export type Reading = { tokens: number; window: number }
export type McpTrouble = { why: string; detail: string }
export type Denial = { tool: string; reason: string }
export type Sample = { at: number; pct: number }
export type Recap = { text: string; at: number; busy: boolean }
export type Unread = { host: string; title: string; at: number }
export type Activity = { ask: string; endedAt: number; awayMs: number; busy: boolean }
export type Beat = {
  id: string
  title?: string
  ask?: string
  busy?: boolean
  endedAt?: number
  project: string
  cwd: string
  model: string
  percent?: number
  turnsLeft?: number
  limits: { kind: string; percent: number; at?: number }[]
  cost?: number
  agents: number
  mcp: string[]
  denials: number
  ponytail: string
  caveman: string
  at: number
  ended: boolean
  host?: string
}

declare module 'claude-code' {
  interface PluginState {
    overalls: { history: Reading[]; ponytail: string; level: string; caveman: string; mcpDown: Record<string, McpTrouble>; panel: '' | 'config' | 'mcp' | 'agents' | 'denials' | 'recap'; denials: Denial[]; limitMeasures: Record<string, Sample[]>; title: string; recap: Recap; activity: Activity; unread: Unread[] }
  }
}
