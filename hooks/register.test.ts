import { test, expect } from 'claude-code/testing'

import { bar, contrast, fmt, heat, hexToRgb, ponytailLabel, weather } from './register.tsx'

test('forecast helpers', () => {
  expect([0, 24, 25, 49, 50, 74, 75, 89, 90, 100].map(p => weather(p).word)).toEqual([
    'Clear', 'Clear', 'Cloudy', 'Cloudy', 'Showers', 'Showers', 'Storm', 'Storm', 'Compact soon', 'Compact soon',
  ])
  expect(`${fmt(134400)} / ${fmt(200000)}`).toBe('134.4k / 200k')
  expect(fmt(1000000)).toBe('1M')
  expect([0, 100000, 199999, 200000].map(tokens => bar({ tokens, window: 200000 })).join('')).toBe('▁▅██')
})

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 }

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
  console.log([0, 25, 50, 75, 100].map(p => `${p}%=${heat(p)}`).join(' '))
  console.log(Object.entries(worst).map(([bg, r]) => `${bg} ${r.toFixed(2)}:1`).join('  '))
  for (const r of Object.values(worst)) expect(r).toBeGreaterThanOrEqual(3)
  expect(heat(0)).toMatch(/^#00[0-9a-f]{2}00$/)
  expect(heat(100)).toMatch(/^#[0-9a-f]{2}0000$/)
})

test('band draws, offers Compact from 75%, and records the drop', async ($, on) => {
  let tokens = 0
  let compacted = 0
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  on('session.compact', () => (compacted++, { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }], tokensAfter: 20000 }))
  on('ui.render', () => ({ tree: null }))
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
  ['off', 'ponytail: ultra'],
] as const) {
  test(`weather=${detail} with ponytail installed`, { options: { weather: detail, ponytail: true } }, async ($, on) => {
    let tokens = 0
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200000 }, rateLimits: [] } }))
    on('turn.complete', () => ({ text: '' }))
    on('settings.read', () => ({ value: { enabledPlugins: { 'ponytail@ponytail': true } } }))
    on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
    on('fs.read', (_$, e) => (e.path === '/home/u/.claude/.ponytail-active' ? { value: 'ultra\n' } : { error: 'ENOENT' }))
    on('ui.render', () => ({ tree: null }))
    for (const n of [36100, 134400]) {
      tokens = n
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' })
    }
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'overalls', surface, component: 'AbovePrompt', props: PROPS })
      expect(await textOf(ui)).toBe(expected)
      await ui.unmount()
    }
  })
}

test('subagent turns leave the forecast alone', { options: { weather: 'full', ponytail: false } }, async ($, on) => {
  let tokens = 0
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200000 }, rateLimits: [] } }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ tree: null }))
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
    let tokens = 0
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 200000 }, rateLimits: [] } }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', () => ({ tree: null }))
    for (const n of [36100, 134400]) {
      tokens = n
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${n}`, reason: 'answer' })
    }
    const ui = await $.ui.mount({ plugin: 'overalls', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
    expect(await textOf(ui)).toBe(expected)
    await ui.unmount()
  })
}
