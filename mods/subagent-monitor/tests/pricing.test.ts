import { expect, test } from 'claude-code/testing'

import { money, stepCost, totalCost } from '../hooks/pricing'

// Floating-point sums compared to a nanodollar.
const round = (usd: number) => Math.round(usd * 1e9) / 1e9

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
})

test('prices a short request at the standard Haiku 5.5 rates', async () => {
  const { cost, isLong } = stepCost(usage(10_000, 2_000, 80_000, 8_000))
  expect(isLong).toBe(false)
  expect(round(cost.input)).toBe(0.001)
  expect(round(cost.output)).toBe(0.001)
  expect(round(cost.cacheRead)).toBe(0.0008)
  expect(round(cost.cacheWrite)).toBe(0.001)
  expect(money(totalCost(cost))).toBe('$0.004')
})

test('a prompt over 100k tokens, cache reads included, pays long-context rates', async () => {
  const { cost, isLong } = stepCost(usage(1_000, 1_000, 99_500, 0))
  expect(isLong).toBe(true)
  expect(round(cost.input)).toBe(0.0005)
  expect(round(cost.output)).toBe(0.0025)
  expect(round(cost.cacheRead)).toBe(0.004975)
})

test('formats money for small and large amounts', async () => {
  expect(money(0)).toBe('$0')
  expect(money(0.0004)).toBe('<$0.001')
  expect(money(0.0123)).toBe('$0.012')
  expect(money(3.456)).toBe('$3.46')
})
