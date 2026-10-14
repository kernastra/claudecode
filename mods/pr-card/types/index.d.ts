/** `owner/repo#123`, the one key a PR is stored and drawn under. */
export type PrKey = string

export type PrState = 'OPEN' | 'CLOSED' | 'MERGED'

/** One normalized CI state; the GitHub check-run and commit-status vocabularies folded together. */
export type CheckState =
  | 'queued'
  | 'in_progress'
  | 'pending'
  | 'success'
  | 'failure'
  | 'error'
  | 'cancelled'
  | 'timed_out'
  | 'action_required'
  | 'skipped'
  | 'neutral'
  | 'stale'
  | 'unknown'

export type PrCheck = {
  name: string
  workflow?: string
  state: CheckState
  url?: string
  /** null when GitHub could not say (no branch protection data for the viewer). */
  isRequired: boolean | null
}

export type PrReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'

export type PrReview = { author: string; state: PrReviewState; submittedAt?: string; url?: string }

export type PrThreadComment = { id: string; author: string; body: string; url?: string; createdAt?: string }

export type PrThread = {
  id: string
  path: string
  line: number | null
  originalLine: number | null
  startLine: number | null
  isResolved: boolean
  isOutdated: boolean
  diffHunk?: string
  comments: PrThreadComment[]
  totalComments: number
}

export type PrFile = { path: string; additions: number; deletions: number }

export type PrCommit = { sha: string; headline: string; url?: string; date?: string }

export type PrData = {
  key: PrKey
  owner: string
  repo: string
  number: number
  title: string
  url: string
  state: PrState
  isDraft: boolean
  author: string | null
  headRef: string
  baseRef: string
  headSha: string
  headOwner: string | null
  isCrossRepository: boolean
  additions: number
  deletions: number
  changedFiles: number
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  mergeStateStatus: string | null
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  /** The combined rollup GitHub computes for the head commit; null when the commit has no checks. */
  checksRollup: string | null
  checks: PrCheck[]
  checksTotal: number
  files: PrFile[]
  filesTotal: number
  commits: PrCommit[]
  commitsTotal: number
  reviews: PrReview[]
  reviewRequests: string[]
  threads: PrThread[]
  threadsTotal: number
  viewer: string | null
  viewerPermission: string | null
  maintainerCanModify: boolean
  updatedAt?: string
}

export type PrErrorKind =
  | 'gh-missing'
  | 'auth'
  | 'not-found'
  | 'forbidden'
  | 'rate-limit'
  | 'network'
  | 'malformed'
  | 'unknown'

export type PrError = { kind: PrErrorKind; message: string }

export type PrEntry = {
  data?: PrData
  error?: PrError
  /** When the last successful fetch finished (ms since epoch). */
  fetchedAt?: number
  isLoading: boolean
  /** Monotonic id of the fetch that last wrote this entry; an older fetch never overwrites a newer one. */
  seq: number
  /** No background refresh before this time (set after a rate limit). */
  backoffUntil?: number
}

/** Which card a transcript row draws: the PR it is bound to. */
export type CardBinding = { key: PrKey; reason: 'create' | 'push' | 'view' | 'tool' }

export type CardSection = 'checks' | 'reviews' | 'files' | 'commits'

/** Per drawn card: which section is open and which thread is expanded. */
export type CardUi = { section: CardSection | null; thread: string | null }

/** The bar above the prompt: whether it shows, and which PR it follows. */
export type BandState = { on: boolean; key: PrKey | null; dismissed?: boolean }

/** A review fix Claude was asked to make, from the press until its turn completes. */
export type FixTask = { key: PrKey; threadId: string; pressedAt: number; isRunning: boolean }

declare module 'claude-code' {
  interface PluginState {
    'github-pr-card': {
      prs: Record<PrKey, PrEntry>
      bindings: Record<string, CardBinding>
      ui: Record<string, CardUi>
      fix: FixTask | null
      band: BandState
      /** The PR the details pane shows. */
      details: PrKey | null
    }
  }
}
