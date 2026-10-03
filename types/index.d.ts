export type Reading = { tokens: number; window: number }

declare module 'claude-code' {
  interface PluginState {
    overalls: { history: Reading[]; ponytail: string }
  }
}
