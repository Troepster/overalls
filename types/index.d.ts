export type Reading = { tokens: number; window: number }
export type McpTrouble = { why: string; detail: string }
export type Denial = { tool: string; reason: string }
export type Sample = { at: number; pct: number }
export type Beat = {
  id: string
  title?: string
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
    overalls: { history: Reading[]; ponytail: string; level: string; caveman: string; mcpDown: Record<string, McpTrouble>; panel: '' | 'config' | 'mcp' | 'agents' | 'denials'; denials: Denial[]; limitMeasures: Record<string, Sample[]>; title: string }
  }
}
