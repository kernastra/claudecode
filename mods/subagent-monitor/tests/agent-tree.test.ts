import { expect, mock, test } from 'claude-code/testing'

const ENGINE = { plugin: 'engine', tier: 'core' } as const

test('tracks a subagent tree with tokens and draws it inline and in the pane', async ($, on) => {
  let spawned = 0
  const clock = mock.clock(on, { now: 1_000_000 })

  // Beneath the plugin, stand in for the engine: an Agent call spawns a subagent.
  on('agent.spawn', async (_$, e) => {
    spawned += 1
    return { model: e.subagentType === 'Explore' ? 'claude-haiku-5-5' : 'claude-opus-5-5', agentId: `a${spawned}` }
  })
  on('tool.call', async (_$, e) => {
    if (e.tool === 'Agent') {
      await $.agent.spawn({
        tool_use_id: e.tool_use_id,
        prompt: e.prompt,
        description: e.description,
        subagentType: e.subagent_type ?? 'general-purpose',
        provider: ENGINE,
        parentModel: 'claude-opus-5-5',
        parentAgentId: e.agentId,
        background: e.run_in_background === true,
        fork: false,
      })
    }
    return { result: { ok: true } as never }
  })
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 20_000,
        cache_creation_input_tokens: 0,
        model: e.model,
      },
    }
  })
  on('turn.complete', async e => ({ text: '' }))

  // Main loop spawns "Review merged diff"; that agent spawns "Find callers".
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'tu1',
    description: 'Review merged diff',
    prompt: 'Review the diff',
    run_in_background: true,
  })
  await $.tool.call({
    tool: 'Agent',
    tool_use_id: 'tu2',
    description: 'Find callers of parse()',
    prompt: 'Find callers',
    subagent_type: 'Explore',
    agentId: 'a1',
    run_in_background: true,
  } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'tu3', command: 'grep -rn parse src', agentId: 'a2' } as never)

  for (const index of [0, 1]) {
    const step = $.turn.step({ turnId: 't2', index, model: 'claude-haiku-5-5', messageCount: 3, agentId: 'a2' })
    for await (const _ of step) {
      // drain
    }
  }
  await clock.advance(12_000)
  await $.turn.complete({
    turnId: 't2',
    agentId: 'a2',
    reason: 'answer',
    answer: 'parse() is called from orders.py',
    durationMs: 5,
    isAborted: false,
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    const row = await $.ui.mount({
      plugin: 'agent-tree',
      surface,
      component: 'ToolUse',
      requestId: 'tu1',
      props: { tool_use_id: 'tu1', tool: 'Agent', input: {}, isRunning: true, isErrored: false, isInterrupted: false },
    })
    const texts = (await row.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(texts).toContain('Subagents')
    expect(texts).toContain('1 running')
    expect(texts).toContain('2 agents')
    expect(texts).toContain('Review merged diff')
    expect(texts).toContain('Find callers of parse()')
    expect(texts).toContain('└')
    // a2: two steps of 21.5k each.
    expect(texts).toContain('43k')
    expect(texts).toContain('Thinking… · 1 call')
    expect(await row.find({ key: 'pane-tu1' })).toBeDefined()
    await row.press({ key: 'toggle-tu1' })
    expect((await row.findAll({ type: 'Text' })).map(t => t.text)).not.toContain('Find callers of parse()')
    await row.press({ key: 'toggle-tu1' })
    await row.unmount()

    const pane = await $.ui.mount({
      plugin: 'agent-tree',
      surface,
      component: 'Pane',
      requestId: 'agent-tree',
      props: { title: 'Subagents', isFocused: true, bodyColumns: 90, placement: 'dock' } as never,
    })
    // The running agent is chosen first; step to the finished child.
    expect((await pane.findAll({ type: 'Text' })).map(t => t.text)).toContain('1 of 2')
    await pane.press({ key: 'next' })
    const detail = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(detail).toContain('2 of 2')
    expect(detail).toContain('· Explore · haiku · 12s')
    expect(detail).toContain('2 requests')
    expect(detail).toContain('40k')
    // Per request: 1000 in × $0.10 + 500 out × $0.50 + 20k cache read × $0.01 per MTok = $0.00055; two requests.
    expect(detail).toContain('Haiku 5.5 API rates')
    expect(detail).toContain('$0.001')
    expect(detail).not.toContain('priced at Haiku 5.5 rates')
    const result = await pane.find({ type: 'Markdown' })
    expect(JSON.stringify(result?.props ?? detail)).toContain('parse() is called from orders.py')

    await pane.press({ key: 'section-activity' })
    const activity = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
    expect(activity).toContain('Bash grep -rn parse src')
    expect(activity).toContain('1 tool call in all')
    expect(await pane.find({ key: 'clear' })).toBeDefined()
    // Leave the view as found for the next surface.
    await pane.press({ key: 'section-result' })
    await pane.press({ key: 'prev' })
    await pane.unmount()
  }
})

test('leaves mixed tool groups to the engine', async ($, on) => {
  let reached = false
  on('ui.render', async (inner, e) => {
    reached = true
    const { Text } = inner.ui.resolve(e)
    return Text({ children: 'engine row' })
  })
  const group = await $.ui.mount({
    plugin: 'agent-tree',
    surface: 'desktop',
    component: 'ToolGroup',
    props: {
      calls: [
        { tool: 'Read', input: { file_path: 'a.py' }, isRunning: false, isErrored: false, isInterrupted: false },
        { tool: 'Agent', input: { description: 'x' }, isRunning: true, isErrored: false, isInterrupted: false },
      ],
      isActive: true,
      isExpanded: false,
    },
  })
  expect(reached).toBe(true)
  expect(await group.find({ text: /agent/ })).toBeUndefined()
})
