import { test, expect } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { bar, caveMode, contrast, fmt, heat, hexToRgb, levelAfter, ponyMode, ponytailLabel, weather } from './register'

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
    expect(await textOf(ui)).toBe('☂ Showers 67% · 134.4k / 200k▂▆▲ +98.3k last turn')
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

// The band's words run together (widgets are spaced by layout, not text), with the forecast
// Button's label and the Ponytail dropdown's value in place: ⚙, Compact and the hover cards
// (the only inverse Text) are left out.
const textOf = async (ui: { findAll: (q: object) => Promise<{ type: string; key?: string; text: string; props: Record<string, unknown> }[]> }) =>
  (await ui.findAll({}))
    .map(n => (n.type === 'Text' ? (n.props.inverse ? '' : n.text) : n.type === 'Select' ? ` ${String(n.props.value)}` : n.type === 'Button' && n.props.label !== '⚙' && n.props.label !== 'Compact' ? String(n.props.label) : ''))
    .join('')

for (const [detail, expected] of [
  ['minimal', '☂ 67% ultra'],
  ['normal', '☂ Showers 67% · 134.4k / 200k ultra'],
  ['full', '☂ Showers 67% · 134.4k / 200k▂▆▲ +98.3k last turn ultra'],
  ['off', ' ultra'],
] as const) {
  test(`weather=${detail} with ponytail installed`, { options: { weather: detail, ponytail: 'icon' } }, async ($, on) => {
  const store = memStore(on)
    let tokens = 0
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200000 }, rateLimits: [] } }))
    on('turn.complete', () => ({ text: '' }))
    on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true } } }))
    on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
    on('fs.read', (_$, e) => (e.path === '/home/u/.config/ponytail/config.json' ? { value: '{"defaultMode":"ultra"}' } : { deny: 'ENOENT' }))
    for (const n of [36100, 134400]) {
      tokens = n
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' })
    }
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'overalls', surface, component: 'AbovePrompt', props: PROPS })
      expect(await textOf(ui)).toBe(expected)
      // The Ponytail logo stands for the word: a terminal Image, an Svg elsewhere.
      expect(await ui.find({ type: surface === 'terminal' ? 'Image' : 'Svg' })).toBeDefined()
      // One line: Box's default direction differs by surface (desktop stacks), so every Box says row.
      const dirs = (await ui.findAll({ type: 'Box' })).map(b => b.props.flexDirection)
      expect(dirs.filter(d => d !== 'row')).toEqual([])
      await ui.unmount()
    }
  })
}

test('subagent turns leave the forecast alone', { options: { weather: 'full', ponytail: 'off' } }, async ($, on) => {
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
  expect(await textOf(ui)).toBe('☂ Showers 67% · 134.4k / 200k▂▆▲ +98.3k last turn')
  await ui.unmount()
})

for (const [typed, expected] of [['Minimal', '☂ 67%'], [' NORMAL ', '☂ Showers 67% · 134.4k / 200k'], ['bogus', '☂ Showers 67% · 134.4k / 200k▂▆▲ +98.3k last turn']] as const) {
  test(`weather typed as ${JSON.stringify(typed)}`, { options: { weather: typed, ponytail: 'off' } }, async ($, on) => {
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

test('/overalls and the ⚙ Config box set the config row', { options: { weather: 'full', ponytail: 'off' } }, async ($, on) => {
  const store = memStore(on)
  // A --plugin-dir load names its rows `overalls@inline.<field>`, not `overalls.<field>`.
  const row = (field: string, kind: 'text' | 'boolean', value: string | boolean) =>
    ({ key: `overalls@inline.${field}`, label: field, kind, value, provider: { plugin: 'overalls', tier: 'user' as const }, isLocked: false })
  on('config.list', () => ({ value: [row('weather', 'text', 'full'), row('ponytail', 'text', 'icon'), { ...row('x', 'text', ''), key: 'theme' }] }))
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
  expect(await run('ponytail on')).toContain('Usage:')
  expect(await run('weather sunny')).toContain('Usage: /overalls weather off|minimal|normal|full')
  expect(sets).toEqual([['overalls@inline.weather', 'minimal'], ['overalls@inline.ponytail', 'off']])
  expect(store.prefs).toEqual({}) // the row holds it, so nothing is kept beside it

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ plugin: 'overalls', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ key: 'weather-off' })).toBeUndefined()
    await ui.press({ key: 'settings' }) // opens the Config box
    await ui.press({ key: 'weather-off' })
    await ui.press({ key: 'settings' }) // and closes it
    expect(await ui.find({ key: 'weather-off' })).toBeUndefined()
    await ui.unmount()
  }
  expect(sets.slice(-3)).toEqual(Array(3).fill(['overalls@inline.weather', 'off']))
  expect(filled).toEqual([])
})

