import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentNode, AgentStatus, AgentTokens, DetailSection } from '../types'
import { addCost, stepCost, ZERO_COST } from './pricing'
import { renderInline, renderPane, type BareCall, type Line, type ViewActions } from './view'

const PANE = 'agent-tree'

const agents = atom({ plugin: 'agent-tree', key: 'agents' } as const, {})
const selected = atom({ plugin: 'agent-tree', key: 'selected' } as const, null)
const toggled = atom({ plugin: 'agent-tree', key: 'toggled' } as const, {})
const section = atom({ plugin: 'agent-tree', key: 'section' } as const, null)
const now = atom({ plugin: 'agent-tree', key: 'now' } as const, 0)
const autoOpened = atom({ plugin: 'agent-tree', key: 'autoOpened' } as const, false)

type Agents = { [id: string]: AgentNode }

// An Agent call as a transcript row knows it, before or without a spawn we saw.
type RowCall = {
  toolUseId?: string
  input: unknown
  isRunning: boolean
  isErrored: boolean
}

const ZERO: AgentTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const MAX_RESULT_CHARS = 4000

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, Math.max(1, max - 1))}…` : one
}

function field(input: unknown, name: string): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

// One short line for a tool call: `Bash npm test`, `Read orders.py`.
function describeCall(tool: string, input: unknown): string {
  const path = field(input, 'file_path') ?? field(input, 'path') ?? field(input, 'notebook_path')
  const arg =
    field(input, 'command') ??
    (path ? path.split('/').pop() : undefined) ??
    field(input, 'pattern') ??
    field(input, 'description') ??
    field(input, 'url') ??
    ''
  return clip(arg ? `${tool} ${arg}` : tool, 60)
}

function childrenOf(all: Agents, parentId: string | undefined): AgentNode[] {
  return Object.values(all)
    .filter(a => a.parentId === parentId)
    .sort((x, y) => x.startedAt - y.startedAt)
}

function subtreeRunning(all: Agents, a: AgentNode): boolean {
  return a.status === 'running' || childrenOf(all, a.id).some(c => subtreeRunning(all, c))
}

// Walks the trees under `roots` into rows; roots sit flush, children get box-drawing guides.
function flatten(all: Agents, roots: AgentNode[]): Line[] {
  const lines: Line[] = []
  const walk = (node: AgentNode, prefix: string) => {
    lines.push({ node, prefix })
    const kids = childrenOf(all, node.id)
    const guide = prefix.replace(/└ $/, '  ').replace(/├ $/, '│ ')
    kids.forEach((kid, i) => walk(kid, `${guide}${i === kids.length - 1 ? '└ ' : '├ '}`))
  }
  roots.forEach(root => walk(root, ''))
  return lines
}

function rootsOf(all: Agents): AgentNode[] {
  return Object.values(all)
    .filter(a => a.parentId === undefined || all[a.parentId] === undefined)
    .sort((x, y) => x.startedAt - y.startedAt)
}

async function openPane($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Subagents' })
}

function actionsFor($: EngineInterface, requestId: string, isOpen: boolean): ViewActions {
  return {
    toggle: () => void update($, toggled, t => ({ ...t, [requestId]: !isOpen })),
    openPane: () => void openPane($),
    select: id => void update($, selected, () => id),
    section: s => void update($, section, () => s),
    clearFinished: () =>
      void update($, agents, current => {
        const kept: Agents = {}
        const mark = (a: AgentNode) => {
          kept[a.id] = a
          childrenOf(current, a.id).forEach(mark)
        }
        rootsOf(current)
          .filter(r => subtreeRunning(current, r))
          .forEach(mark)
        return kept
      }),
  }
}

// The inline card that replaces the transcript's Agent row or group.
async function drawInline(
  $: EngineInterface,
  els: Parameters<typeof renderInline>[0],
  surface: Parameters<typeof renderInline>[1],
  requestId: string,
  calls: RowCall[],
) {
  const all = await read($, agents)
  const at = await read($, now)
  const byToolUse = new Map(Object.values(all).filter(a => a.toolUseId).map(a => [a.toolUseId, a]))

  const roots: AgentNode[] = []
  const bare: BareCall[] = []
  for (const call of calls) {
    const node = call.toolUseId ? byToolUse.get(call.toolUseId) : undefined
    if (node) roots.push(node)
    else
      bare.push({
        description: field(call.input, 'description') ?? 'Agent',
        type: field(call.input, 'subagent_type') ?? 'general-purpose',
        isRunning: call.isRunning,
        isErrored: call.isErrored,
      })
  }
  const lines = flatten(all, roots)
  const isLive = lines.some(l => l.node.status === 'running') || bare.some(c => c.isRunning)
  const isOpen = (await read($, toggled))[requestId] ?? isLive

  return renderInline(els, surface, at, requestId, lines, bare, isOpen, actionsFor($, requestId, isOpen))
}

let ticks = 0

function patch($: EngineInterface, id: string, fn: (a: AgentNode) => AgentNode) {
  return update($, agents, all => (all[id] ? { ...all, [id]: fn(all[id]) } : all))
}

// Keeps elapsed times moving and catches agents whose end we did not see.
async function tick($: EngineInterface) {
  const all = await read($, agents)
  const running = Object.values(all).filter(a => a.status === 'running')
  if (running.length === 0) return
  const at = await $.clock.now()
  await update($, now, () => at)
  ticks += 1
  if (ticks % 5 !== 0) return
  const live = new Map((await $.agent.list()).map(a => [a.id, a.status]))
  for (const a of running) {
    const status = live.get(a.id)
    if (status === undefined || status === 'running' || status === 'pending') continue
    const next: AgentStatus = status === 'completed' ? 'done' : status === 'killed' ? 'stopped' : 'failed'
    await patch($, a.id, n => (n.status === 'running' ? { ...n, status: next, endedAt: at, current: undefined } : n))
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-tree',
      description: 'Show this session’s subagents in a side pane',
    })
    $.clock.every(1000, () => void tick($))
    return next(e)
  })

  on('command.run', { command: 'agent-tree' }, async $ => {
    await openPane($)
    return { text: 'Subagents pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    const label = describeCall(e.tool, e)
    if (id !== undefined) {
      await patch($, id, a => ({ ...a, calls: a.calls + 1, current: label, recent: [...a.recent, label].slice(-8) }))
    }

    const ran = await next(e)

    if (id !== undefined) {
      await patch($, id, a => (a.current === label ? { ...a, current: undefined } : a))
    }
    // A foreground Agent call resolves when its subagent ends.
    if (e.tool === 'Agent' && e.tool_use_id && !e.run_in_background) {
      const toolUseId = e.tool_use_id
      const at = await $.clock.now()
      const failed = ran.isError === true || ran.deny !== undefined
      await update($, agents, all => {
        const a = Object.values(all).find(n => n.toolUseId === toolUseId)
        if (!a || a.status !== 'running') return all
        const status: AgentStatus = failed ? 'failed' : 'done'
        return { ...all, [a.id]: { ...a, status, endedAt: at, current: undefined } }
      })
    }
    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || started.agentId === undefined) return started

    const at = await $.clock.now()
    const node: AgentNode = {
      id: started.agentId,
      toolUseId: e.tool_use_id,
      parentId: e.parentAgentId,
      description: e.description,
      type: e.subagentType,
      model: started.model,
      prompt: e.prompt,
      isBackground: e.background,
      status: 'running',
      startedAt: at,
      tokens: ZERO,
      cost: ZERO_COST,
      longSteps: 0,
      steps: 0,
      calls: 0,
      recent: [],
    }
    await update($, agents, all => ({ ...all, [node.id]: node }))
    await update($, now, () => at)
    if (!(await read($, autoOpened))) {
      await update($, autoOpened, () => true)
      void openPane($).catch(() => undefined)
    }
    return started
  })

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id !== undefined && (await read($, agents))[id]?.status !== 'running') {
      // A finished agent resumed (SendMessage): it is running again.
      await patch($, id, a => ({ ...a, status: 'running', endedAt: undefined }))
    }
    const response = yield* next(e)
    const usage = response.usage
    if (id !== undefined && usage) {
      const step = stepCost(usage)
      await patch($, id, a => ({
        ...a,
        cost: addCost(a.cost ?? ZERO_COST, step.cost),
        longSteps: (a.longSteps ?? 0) + (step.isLong ? 1 : 0),
        model: usage.model || a.model,
        steps: a.steps + 1,
        tokens: {
          input: a.tokens.input + usage.input_tokens,
          output: a.tokens.output + usage.output_tokens,
          cacheRead: a.tokens.cacheRead + usage.cache_read_input_tokens,
          cacheWrite: a.tokens.cacheWrite + usage.cache_creation_input_tokens,
        },
      }))
    }
    return response
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const at = await $.clock.now()
      const status: AgentStatus = e.reason === 'answer' ? 'done' : e.reason === 'aborted' ? 'stopped' : 'failed'
      const answer = e.answer.trim()
      const result = answer.length > MAX_RESULT_CHARS ? `${answer.slice(0, MAX_RESULT_CHARS)}…` : answer
      await patch($, id, a => ({ ...a, status, endedAt: at, current: undefined, result: result || undefined }))
    }
    return next(e)
  })

  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const calls = e.props.calls
    if (calls.length === 0 || calls.some(c => c.tool !== 'Agent')) return next(e)
    return drawInline(
      $,
      $.ui.resolve(e),
      e.surface,
      e.requestId,
      calls.map(c => ({ toolUseId: c.tool_use_id, input: c.input, isRunning: c.isRunning, isErrored: c.isErrored })),
    )
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'Agent' } }, async ($, e) => {
    const p = e.props
    return drawInline($, $.ui.resolve(e), e.surface, e.requestId, [
      { toolUseId: p.tool_use_id, input: p.input, isRunning: p.isRunning, isErrored: p.isErrored },
    ])
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const all = await read($, agents)
    const at = await read($, now)
    const lines = flatten(all, rootsOf(all))
    const nodes = lines.map(l => l.node)
    const chosenId = await read($, selected)
    const chosen =
      (chosenId ? all[chosenId] : undefined) ??
      [...nodes].reverse().find(a => a.status === 'running') ??
      nodes[nodes.length - 1]
    const picked: DetailSection | null = await read($, section)
    const shown: DetailSection = picked ?? (chosen?.status === 'running' ? 'activity' : 'result')

    return renderPane(
      $.ui.resolve(e),
      e.surface,
      at,
      e.props.bodyColumns,
      lines,
      chosen,
      shown,
      actionsFor($, PANE, true),
    )
  })
}
