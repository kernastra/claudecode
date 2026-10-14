// Status mapping: each PR dimension (state, checks, reviews, mergeability) reduced on its own,
// never folded into one success flag. Pure, so the tests cover every state.

import type { CheckState, PrCheck, PrData } from '../types'

/** A theme key of the host, so the surface picks the shade for its light or dark theme. */
export type Tone = 'success' | 'error' | 'warning' | 'merged' | 'neutral'

export type Indicator = { glyph: string; label: string; tone: Tone }

export function stateIndicator(pr: Pick<PrData, 'state' | 'isDraft'>): Indicator {
  if (pr.state === 'MERGED') return { glyph: '◆', label: 'Merged', tone: 'merged' }
  if (pr.state === 'CLOSED') return { glyph: '○', label: 'Closed', tone: 'neutral' }
  if (pr.isDraft) return { glyph: '◌', label: 'Draft', tone: 'neutral' }
  return { glyph: '●', label: 'Open', tone: 'success' }
}

export type CheckBucket = 'failing' | 'pending' | 'passing' | 'cancelled' | 'skipped' | 'unknown'

export function bucketOf(state: CheckState): CheckBucket {
  switch (state) {
    case 'failure':
    case 'error':
    case 'timed_out':
    case 'action_required':
      return 'failing'
    case 'queued':
    case 'in_progress':
    case 'pending':
      return 'pending'
    case 'success':
      return 'passing'
    case 'cancelled':
      return 'cancelled'
    case 'skipped':
    case 'neutral':
    case 'stale':
      return 'skipped'
    default:
      return 'unknown'
  }
}

export const CHECK_GLYPH: Record<CheckBucket, Indicator> = {
  failing: { glyph: '✕', label: 'Failing', tone: 'error' },
  pending: { glyph: '◔', label: 'Pending', tone: 'warning' },
  passing: { glyph: '✓', label: 'Passed', tone: 'success' },
  cancelled: { glyph: '⊘', label: 'Cancelled', tone: 'neutral' },
  skipped: { glyph: '–', label: 'Skipped', tone: 'neutral' },
  unknown: { glyph: '?', label: 'Unknown', tone: 'neutral' },
}

export const CHECK_STATE_LABEL: Record<CheckState, string> = {
  queued: 'Queued',
  in_progress: 'In progress',
  pending: 'Pending',
  success: 'Passed',
  failure: 'Failed',
  error: 'Errored',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
  action_required: 'Action required',
  skipped: 'Skipped',
  neutral: 'Neutral',
  stale: 'Stale',
  unknown: 'Unknown',
}

export type ChecksSummary = {
  counts: Record<CheckBucket, number>
  total: number
  /** Checks GitHub has but the card did not load (past the page). */
  hidden: number
  failingRequired: number
  pendingRequired: number
  overall: CheckBucket | 'none'
  indicator: Indicator
}

/** Failing first, then pending, then the rest: the order a person reads a check list in. */
export function sortChecks(checks: readonly PrCheck[]): PrCheck[] {
  const order: CheckBucket[] = ['failing', 'pending', 'cancelled', 'unknown', 'passing', 'skipped']
  return [...checks].sort((a, b) => order.indexOf(bucketOf(a.state)) - order.indexOf(bucketOf(b.state)) || a.name.localeCompare(b.name))
}

export function summarizeChecks(pr: Pick<PrData, 'checks' | 'checksTotal' | 'checksRollup'>): ChecksSummary {
  const counts: Record<CheckBucket, number> = { failing: 0, pending: 0, passing: 0, cancelled: 0, skipped: 0, unknown: 0 }
  let failingRequired = 0
  let pendingRequired = 0
  for (const check of pr.checks) {
    const bucket = bucketOf(check.state)
    counts[bucket]++
    if (check.isRequired && bucket === 'failing') failingRequired++
    if (check.isRequired && bucket === 'pending') pendingRequired++
  }
  const total = Math.max(pr.checksTotal, pr.checks.length)
  const hidden = total - pr.checks.length
  let overall: CheckBucket | 'none'
  if (total === 0) overall = 'none'
  else if (counts.failing > 0) overall = 'failing'
  else if (counts.pending > 0) overall = 'pending'
  else if (counts.cancelled > 0) overall = 'cancelled'
  else if (counts.unknown > 0 || hidden > 0) overall = rollupBucket(pr.checksRollup)
  else if (counts.passing > 0) overall = 'passing'
  else overall = 'skipped'

  let indicator: Indicator
  switch (overall) {
    case 'none':
      indicator = { glyph: '–', label: 'No checks', tone: 'neutral' }
      break
    case 'failing':
      indicator = { ...CHECK_GLYPH.failing, label: `${counts.failing} failing` }
      break
    case 'pending':
      indicator = { ...CHECK_GLYPH.pending, label: `${counts.pending} pending` }
      break
    case 'passing':
      indicator = { ...CHECK_GLYPH.passing, label: total === 1 ? 'Check passed' : `${counts.passing} checks passed` }
      break
    case 'cancelled':
      indicator = { ...CHECK_GLYPH.cancelled, label: `${counts.cancelled} cancelled` }
      break
    case 'skipped':
      indicator = { ...CHECK_GLYPH.skipped, label: 'Checks skipped' }
      break
    default:
      indicator = { ...CHECK_GLYPH.unknown, label: 'Checks unknown' }
  }
  return { counts, total, hidden, failingRequired, pendingRequired, overall, indicator }
}