test('/overalls without a /config row (desktop) keeps the choice in the store', { options: { weather: 'full', ponytail: 'off' } }, async ($, on) => {
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
    expect(await textOf(ui)).toBe('☂ 67%')
    await ui.unmount()
  }
})

test('Compact runs /compact where the session cannot compact (desktop)', async ($, on) => {
  memStore(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160000, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => { throw new Error('not available in a headless (-p / SDK) session yet') })
  const ran: string[] = []
  on('command.run', (_$, e) => (ran.push(e.command), { text: '' }))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'compact' })
  await ui.unmount()
  expect(ran).toEqual(['compact'])
})

test('Compact fills /compact where it cannot run it either', async ($, on) => {
  memStore(on)
  on('command.run', () => { throw new Error('refused') })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160000, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => { throw new Error('not available in a headless (-p / SDK) session yet') })
  const filled: string[] = []
  on('prompt.fill', (_$, e) => (filled.push(e.text), { isFilled: true, text: e.text, cursor: e.text.length }))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'compact' })
  await ui.unmount()
  expect(filled).toEqual(['/compact'])
})

test('pressing the forecast steps its detail, skipping off', { options: { weather: 'normal', ponytail: 'off' } }, async ($, on) => {
  const store = memStore(on)
  on('config.list', () => ({ value: [] }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 134400, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const seen: unknown[] = []
  for (let i = 0; i < 3; i++) {
    const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'detail' })
    await ui.unmount()
    seen.push((store.prefs as Record<string, unknown>).weather)
  }
  expect(seen).toEqual(['full', 'minimal', 'normal'])
})

test('with weather and ponytail both off, ⚙ still draws', { options: { weather: 'off', ponytail: 'off' } }, async ($, on) => {
  memStore(on)
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ key: 'settings' })).toBeDefined()
  await ui.unmount()
})

test('the ⚙ Config box sets each choice in one press', { options: { weather: 'minimal', ponytail: 'off' } }, async ($, on) => {
  const store = memStore(on)
  on('config.list', () => ({ value: [] }))
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'settings' })
  // The bordered Config box sits above the band: the only Boxes that stack are it and its parent.
  expect((await ui.findAll({ type: 'Box' })).map(b => b.props.flexDirection).filter(d => d !== 'row')).toEqual(['column', 'column'])
  expect((await ui.find({ key: 'settings' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'weather-minimal' }))?.props.label).toBe('minimal ✓')
  await ui.press({ key: 'weather-off' })
  expect(store.prefs).toEqual({ weather: 'off' })
  await ui.press({ key: 'weather-full' })
  await ui.press({ key: 'ponytail-text' })
  expect(store.prefs).toEqual({ weather: 'full', ponytail: 'text' })
  await ui.unmount()
})

test('hover cards explain the Config box settings, and stay off the band', { options: { weather: 'normal', ponytail: 'icon' } }, async ($, on) => {
  memStore(on)
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 160000, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  on('settings.read', () => ({ value: {} }))
  on('env.get', () => ({ value: '/h' }))
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // The kit's tree leaves out hover, so this checks the hidden cards' words: none on the band.
  const cards = async () =>
    (await ui.findAll({ type: 'Text' })).filter(t => t.props.inverse).map(t => t.text.trim().split(':')[0])
  expect(await cards()).toEqual([])
  await ui.press({ key: 'settings' })
  expect(await cards()).toEqual(['Weather', 'Ponytail', 'Caveman', 'Megacave', 'Limits', 'Cost'])
  await ui.unmount()
})

