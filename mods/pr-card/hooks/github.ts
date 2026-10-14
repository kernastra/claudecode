// GitHub data: the one GraphQL query a card needs, its normalization, and error classification.
// Everything here is pure, so tests feed it recorded and malformed responses directly.

import type { CheckState, PrCheck, PrData, PrError, PrReview, PrReviewState, PrThread } from '../types'
import { keyOf, type PrRef } from './refs'

export const FILES_PAGE = 100
export const CHECKS_PAGE = 100
export const THREADS_PAGE = 100
export const COMMENTS_PAGE = 20

/** Read-only. `isRequired` needs the PR number, so the query takes it twice over. */
export const PR_QUERY = `query($owner:String!,$name:String!,$number:Int!){
  viewer{login}
  repository(owner:$owner,name:$name){
    nameWithOwner viewerPermission
    pullRequest(number:$number){
      number title url state isDraft updatedAt maintainerCanModify
      author{login}
      headRefName baseRefName headRefOid isCrossRepository
      headRepositoryOwner{login}
      additions deletions changedFiles
      mergeable mergeStateStatus reviewDecision
      files(first:${FILES_PAGE}){totalCount nodes{path additions deletions}}
      commits(last:5){totalCount nodes{commit{oid messageHeadline committedDate url
        statusCheckRollup{state contexts(first:${CHECKS_PAGE}){totalCount nodes{
          __typename
          ... on CheckRun{name status conclusion detailsUrl isRequired(pullRequestNumber:$number) checkSuite{workflowRun{workflow{name}}}}
          ... on StatusContext{context state targetUrl isRequired(pullRequestNumber:$number)}
        }}}}}}
      latestOpinionatedReviews(first:30){nodes{author{login} state submittedAt url}}
      reviewRequests(first:20){nodes{requestedReviewer{__typename ... on User{login} ... on Team{name} ... on Bot{login} ... on Mannequin{login}}}}
      reviewThreads(first:${THREADS_PAGE}){totalCount nodes{id isResolved isOutdated path line originalLine startLine
        comments(first:${COMMENTS_PAGE}){totalCount nodes{id author{login} body url createdAt diffHunk}}}}
    }
  }
}`

export function prQueryArgv(ref: PrRef): string[] {
  return [
    'gh', 'api', 'graphql',
    '-F', `owner=${ref.owner}`,
    '-F', `name=${ref.repo}`,
    '-F', `number=${ref.number}`,
    '-f', `query=${PR_QUERY}`,
  ]
}

export class GitHubError extends Error {
  constructor(readonly info: PrError) {
    super(info.message)
  }
}

const TOKEN_PATTERNS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b(authorization|token|bearer)\s*[:=]?\s*\S+/gi,
  /https?:\/\/[^/\s:@]+:[^/\s@]+@/g,
]

/** Removes anything token-shaped, so no message the card or the model reads carries a credential. */
export function redact(text: string): string {
  let out = text
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, '[redacted]')
  return out
}

/** One sentence the card can show, from `gh`'s exit and stderr. Never the raw stderr. */
export function classifyGhFailure(stderr: string, stdout = ''): PrError {
  const text = `${stderr}\n${stdout}`
  if (/rate limit|abuse detection|secondary rate/i.test(text))
    return { kind: 'rate-limit', message: 'GitHub rate limit reached. The card keeps its last data and retries later.' }
  if (/gh auth login|not logged in|authentication required|HTTP 401|bad credentials|token .*(expired|revoked)/i.test(text))
    return { kind: 'auth', message: 'GitHub CLI is not authenticated. Run `gh auth login`, then refresh.' }
  if (/Could not resolve to a (Repository|PullRequest)|NOT_FOUND|HTTP 404/i.test(text))
    return { kind: 'not-found', message: 'Pull request not found, or this account cannot see the repository.' }
  if (/HTTP 403|Resource not accessible|SAML|forbidden|INSUFFICIENT_SCOPES|scope/i.test(text))
    return { kind: 'forbidden', message: 'GitHub denied access. The token may lack the `repo` scope or SSO authorization.' }
  if (/error connecting|dial tcp|could not resolve host|timeout|timed out|network is unreachable|connection refused|TLS handshake|no such host/i.test(text))
    return { kind: 'network', message: 'Could not reach GitHub. Check the network, then refresh.' }
  const first = redact(stderr.trim().split('\n')[0] ?? '').slice(0, 160)
  return { kind: 'unknown', message: first ? `GitHub CLI failed: ${first}` : 'GitHub CLI failed with no message.' }
}

