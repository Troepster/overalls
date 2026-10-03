export type Reading = { tokens: number; window: number }

declare module 'claude-code' {
  interface PluginState {
    overalls: { history: Reading[]; ponytail: string; level: string; caveman: { mode: string; savings: string }; configOpen: boolean }
  }
}