test('Ponytail shows as the logo or the word, and the old on/off switch still reads', () => {
  expect([true, false, 'Text', ' off ', 'icon', 'bogus', undefined].map(ponyMode)).toEqual(['icon', 'off', 'text', 'off', 'icon', 'icon', 'icon'])
})

test('ponytail=text draws the word, not the logo', { options: { weather: 'off', ponytail: 'text' } }, async ($, on) => {
  memStore(on)
  on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true } } }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', () => ({ value: '{"defaultMode":"lite"}' }))
  on('session.start', (_$, e) => e)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await textOf(ui)).toBe('ponytail: lite')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('picking a Ponytail level runs /ponytail with it; on mobile a press steps to the next', { options: { weather: 'off', ponytail: 'icon' } }, async ($, on) => {
  memStore(on)
  on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true } } }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('fs.read', () => ({ value: '{"defaultMode":"ultra"}' }))
  on('session.start', (_$, e) => e)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const ran: string[] = []
  on('command.run', (_$, e) => {
    if (e.command === 'ponytail') throw new Error('unknown command') // the bare name refused
    return ran.push(`${e.command} ${e.args}`), { text: '' }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const desktop = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await desktop.select({ key: 'ponytail-level', value: 'ultra' }) // already: nothing runs
  await desktop.select({ key: 'ponytail-level', value: 'lite' })
  await desktop.unmount()
  const mobile = await $.ui.mount({ plugin: 'overalls', surface: 'mobile', component: 'AbovePrompt', props: PROPS })
  await mobile.press({ key: 'ponytail-level' })
  await mobile.unmount()
  expect(ran).toEqual(['ponytail:ponytail lite', 'ponytail:ponytail off'])
})

test('a submitted prompt changes the level as Ponytail reads it', () => {
  const cases = ['/ponytail lite', '/ponytail:ponytail ULTRA', '$ponytail off', '/ponytail', '/ponytail default lite', '/ponytail bogus', '/ponytail-review', 'Stop ponytail!', 'add a normal mode toggle', '/ponytail-help']
  expect(cases.map(levelAfter)).toEqual(['lite', 'ultra', 'off', undefined, undefined, 'default', 'review', 'off', undefined, undefined])
})

test("the level is this session's: its default at start, its own switches, its default again after compacting", { options: { weather: 'off', ponytail: 'text' } }, async ($, on) => {
  memStore(on)
  on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true } } }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : e.name === 'PONYTAIL_DEFAULT_MODE' ? 'lite' : undefined }))
  // The shared file says ultra (another session's switch): it is never read.
  on('fs.read', (_$, e) => (e.path.endsWith('.ponytail-active') ? { value: 'ultra\n' } : { deny: 'ENOENT' }))
  on('session.start', (_$, e) => e)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('session.compact', () => ({ messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }], tokensAfter: 1000 }))
  const submit = (text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  const shown = async () => {
    const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
    const t = await textOf(ui)
    await ui.unmount()
    return t
  }
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(await shown()).toBe('ponytail: lite')
  await submit('/ponytail full')
  expect(await shown()).toBe('ponytail: full')
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true }) // a reload keeps it
  expect(await shown()).toBe('ponytail: full')
  await submit('stop ponytail')
  expect(await shown()).toBe('ponytail: off')
  await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
  expect(await shown()).toBe('ponytail: lite')
})

test('Caveman modes read as its statusline reads them', () => {
  expect(['caveman', 'LITE', 'full', 'ultra', 'ultracave', 'wenyan-lite', 'megacave', 'commit', 'off', '', undefined, 'junk'].map(caveMode))
    .toEqual(['caveman', 'caveman', 'caveman', 'ultracave', 'ultracave', 'megacave', 'megacave', 'commit', 'off', 'off', 'off', 'off'])
})

