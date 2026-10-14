import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

import type { BandState, CardBinding, CardSection, CardUi, FixTask, PrData, PrEntry, PrThread } from '../types'
import { renderBand } from './band'
import { renderCard, renderChoice, renderDetails } from './card'
import { renderTilesCard } from './card-tiles'
import { classifyGhFailure, classifySpawnFailure, GitHubError, normalizePr, parsePrList, prQueryArgv, redact } from './github'
import { buildFixPrompt, excerptAround } from './prompt'
import {
  candidateRepos,
  findPrUrls,
  isGitPush,
  isPrCreate,
  isPrView,
  isSensitiveDuringFix,
  keyOf,
  parseGitHubRemote,
  parsePrArg,
  parseRemotes,
  refOfKey,
  sameRepo,
  type PrRef,
} from './refs'
import { isSettling, modelSummary } from './status'

const PLUGIN = 'github-pr-card'
const COMMAND = 'pr'
const TOOL_NAME = 'show_pr_card'
const TOOL = 'mcp__github-pr-card__show_pr_card'
const CARD_PREFIX = 'GitHub PR card:'
/** The side pane the PR bar's Details button and /pr-details open. */
const DETAILS_PANE = 'pr-details'

const prs = atom({ plugin: 'github-pr-card', key: 'prs' } as const, {} as Record<string, PrEntry>)
const bindings = atom({ plugin: 'github-pr-card', key: 'bindings' } as const, {} as Record<string, CardBinding>)
const cardUi = atom({ plugin: 'github-pr-card', key: 'ui' } as const, {} as Record<string, CardUi>)
const fixTask = atom({ plugin: 'github-pr-card', key: 'fix' } as const, null as FixTask | null)
const detailsAtom = atom({ plugin: 'github-pr-card', key: 'details' } as const, null as string | null)
const bandAtom = atom({ plugin: 'github-pr-card', key: 'band' } as const, { on: false, key: null } as BandState)

const CLOSED_UI: CardUi = { section: null, thread: null }
const FRESH_MS = 15_000
const SEEN_WINDOW_MS = 30 * 60_000
const RATE_LIMIT_BACKOFF_MS = 5 * 60_000
const DISCOVERY_TTL_MS = 30_000

// Module state: rebuilt on reload, and nothing here is needed to draw (that lives in $.state).
const inflight = new Map<string, Promise<void>>()
const lastSeen = new Map<string, number>()
// When the PR bar's art started, so each redraw continues the animation instead of restarting it.
let bandArtStartedAt = 0
let seqCounter = 0
let discoveryCache: { signature: string; at: number; outcome: Target } | null = null

type $ = EngineInterface
type RenderInput = Parameters<EngineInterface['ui']['resolve']>[0] & { requestId: string; viewport?: { columns: number } }

type Target =
  | { kind: 'found'; key: string }
  | { kind: 'multiple'; keys: string[]; branch: string }
  | { kind: 'none'; message: string }

