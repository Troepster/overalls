import { test, expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { bar, contrast, fmt, heat, hexToRgb, ponytailLabel, weather } from './register'

test('forecast helpers', () => {
  expect([0, 24, 25, 49, 50, 74, 75, 89, 90, 100].map(p => weather(p).word)).toEqual([
    'Clear', 'Clear', 'Cloudy', 'Cloudy', 'Showers', 'Showers', 'Storm', 'Storm', 'Compact soon', 'Compact soon',
  ])
  expect(`${fmt(134400)} / ${fmt(200000)}`).toBe('134.4k / 200k')
  expect(fmt(1000000)).toBe('1M')
  expect([0, 100000, 199999, 200000].map(tokens => bar({ tokens, window: 200000 })).join('')).toBe('▁▅██')
})

// The test kit keeps no store: an in-memory one per test, returned so a test can read it.
const memStore = (on: Parameters<TestBody>[1]) => {
  const store: Record<string, unknown> = {}
  on('store.get', (_$, e) => ({ value: store[e.key] }))
  on('store.set', (_$, e) => ((store[e.key] = JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  return store
}

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} }

// WCAG 1.4.11: coloured glyphs (icon, bars) need 3:1 against the background.
// Light: white, off-white. Dark: black, VS Code/terminal greys, desktop dark.
const BACKGROUNDS = ['#ffffff', '#f5f5f5', '#eeeeee', '#000000', '#1e1e1e', '#262624', '#2b2b2b', '#303030']

test('a11y: every heat colour keeps 3:1 on light and dark backgrounds', () => {
  const worst: Record<string, number> = {}
  for (let p = 0; p <= 100; p++) {
    for (const bg of BACKGROUNDS) {
      const ratio = contrast(hexToRgb(heat(p)), hexToRgb(bg))
      worst[bg] = Math.min(worst[bg] ?? Infinity, ratio)
    }
  }
  for (const r of Object.values(worst)) expect(r).toBeGreaterThanOrEqual(3)
  expect(heat(0)).toMatch(/^#00[0-9a-f]{2}00$/)
  expect(heat(100)).toMatch(/^#[0-9a-f]{2}0000$/)
})

test('band draws, offers Compact from 75%, and records the drop', async ($, on) => {
  const store = memStore(on)
  let tokens = 0
  let compacted = 0
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => (compacted++, { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }], tokensAfter: 20000 }))
  const turn = async (n: number) => {
    tokens = n
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' })
  }

  await turn(36100)
  await turn(134400)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'overalls', surface, component: 'AbovePrompt', props: PROPS })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
    expect(texts).toBe('☂ Showers 67% · 134.4k / 200k · ▂▆ · ▲ +98.3k last turn ')
    expect(await ui.find({ key: 'compact' })).toBeUndefined()
    await ui.unmount()
  }

  await turn(160000)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ plugin: 'overalls', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ key: 'compact' })).toBeDefined()
    const busy = await $.ui.mount({ plugin: 'overalls', surface, component: 'AbovePrompt', props: { ...PROPS, isWorking: true } })
    expect(await busy.find({ key: 'compact' })).toBeUndefined()
    await busy.unmount()
    if (surface === 'terminal') {
      await ui.press({ key: 'compact' })
      expect(compacted).toBe(1)
      expect(await ui.find({ key: 'compact' })).toBeUndefined()
      expect((await ui.findAll({ type: 'Text' })).map(t => t.text).join('')).toContain('10% · 20k / 200k')
    }
    await ui.unmount()
  }
})

test('ponytail label', () => {
  expect(ponytailLabel(false, 'full')).toBe('not installed')
  expect(ponytailLabel(true, undefined)).toBe('off')
  expect(ponytailLabel(true, 'lite\n')).toBe('lite')
})

const textOf = async (ui: { findAll: (q: { type: 'Text' }) => Promise<{ text: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')

for (const [detail, expected] of [
  ['minimal', '☂ 67% · ponytail: ultra '],
  ['normal', '☂ Showers 67% · 134.4k / 200k · ponytail: ultra '],
  ['full', '☂ Showers 67% · 134.4k / 200k · ▂▆ · ▲ +98.3k last turn · ponytail: ultra '],
  ['off', 'ponytail: ultra '],
] as const) {
  test(`weather=${detail} with ponytail installed`, { options: { weather: detail, ponytail: true } }, async ($, on) => {
  const store = memStore(on)
    let tokens = 0
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200000 }, rateLimits: [] } }))
    on('turn.complete', () => ({ text: '' }))
    on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true } } }))
    on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
    on('fs.read', (_$, e) => (e.path === '/home/u/.claude/.ponytail-active' ? { value: 'ultra\n' } : { deny: 'ENOENT' }))
    for (const n of [36100, 134400]) {
      tokens = n
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' })
    }
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'overalls', surface, component: 'AbovePrompt', props: PROPS })
      expect(await textOf(ui)).toBe(expected)
      // One line: Box's default direction differs by surface (desktop stacks), so every Box says row.
      const dirs = (await ui.findAll({ type: 'Box' })).map(b => b.props.flexDirection)
      expect(dirs.filter(d => d !== 'row')).toEqual([])
      await ui.unmount()
    }
  })
}

