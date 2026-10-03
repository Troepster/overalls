import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reading } from '../types'

const history = atom({ plugin: 'overalls', key: 'history' } as const, [] as Reading[])
const ponytail = atom({ plugin: 'overalls', key: 'ponytail' } as const, '')

const BARS = '▁▂▃▄▅▆▇█'
const DETAILS = ['off', 'minimal', 'normal', 'full'] as const
const COMPACT_AT = 75
const USAGE = 'weather off|minimal|normal|full · ponytail on|off'

// Ponytail writes its level to <claude dir>/.ponytail-active and deletes it when off.
// ponytail: one global file, so concurrent sessions show the last level set anywhere.
export const ponytailLabel = (installed: boolean, flag: string | undefined) =>
  !installed ? 'not installed' : flag?.trim() || 'off'

// Never throws: a failed check leaves the last label rather than breaking the hook it rides on.
const readPonytail = ($: EngineInterface) => checkPonytail($).catch(() => {})

async function checkPonytail($: EngineInterface) {
  const plugins = ((await $.settings.read()).enabledPlugins ?? {}) as Record<string, unknown>
  const installed = Object.entries(plugins).some(([k, v]) => k.startsWith('ponytail@') && v === true)
  const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
  const flag = installed ? await $.fs.read(`${dir}/.ponytail-active`).catch(() => undefined) : undefined
  await update($, ponytail, () => ponytailLabel(installed, typeof flag === 'string' ? flag : undefined))
}

export const weather = (percent: number) =>
  percent < 25 ? { icon: '☀', word: 'Clear' }
  : percent < 50 ? { icon: '☁', word: 'Cloudy' }
  : percent < 75 ? { icon: '☂', word: 'Showers' }
  : percent < 90 ? { icon: '☇', word: 'Storm' }
  : { icon: '↯', word: 'Compact soon' }

const hsl = (hue: number, l: number) => {
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    return l - l * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0), f(8), f(4)]
}

// WCAG relative luminance of an sRGB triple in 0..1.
export const luminance = (rgb: number[]) => {
  const [r = 0, g = 0, b = 0] = rgb.map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const contrast = (a: number[], b: number[]) => {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

export const hexToRgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)

// Green at empty to red at full, every step held at one luminance (0.2) so it keeps
// 3:1 against white, black and the usual dark greys alike: no theme detection needed.
const TARGET = 0.2
export const heat = (percent: number) => {
  const hue = 120 * (1 - Math.min(100, Math.max(0, percent)) / 100)
  let lo = 0
  let hi = 0.5
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (luminance(hsl(hue, mid)) < TARGET) lo = mid
    else hi = mid
  }
  return '#' + hsl(hue, lo).map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
}

export const fmt = (n: number) =>
  n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : `${n}`

const pct = (r: Reading) => (r.tokens / r.window) * 100

// Bars scale to the window, so a full bar means a full context, not the busiest turn.
export const bar = (r: Reading) => BARS[Math.min(7, Math.floor(pct(r) / 12.5))]

// The engine skips a plugin's own session.compact hook for a compaction that plugin
// started, so the button calls this too.
async function recordDrop($: EngineInterface, tokensAfter?: number) {
  await update($, history, prev => {
    const last = prev[prev.length - 1]
    return last && tokensAfter !== undefined
      ? [...prev, { tokens: tokensAfter, window: last.window }].slice(-12)
      : []
  })
}

type Prefs = { weather?: string; ponytail?: boolean }
type Options = Parameters<Register>[1]

// /overalls choices made where the mod has no /config row (the desktop app) live in its
// store and win over userConfig. A typed field, not a picker: the directory doesn't accept
// userConfig `options` yet.
async function prefs($: EngineInterface, options: Options) {
  const saved = ((await $.store.get('prefs')) ?? {}) as Prefs
  return {
    detail: DETAILS.find(d => d === String(saved.weather ?? options.weather).trim().toLowerCase()) ?? 'full',
    showPonytail: (saved.ponytail ?? options.ponytail) === true,
  }
}