async function run($: $, argv: string[], timeoutMs = 20_000): Promise<ProcessRunResult> {
  try {
    return await $.process.run(argv, { timeoutMs, env: { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', NO_COLOR: '1' } })
  } catch (error) {
    throw new GitHubError(classifySpawnFailure(error))
  }
}

async function git($: $, args: string[]): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', ...args], { timeoutMs: 10_000 })
    return ran.exitCode === 0 ? ran.stdout.trim() : null
  } catch {
    return null
  }
}

async function fetchPr($: $, ref: PrRef): Promise<PrData> {
  const ran = await run($, prQueryArgv(ref))
  let parsed: unknown
  try {
    parsed = JSON.parse(ran.stdout)
  } catch {
    if (ran.exitCode !== 0) throw new GitHubError(classifyStderr(ran))
    throw new GitHubError({ kind: 'malformed', message: 'GitHub CLI returned unreadable output.' })
  }
  // `gh api graphql` exits 1 with the GraphQL errors as JSON on stdout; normalizePr classifies them.
  if (ran.exitCode !== 0 && !(parsed && typeof parsed === 'object' && 'errors' in parsed)) throw new GitHubError(classifyStderr(ran))
  return normalizePr(parsed, ref)
}

function classifyStderr(ran: ProcessRunResult) {
  return classifyGhFailure(ran.stderr, ran.stdout)
}

/**
 * Fetches one PR into state. Concurrent calls for a key share one request; a slower,
 * older fetch never overwrites a newer one; a failure keeps the last good data.
 */
function refresh($: $, key: string): Promise<void> {
  const running = inflight.get(key)
  if (running) return running
  const ref = refOfKey(key)
  if (!ref) return Promise.resolve()
  const seq = Date.now() * 1000 + (seqCounter++ % 1000)
  const job = (async () => {
    await update($, prs, all => ({ ...all, [key]: { ...(all[key] ?? { seq: 0 }), isLoading: true } }))
    try {
      const data = await fetchPr($, ref)
      const fetchedAt = Date.now()
      await update($, prs, all => {
        const current = all[key]
        if (current && current.seq > seq) return all
        // Stored under the key it was asked for, so a renamed repository still matches its rows.
        return { ...all, [key]: { data: { ...data, key }, fetchedAt, isLoading: false, seq } }
      })
    } catch (error) {
      const info = error instanceof GitHubError ? error.info : { kind: 'unknown' as const, message: redact(String(error)).slice(0, 160) }
      await update($, prs, all => {
        const current = all[key] ?? { seq: 0, isLoading: false }
        if (current.seq > seq) return all
        return {
          ...all,
          [key]: {
            ...current,
            error: info,
            isLoading: false,
            seq,
            backoffUntil: info.kind === 'rate-limit' ? Date.now() + RATE_LIMIT_BACKOFF_MS : current.backoffUntil,
          },
        }
      })
    }
  })().finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

/** Refreshes unless a successful fetch is younger than `maxAgeMs`. */
async function ensure($: $, key: string, maxAgeMs = FRESH_MS): Promise<void> {
  const entry = (await read($, prs))[key]
  if (entry?.data && !entry.error && entry.fetchedAt && Date.now() - entry.fetchedAt < maxAgeMs) return
  await refresh($, key)
}

/**
 * The PR for the current branch: GitHub remotes ranked upstream, origin, rest; the head
 * owner taken from the branch's push remote so a fork's PR is told from upstream's own.
 */
async function discover($: $): Promise<Target> {
  const top = await git($, ['rev-parse', '--show-toplevel'])
  if (top === null) return { kind: 'none', message: 'This folder is not a git repository. Run `/pr <owner/repo#number>` or `/pr <url>`.' }
  const branch = await git($, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (branch === null) return { kind: 'none', message: 'HEAD is detached, so no branch maps to a PR. Run `/pr <number>` to pick one.' }
  const remotes = parseRemotes((await git($, ['remote', '-v'])) ?? '')
  const repos = candidateRepos(remotes)
  if (repos.length === 0) return { kind: 'none', message: 'No GitHub remote in this repository (github.com only).' }

  const trackingRemote = await git($, ['config', '--get', `branch.${branch}.remote`])
  const merge = await git($, ['config', '--get', `branch.${branch}.merge`])
  const pushRemote = (await git($, ['config', '--get', `branch.${branch}.pushRemote`])) ?? (await git($, ['config', '--get', 'remote.pushDefault'])) ?? trackingRemote
  const headBranch = merge?.replace(/^refs\/heads\//, '') || branch
  const pushUrl = remotes.find(remote => remote.name === pushRemote)?.url
  const headOwner = (pushUrl && parseGitHubRemote(pushUrl)?.owner) ?? repos.find(repo => repo.remote === 'origin')?.owner ?? null

  const signature = `${top}|${branch}|${headBranch}|${headOwner}|${repos.map(repo => `${repo.owner}/${repo.repo}`).join(',')}`
  if (discoveryCache && discoveryCache.signature === signature && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) return discoveryCache.outcome

  const listFor = async (repo: { owner: string; repo: string }, state: 'open' | 'all') => {
    const ran = await run($, ['gh', 'pr', 'list', '--repo', `${repo.owner}/${repo.repo}`, '--head', headBranch, '--state', state, '--limit', '10', '--json', 'number,url,title,state,headRepositoryOwner'])
    if (ran.exitCode !== 0) throw new GitHubError(classifyStderr(ran))
    return parsePrList(ran.stdout)
      .filter(row => !headOwner || !row.headOwner || row.headOwner.toLowerCase() === headOwner.toLowerCase())
      .map(row => keyOf({ owner: repo.owner, repo: repo.repo, number: row.number }))
  }

  let outcome: Target
  try {
    let keys: string[] = []
    for (const repo of repos) keys.push(...(await listFor(repo, 'open')))
    if (keys.length === 0) keys = await listFor(repos[0]!, 'all')
    keys = [...new Set(keys)]
    if (keys.length === 1) outcome = { kind: 'found', key: keys[0]! }
    else if (keys.length > 1) outcome = { kind: 'multiple', keys, branch: headBranch }
    else outcome = { kind: 'none', message: `No pull request for branch \`${headBranch}\` in ${repos.map(repo => `${repo.owner}/${repo.repo}`).join(' or ')}.` }
  } catch (error) {
    const info = error instanceof GitHubError ? error.info : classifySpawnFailure(error)
    return { kind: 'none', message: info.message }
  }
  discoveryCache = { signature, at: Date.now(), outcome }
  return outcome
}

async function resolveTarget($: $, raw: string): Promise<Target> {
  const arg = parsePrArg(raw)
  switch (arg.kind) {
    case 'none':
      return discover($)
    case 'ref':
      return { kind: 'found', key: keyOf(arg.ref) }
    case 'number': {
      const repos = candidateRepos(parseRemotes((await git($, ['remote', '-v'])) ?? ''))
      if (repos.length === 0) return { kind: 'none', message: `No GitHub remote here to resolve #${arg.number}. Use \`/pr owner/repo#${arg.number}\`.` }
      return { kind: 'found', key: keyOf({ ...repos[0]!, number: arg.number }) }
    }
    default:
      return { kind: 'none', message: `Not a PR reference: \`${arg.text}\`. Use a number, owner/repo#number, or a PR URL.` }
  }
}

async function bind($: $, requestId: string, binding: CardBinding) {
  await update($, bindings, all => {
    const next = { ...all, [requestId]: binding }
    const ids = Object.keys(next)
    // Keep the map bounded across a long session; the oldest bindings go first.
    for (const id of ids.slice(0, Math.max(0, ids.length - 400))) delete next[id]
    return next
  })
}

/** The PR's file and line on disk, when this checkout is that repository. */
async function localExcerpt($: $, pr: PrData, thread: PrThread) {
  if (!thread.path || thread.path.startsWith('/') || thread.path.split('/').includes('..')) return undefined
  const repos = candidateRepos(parseRemotes((await git($, ['remote', '-v'])) ?? ''))
  if (!repos.some(repo => sameRepo(repo, pr))) return undefined
  const top = await git($, ['rev-parse', '--show-toplevel'])
  if (!top) return undefined
  try {
    const content = await $.fs.read(`${top}/${thread.path}`)
    return excerptAround(content, thread.line ?? thread.originalLine)
  } catch {
    return undefined
  }
}

async function fixPrompt($: $, pr: PrData, thread: PrThread): Promise<string> {
  const localBranch = await git($, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  return buildFixPrompt({ pr, thread, localBranch, excerpt: await localExcerpt($, pr, thread) })
}

/** Binds a finished Bash call's row to its PR, discovering the branch's PR after a push. */
async function attachCard($: $, attach: { id: string; ref: PrRef | undefined; reason: CardBinding['reason']; bindRow: boolean; autoBar: boolean }) {
  let ref = attach.ref
  if (!ref) {
    discoveryCache = null
    const target = await discover($)
    if (target.kind !== 'found') return
    ref = refOfKey(target.key) ?? undefined
  }
  if (!ref) return
  const key = keyOf(ref)
  if (attach.bindRow) await bind($, attach.id, { key, reason: attach.reason })
  // The bar follows the PR; in auto mode a push also brings it up, unless ✕ hid it this session.
  await update($, bandAtom, band => (band.on || (attach.autoBar && !band.dismissed) ? { ...band, on: true, key } : band))
  await refresh($, key)
  // GitHub registers new check runs a few seconds after a push.
  if (attach.reason !== 'view') $.clock.after(12_000, () => void refresh($, key).catch(() => undefined))
}

/** `panel` is the installed design; `tiles` the effortless-style one behind /pr-tiles. */
async function drawCard($: $, e: RenderInput, key: string, design: 'panel' | 'tiles' | 'details' = 'panel') {
  lastSeen.set(key, Date.now())
  const els = $.ui.resolve(e)
  const entry = (await read($, prs))[key]
  const ui = (await read($, cardUi))[e.requestId] ?? CLOSED_UI
  const task = await read($, fixTask)
  if (!entry || (!entry.data && !entry.error && !entry.isLoading)) $.clock.after(0, () => void ensure($, key).catch(() => undefined))
  const requestId = e.requestId
  const render = design === 'tiles' ? renderTilesCard : design === 'details' ? renderDetails : renderCard
  return render({
    els,
    surface: e.surface,
    prKey: key,
    entry,
    ui,
    fixBusy: !!task,
    columns: e.viewport?.columns ?? 80,
    actions: {
      toggleSection: (section: CardSection) =>
        void update($, cardUi, all => {
          const current = all[requestId] ?? CLOSED_UI
          return { ...all, [requestId]: { section: current.section === section ? null : section, thread: current.thread } }
        }),
      toggleThread: (threadId: string) =>
        void update($, cardUi, all => {
          const current = all[requestId] ?? CLOSED_UI
          return { ...all, [requestId]: { ...current, thread: current.thread === threadId ? null : threadId } }
        }),
      refresh: () => {
        discoveryCache = null
        void refresh($, key)
      },
      fix: (thread: PrThread) =>
        void (async () => {
          const pr = (await read($, prs))[key]?.data
          if (!pr) return
          const pending = await read($, fixTask)
          // A press whose prompt never started a turn (refused, crashed) frees up after five minutes.
          if (pending && (pending.isRunning || Date.now() - pending.pressedAt < 5 * 60_000)) {
            $.ui.toast('A Fix with Claude task is already queued or running.')
            return
          }
          const text = await fixPrompt($, pr, thread)
          await update($, fixTask, () => ({ key, threadId: thread.id, pressedAt: Date.now(), isRunning: false }))
          $.ui.toast('Sent the review thread to Claude. Pushes and GitHub writes will ask you first.', { timeoutMs: 6000 })
          await $.prompt.submit({ text })
        })().catch(() => {
          void update($, fixTask, () => null)
          $.ui.toast('Could not start the fix. Use Copy prompt instead.')
        }),
      copyPrompt: (thread: PrThread) =>
        void (async () => {
          const pr = (await read($, prs))[key]?.data
          if (!pr) return
          const copied = await $.ui.copy({ text: await fixPrompt($, pr, thread), surface: e.surface })
          $.ui.toast(copied.isCopied ? 'Fix prompt copied.' : 'Could not reach the clipboard here.')
        })(),
    },
  })
}

/** `owner/repo#n` from a status line this plugin wrote (`GitHub PR card: owner/repo#n ...`). */
function keyFromCardText(text: unknown): string | null {
  const raw = typeof text === 'string' ? text : Array.isArray(text) ? String((text[0] as { text?: unknown } | undefined)?.text ?? '') : ''
  // The host may put the plugin's name in front (`github-pr-card: GitHub PR card: ...`).
  const at = raw.indexOf(CARD_PREFIX)
  if (at < 0 || at > 40) return null
  const key = raw.slice(at + CARD_PREFIX.length).trim().match(/^(\S+#\d+)\s/)?.[1]
  return key && refOfKey(key) ? key : null
}

/** What /pr and /pr-tiles print: the status line the card is drawn from, or why there is no card. */
async function runPr($: $, args: string): Promise<{ text: string }> {
  discoveryCache = null
  const target = await resolveTarget($, args)
  if (target.kind === 'none') return { text: `${CARD_PREFIX} ${target.message}` }
  if (target.kind === 'multiple')
    return { text: `${CARD_PREFIX} several pull requests match \`${target.branch}\`: ${target.keys.join(', ')}. Run \`/pr <owner/repo#number>\` to pick one.` }
  await ensure($, target.key, 5_000)
  const entry = (await read($, prs))[target.key]
  if (entry?.data) return { text: modelSummary(entry.data) }
  return { text: `${CARD_PREFIX} ${target.key} — ${entry?.error?.message ?? 'not loaded'}` }
}

/** The PR bar above the prompt, stacked over whatever else draws there (the usage band). */
async function drawBand($: $, e: RenderInput & { props: { bodyColumns: number } }, key: string) {
  lastSeen.set(key, Date.now())
  const entry = (await read($, prs))[key]
  if (!entry || (!entry.data && !entry.error && !entry.isLoading)) $.clock.after(0, () => void ensure($, key).catch(() => undefined))
  if (!bandArtStartedAt) bandArtStartedAt = Date.now()
  return renderBand({
    artElapsedMs: Date.now() - bandArtStartedAt,
    els: $.ui.resolve(e),
    surface: e.surface,
    columns: e.props.bodyColumns,
    prKey: key,
    entry,
    actions: {
      details: () => void openDetails($, key).catch(() => $.ui.toast('Could not open the PR details pane.')),
      refresh: () => void refresh($, key),
      hide: () => void update($, bandAtom, band => ({ ...band, on: false, dismissed: true })),
    },
  })
}

/** Shows the PR bar for the current branch's PR when there is exactly one and the bar is not already up. */
async function showBranchBar($: $) {
  const band = await read($, bandAtom)
  if (band.on || band.dismissed) return
  const target = await discover($)
  if (target.kind !== 'found') return
  await update($, bandAtom, current => (current.on || current.dismissed ? current : { ...current, on: true, key: target.key }))
  await ensure($, target.key)
}

/** Shows `key` in the details pane, opening it (the press or command that calls this is the person's own). */
async function openDetails($: $, key: string) {
  await update($, detailsAtom, () => key)
  const ref = refOfKey(key)
  await $.ui.open({ id: DETAILS_PANE, title: ref ? `PR #${ref.number}` : 'PR details', focus: true, closeOnEscape: true })
  await ensure($, key)
}

export const register: Register = (on, options) => {
  const pollSeconds = typeof options.pollSeconds === 'number' ? options.pollSeconds : 60
  const autoAttach = options.autoAttach !== false
  const autoBar = options.prBar !== 'manual'
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show the GitHub pull request card for this branch, a number, owner/repo#n, or a URL',
      argumentHint: '[number | owner/repo#n | url]',
    })
    // The same card in the effortless-style tiles layout.
    await $.command.register({
      name: 'pr-tiles',
      description: 'Show the GitHub PR card in the tiles design',
      argumentHint: '[number | owner/repo#n | url]',
    })
    await $.command.register({
      name: 'pr-band',
      description: 'Show or hide the GitHub PR bar above the prompt',
      argumentHint: '[number | owner/repo#n | url]',
    })
    await $.command.register({
      name: 'pr-details',
      description: 'Open the full GitHub PR view in a side pane',
      argumentHint: '[number | owner/repo#n | url]',
    })
    await $.tool.register({
      name: TOOL_NAME,
      description:
        'Show the live GitHub pull request card inline in the conversation for the person: state, CI checks, reviews and unresolved threads. ' +
        'Call it after creating a PR or when the person asks about a PR\'s status. `ref` is a PR URL, owner/repo#123, a number, or empty for the current branch. ' +
        'The result is a one-line status; review comment text is not returned.',
      inputSchema: {
        type: 'object',
        properties: { ref: { type: 'string', description: 'PR URL, owner/repo#123, a PR number, or empty for the current branch' } },
      },
    })
    // Auto mode: the bar comes up for the branch's PR, off the start path (discovery calls git and gh).
    if (autoBar) $.clock.after(1500, () => void showBranchBar($).catch(() => undefined))
    if (pollSeconds > 0) {
      const pollMs = Math.max(15, pollSeconds) * 1000
      $.clock.every(pollMs, () => {
        void (async () => {
          const now = Date.now()
          const all = await read($, prs)
          for (const [key, entry] of Object.entries(all)) {
            if (now - (lastSeen.get(key) ?? 0) > SEEN_WINDOW_MS) continue
            if (entry.backoffUntil && entry.backoffUntil > now) continue
            if (entry.fetchedAt && now - entry.fetchedAt < pollMs * 0.8) continue
            const retry = entry.error && (entry.error.kind === 'network' || entry.error.kind === 'rate-limit')
            if ((entry.data && isSettling(entry.data)) || retry) await refresh($, key)
          }
        })().catch(() => undefined)
      })
    }
    return next(e)
  })

  // The model's tool: draws the card on its own result row.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const target = await resolveTarget($, String((e as { ref?: unknown }).ref ?? ''))
    if (target.kind === 'none') return { deny: target.message }
    if (target.kind === 'multiple')
      return { deny: `Several PRs match branch ${target.branch}: ${target.keys.join(', ')}. Ask the person which one, then call again with that ref.` }
    await bind($, e.tool_use_id, { key: target.key, reason: 'tool' })
    await ensure($, target.key, 5_000)
    const entry = (await read($, prs))[target.key]
    if (!entry?.data) return { deny: entry?.error?.message ?? 'The pull request could not be loaded.' }
    // A plugin tool's result is text (or content blocks); the card reads its key back from the prefix.
    return { result: modelSummary(entry.data) }
  }).catch(() => ({ deny: 'github-pr-card could not load the pull request.' }))

  // Bash: hold review-fix turns to the person's approval for pushes and GitHub writes,
  // and attach a card under successful PR creation, views and pushes.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const command = typeof e.command === 'string' ? e.command : ''
    const task = await read($, fixTask)
    const why = task?.isRunning ? isSensitiveDuringFix(command) : null
    if (why) {
      let answer = 'Deny'
      try {
        answer = await $.ui.ask(`During a Fix with Claude task, Claude wants to run a command that ${why}:\n\n${command.slice(0, 400)}\n\nAllow it once?`, [
          'Deny',
          'Allow once',
        ])
      } catch {
        answer = 'Deny'
      }
      if (answer !== 'Allow once')
        return { deny: `github-pr-card: the person did not approve a command that ${why} during the review fix. Report the change and ask before pushing or writing to GitHub.` }
    }

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    // With row cards off, a push still moves the PR bar when it is showing.
    if (!autoAttach && !autoBar && !(await read($, bandAtom)).on) return ran
    const output = ran.result as { stdout?: string; gitOperation?: { push?: { branch: string }; pr?: { url?: string; number: number; action: string } } } | undefined
    const op = output?.gitOperation
    const stdout = output?.stdout ?? ''
    const opUrl = op?.pr?.url ? findPrUrls(op.pr.url)[0] : undefined
    const created = op?.pr?.action === 'created' || isPrCreate(command)
    const viewed = isPrView(command)
    const pushed = !!op?.push || isGitPush(command)
    const ref = opUrl ?? (created || viewed ? findPrUrls(stdout)[0] : undefined)
    if (ref || pushed) {
      const attach = { id: e.tool_use_id, ref, reason: created ? 'create' : viewed ? 'view' : 'push', bindRow: autoAttach, autoBar } as const
      $.clock.after(0, () => void attachCard($, attach).catch(() => undefined))
    }
    return ran
  }).catch(async ($, e, next) => {
    // Fail closed only where the hook guards: a sensitive command during a fix is refused.
    const task = await read($, fixTask)
    const why = task?.isRunning && typeof e.command === 'string' ? isSensitiveDuringFix(e.command) : null
    if (why) return { deny: `github-pr-card could not ask for approval of a command that ${why}; it was not run.` }
    return next.called ? undefined : next(e)
  })

  // A review fix: armed when its prompt enters the session, finished when that turn ends.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (e.origin.kind === 'plugin' && 'name' in e.origin && e.origin.name === PLUGIN)
      await update($, fixTask, task => (task ? { ...task, isRunning: true } : task))
    return result
  }).catch(($, e, next) => (next.called ? undefined : next(e)))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const task = await read($, fixTask)
    if (task?.isRunning) {
      await update($, fixTask, () => null)
      $.ui.toast('Review fix finished. The thread stays unresolved until a reviewer resolves it on GitHub.', { timeoutMs: 6000 })
      $.clock.after(0, () => void refresh($, task.key))
    }
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => runPr($, e.args)).catch(() => ({ text: `${CARD_PREFIX} the card failed to load. Run /pr again, or check \`gh auth status\`.` }))

  on('ui.render', { component: 'ToolResult', props: { tool: TOOL } }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const key = keyFromCardText(e.props.output)
    if (!key) return next(e)
    return drawCard($, e, key)
  })

  // Desktop draws a tool call as one ToolUse row carrying its output (no separate ToolResult),
  // so the card hooks both sites.
  // A run of calls the transcript folds into one count line hides the card; unfold a run that holds one.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const holdsCard = e.props.calls.some(call => call.tool === TOOL)
    return holdsCard && !e.props.isExpanded ? next({ ...e, props: { ...e.props, isExpanded: true } }) : next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isRunning || e.props.isErrored) return next(e)
    if (e.props.tool === TOOL) {
      const key = keyFromCardText(e.props.output)
      return key ? drawCard($, e, key) : next(e)
    }
    if (e.props.tool !== 'Bash') return next(e)
    const binding = (await read($, bindings))[e.requestId]
    if (!binding) return next(e)
    const card = await drawCard($, e, binding.key)
    const own = await next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        {own}
        {card}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult', props: { tool: 'Bash' } }, async ($, e, next) => {
    const binding = (await read($, bindings))[e.requestId]
    if (!binding || e.props.isErrored) return next(e)
    const card = await drawCard($, e, binding.key)
    const own = await next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column" gap={1}>
        {own}
        {card}
      </Box>
    )
  })

  on('command.run', { command: 'pr-details' }, async ($, e) => {
    discoveryCache = null
    const target = await resolveTarget($, e.args)
    if (target.kind === 'none') return { text: `${CARD_PREFIX} ${target.message}` }
    if (target.kind === 'multiple')
      return { text: `Several pull requests match \`${target.branch}\`: ${target.keys.join(', ')}. Run \`/pr-details <owner/repo#number>\` to pick one.` }
    await openDetails($, target.key)
    return { text: `Opened ${target.key} in the side pane.` }
  }).catch(() => ({ text: 'The PR details pane failed to open. Check `gh auth status`, then try again.' }))

  on('ui.render', { component: 'Pane', requestId: 'pr-details' }, async ($, e) => {
    const key = await read($, detailsAtom)
    if (!key) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>No pull request selected. Run /pr-details or press Details on the PR bar.</Text>
    }
    return drawCard($, e, key, 'details')
  })

  on('command.run', { command: 'pr-band' }, async ($, e) => {
    const band = await read($, bandAtom)
    if (band.on && !e.args.trim()) {
      await update($, bandAtom, current => ({ ...current, on: false, dismissed: true }))
      return { text: 'PR bar hidden. Run /pr-band to show it again.' }
    }
    discoveryCache = null
    const target = await resolveTarget($, e.args)
    if (target.kind === 'none') return { text: `${CARD_PREFIX} ${target.message}` }
    if (target.kind === 'multiple')
      return { text: `Several pull requests match \`${target.branch}\`: ${target.keys.join(', ')}. Run \`/pr-band <owner/repo#number>\` to pick one.` }
    await update($, bandAtom, () => ({ on: true, key: target.key, dismissed: false }))
    await ensure($, target.key, 5_000)
    return { text: `PR bar on for ${target.key}. It follows PRs Claude pushes; ✕ or /pr-band hides it.` }
  }).catch(() => ({ text: 'The PR bar failed to start. Check `gh auth status`, then run /pr-band again.' }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const band = await read($, bandAtom)
    if (!band.on || !band.key) return below
    const mine = await drawBand($, e, band.key)
    if (!below) return mine
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    )
  })

  on('command.run', { command: 'pr-tiles' }, async ($, e) => runPr($, e.args)).catch(() => ({
    text: `${CARD_PREFIX} the card failed to load. Run /pr-tiles again, or check \`gh auth status\`.`,
  }))

  on('ui.render', { component: 'CommandOutput', props: { command: 'pr-tiles' } }, async ($, e, next) => {
    const key = e.props.isErrored ? null : keyFromCardText(e.props.text)
    return key ? drawCard($, e, key, 'tiles') : next(e)
  })

  on('ui.render', { component: 'CommandOutput', props: { command: COMMAND } }, async ($, e, next) => {
    const at = e.props.text.indexOf(CARD_PREFIX)
    if (e.props.isErrored || at < 0 || at > 40) return next(e)
    const rest = e.props.text.slice(at + CARD_PREFIX.length).trim()
    const key = keyFromCardText(e.props.text)
    if (key) return drawCard($, e, key)
    if (rest.startsWith('several')) {
      const keys = [...rest.matchAll(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+)/g)].map(match => match[1]!)
      const branch = rest.match(/`([^`]+)`/)?.[1] ?? 'this branch'
      if (keys.length > 1) return renderChoice($.ui.resolve(e), e.surface, keys, branch, choice => void $.command.run({ command: COMMAND, args: choice }))
    }
    return next(e)
  })
}