function rollupBucket(rollup: string | null): CheckBucket {
  switch (rollup) {
    case 'SUCCESS': return 'passing'
    case 'FAILURE':
    case 'ERROR': return 'failing'
    case 'PENDING':
    case 'EXPECTED': return 'pending'
    default: return 'unknown'
  }
}

export type ReviewSummary = {
  approvals: number
  changesRequested: number
  unresolved: number
  /** True when GitHub has more threads than the card loaded, so `unresolved` is a floor. */
  unresolvedIsFloor: boolean
  requested: string[]
  isReviewRequired: boolean | null
  latestActivity: string | null
  indicator: Indicator | null
}

export function summarizeReviews(pr: Pick<PrData, 'reviews' | 'threads' | 'threadsTotal' | 'reviewRequests' | 'reviewDecision'>): ReviewSummary {
  const approvals = pr.reviews.filter(review => review.state === 'APPROVED').length
  const changesRequested = pr.reviews.filter(review => review.state === 'CHANGES_REQUESTED').length
  const unresolved = pr.threads.filter(thread => !thread.isResolved).length
  const stamps = [
    ...pr.reviews.map(review => review.submittedAt),
    ...pr.threads.flatMap(thread => thread.comments.map(comment => comment.createdAt)),
  ].filter((stamp): stamp is string => !!stamp)
  const latestActivity = stamps.sort().at(-1) ?? null

  let indicator: Indicator | null = null
  if (pr.reviewDecision === 'CHANGES_REQUESTED' || changesRequested > 0)
    indicator = { glyph: '±', label: 'Changes requested', tone: 'warning' }
  else if (pr.reviewDecision === 'APPROVED') indicator = { glyph: '✓', label: approvals > 1 ? `Approved ×${approvals}` : 'Approved', tone: 'success' }
  else if (pr.reviewDecision === 'REVIEW_REQUIRED') indicator = { glyph: '◇', label: 'Review required', tone: 'neutral' }
  else if (pr.reviewRequests.length > 0) indicator = { glyph: '◇', label: 'Review requested', tone: 'neutral' }
  else if (approvals > 0) indicator = { glyph: '✓', label: approvals > 1 ? `${approvals} approvals` : '1 approval', tone: 'success' }

  return {
    approvals,
    changesRequested,
    unresolved,
    unresolvedIsFloor: pr.threadsTotal > pr.threads.length,
    requested: pr.reviewRequests,
    isReviewRequired: pr.reviewDecision === null ? null : pr.reviewDecision === 'REVIEW_REQUIRED',
    latestActivity,
    indicator,
  }
}

/** Merge conflicts and other blockers GitHub reports; null when there is nothing to say. */
export function mergeIndicator(pr: Pick<PrData, 'state' | 'mergeable' | 'mergeStateStatus'>): Indicator | null {
  if (pr.state !== 'OPEN') return null
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') return { glyph: '⚠', label: 'Merge conflicts', tone: 'error' }
  if (pr.mergeStateStatus === 'BEHIND') return { glyph: '↓', label: 'Behind base', tone: 'neutral' }
  return null
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

/** True while something on the PR may still change without anyone pushing: checks running. */
export function isSettling(pr: PrData): boolean {
  if (pr.state !== 'OPEN') return false
  const checks = summarizeChecks(pr)
  return checks.overall === 'pending' || pr.mergeable === 'UNKNOWN'
}

/**
 * The line the model reads for a card: our own vocabulary and counts only. PR text is
 * quoted as data; review comment bodies never reach the model through this path.
 */
export function modelSummary(pr: PrData): string {
  const checks = summarizeChecks(pr)
  const reviews = summarizeReviews(pr)
  const merge = mergeIndicator(pr)
  const parts = [
    stateIndicator(pr).label,
    checks.indicator.label + (checks.failingRequired ? ` (${checks.failingRequired} required)` : ''),
    reviews.indicator?.label,
    reviews.unresolved ? `${reviews.unresolved}${reviews.unresolvedIsFloor ? '+' : ''} unresolved review threads` : undefined,
    merge?.label,
  ].filter(Boolean)
  return `GitHub PR card: ${pr.key} ${JSON.stringify(pr.title)} — ${parts.join('; ')}. ${pr.headRef} → ${pr.baseRef} at ${shortSha(pr.headSha)}. ${pr.url}`
}
