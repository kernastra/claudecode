// The tree's drawing: pure functions of the stored agents and the view's own UI state.
// Styled like the usage band and the PR card: a #212121 panel on desktop, a quiet bordered
// card on the terminal, dim labels, plain values, and Claude orange only as a small accent.

import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { AgentNode, AgentStatus, AgentTokens, DetailSection } from '../types'
import { isHaiku55, money, totalCost, ZERO_COST } from './pricing'

type Tone = 'claude' | 'success' | 'warning' | 'error' | 'neutral'
type Ink = Tone | 'text' | 'dim'

const ORANGE = '#D97757'
const PANEL = '#212121'
const TRACK = '#8A8A8A'
// Desktop takes the usage band's amber and red; the terminal uses theme keys, so it follows /theme.
const DESKTOP_TONE: Partial<Record<Tone, string>> = { claude: ORANGE, warning: '#E0A23B', error: '#E5534B' }
const TERMINAL_TONE: Record<Tone, string> = {
  claude: 'claude',
  success: 'success',
  warning: 'warning',
  error: 'error',
  neutral: 'inactive',
}

const STATUS: { [S in AgentStatus]: { glyph: string; label: string; tone: Tone } } = {
  running: { glyph: '●', label: 'Running', tone: 'claude' },
  done: { glyph: '✓', label: 'Done', tone: 'success' },
  failed: { glyph: '✕', label: 'Failed', tone: 'error' },
  stopped: { glyph: '⊘', label: 'Stopped', tone: 'neutral' },
}

const SVG_PX_PER_CELL = 7
const SVG_HEIGHT = 6
const COL_MODEL = 7
const COL_TOKENS = 6
const COL_TIME = 7

// A root with two children, drawn in the accent; the terminal draws ✦ in the theme's claude color.
const TREE_ICON =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">` +
  `<path d="M4 5v7h5M4 8h5" fill="none" stroke="${ORANGE}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<circle cx="4" cy="3.25" r="2" fill="${ORANGE}"/><circle cx="11" cy="8" r="2" fill="${ORANGE}"/>` +
  `<circle cx="11" cy="12" r="2" fill="${ORANGE}"/></svg>`

export type Line = { node: AgentNode; prefix: string }

export type ViewActions = {
  toggle: () => void
  openPane: () => void
  select: (id: string) => void
  section: (section: DetailSection) => void
  clearFinished: () => void
}

type Ctx = { els: ElementTable; surface: RenderSurface; at: number }

function ink({ surface }: Ctx, role: Ink): { color?: string; dimColor?: boolean } {
  if (role === 'text') return {}
  if (role === 'dim') return { dimColor: true }
  return { color: (surface !== 'terminal' && DESKTOP_TONE[role]) || TERMINAL_TONE[role] }
}

function frame({ surface }: Ctx) {
  return surface === 'terminal'
    ? ({ borderStyle: 'round', borderColor: 'subtle', paddingX: 1 } as const)
    : ({ borderStyle: 'round', borderColor: PANEL, backgroundColor: PANEL, paddingX: 2, paddingY: 1 } as const)
}

export const totalTokens = (t: AgentTokens) => t.input + t.output + t.cacheRead + t.cacheWrite

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function shortModel(model: string): string {
  const family = /(opus|sonnet|haiku|fable)/i.exec(model)
  return family?.[1] ? family[1].toLowerCase() : model
}

const elapsed = (a: AgentNode, at: number) => (a.endedAt ?? Math.max(at, a.startedAt)) - a.startedAt

function span(nodes: AgentNode[], at: number): number {
  if (nodes.length === 0) return 0
  const start = Math.min(...nodes.map(a => a.startedAt))
  const end = Math.max(...nodes.map(a => a.endedAt ?? Math.max(at, a.startedAt)))
  return end - start
}

function icon(ctx: Ctx): RenderElement {
  const { els, surface } = ctx
  if ('Svg' in els && surface !== 'terminal') {
    const { Svg } = els
    return <Svg source={TREE_ICON} alt="Subagents" width={16} height={16} />
  }
  return <els.Text {...ink(ctx, 'claude')}>✦</els.Text>
}