async function refreshPonytail($: EngineInterface, options: Options) {
  if ((await prefs($, options)).showPonytail) await readPonytail($)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'overalls', description: 'Set the Overalls band', argumentHint: USAGE })
    await refreshPonytail($, options)
    return next(e)
  })

  on('command.run', { command: 'overalls' }, async ($, e) => {
    const [field = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const value =
      field === 'weather' && (DETAILS as readonly string[]).includes(arg) ? arg
      : field === 'ponytail' && (arg === 'on' || arg === 'off') ? arg === 'on'
      : undefined
    if (value === undefined) {
      const p = await prefs($, options)
      return { text: `Overalls weather: ${p.detail}, ponytail: ${p.showPonytail ? 'on' : 'off'}\nUsage: /overalls ${USAGE}` }
    }
    // Where the mod has a /config row (the terminal), set that and drop any stored choice;
    // the engine saves the row and reloads this module with it.
    const row = (await $.config.list()).find(
      r => r.provider.plugin.split('@')[0] === 'overalls' && (r.key === field || r.key.endsWith(`.${field}`)),
    )
    const saved = ((await $.store.get('prefs')) ?? {}) as Record<string, unknown>
    await $.store.set('prefs', row ? { ...saved, [field]: undefined } : { ...saved, [field]: value })
    if (row) {
      const r = await $.config.set({ key: row.key, value }).catch((err: unknown) => ({ deny: String(err) }))
      if (r.deny) return { text: `Couldn't set ${field}: ${r.deny}` }
    } else {
      await refreshPonytail($, options)
      $.ui.invalidate('ui.render')
    }
    return { text: `Overalls ${field}: ${value === true ? 'on' : value === false ? 'off' : value}` }
  })

  // `/ponytail lite` and "stop ponytail" take effect as the prompt goes in.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    await refreshPonytail($, options)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) return next(e) // main-loop turns only, not subagents
    const { context } = await $.session.usage()
    if (context.tokens !== undefined) {
      const reading = { tokens: context.tokens, window: context.window }
      await update($, history, prev => [...prev, reading].slice(-12))
    }
    await refreshPonytail($, options)
    return next(e)
  })

  // Any compaction records the drop at once rather than next turn.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (result.messages) await recordDrop($, result.tokensAfter)
    return result
  })

  // Don't name a local `h`: JSX compiles to the global h().
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { detail, showPonytail } = await prefs($, options)
    const readings = detail === 'off' ? [] : await read($, history)
    const pony = showPonytail ? await read($, ponytail) : ''
    if (e.props.hasSurvey || (readings.length === 0 && !pony)) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const ponySegment = pony && <Text dimColor>{readings.length ? ' · ' : ''}ponytail: {pony}</Text>
    // Starts the command in the prompt box rather than guessing which setting is wanted.
    const settings = (
      <Button key="settings" label="⚙" plain dimColor onPress={() => void $.prompt.fill({ text: '/overalls ' })} />
    )
    const now = readings.at(-1)
    if (!now) return <Box flexDirection="row">{ponySegment}<Text> </Text>{settings}</Box>

    const percent = Math.round(pct(now))
    const w = weather(percent)
    const delta = now.tokens - (readings.at(-2)?.tokens ?? 0)

    const compact = async () => {
      try {
        const r = await $.session.compact()
        if (r.skip !== undefined) $.ui.toast(`Compact skipped: ${r.skip}`)
        else await recordDrop($, r.tokensAfter)
      } catch (err) {
        $.ui.toast(`Couldn't compact: ${err instanceof Error ? err.message : err}`)
      }
    }

    return (
      <Box flexDirection="row">
        <Text color={heat(percent)}>{w.icon}</Text>
        {...(detail === 'minimal'
          ? [<Text> {percent}%</Text>]
          : [<Text bold> {w.word}</Text>, <Text> {percent}% · {fmt(now.tokens)} / {fmt(now.window)}</Text>])}
        {...(detail === 'full'
          ? [
              <Text> · </Text>,
              ...readings.map(r => <Text color={heat(pct(r))}>{bar(r)}</Text>),
              <Text dimColor> · {delta >= 0 ? '▲ +' : '▼ -'}{fmt(Math.abs(delta))} last turn</Text>,
            ]
          : [])}
        {ponySegment}
        <Text> </Text>
        {settings}
        {percent >= COMPACT_AT && !e.props.isWorking && (
          <Button key="compact" label="Compact" variant="primary" onPress={compact} />
        )}
      </Box>
    )
  })
}
