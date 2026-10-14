import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { UsageSnapshot, UsageWindow } from '../types'
import { ART_H, ART_W, SEASONS, seasonArt, seasonByName, seasonFor } from './seasons'

const snapshot = atom({ plugin: 'usage-band', key: 'snapshot' } as const, null)
const now = atom({ plugin: 'usage-band', key: 'now' } as const, 0)
const themeAtom = atom({ plugin: 'usage-band', key: 'theme' } as const, null as string | null)

// When the seasonal art started, so each redraw continues its animation instead of restarting it.
let artStartedAt = 0

type Level = 'normal' | 'warning' | 'error'
type Metric = { label: string; percent: number | undefined; full: string; short: string }

// How a segment is drawn at a given width; the first that fits on one row wins.
type Fit = { meterCells: number; detail: 'full' | 'short' | 'none'; gap: number }
const FITS: Fit[] = [
  { meterCells: 10, detail: 'full', gap: 3 },
  { meterCells: 6, detail: 'short', gap: 3 },
  { meterCells: 4, detail: 'short', gap: 2 },
  { meterCells: 0, detail: 'short', gap: 2 },
  { meterCells: 0, detail: 'none', gap: 2 },
]

const PERCENT_CELLS = 4
const TICK_MS = 60_000

// Terminal colors are theme keys, so the band follows the person's /theme.
const TERMINAL_COLOR: Record<Level, string> = { normal: 'claude', warning: 'warning', error: 'error' }
// The SVG meters on desktop need raw colors; these read on light and dark.
const DESKTOP_COLOR: Record<Level, string> = { normal: '#D97757', warning: '#E0A23B', error: '#E5534B' }
const DESKTOP_TRACK = '#8A8A8A'
const SVG_PX_PER_CELL = 7
const SVG_HEIGHT = 6

function levelOf(percent: number | undefined): Level {
  if (percent === undefined) return 'normal'
  if (percent >= 90) return 'error'
  if (percent >= 75) return 'warning'
  return 'normal'
}

function windowOf(limits: SessionRateLimit[], kind: string): UsageWindow | null {
  const found = limits.find(limit => limit.kind === kind)
  if (found === undefined) return null
  return found.resetsAt === undefined
    ? { percentUsed: found.percentUsed }
    : { percentUsed: found.percentUsed, resetsAt: found.resetsAt }
}

function snapshotOf(context: SessionContextUsage, limits: SessionRateLimit[]): UsageSnapshot {
  const fill: UsageSnapshot['context'] = { window: context.window }
  if (context.tokens !== undefined) fill.tokens = context.tokens
  if (context.percent !== undefined) fill.percent = context.percent

  return {
    context: fill,
    fiveHour: windowOf(limits, 'five_hour'),
    sevenDay: windowOf(limits, 'seven_day'),
  }
}