// The one status a group reads as: failures first, then work in progress, then done.
function groupStatus(nodes: AgentNode[], pending: number): { glyph: string; label: string; tone: Tone } {
  const count = (s: AgentStatus) => nodes.filter(a => a.status === s).length
  const running = count('running') + pending
  if (count('failed') > 0) return { ...STATUS.failed, label: `${count('failed')} failed` }
  if (running > 0) return { ...STATUS.running, label: `${running} running` }
  if (count('stopped') > 0) return { ...STATUS.stopped, label: `${count('stopped')} stopped` }
  return { ...STATUS.done, label: 'All done' }
}

function indicator(ctx: Ctx, item: { glyph: string; label: string; tone: Tone }): RenderElement {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="row" gap={1} flexShrink={0}>
      <Text {...ink(ctx, item.tone)}>{item.glyph}</Text>
      <Text>{item.label}</Text>
    </Box>
  )
}

const costOf = (a: AgentNode) => totalCost(a.cost ?? ZERO_COST)

function summaryText(nodes: AgentNode[], extra: number, at: number, withCost: boolean): string {
  const n = nodes.length + extra
  const parts = [`${n} ${n === 1 ? 'agent' : 'agents'}`]
  if (nodes.length > 0) {
    parts.push(duration(span(nodes, at)))
    parts.push(`${tokens(nodes.reduce((sum, a) => sum + totalTokens(a.tokens), 0))} tokens`)
    if (withCost) parts.push(money(nodes.reduce((sum, a) => sum + costOf(a), 0)))
  }
  return parts.join(' · ')
}

function header(ctx: Ctx, nodes: AgentNode[], pending: number, withCost = false): RenderElement {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1} justifyContent="space-between">
        <Box flexDirection="row" gap={1} flexShrink={1}>
          {icon(ctx)}
          <Text bold>Subagents</Text>
        </Box>
        {indicator(ctx, groupStatus(nodes, pending))}
      </Box>
      <Text dimColor wrap="truncate-end">
        {summaryText(nodes, pending, ctx.at, withCost)}
      </Text>
    </Box>
  )
}

function cell(ctx: Ctx, width: number, text: string, role: Ink): RenderElement {
  const { Box, Text } = ctx.els
  return (
    <Box width={width} flexShrink={0} justifyContent="flex-end">
      <Text {...ink(ctx, role)} wrap="truncate-end">
        {text}
      </Text>
    </Box>
  )
}

function columnHeads(ctx: Ctx): RenderElement {
  const { Box } = ctx.els
  return (
    <Box flexDirection="row" columnGap={1}>
      <Box flexGrow={1} />
      {cell(ctx, COL_MODEL, 'model', 'dim')}
      {cell(ctx, COL_TOKENS, 'tokens', 'dim')}
      {cell(ctx, COL_TIME, 'time', 'dim')}
    </Box>
  )
}

function agentRow(ctx: Ctx, line: Line, isChosen: boolean): RenderElement {
  const { Box, Text } = ctx.els
  const a = line.node
  const s = STATUS[a.status]
  const indent = line.prefix.length + 2
  return (
    <Box key={`row-${a.id}`} flexDirection="column">
      <Box flexDirection="row" columnGap={1}>
        {line.prefix ? <Text dimColor>{line.prefix.trimEnd()}</Text> : null}
        <Text {...ink(ctx, s.tone)}>{s.glyph}</Text>
        <Box flexGrow={1} flexShrink={1}>
          <Text bold={isChosen} wrap="truncate-end">
            {a.description}
          </Text>
        </Box>
        {cell(ctx, COL_MODEL, shortModel(a.model), 'dim')}
        {cell(ctx, COL_TOKENS, tokens(totalTokens(a.tokens)), 'text')}
        {cell(ctx, COL_TIME, duration(elapsed(a, ctx.at)), 'dim')}
      </Box>
      {a.status === 'running' && (
        <Box paddingLeft={indent}>
          <Text dimColor wrap="truncate-end">
            {`${a.current ?? 'Thinking…'} · ${a.calls} ${a.calls === 1 ? 'call' : 'calls'}`}
          </Text>
        </Box>
      )}
    </Box>
  )
}