test("Caveman shows this session's own mode and savings, and a pick runs its command", { options: { weather: 'off', ponytail: 'off', caveman: 'text', limits: 'off' } }, async ($, on) => {
  memStore(on)
  on('settings.read', () => ({ value: { enabledPlugins: { 'caveman@caveman': true } } }))
  on('config.list', () => ({ value: [] }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.id', () => ({ value: 'sess-1' }))
  const files: Record<string, string> = {
    '/home/u/.claude/.caveman-sessions/sess-1.mode': 'ultracave\n',
    '/home/u/.claude/.caveman-active': 'caveman', // another window's: not this one
    '/home/u/.claude/.caveman-statusline-suffix': '⛏ 12.4k\n',
  }
  on('fs.read', (_$, e) => { const value = files[e.path]; return value !== undefined ? { value } : { deny: 'ENOENT' } })
  on('session.start', (_$, e) => e)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  const ran: string[] = []
  on('command.run', (_$, e) => {
    if (!e.command.includes(':')) throw new Error('unknown command') // only the plugin-named one runs
    return ran.push(`${e.command} ${e.args}`.trim()), { text: '' }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await textOf(ui)).toBe('caveman: ultracave ⛏ 12.4k')
  const modes = async () => ((await ui.find({ key: 'caveman-mode' }))?.props.options as { value: string }[]).map(o => o.value)
  expect(await modes()).toEqual(['ultracave', 'caveman', 'off']) // megacave only when asked for
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'megacave-on' })
  expect(await modes()).toEqual(['megacave', 'ultracave', 'caveman', 'off'])
  await ui.select({ key: 'caveman-mode', value: 'off' })
  await ui.select({ key: 'caveman-mode', value: 'megacave' })
  await ui.unmount()
  expect(ran).toEqual(['caveman:caveman off', 'caveman:megacave'])
})

test('Caveman draws nothing where it is not installed', { options: { weather: 'off', ponytail: 'off', caveman: 'icon', limits: 'off' } }, async ($, on) => {
  memStore(on)
  on('settings.read', () => ({ value: { enabledPlugins: {} } }))
  on('session.start', (_$, e) => e)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ key: 'caveman-mode' })).toBeUndefined()
  await ui.unmount()
})

test('usage limits and session cost show as widgets when on', { options: { weather: 'off', ponytail: 'off', limits: 'on', cost: 'on' } }, async ($, on) => {
  memStore(on)
  const rateLimits = [{ kind: 'five_hour', percentUsed: 42 }, { kind: 'seven_day', percentUsed: 18.5 }]
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits, cost: { usd: 1.234 } } }))
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await textOf(ui)).toBe('5h 42% · 7d 19%$1.23')
  await ui.unmount()
})

test("a session Caveman hasn't started in shows off, not another window's mode", { options: { weather: 'off', ponytail: 'off', caveman: 'text', limits: 'off' } }, async ($, on) => {
  memStore(on)
  on('settings.read', () => ({ value: { enabledPlugins: { 'caveman@caveman': true } } }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.id', () => ({ value: 'sess-2' }))
  on('fs.read', (_$, e) => (e.path === '/home/u/.claude/.caveman-active' ? { value: 'ultracave' } : { deny: 'ENOENT' }))
  on('session.start', (_$, e) => e)
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await textOf(ui)).toBe('caveman: off')
  await ui.unmount()
})

test('the Config box offers Install for a plugin that is missing, as a request in the prompt box', { options: { weather: 'off', ponytail: 'off', limits: 'off' } }, async ($, on) => {
  memStore(on)
  on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true } } }))
  const filled: string[] = []
  on('prompt.fill', (_$, e) => (filled.push(e.text), { isFilled: true, text: e.text, cursor: e.text.length }))
  const ui = await $.ui.mount({ plugin: 'overalls', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ key: 'install-caveman' })).toBeUndefined() // closed box: nothing checked
  await ui.press({ key: 'settings' })
  expect(await ui.find({ key: 'install-ponytail' })).toBeUndefined()
  await ui.press({ key: 'install-caveman' })
  await ui.unmount()
  expect(filled).toEqual([
    'Install the caveman Claude Code plugin: run `claude plugin marketplace add JuliusBrussee/caveman` then `claude plugin install caveman@caveman`.',
  ])
})
