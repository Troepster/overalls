export type Reading = { tokens: number; window: number }
export type McpTrouble = { why: string; detail: string }
export type Denial = { tool: string; reason: string }

declare module 'claude-code' {
  interface PluginState {
    overalls: { history: Reading[]; ponytail: string; level: string; caveman: string; mcpDown: Record<string, McpTrouble>; panel: '' | 'config' | 'mcp' | 'agents' | 'denials'; denials: Denial[] }
  }
}