// An Agent row the tree has no record of (spawned before the mod loaded).
export type BareCall = { description: string; type: string; isRunning: boolean; isErrored: boolean }

function bareRow(ctx: Ctx, call: BareCall, index: number): RenderElement {
  const { Box, Text } = ctx.els
  const s = call.isRunning ? STATUS.running : call.isErrored ? STATUS.failed : STATUS.done
  return (
    <Box key={`bare-${index}`} flexDirection="row" columnGap={1}>
      <Text {...ink(ctx, s.tone)}>{s.glyph}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end">{call.description}</Text>
      </Box>
      {cell(ctx, COL_MODEL, '—', 'dim')}
      {cell(ctx, COL_TOKENS, '—', 'dim')}
      {cell(ctx, COL_TIME, '—', 'dim')}
    </Box>
  )
}

function toggleButton(ctx: Ctx, key: string, label: string, isOpen: boolean, onPress: () => void): RenderElement {
  const { Button } = ctx.els
  return <Button key={key} label={`${label} ${isOpen ? '▾' : '▸'}`} dimColor={!isOpen} onPress={onPress} />
}

/** The card that stands in the transcript where the Agent rows were. */
export function renderInline(
  els: ElementTable,
  surface: RenderSurface,
  at: number,
  requestId: string,
  lines: Line[],
  bare: BareCall[],
  isOpen: boolean,
  actions: ViewActions,
): RenderElement {
  const ctx: Ctx = { els, surface, at }
  const { Box, Button } = els
  const nodes = lines.map(l => l.node)
  const pending = bare.filter(c => c.isRunning).length
  const count = lines.length + bare.length
  return (
    <Box flexDirection="column" {...frame(ctx)}>
      {header(ctx, nodes, pending)}
      {isOpen && (
        <Box flexDirection="column" marginTop={1}>
          {columnHeads(ctx)}
          {lines.map(line => agentRow(ctx, line, false))}
          {bare.map((call, i) => bareRow(ctx, call, i))}
        </Box>
      )}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} marginTop={1}>
        {toggleButton(ctx, `toggle-${requestId}`, `Agents ${count}`, isOpen, actions.toggle)}
        <Button key={`pane-${requestId}`} label="Open in pane" variant="primary" onPress={actions.openPane} />
      </Box>
    </Box>
  )
}

function tokenBar(ctx: Ctx, t: AgentTokens, cells: number): RenderElement | null {
  const total = totalTokens(t)
  const parts: Array<{ value: number; color: string; opacity: number }> = [
    { value: t.output, color: ORANGE, opacity: 1 },
    { value: t.input, color: ORANGE, opacity: 0.6 },
    { value: t.cacheWrite, color: ORANGE, opacity: 0.32 },
    { value: t.cacheRead, color: TRACK, opacity: 0.55 },
  ]
  if (ctx.surface !== 'terminal' && 'Svg' in ctx.els) {
    const { Svg } = ctx.els
    const width = cells * SVG_PX_PER_CELL
    let x = 0
    const rects = total === 0 ? '' : parts
      .map(p => {
        const w = (p.value / total) * width
        const rect = w > 0 ? `<rect x="${x.toFixed(2)}" width="${w.toFixed(2)}" height="${SVG_HEIGHT}" fill="${p.color}" fill-opacity="${p.opacity}"/>` : ''
        x += w
        return rect
      })
      .join('')
    const source =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${SVG_HEIGHT}" viewBox="0 0 ${width} ${SVG_HEIGHT}">` +
      `<defs><clipPath id="r"><rect width="${width}" height="${SVG_HEIGHT}" rx="3"/></clipPath></defs>` +
      `<g clip-path="url(#r)"><rect width="${width}" height="${SVG_HEIGHT}" fill="${TRACK}" fill-opacity="0.25"/>${rects}</g></svg>`
    return <Svg source={source} alt={`${tokens(total)} tokens`} width={width} height={SVG_HEIGHT} />
  }
  if (total === 0) return null
  const { Box, Text } = ctx.els
  const out = Math.round((t.output / total) * cells)
  const fresh = Math.round(((t.input + t.cacheWrite) / total) * cells)
  const rest = Math.max(0, cells - out - fresh)
  return (
    <Box flexDirection="row">
      {out > 0 ? <Text {...ink(ctx, 'claude')}>{'━'.repeat(out)}</Text> : null}
      {fresh > 0 ? <Text>{'━'.repeat(fresh)}</Text> : null}
      {rest > 0 ? <Text dimColor>{'─'.repeat(rest)}</Text> : null}
    </Box>
  )
}

