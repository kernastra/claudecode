// The card's drawing: a pure function of the stored entry and the card's own UI state.
// Colors are the host's theme keys only, so every surface draws them in its own palette.

import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { CardSection, CardUi, PrCheck, PrData, PrEntry, PrThread } from '../types'
import { canPush, lineLabel } from './prompt'
import {
  bucketOf,
  CHECK_GLYPH,
  CHECK_STATE_LABEL,
  mergeIndicator,
  shortSha,
  sortChecks,
  stateIndicator,
  summarizeChecks,
  summarizeReviews,
  type Indicator,
  type Tone,
} from './status'

export type CardActions = {
  toggleSection: (section: CardSection) => void
  toggleThread: (threadId: string) => void
  refresh: () => void
  fix: (thread: PrThread) => void
  copyPrompt: (thread: PrThread) => void
}

export type CardProps = {
  els: ElementTable
  surface: RenderSurface
  prKey: string
  entry: PrEntry | undefined
  ui: CardUi
  /** Whether a Fix with Claude task is waiting or running, so the buttons say so. */
  fixBusy: boolean
  columns: number
  actions: CardActions
}

const MAX_CHECKS = 12
const MAX_FILES = 20
const MAX_BODY_CHARS = 900

// Styled like the usage band above the prompt: no fill, plain values, dim labels, and Claude orange
// only as a small accent (the PR icon, #D97757). Desktop takes the band's own amber and red; the terminal uses
// the theme's keys, so it follows /theme.
const DESKTOP_TONE: Partial<Record<Tone, string>> = { warning: '#E0A23B', error: '#E5534B' }

type Ink = Tone | 'text' | 'dim' | 'title' | 'added' | 'removed'

/** Text color props for a role, so every Text in the card takes its color from one place. */
function ink({ surface }: { surface: RenderSurface }, role: Ink): { color?: string; dimColor?: boolean } {
  switch (role) {
    case 'text':
    case 'title':
      return {}
    case 'dim':
      return { dimColor: true }
    case 'added':
      return { color: 'diffAdded' }
    case 'removed':
      return { color: 'diffRemoved' }
    default:
      return { color: (surface !== 'terminal' && DESKTOP_TONE[role]) || color(role) }
  }
}

// The usage band's panel: #212121 on the #151515 page, rounded, no visible edge (the border is drawn in
// the fill color only for its rounded corners). The terminal has no fill, so it keeps a quiet border.
const PANEL = '#212121'

function frame({ surface }: { surface: RenderSurface }) {
  return surface === 'terminal'
    ? ({ borderStyle: 'round', borderColor: 'subtle', paddingX: 1 } as const)
    : ({ borderStyle: 'round', borderColor: PANEL, backgroundColor: PANEL, paddingX: 2, paddingY: 1 } as const)
}

const color = (tone: Tone): string | undefined => (tone === 'neutral' ? 'inactive' : tone)

