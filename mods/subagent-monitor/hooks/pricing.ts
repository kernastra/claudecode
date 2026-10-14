// Claude Haiku 5.5 API prices, USD per million tokens, from
// https://platform.claude.com/docs/en/about-claude/pricing (read 2026-10-10).
// Each request is priced on its own: one whose prompt (input + cache reads + cache writes)
// is over 100,000 tokens pays the long-context row for all of its tokens.
// Usage does not say which TTL a cache write used, so writes are priced at the 5-minute rate.

import type { ModelUsage } from 'claude-code'

import type { AgentCost } from '../types'

type Rates = { input: number; cacheWrite: number; cacheRead: number; output: number }

const STANDARD: Rates = { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 }
const LONG: Rates = { input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 }
const LONG_PROMPT_TOKENS = 100_000

export const ZERO_COST: AgentCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export const isHaiku55 = (model: string) => /haiku-5-5/.test(model)

export function stepCost(u: ModelUsage): { cost: AgentCost; isLong: boolean } {
  const prompt = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
  const isLong = prompt > LONG_PROMPT_TOKENS
  const r = isLong ? LONG : STANDARD
  const usd = (tokens: number, rate: number) => (tokens * rate) / 1_000_000
  return {
    isLong,
    cost: {
      input: usd(u.input_tokens, r.input),
      output: usd(u.output_tokens, r.output),
      cacheRead: usd(u.cache_read_input_tokens, r.cacheRead),
      cacheWrite: usd(u.cache_creation_input_tokens, r.cacheWrite),
    },
  }
}

export const addCost = (a: AgentCost, b: AgentCost): AgentCost => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})

export const totalCost = (c: AgentCost) => c.input + c.output + c.cacheRead + c.cacheWrite

export function money(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.001) return '<$0.001'
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}