function legendItem(ctx: Ctx, label: string, value: string): RenderElement {
  const { Box, Text } = ctx.els
  return (
    <Box flexDirection="row" gap={1} flexShrink={0}>
      <Text dimColor>{label}</Text>
      <Text>{value}</Text>
    </Box>
  )
}

function tokenBlock(ctx: Ctx, a: AgentNode, columns: number): RenderElement {
  const { Box, Text } = ctx.els
  const t = a.tokens
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" gap={1} alignItems="center">
        <Text dimColor>Tokens</Text>
        {tokenBar(ctx, t, Math.max(8, Math.min(24, columns - 30)))}
        <Text>{tokens(totalTokens(t))}</Text>
        <Text dimColor>{`· ${a.steps} ${a.steps === 1 ? 'request' : 'requests'}`}</Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {legendItem(ctx, 'Output', tokens(t.output))}
        {legendItem(ctx, 'Input', tokens(t.input))}
        {legendItem(ctx, 'Cache write', tokens(t.cacheWrite))}
        {legendItem(ctx, 'Cache read', tokens(t.cacheRead))}
      </Box>
    </Box>
  )
}

// What the agent cost at Claude Haiku 5.5 API prices, summed request by request.
function costBlock(ctx: Ctx, a: AgentNode): RenderElement {
  const { Box, Text } = ctx.els
  const c = a.cost ?? ZERO_COST
  const notes: string[] = []
  if (a.cost === undefined) notes.push('Started before cost tracking; not priced.')
  else if (!isHaiku55(a.model)) notes.push(`Ran on ${shortModel(a.model)}; priced at Haiku 5.5 rates.`)
  if ((a.longSteps ?? 0) > 0)
    notes.push(`${a.longSteps} ${a.longSteps === 1 ? 'request' : 'requests'} over 100k tokens, at long-context rates.`)
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>Cost</Text>
        <Text>{money(totalCost(c))}</Text>
        <Text dimColor>· Haiku 5.5 API rates</Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {legendItem(ctx, 'Output', money(c.output))}
        {legendItem(ctx, 'Input', money(c.input))}
        {legendItem(ctx, 'Cache write', money(c.cacheWrite))}
        {legendItem(ctx, 'Cache read', money(c.cacheRead))}
      </Box>
      {notes.map((note, i) => (
        <Text key={`cost-note-${i}`} dimColor wrap="wrap">
          {note}
        </Text>
      ))}
    </Box>
  )
}

function sectionBody(ctx: Ctx, a: AgentNode, section: DetailSection): RenderElement {
  const { Box, Text } = ctx.els
  if (section === 'activity') {
    const recent = [...a.recent].reverse()
    return (
      <Box flexDirection="column" marginTop={1}>
        {a.current && (
          <Box flexDirection="row" columnGap={1}>
            <Text {...ink(ctx, 'claude')}>●</Text>
            <Text wrap="truncate-end">{a.current}</Text>
          </Box>
        )}
        {recent
          .filter((r, i) => !(a.current && i === 0 && r === a.current))
          .map((r, i) => (
            <Box key={`recent-${i}`} flexDirection="row" columnGap={1}>
              <Text dimColor>·</Text>
              <Text dimColor wrap="truncate-end">
                {r}
              </Text>
            </Box>
          ))}
        {recent.length === 0 && <Text dimColor>No tool calls yet.</Text>}
        <Text dimColor>{`${a.calls} tool ${a.calls === 1 ? 'call' : 'calls'} in all`}</Text>
      </Box>
    )
  }
  if (section === 'prompt') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text wrap="wrap">{a.prompt.length > 1500 ? `${a.prompt.slice(0, 1500)}…` : a.prompt}</Text>
      </Box>
    )
  }
  const result = a.result ?? (a.status === 'running' ? 'Still running.' : 'No result was reported.')
  return (
    <Box flexDirection="column" marginTop={1}>
      {'Markdown' in ctx.els && a.result ? <ctx.els.Markdown text={result} /> : <Text dimColor={!a.result}>{result}</Text>}
    </Box>
  )
}

