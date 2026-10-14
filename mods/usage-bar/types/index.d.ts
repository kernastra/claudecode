export type UsageWindow = { percentUsed: number; resetsAt?: string }

export type UsageSnapshot = {
  context: { tokens?: number; window: number; percent?: number }
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
}

declare module 'claude-code' {
  interface PluginState {
    /** `theme`: a season id the preview command pinned for this session; null follows the month. */
    'usage-band': { snapshot: UsageSnapshot | null; now: number; theme: string | null }
  }
}