// The time left in a window: "3h 12m", "4d 2h", "now"; '' when unknown.
function timeLeft(iso: string | undefined, at: number): string {
  if (iso === undefined) return ''
  const ms = Date.parse(iso) - at
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'now'

  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function limitMetric(label: string, window: UsageWindow | null, at: number): Metric {
  const left = timeLeft(window?.resetsAt, at)
  return {
    label,
    percent: window?.percentUsed,
    full: left === '' ? '' : left === 'now' ? 'resetting' : `resets in ${left}`,
    short: left === 'now' ? 'resetting' : left,
  }
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function percentText(percent: number | undefined): string {
  return (percent === undefined ? '—' : `${Math.round(percent)}%`).padStart(PERCENT_CELLS)
}

function detailOf(m: Metric, fit: Fit): string {
  return fit.detail === 'full' ? m.full : fit.detail === 'short' ? m.short : ''
}

function rowWidth(metrics: Metric[], fit: Fit): number {
  const segments = metrics.reduce((sum, m) => {
    const detail = detailOf(m, fit)
    const meter = fit.meterCells > 0 ? 1 + fit.meterCells : 0
    return sum + m.label.length + meter + 1 + PERCENT_CELLS + (detail ? 1 + detail.length : 0)
  }, 0)
  return segments + fit.gap * (metrics.length - 1)
}

function textMeter(percent: number | undefined, cells: number): { fill: string; rest: string } {
  const filled =
    percent === undefined || percent <= 0
      ? 0
      : Math.min(cells, Math.max(1, Math.round((percent / 100) * cells)))
  return { fill: '━'.repeat(filled), rest: '─'.repeat(cells - filled) }
}

function svgMeter(percent: number | undefined, color: string, width: number): string {
  const filled =
    percent === undefined || percent <= 0
      ? 0
      : Math.min(width, Math.max(SVG_HEIGHT, Math.round((percent / 100) * width)))
  const fill = filled > 0 ? `<rect width="${filled}" height="${SVG_HEIGHT}" rx="3" fill="${color}"/>` : ''

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${SVG_HEIGHT}" viewBox="0 0 ${width} ${SVG_HEIGHT}">` +
    `<rect width="${width}" height="${SVG_HEIGHT}" rx="3" fill="${DESKTOP_TRACK}" fill-opacity="0.25"/>` +
    fill +
    `</svg>`
  )
}

async function tick($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  await update($, now, () => at)
}

/** True for nothing drawn: no tree, or an element with no children (the engine's empty band). */
function isEmptyTree(tree: unknown): boolean {
  if (!tree || typeof tree !== 'object' || !('type' in tree)) return true
  const el = tree as { children?: unknown; props?: { children?: unknown } }
  const kids = el.children ?? el.props?.children
  return kids === undefined || kids === null || (Array.isArray(kids) && kids.length === 0)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const usage = await $.session.usage()
      await update($, snapshot, () => snapshotOf(usage.context, usage.rateLimits))
    } catch {
      // No reading yet; the first session.measure fills the band.
    }
    await tick($)
    // Keeps the reset countdowns current while the session sits idle.
    $.clock.every(TICK_MS, () => void tick($))
    await $.command.register({
      name: 'usage-theme',
      description: "Preview the usage band's holiday theme for a month (number, name or holiday), or 'auto' for this month",
      argumentHint: '[month | holiday | auto]',
    })

    return next(e)
  })

  on('command.run', { command: 'usage-theme' }, async ($, e) => {
    const arg = e.args.trim()
    if (!arg || arg === 'auto') {
      await update($, themeAtom, () => null)
      const season = seasonFor(new Date())
      return { text: `Usage band follows the month: ${season.name}. Themes: ${SEASONS.map((s, i) => `${i + 1} ${s.name}`).join(', ')}.` }
    }
    const season = seasonByName(arg)
    if (!season) return { text: `No theme matches "${arg.slice(0, 40)}". Try a month (1-12, "dec") or a holiday ("halloween").` }
    await update($, themeAtom, () => season.id)
    return { text: `Usage band shows ${season.name} for this session. /usage-theme auto goes back to the month.` }
  })

  on('session.measure', async ($, e, next) => {
    await update($, snapshot, () => snapshotOf(e.context, e.rateLimits))
    await tick($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const snap = await read($, snapshot)
    if (snap === null) return next(e)
    const at = await read($, now)

    const { context } = snap
    const used = context.tokens === undefined ? '—' : tokens(context.tokens)
    const metrics: Metric[] = [
      limitMetric('5-hour', snap.fiveHour, at),
      limitMetric('7-day', snap.sevenDay, at),
      {
        label: 'Context',
        percent: context.percent,
        full: `${used} / ${tokens(context.window)}`,
        short: `${used}/${tokens(context.window)}`,
      },
    ]

    // Always one row: the richest form that fits the band's width.
    const inner = Math.max(0, e.props.bodyColumns - 2)
    const fit = FITS.find(f => rowWidth(metrics, f) <= inner) ?? FITS[FITS.length - 1]!

    const { Box, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : undefined

    const segment = (m: Metric) => {
      const level = levelOf(m.percent)
      const pct = percentText(m.percent)
      const detail = detailOf(m, fit)
      const percent =
        level === 'normal' ? (
          <Text>{pct}</Text>
        ) : (
          <Text color={(Svg ? DESKTOP_COLOR : TERMINAL_COLOR)[level]}>{pct}</Text>
        )

      let meter = null
      if (fit.meterCells > 0 && Svg !== undefined) {
        const width = fit.meterCells * SVG_PX_PER_CELL
        meter = (
          <Svg
            source={svgMeter(m.percent, DESKTOP_COLOR[level], width)}
            alt={`${m.label} ${pct.trim()} used`}
            width={width}
            height={SVG_HEIGHT}
          />
        )
      } else if (fit.meterCells > 0) {
        const { fill, rest } = textMeter(m.percent, fit.meterCells)
        meter = (
          <Box flexDirection="row">
            {fill ? <Text color={TERMINAL_COLOR[level]}>{fill}</Text> : null}
            {rest ? <Text dimColor>{rest}</Text> : null}
          </Box>
        )
      }

      return (
        <Box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
          <Text dimColor>{m.label}</Text>
          {meter}
          {percent}
          {detail ? <Text dimColor>{detail}</Text> : null}
        </Box>
      )
    }

    const bar = (
      <Box
        paddingX={1}
        flexGrow={1}
        width="100%"
        flexDirection="row"
        flexWrap="nowrap"
        justifyContent="space-between"
        columnGap={fit.gap}
        overflow="hidden"
      >
        {/* Positioned (an empty absolute child), so the row paints over the seasonal art. */}
        {Svg ? <Box position="absolute" top={0} left={0} /> : null}
        {segment(metrics[0]!)}
        {segment(metrics[1]!)}
        {segment(metrics[2]!)}
      </Box>
    )
    // The month's holiday art behind the row (Desktop): a layer under it, labelled, since Desktop skips an
    // Svg whose alt is empty.
    const pinned = await read($, themeAtom)
    const season = (pinned && SEASONS.find(s => s.id === pinned)) || seasonFor(new Date(at || Date.now()))
    if (Svg && !artStartedAt) artStartedAt = Date.now()
    const art = Svg ? (
      <Box key="usage-art" position="absolute" top={-1} right={0} bottom={-1}>
        <Svg source={seasonArt(season, Date.now() - artStartedAt)} alt={`${season.name} theme`} width={ART_W} height={ART_H} />
      </Box>
    ) : null

    // Other mods share this band (the PR bar): what they draw stacks above the usage row.
    const above = await next(e)
    const shared = !isEmptyTree(above)
    // One box holds the art and the row, as the PR bar's does, so the art covers it edge to edge (a box nested
    // inside clipped it to the row). On Desktop it is always a bordered box of its own: the app's band frame
    // around it takes no art. The terminal borders it only when another mod's row shares the band.
    // Full width: a box sizes to its content otherwise, and the art stopped where the numbers ended.
    const bordered = Boolean(Svg) || shared
    const box = (
      <Box
        key="usage"
        position={Svg ? 'relative' : undefined}
        overflow="hidden"
        width="100%"
        borderStyle={bordered ? 'round' : undefined}
        borderColor={bordered ? (Svg ? '#2a2a2f' : 'subtle') : undefined}
        backgroundColor={Svg ? '#141416' : undefined}
      >
        {art}
        {bar}
      </Box>
    )
    if (!shared) return box
    // Shared with another mod: each row reads as its own box, a gap between them.
    return (
      <Box flexDirection="column" gap={1}>
        {above}
        {box}
      </Box>
    )
  })
}