export function classifySpawnFailure(error: unknown): PrError {
  const text = error instanceof Error ? error.message : String(error)
  if (/ENOENT|not found|no such file|spawn/i.test(text))
    return { kind: 'gh-missing', message: 'GitHub CLI (`gh`) is not installed or not on PATH. Install it from https://cli.github.com.' }
  if (/time/i.test(text)) return { kind: 'network', message: 'GitHub CLI timed out. Check the network, then refresh.' }
  return { kind: 'unknown', message: redact(text).slice(0, 160) }
}

type Json = Record<string, unknown>
const obj = (value: unknown): Json | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null)
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const intOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) ? value : null)
const login = (value: unknown): string | null => str(obj(value)?.login)
const nodes = (value: unknown): unknown[] => arr(obj(value)?.nodes)
const total = (value: unknown, fallback: number): number => {
  const count = obj(value)?.totalCount
  return typeof count === 'number' ? count : fallback
}

/** GitHub's check-run status/conclusion and commit-status state, as one state. */
export function checkStateOf(node: Json): CheckState {
  if (node.__typename === 'StatusContext') {
    switch (node.state) {
      case 'SUCCESS': return 'success'
      case 'FAILURE': return 'failure'
      case 'ERROR': return 'error'
      case 'PENDING': return 'pending'
      case 'EXPECTED': return 'pending'
      default: return 'unknown'
    }
  }
  const status = str(node.status)
  if (status === 'QUEUED' || status === 'WAITING' || status === 'REQUESTED' || status === 'PENDING') return 'queued'
  if (status === 'IN_PROGRESS') return 'in_progress'
  if (status !== 'COMPLETED') return 'unknown'
  switch (node.conclusion) {
    case 'SUCCESS': return 'success'
    case 'FAILURE': return 'failure'
    case 'CANCELLED': return 'cancelled'
    case 'TIMED_OUT': return 'timed_out'
    case 'ACTION_REQUIRED': return 'action_required'
    case 'SKIPPED': return 'skipped'
    case 'NEUTRAL': return 'neutral'
    case 'STALE': return 'stale'
    case 'STARTUP_FAILURE': return 'failure'
    default: return 'unknown'
  }
}

const httpsUrl = (value: unknown): string | undefined => {
  const text = str(value)
  return text && /^https:\/\/[\x21-\x7e]+$/.test(text) && text.length <= 2048 ? text : undefined
}

function checkOf(node: Json): PrCheck {
  const isStatus = node.__typename === 'StatusContext'
  const workflow = str(obj(obj(obj(node.checkSuite)?.workflowRun)?.workflow)?.name) ?? undefined
  const required = node.isRequired
  return {
    name: (isStatus ? str(node.context) : str(node.name)) ?? 'Unnamed check',
    workflow,
    state: checkStateOf(node),
    url: httpsUrl(isStatus ? node.targetUrl : node.detailsUrl),
    isRequired: typeof required === 'boolean' ? required : null,
  }
}

const REVIEW_STATES: readonly PrReviewState[] = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']

function threadOf(node: Json): PrThread {
  const comments = nodes(node.comments).map(raw => {
    const comment = obj(raw) ?? {}
    return {
      id: str(comment.id) ?? '',
      author: login(comment.author) ?? 'ghost',
      body: str(comment.body) ?? '',
      url: httpsUrl(comment.url),
      createdAt: str(comment.createdAt) ?? undefined,
    }
  })
  const firstHunk = str(obj(nodes(node.comments)[0])?.diffHunk) ?? undefined
  return {
    id: str(node.id) ?? '',
    path: str(node.path) ?? '',
    line: intOrNull(node.line),
    originalLine: intOrNull(node.originalLine),
    startLine: intOrNull(node.startLine),
    isResolved: node.isResolved === true,
    isOutdated: node.isOutdated === true,
    diffHunk: firstHunk,
    comments,
    totalComments: total(node.comments, comments.length),
  }
}

/**
 * The `gh api graphql` response as PrData. Throws GitHubError on GraphQL errors or a
 * response missing the pull request, so a half-read card never claims anything.
 */
