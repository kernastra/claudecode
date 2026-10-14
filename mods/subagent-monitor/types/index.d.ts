export type DetailSection = 'activity' | 'prompt' | 'result'

export type AgentStatus = 'running' | 'done' | 'failed' | 'stopped'

export type AgentTokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

// Dollars, summed request by request at the rates in hooks/pricing.ts.
export type AgentCost = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type AgentNode = {
  id: string
  toolUseId?: string
  parentId?: string
  description: string
  type: string
  model: string
  prompt: string
  isBackground: boolean
  status: AgentStatus
  startedAt: number
  endedAt?: number
  tokens: AgentTokens
  // Optional: agents recorded before cost tracking have neither.
  cost?: AgentCost
  longSteps?: number
  steps: number
  calls: number
  current?: string
  recent: string[]
  result?: string
}

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': {
      agents: { [id: string]: AgentNode }
      selected: string | null
      toggled: { [requestId: string]: boolean }
      section: DetailSection | null
      now: number
      autoOpened: boolean
    }
  }
}