// Octicons git-pull-request-16 (MIT). A neutral stroke; the state reads from the label beside it.
const PR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><style>path{fill:#d97757}</style><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>`

export function clock(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function day(iso: string | undefined | null): string {
  return iso ? iso.slice(0, 10) : ''
}

function trimBody(body: string): string {
  const text = body.trim()
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text
}

/**
 * The full view for the details pane: the card's header and status, then every section open (checks, reviews and
 * threads with Fix with Claude, files, commits). The pane draws its own frame, so this has none.
 */
export function renderDetails(props: CardProps): RenderElement {
  const { els, entry } = props
  const { Box, Text, Button } = els
  const pr = entry?.data
  if (!pr) return renderCard(props)
  const heading = (label: string) => (
    <Box marginTop={1}>
      <Text {...ink(props, 'text')} bold>
        {label}
      </Text>
    </Box>
  )
  let note = ''
  if (entry?.isLoading) note = 'Refreshing…'
  else if (entry?.error && entry.fetchedAt) note = `Couldn't refresh (${entry.error.kind}); showing ${clock(entry.fetchedAt)}`
  else if (entry?.fetchedAt) note = `Updated ${clock(entry.fetchedAt)}`
  return (
    <Box flexDirection="column" paddingX={1}>
      {header(props, pr)}
      {statusLine(props, pr)}
      {changeLine(props, pr)}
      <Box flexDirection="row" columnGap={2} alignItems="center" marginTop={1}>
        <Button key="refresh" label="Refresh" onPress={() => props.actions.refresh()} />
        <Text {...ink(props, 'dim')}>{note}</Text>
      </Box>
      {heading('Checks')}
      {checksSection(props, pr)}
      {heading('Reviews')}
      {reviewsSection(props, pr)}
      {heading('Files')}
      {filesSection(props, pr)}
      {heading('Commits')}
      {commitsSection(props, pr)}
    </Box>
  )
}

export function renderCard(props: CardProps): RenderElement {
  const { els, prKey, entry } = props
  const { Box, Text } = els
  const pr = entry?.data

  if (!pr) {
    return (
      <Box flexDirection="column" {...frame(props)}>
        <Box flexDirection="row" gap={1}>
          {icon(props)}
          <Text {...ink(props, 'text')} bold {...ink(props, 'title')}>{prKey}</Text>
        </Box>
        {entry?.error ? (
          <Box flexDirection="column">
            <Text {...ink(props, 'error')}>{entry.error.message}</Text>
            {footer(props, undefined)}
          </Box>
        ) : (
          <Text {...ink(props, 'dim')}>Loading pull request…</Text>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" {...frame(props)}>
      {header(props, pr)}
      {statusLine(props, pr)}
      {changeLine(props, pr)}
      {footer(props, pr)}
      {props.ui.section === 'checks' && checksSection(props, pr)}
      {props.ui.section === 'reviews' && reviewsSection(props, pr)}
      {props.ui.section === 'files' && filesSection(props, pr)}
      {props.ui.section === 'commits' && commitsSection(props, pr)}
    </Box>
  )
}

export function icon(props: CardProps): RenderElement {
  const { els, surface } = props
  if ('Svg' in els && surface !== 'terminal') {
    const { Svg } = els
    return <Svg source={PR_ICON} alt="Pull request" width={16} height={16} />
  }
  return <els.Text color="claude">✦</els.Text>
}

function header(props: CardProps, pr: PrData): RenderElement {
  const { Box, Text, Link } = props.els
  const state = stateIndicator(pr)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} justifyContent="space-between">
        <Box flexDirection="row" gap={1} flexShrink={1}>
          {icon(props)}
          <Text {...ink(props, 'text')} bold {...ink(props, 'title')} wrap="wrap">
            {pr.title}
          </Text>
        </Box>
        <Link href={pr.url} label="GitHub ↗" />
      </Box>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text {...ink(props, 'dim')} wrap="truncate-end">
          {`${pr.owner}/${pr.repo} #${pr.number}${pr.author ? ` · ${pr.author}` : ''} ·`}
        </Text>
        {indicator(props, state)}
      </Box>
    </Box>
  )
}

function indicator(props: CardProps, item: Indicator): RenderElement {
  const { els } = props
  const { Box, Text } = els
  return (
    <Box flexDirection="row" gap={1}>
      <Text {...ink(props, item.tone)}>{item.glyph}</Text>
      <Text {...ink(props, 'text')}>{item.label}</Text>
    </Box>
  )
}

function statusLine(props: CardProps, pr: PrData): RenderElement {
  const { Box, Text } = props.els
  const checks = summarizeChecks(pr)
  const reviews = summarizeReviews(pr)
  const merge = mergeIndicator(pr)
  return (
    <Box flexDirection="row" columnGap={2} flexWrap="wrap" marginTop={1}>
      {indicator(props, checks.failingRequired ? { ...checks.indicator, label: `${checks.indicator.label} (${checks.failingRequired} required)` } : checks.indicator)}
      {reviews.indicator && indicator(props, reviews.indicator)}
      {reviews.unresolved > 0 &&
        indicator(props, {
          glyph: '◦',
          label: `${reviews.unresolved}${reviews.unresolvedIsFloor ? '+' : ''} unresolved`,
          tone: 'warning',
        })}
      {merge && indicator(props, merge)}
      {pr.state === 'OPEN' && pr.mergeable === 'UNKNOWN' && <Text {...ink(props, 'dim')}>Mergeability pending</Text>}
    </Box>
  )
}

function changeLine(props: CardProps, pr: PrData): RenderElement {
  const { els } = props
  const { Box, Text } = els
  return (
    <Box flexDirection="row" columnGap={1} flexWrap="wrap">
      <Text {...ink(props, 'dim')} wrap="truncate-middle">{`${pr.headRef} → ${pr.baseRef}`}</Text>
      <Text {...ink(props, 'dim')}>{`· ${shortSha(pr.headSha)} · ${pr.changedFiles} ${pr.changedFiles === 1 ? 'file' : 'files'}`}</Text>
      <Text {...ink(props, 'added')}>{`+${pr.additions}`}</Text>
      <Text {...ink(props, 'removed')}>{`−${pr.deletions}`}</Text>
    </Box>
  )
}

function sectionButton(props: CardProps, section: CardSection, label: string): RenderElement {
  const { Button } = props.els
  const isOpen = props.ui.section === section
  return (
    <Button
      key={`section-${section}`}
      label={`${label} ${isOpen ? '▾' : '▸'}`}
      dimColor={!isOpen}
      onPress={() => props.actions.toggleSection(section)}
    />
  )
}

function footer(props: CardProps, pr: PrData | undefined): RenderElement {
  const { Box, Text, Button } = props.els
  const { entry } = props
  const checks = pr ? summarizeChecks(pr) : undefined
  const reviews = pr ? summarizeReviews(pr) : undefined
  let note: RenderElement
  if (entry?.isLoading) note = <Text {...ink(props, 'dim')}>Refreshing…</Text>
  else if (entry?.error && entry.fetchedAt)
    note = <Text {...ink(props, 'warning')}>{`Couldn't refresh (${entry.error.kind}); showing ${clock(entry.fetchedAt)}`}</Text>
  else if (entry?.fetchedAt) note = <Text {...ink(props, 'dim')}>{`Updated ${clock(entry.fetchedAt)}`}</Text>
  else note = <Text {...ink(props, 'dim')}> </Text>

  // The one bright button: what most needs a look, else Refresh.
  let primary: { key: string; label: string; onPress: () => void } | null = null
  if (checks && checks.counts.failing > 0 && props.ui.section !== 'checks')
    primary = { key: 'primary-checks', label: 'Show failures', onPress: () => props.actions.toggleSection('checks') }
  else if (reviews && reviews.unresolved > 0 && props.ui.section !== 'reviews')
    primary = {
      key: 'primary-reviews',
      label: `Review ${reviews.unresolved} ${reviews.unresolved === 1 ? 'thread' : 'threads'}`,
      onPress: () => props.actions.toggleSection('reviews'),
    }
  const refresh = () => props.actions.refresh()

  return (
    <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} flexWrap="wrap" marginTop={1}>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap" alignItems="center" flexShrink={1}>
        {pr && checks && checks.total > 0 && sectionButton(props, 'checks', `Checks ${checks.total}`)}
        {pr && reviews && sectionButton(props, 'reviews', reviews.unresolved ? `Reviews · ${reviews.unresolved} open` : 'Reviews')}
        {pr && sectionButton(props, 'files', 'Files')}
        {pr && sectionButton(props, 'commits', 'Commits')}
        {primary && <Button key="refresh" label="Refresh" dimColor onPress={refresh} />}
        {note}
      </Box>
      {primary ? (
        <Button key={primary.key} label={primary.label} variant="primary" onPress={primary.onPress} />
      ) : (
        <Button key="refresh" label="Refresh" variant="primary" onPress={refresh} />
      )}
    </Box>
  )
}

function sectionBox(props: CardProps, children: RenderElement[]): RenderElement {
  const { Box } = props.els
  return (
    <Box flexDirection="column" marginTop={1}>
      {children}
    </Box>
  )
}

function checkRow(props: CardProps, check: PrCheck, index: number): RenderElement {
  const { Box, Text, Link } = props.els
  const bucket = CHECK_GLYPH[bucketOf(check.state)]
  const name = check.workflow && check.workflow !== check.name ? `${check.workflow} / ${check.name}` : check.name
  return (
    <Box key={`check-${index}`} flexDirection="row" columnGap={1}>
      <Text {...ink(props, bucket.tone)}>{bucket.glyph}</Text>
      <Box flexShrink={1}>
        <Text {...ink(props, 'text')} wrap="truncate-end">{name}</Text>
      </Box>
      <Text {...ink(props, 'dim')}>{CHECK_STATE_LABEL[check.state] + (check.isRequired ? ' · required' : '')}</Text>
      {check.url && <Link href={check.url} label="details" />}
    </Box>
  )
}

export function checksSection(props: CardProps, pr: PrData): RenderElement {
  const { Text, Link } = props.els
  const sorted = sortChecks(pr.checks)
  const shown = sorted.slice(0, MAX_CHECKS)
  const more = Math.max(pr.checksTotal, pr.checks.length) - shown.length
  const rows: RenderElement[] = shown.map((check, index) => checkRow(props, check, index))
  if (pr.checks.length === 0) rows.push(<Text {...ink(props, 'dim')}>No checks reported for the head commit.</Text>)
  if (more > 0) rows.push(<Link href={`${pr.url}/checks`} label={`${more} more on GitHub`} />)
  if (pr.checks.every(check => check.isRequired === null) && pr.checks.length > 0)
    rows.push(<Text {...ink(props, 'dim')}>Required status is not visible to this account.</Text>)
  return sectionBox(props, rows)
}

function threadRow(props: CardProps, pr: PrData, thread: PrThread): RenderElement {
  const { Box, Text, Button, Link, Markdown, Code } = props.els
  const first = thread.comments[0]
  const isOpen = props.ui.thread === thread.id
  const preview = (first?.body ?? '').replace(/\s+/g, ' ').trim()
  const fixLabel = props.fixBusy ? 'Fix queued' : 'Fix with Claude'
  const hunk = thread.diffHunk?.split('\n') ?? []
  return (
    <Box key={`thread-${thread.id}`} flexDirection="column" marginTop={1}>
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Text {...ink(props, 'warning')}>◦</Text>
        <Text {...ink(props, 'dim')} wrap="truncate-middle">{lineLabel(thread)}</Text>
        <Text {...ink(props, 'text')}>{first ? `@${first.author}` : 'thread'}</Text>
        {thread.isOutdated && <Text {...ink(props, 'dim')}>outdated</Text>}
        {thread.totalComments > 1 && <Text {...ink(props, 'dim')}>{`${thread.totalComments} comments`}</Text>}
      </Box>
      {!isOpen && preview && (
        <Text {...ink(props, 'dim')} wrap="truncate-end">
          {preview.slice(0, 240)}
        </Text>
      )}
      {isOpen && (
        <Box flexDirection="column" paddingLeft={2}>
          {thread.comments.slice(0, 10).map(comment => (
            <Markdown text={`**@${comment.author}**${comment.createdAt ? ` · ${day(comment.createdAt)}` : ''}\n\n${trimBody(comment.body) || '_(empty)_'}`} />
          ))}
          {hunk.length > 0 && hunk.length <= 14 && <Code source={thread.diffHunk!.slice(0, 9000)} format="diff" path={thread.path} />}
          {hunk.length > 14 && <Code source={hunk.slice(-6).join('\n').slice(0, 9000)} path={thread.path} wrap="truncate-end" />}
        </Box>
      )}
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Button key={`fix-${thread.id}`} label={fixLabel} onPress={() => props.actions.fix(thread)} />
        <Button key={`expand-${thread.id}`} label={isOpen ? 'Collapse' : 'Read thread'} dimColor onPress={() => props.actions.toggleThread(thread.id)} />
        {isOpen && <Button key={`copy-${thread.id}`} label="Copy prompt" dimColor onPress={() => props.actions.copyPrompt(thread)} />}
        {first?.url && <Link href={first.url} label="Open thread ↗" />}
      </Box>
    </Box>
  )
}

export function reviewsSection(props: CardProps, pr: PrData): RenderElement {
  const { Box, Text, Link } = props.els
  const summary = summarizeReviews(pr)
  const rows: RenderElement[] = []
  const verdict: Record<string, string> = {
    APPROVED: 'approved',
    CHANGES_REQUESTED: 'requested changes',
    COMMENTED: 'commented',
    DISMISSED: 'dismissed',
    PENDING: 'pending',
  }
  const tone: Record<string, Tone> = { APPROVED: 'success', CHANGES_REQUESTED: 'warning' }
  rows.push(
    <Text {...ink(props, 'dim')}>
      {[
        `${summary.approvals} ${summary.approvals === 1 ? 'approval' : 'approvals'}`,
        `${summary.changesRequested} change ${summary.changesRequested === 1 ? 'request' : 'requests'}`,
        `${summary.unresolved}${summary.unresolvedIsFloor ? '+' : ''} unresolved`,
        summary.isReviewRequired === true ? 'review required' : summary.isReviewRequired === false ? 'no review required' : undefined,
        summary.latestActivity ? `last activity ${day(summary.latestActivity)}` : undefined,
      ]
        .filter(Boolean)
        .join(' · ')}
    </Text>,
  )
  for (const [index, review] of pr.reviews.entries()) {
    rows.push(
      <Box key={`review-${index}`} flexDirection="row" columnGap={1}>
        <Text {...ink(props, tone[review.state] ?? 'neutral')}>{review.state === 'APPROVED' ? '✓' : review.state === 'CHANGES_REQUESTED' ? '±' : '·'}</Text>
        <Text {...ink(props, 'text')}>{`@${review.author}`}</Text>
        <Text {...ink(props, 'dim')}>{`${verdict[review.state]}${review.submittedAt ? ` · ${day(review.submittedAt)}` : ''}`}</Text>
        {review.url && <Link href={review.url} label="view" />}
      </Box>,
    )
  }
  if (summary.requested.length > 0) rows.push(<Text {...ink(props, 'dim')}>{`Awaiting ${summary.requested.map(name => `@${name}`).join(', ')}`}</Text>)

  const open = pr.threads.filter(thread => !thread.isResolved)
  if (open.length > 0 && !canPush(pr))
    rows.push(<Text {...ink(props, 'warning')}>{`This account has ${pr.viewerPermission?.toLowerCase() ?? 'unknown'} access; fixes may not be pushable to ${pr.headRef}.`}</Text>)
  for (const thread of open) rows.push(threadRow(props, pr, thread))
  const resolved = pr.threads.length - open.length
  if (resolved > 0) rows.push(<Text {...ink(props, 'dim')}>{`${resolved} resolved ${resolved === 1 ? 'thread' : 'threads'} not shown`}</Text>)
  if (summary.unresolvedIsFloor) rows.push(<Link href={`${pr.url}/files`} label="More threads on GitHub" />)
  if (pr.reviews.length === 0 && pr.threads.length === 0 && summary.requested.length === 0)
    rows.push(<Text {...ink(props, 'dim')}>No reviews yet.</Text>)
  rows.push(<Text {...ink(props, 'dim')}>PR conversation comments and bot messages are on GitHub.</Text>)
  return sectionBox(props, rows)
}

export function filesSection(props: CardProps, pr: PrData): RenderElement {
  const { Box, Text, Link } = props.els
  const rows: RenderElement[] = pr.files.slice(0, MAX_FILES).map((file, index) => (
    <Box key={`file-${index}`} flexDirection="row" columnGap={1}>
      <Box flexShrink={1}>
        <Text {...ink(props, 'dim')} wrap="truncate-start">{file.path}</Text>
      </Box>
      <Text {...ink(props, 'added')}>{`+${file.additions}`}</Text>
      <Text {...ink(props, 'removed')}>{`−${file.deletions}`}</Text>
    </Box>
  ))
  const more = pr.filesTotal - Math.min(pr.files.length, MAX_FILES)
  if (more > 0) rows.push(<Link href={`${pr.url}/files`} label={`${more} more files on GitHub`} />)
  else rows.push(<Link href={`${pr.url}/files`} label="Diff on GitHub ↗" />)
  return sectionBox(props, rows)
}

export function commitsSection(props: CardProps, pr: PrData): RenderElement {
  const { Box, Text, Link } = props.els
  const rows: RenderElement[] = pr.commits.map((commit, index) => (
    <Box key={`commit-${index}`} flexDirection="row" columnGap={1}>
      <Text {...ink(props, 'dim')}>{shortSha(commit.sha)}</Text>
      <Box flexShrink={1}>
        <Text {...ink(props, 'text')} wrap="truncate-end">{commit.headline}</Text>
      </Box>
      <Text {...ink(props, 'dim')}>{day(commit.date)}</Text>
    </Box>
  ))
  if (pr.commitsTotal > pr.commits.length) rows.push(<Link href={`${pr.url}/commits`} label={`All ${pr.commitsTotal} commits on GitHub`} />)
  return sectionBox(props, rows)
}

/** The row for `/pr` when several PRs match: one button each, never a guess. */
export function renderChoice(els: ElementTable, surface: RenderSurface, keys: string[], branch: string, choose: (key: string) => void): RenderElement {
  const props = { surface }
  const { Box, Text, Button } = els
  return (
    <Box flexDirection="column" {...frame({ surface })}>
      <Text {...ink(props, 'text')} bold {...ink(props, 'title')}>{`Several pull requests match ${branch}. Pick one:`}</Text>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {keys.map(key => (
          <Button key={`choose-${key}`} label={key} onPress={() => choose(key)} />
        ))}
      </Box>
    </Box>
  )
}