test('subagent turns leave the forecast alone', { options: { weather: 'full', ponytail: false } }, async ($, on) => {
  const store = memStore(on)
  let tokens = 0
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  const turn = async (n: number, agentId?: string) => {
    tokens = n
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer', agentId })
  }
  await turn(36100)
  await turn(150000, 'sub-1')
  await turn(134400)
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await textOf(ui)).toBe('☂ Showers 67% · 134.4k / 200k · ▂▆ · ▲ +98.3k last turn ')
  await ui.unmount()
})

for (const [typed, expected] of [['Minimal', '☂ 67% '], [' NORMAL ', '☂ Showers 67% · 134.4k / 200k '], ['bogus', '☂ Showers 67% · 134.4k / 200k · ▂▆ · ▲ +98.3k last turn ']] as const) {
  test(`weather typed as ${JSON.stringify(typed)}`, { options: { weather: typed, ponytail: false } }, async ($, on) => {
  const store = memStore(on)
    let tokens = 0
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200000 }, rateLimits: [] } }))
    on('turn.complete', () => ({ text: '' }))
    for (const n of [36100, 134400]) {
      tokens = n
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' })
    }
    const ui = await $.ui.mount({ plugin: 'overalls', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect(await textOf(ui)).toBe(expected)
    await ui.unmount()
  })
}

test('/overalls sets the config row, and ⚙ starts the command', { options: { weather: 'full', ponytail: false } }, async ($, on) => {
  const store = memStore(on)
  // A --plugin-dir load names its rows `overalls@inline.<field>`, not `overalls.<field>`.
  const row = (field: string, kind: 'text' | 'boolean', value: string | boolean) =>
    ({ key: `overalls@inline.${field}`, label: field, kind, value, provider: { plugin: 'overalls', tier: 'user' as const }, isLocked: false })
  on('config.list', () => ({ value: [row('weather', 'text', 'full'), row('ponytail', 'boolean', true), { ...row('x', 'text', ''), key: 'theme' }] }))
  const sets: unknown[] = []
  on('config.set', (_$, e) => (sets.push([e.key, e.value]), { value: e.value }))
  const filled: string[] = []
  on('prompt.fill', (_$, e) => (filled.push(e.text), { isFilled: true, text: e.text, cursor: e.text.length }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 36100, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  const registered: string[] = []
  on('command.register', (_$, e) => (registered.push(e.name), { value: { command: e.name } }))
  on('session.start', (_$, e) => e)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(registered).toEqual(['overalls'])

  const run = async (args: string) => (await $.command.run({ command: 'overalls', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text
  expect(await run('weather Minimal')).toBe('Overalls weather: minimal')
  expect(await run('ponytail off')).toBe('Overalls ponytail: off')
  expect(await run('weather sunny')).toContain('Usage: /overalls weather off|minimal|normal|full')
  expect(sets).toEqual([['overalls@inline.weather', 'minimal'], ['overalls@inline.ponytail', false]])
  expect(store.prefs).toEqual({}) // the row holds it, so nothing is kept beside it

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'overalls', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'settings' })
    await ui.unmount()
  }
  expect(filled).toEqual(['/overalls ', '/overalls '])
})

test('/overalls without a /config row (desktop) keeps the choice in the store', { options: { weather: 'full', ponytail: false } }, async ($, on) => {
  const store = memStore(on)
  on('config.list', () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'text' as const, value: 'dark', provider: { plugin: 'engine', tier: 'core' as const }, isLocked: false }] }))
  on('config.set', () => { throw new Error('no row to set') })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 134400, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  const run = async (args: string) =>
    (await $.command.run({ command: 'overalls', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text
  expect(await run('weather minimal')).toBe('Overalls weather: minimal')
  expect(store.prefs).toEqual({ weather: 'minimal' })
  expect(await run('')).toContain('Overalls weather: minimal, ponytail: off')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'overalls', surface, component: 'AbovePrompt', props: PROPS })
    expect(await textOf(ui)).toBe('☂ 67% ')
    await ui.unmount()
  }
})