export function normalizePr(raw: unknown, ref: PrRef): PrData {
  const root = obj(raw)
  const errors = arr(root?.errors)
  const repository = obj(obj(root?.data)?.repository)
  const pr = obj(repository?.pullRequest)
  if (!pr) {
    const message = errors.map(error => str(obj(error)?.message) ?? '').join('\n')
    if (errors.length > 0) throw new GitHubError(classifyGhFailure(message))
    throw new GitHubError({ kind: repository ? 'not-found' : 'malformed', message: repository ? 'Pull request not found.' : 'GitHub returned an unexpected response.' })
  }
  const number = intOrNull(pr.number)
  const url = httpsUrl(pr.url)
  const state = str(pr.state)
  if (number === null || !url || (state !== 'OPEN' && state !== 'CLOSED' && state !== 'MERGED'))
    throw new GitHubError({ kind: 'malformed', message: 'GitHub returned a pull request without its number, URL or state.' })

  const commitNodes = nodes(pr.commits).map(node => obj(obj(node)?.commit) ?? {})
  const head = commitNodes[commitNodes.length - 1] ?? {}
  const rollup = obj(head.statusCheckRollup)
  const mergeable = str(pr.mergeable)
  const decision = str(pr.reviewDecision)
  const [owner, repo] = (str(repository?.nameWithOwner) ?? `${ref.owner}/${ref.repo}`).split('/') as [string, string]
  const reviewers = nodes(pr.reviewRequests)
    .map(node => obj(obj(node)?.requestedReviewer))
    .map(reviewer => (reviewer ? (str(reviewer.login) ?? str(reviewer.name)) : null))
    .filter((name): name is string => !!name)

  return {
    key: keyOf({ owner, repo, number }),
    owner,
    repo,
    number,
    title: str(pr.title) ?? '(untitled)',
    url,
    state,
    isDraft: pr.isDraft === true,
    author: login(pr.author),
    headRef: str(pr.headRefName) ?? '',
    baseRef: str(pr.baseRefName) ?? '',
    headSha: str(pr.headRefOid) ?? str(head.oid) ?? '',
    headOwner: login(pr.headRepositoryOwner),
    isCrossRepository: pr.isCrossRepository === true,
    additions: num(pr.additions),
    deletions: num(pr.deletions),
    changedFiles: num(pr.changedFiles),
    mergeable: mergeable === 'MERGEABLE' || mergeable === 'CONFLICTING' ? mergeable : 'UNKNOWN',
    mergeStateStatus: str(pr.mergeStateStatus),
    reviewDecision: decision === 'APPROVED' || decision === 'CHANGES_REQUESTED' || decision === 'REVIEW_REQUIRED' ? decision : null,
    checksRollup: str(rollup?.state),
    checks: nodes(rollup?.contexts).map(node => checkOf(obj(node) ?? {})),
    checksTotal: total(rollup?.contexts, 0),
    files: nodes(pr.files).map(node => {
      const file = obj(node) ?? {}
      return { path: str(file.path) ?? '', additions: num(file.additions), deletions: num(file.deletions) }
    }),
    filesTotal: total(pr.files, num(pr.changedFiles)),
    commits: commitNodes
      .map(commit => ({
        sha: str(commit.oid) ?? '',
        headline: str(commit.messageHeadline) ?? '',
        url: httpsUrl(commit.url),
        date: str(commit.committedDate) ?? undefined,
      }))
      .reverse(),
    commitsTotal: total(pr.commits, commitNodes.length),
    reviews: nodes(pr.latestOpinionatedReviews)
      .map(node => obj(node) ?? {})
      .filter(review => REVIEW_STATES.includes(review.state as PrReviewState))
      .map(
        (review): PrReview => ({
          author: login(review.author) ?? 'ghost',
          state: review.state as PrReviewState,
          submittedAt: str(review.submittedAt) ?? undefined,
          url: httpsUrl(review.url),
        }),
      ),
    reviewRequests: reviewers,
    threads: nodes(pr.reviewThreads).map(node => threadOf(obj(node) ?? {})),
    threadsTotal: total(pr.reviewThreads, 0),
    viewer: login(obj(root?.data)?.viewer),
    viewerPermission: str(repository?.viewerPermission),
    maintainerCanModify: pr.maintainerCanModify === true,
    updatedAt: str(pr.updatedAt) ?? undefined,
  }
}

/** `gh pr list --json number,url,title,state,headRepositoryOwner` rows. */
export type ListedPr = { number: number; url: string; title: string; state: string; headOwner: string | null }

export function parsePrList(stdout: string): ListedPr[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new GitHubError({ kind: 'malformed', message: 'GitHub CLI returned unreadable PR list output.' })
  }
  return arr(parsed)
    .map(node => obj(node) ?? {})
    .filter(row => intOrNull(row.number) !== null && httpsUrl(row.url))
    .map(row => ({
      number: row.number as number,
      url: row.url as string,
      title: str(row.title) ?? '',
      state: str(row.state) ?? 'OPEN',
      headOwner: login(row.headRepositoryOwner),
    }))
}