function detailCard(
  ctx: Ctx,
  a: AgentNode,
  position: { index: number; of: number; prev?: string; next?: string },
  section: DetailSection,
  columns: number,
  actions: ViewActions,
): RenderElement {
  const { Box, Text, Button } = ctx.els
  const s = STATUS[a.status]
  const meta = [a.type, shortModel(a.model), duration(elapsed(a, ctx.at))]
  if (a.isBackground) meta.push('background')
  const prev = position.prev
  const next = position.next
  return (
    <Box flexDirection="column" {...frame(ctx)}>
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Box flexShrink={1}>
          <Text bold wrap="wrap">
            {a.description}
          </Text>
        </Box>
        <Box flexDirection="row" gap={1} flexShrink={0} alignItems="center">
          <Text dimColor>{`${position.index + 1} of ${position.of}`}</Text>
          {prev && <Button key="prev" label="‹" dimColor onPress={() => actions.select(prev)} />}
          {next && <Button key="next" label="›" dimColor onPress={() => actions.select(next)} />}
        </Box>
      </Box>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {indicator(ctx, s)}
        <Text dimColor wrap="truncate-end">{`· ${meta.join(' · ')}`}</Text>
      </Box>
      {tokenBlock(ctx, a, columns)}
      {costBlock(ctx, a)}
      <Box flexDirection="row" columnGap={2} flexWrap="wrap" marginTop={1}>
        {toggleButton(ctx, 'section-activity', 'Activity', section === 'activity', () => actions.section('activity'))}
        {toggleButton(ctx, 'section-prompt', 'Prompt', section === 'prompt', () => actions.section('prompt'))}
        {toggleButton(ctx, 'section-result', 'Result', section === 'result', () => actions.section('result'))}
      </Box>
      {sectionBody(ctx, a, section)}
    </Box>
  )
}

/** The side pane: the whole session's tree, then one agent in detail. */
export function renderPane(
  els: ElementTable,
  surface: RenderSurface,
  at: number,
  columns: number,
  lines: Line[],
  chosen: AgentNode | undefined,
  section: DetailSection,
  actions: ViewActions,
): RenderElement {
  const ctx: Ctx = { els, surface, at }
  const { Box, Text, Button } = els
  const nodes = lines.map(l => l.node)

  if (chosen === undefined) {
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          {icon(ctx)}
          <Text bold>Subagents</Text>
        </Box>
        <Text dimColor>No subagents yet this session. They appear here as they start.</Text>
      </Box>
    )
  }

  const index = Math.max(0, lines.findIndex(l => l.node.id === chosen.id))
  const position = {
    index,
    of: lines.length,
    prev: lines[index - 1]?.node.id,
    next: lines[index + 1]?.node.id,
  }
  const hasFinished = nodes.some(a => a.status !== 'running')

  return (
    <Box flexDirection="column" gap={1}>
      {header(ctx, nodes, 0, true)}
      <Box flexDirection="column">
        {columnHeads(ctx)}
        {lines.map(line => agentRow(ctx, line, line.node.id === chosen.id))}
      </Box>
      {detailCard(ctx, chosen, position, section, columns, actions)}
      {hasFinished && (
        <Box flexDirection="row" justifyContent="flex-end">
          <Button key="clear" label="Clear finished" dimColor onPress={actions.clearFinished} />
        </Box>
      )}
    </Box>
  )
}
