import { expect, mock, test } from 'claude-code/testing'

import { SEASONS, seasonArt, seasonByName, seasonFor } from '../hooks/seasons'

const SURFACES = ['desktop'] as const
const START = Date.parse('2026-10-07T12:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE

const bandProps = (bodyColumns: number, hasSurvey = false) => ({
  hasSurvey,
  isWorking: false,
  maxRows: 12,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
})

// Stands in for the engine, which draws nothing of its own in the band.
const ENGINE_BAND = { type: 'Box' as const, children: ['engine'] }
// The engine's band with nothing in it, as when no other mod draws there.
const ENGINE_EMPTY = () => ({ type: 'Box' as const, children: [] }) as never

const READING = {
  context: { tokens: 62_400, window: 200_000, percent: 31 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 18.4, resetsAt: new Date(START + 3 * HOUR + 12 * MINUTE).toISOString() },
    { kind: 'seven_day', percentUsed: 92, resetsAt: new Date(START + 4 * 24 * HOUR + 2 * HOUR).toISOString() },
  ],
}

test('keeps 5-hour, 7-day and context on one row at every width', async ($, on) => {
  mock.clock(on, { now: START })
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_EMPTY)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ ...READING, changed: ['context', 'rateLimits'] })

  for (const surface of SURFACES) {
    for (const bodyColumns of [160, 70, 44]) {
      const ui = await $.ui.mount({
        plugin: 'usage-band',
        surface,
        component: 'AbovePrompt',
        props: bandProps(bodyColumns),
      })

      const box = (await ui.findAll({ type: 'Box' })).find(found => found.props.flexWrap === 'nowrap')
      expect(box?.props.flexDirection).toBe('row')
      expect(box?.props.flexWrap).toBe('nowrap')

      expect(await ui.find({ type: 'Text', text: '5-hour' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '7-day' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Context' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /18%/ })).toBeDefined()

      // 92% of the weekly window is drawn in the alarm color.
      const weekly = await ui.find({ type: 'Text', text: /92%/ })
      expect(weekly?.props.color).toBe(surface === 'desktop' ? '#E5534B' : 'error')

      if (bodyColumns === 160) {
        // Room for everything: bars and the full wording.
        expect(await ui.find({ type: 'Text', text: 'resets in 3h 12m' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: 'resets in 4d 2h' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: '62k / 200k' })).toBeDefined()
        expect(await ui.find({ type: surface === 'desktop' ? 'Svg' : 'Text', text: surface === 'desktop' ? undefined : /━/ })).toBeDefined()
      }
      if (bodyColumns === 70) {
        // Bars drop out before anything wraps; times shorten.
        expect(await ui.find({ type: 'Text', text: '3h 12m' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: '62k/200k' })).toBeDefined()
        expect(await ui.find({ type: 'Text', text: /resets in/ })).toBeUndefined()
        // No meter images (the seasonal art behind the row is the only Svg left).
        expect((await ui.findAll({ type: 'Svg' })).filter(svg => String((svg.props as { alt?: string }).alt).endsWith('used'))).toHaveLength(0)
        expect(await ui.find({ type: 'Text', text: /━|─/ })).toBeUndefined()
      }
      if (bodyColumns === 44) {
        // Narrowest: label and percent only.
        expect(await ui.find({ type: 'Text', text: '3h 12m' })).toBeUndefined()
        expect(await ui.find({ type: 'Text', text: '62k/200k' })).toBeUndefined()
      }

      await ui.unmount()
    }
  }
})

test('the reset countdown keeps moving while the session is idle', async ($, on) => {
  const clock = mock.clock(on, { now: START })
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_EMPTY)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: START, ...READING } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'terminal', component: 'AbovePrompt', props: bandProps(160) })
  expect(await ui.find({ type: 'Text', text: /resets in 3h 12m/ })).toBeDefined()

  await clock.advance(2 * MINUTE)
  expect(await ui.find({ type: 'Text', text: /resets in 3h 10m/ })).toBeDefined()
  await ui.unmount()
})

test('shows placeholders before the first reading', async ($, on) => {
  mock.clock(on, { now: START })
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_EMPTY)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { window: 1_000_000 }, rateLimits: [], changed: ['context'] })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: bandProps(160) })
    expect(await ui.find({ type: 'Text', text: /— \/ 1M/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Text', text: /^\s*—$/ })).length).toBe(3)
    await ui.unmount()
  }
})

test('yields the band to a survey', async ($, on) => {
  mock.clock(on, { now: START })
  on('ui.render', { component: 'AbovePrompt' }, () => ENGINE_BAND)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { window: 200_000 }, rateLimits: [], changed: ['context'] })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: bandProps(160, true) })
    expect(await ui.find({ type: 'Text', text: /Context/ })).toBeUndefined()
    expect(await ui.find({ type: 'Box', text: 'engine' })).toBeDefined()
    await ui.unmount()
  }
})

test('another mod in the band (the PR bar) stacks above the usage row', async ($, on) => {
  mock.clock(on, { now: START })
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box' as const, children: ['pr bar'] }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ ...READING, changed: ['context', 'rateLimits'] })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface, component: 'AbovePrompt', props: bandProps(160) })
    const outer = await ui.find({ type: 'Box' })
    expect(outer?.props.flexDirection).toBe('column')
    expect(outer?.props.gap).toBe(1)
    // The usage row sits in a box of its own under the other mod's.
    expect((await ui.findAll({ type: 'Box' })).some(box => box.props.borderStyle === 'round')).toBe(true)
    expect(await ui.find({ type: 'Box', text: 'pr bar' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '5-hour' })).toBeDefined()
    await ui.unmount()
  }
})

test('each month has its holiday theme; names and numbers find them', async () => {
  expect(SEASONS).toHaveLength(12)
  expect(seasonFor(new Date(2026, 9, 10)).id).toBe('halloween')
  expect(seasonFor(new Date(2026, 10, 1)).id).toBe('thanksgiving')
  expect(seasonFor(new Date(2026, 11, 24)).id).toBe('christmas')
  expect(seasonByName('12')?.id).toBe('christmas')
  expect(seasonByName('feb')?.id).toBe('valentines')
  expect(seasonByName('halloween')?.id).toBe('halloween')
  expect(seasonByName('nope')).toBeUndefined()
  for (const season of SEASONS) {
    const art = seasonArt(season, 12_345)
    expect(art.length).toBeLessThan(131_072)
    expect(art).toContain('@keyframes mv')
    // Redraws continue the timeline: delays are shifted back by the elapsed time.
    expect(art).toContain('animation-delay:-12.35s')
  }
})

test('the band draws the month\'s art behind the row, labelled, and /usage-theme pins another', async ($, on) => {
  mock.clock(on, { now: START })
  on('ui.render', { component: 'AbovePrompt' }, ENGINE_EMPTY)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: START, ...READING } }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })

  const art = async () => {
    const ui = await $.ui.mount({ plugin: 'usage-band', surface: 'desktop', component: 'AbovePrompt', props: bandProps(160) })
    const found = (await ui.findAll({ type: 'Svg' })).find(svg => String((svg.props as { alt?: string }).alt).endsWith('theme'))
    await ui.unmount()
    return (found?.props as { alt?: string } | undefined)?.alt
  }
  expect(await art()).toBe('Halloween theme')
  const run = (args: string) => $.command.run({ command: 'usage-theme', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect((await run('dec')).text).toContain('Christmas')
  expect(await art()).toBe('Christmas theme')
  expect((await run('auto')).text).toContain('Halloween')
  expect(await art()).toBe('Halloween theme')
})
