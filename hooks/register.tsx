import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Reading } from '../types'
import { PONYTAIL_PNG } from './ponytail-icon'

const history = atom({ plugin: 'overalls', key: 'history' } as const, [] as Reading[])
const ponytail = atom({ plugin: 'overalls', key: 'ponytail' } as const, '')
const level = atom({ plugin: 'overalls', key: 'level' } as const, '')
const caveman = atom({ plugin: 'overalls', key: 'caveman' } as const, { mode: '', savings: '' })
const configOpen = atom({ plugin: 'overalls', key: 'configOpen' } as const, false)

const BARS = '▁▂▃▄▅▆▇█'
const DETAILS = ['off', 'minimal', 'normal', 'full'] as const
const PONY = ['off', 'icon', 'text'] as const
const ONOFF = ['on', 'off'] as const
// Every setting and what it takes, in /overalls, the Config box and userConfig alike.
const FIELDS = { weather: DETAILS, ponytail: PONY, caveman: PONY, megacave: ONOFF, limits: ONOFF, cost: ONOFF } as const
type Field = keyof typeof FIELDS
const COMPACT_AT = 75
// The Config box's hover cards, keyed by the hover scope that reveals them. The band has none:
// a card can't leave the band, so there it covers the forecast it would explain.
const TIPS = {
  'cfg-weather': 'Weather: a forecast of how full the context window is',
  'cfg-ponytail': 'Ponytail: the level the Ponytail plugin is running at',
  'cfg-caveman': 'Caveman: the mode the Caveman plugin is running in, and the tokens it has saved',
  'cfg-megacave': 'Megacave: offer Caveman\'s Classical Chinese mode in its dropdown',
  'cfg-limits': 'Limits: how much of your 5-hour and weekly usage is spent',
  'cfg-cost': 'Cost: what this session has cost so far',
} as const
const USAGE = Object.entries(FIELDS).map(([f, vs]) => `${f} ${vs.join('|')}`).join(' · ')

export const ponytailLabel = (installed: boolean, level: string | undefined) =>
  !installed ? 'not installed' : level?.trim() || 'off'

// Ponytail keeps one level file for every session (<claude dir>/.ponytail-active), so it can't say
// what this session runs at. The level is tracked here per session instead, by Ponytail's own
// rules (hooks/ponytail-activate.js, ponytail-mode-tracker.js, ponytail-config.js in 4.9.0): a
// session, and a compaction, start at its default; a submitted command changes it.
const MODES = ['off', 'lite', 'full', 'ultra']

// What a submitted prompt does to the session's level: a level, 'default', or undefined (none).
export const levelAfter = (text: string) => {
  const t = text.trim().toLowerCase()
  const [first = '', arg = ''] = t.split(/\s+/)
  const cmd = first.replace(/^[@$]/, '/')
  if (cmd === '/ponytail-review' || cmd === '/ponytail:ponytail-review') return 'review'
  if (cmd === '/ponytail' || cmd === '/ponytail:ponytail') {
    // A bare /ponytail only reports; `/ponytail default x` sets new sessions', not this one's.
    if (arg === '' || arg === 'default') return undefined
    return MODES.includes(arg) ? arg : 'default'
  }
  const bare = t.replace(/[.!?\s]+$/, '')
  return bare === 'stop ponytail' || bare === 'normal mode' ? 'off' : undefined
}

// PONYTAIL_DEFAULT_MODE, else defaultMode in its config.json, else full.
async function ponytailDefault($: EngineInterface) {
  const env = String((await $.env.get('PONYTAIL_DEFAULT_MODE')) ?? '').toLowerCase()
  if (MODES.includes(env)) return env
  const xdg = await $.env.get('XDG_CONFIG_HOME')
  const dir = xdg ? `${xdg}/ponytail` : `${await $.env.get('HOME')}/.config/ponytail`
  const raw = await $.fs.read(`${dir}/config.json`).catch(() => undefined)
  try {
    const mode = String(JSON.parse(String(raw)).defaultMode).toLowerCase()
    if (MODES.includes(mode)) return mode
  } catch {}
  return 'full'
}

async function isInstalled($: EngineInterface, plugin: string) {
  const plugins = ((await $.settings.read()).enabledPlugins ?? {}) as Record<string, unknown>
  return Object.entries(plugins).some(([k, v]) => k.startsWith(`${plugin}@`) && v === true)
}

const claudeDir = async ($: EngineInterface) =>
  (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`

// Never throws: a failed check leaves the last label rather than breaking the hook it rides on.
const readPonytail = ($: EngineInterface) => checkPonytail($).catch(() => {})

async function checkPonytail($: EngineInterface) {
  const installed = await isInstalled($, 'ponytail')
  let now = await read($, level)
  if (installed && !now) {
    now = await ponytailDefault($)
    await update($, level, () => now)
  }
  await update($, ponytail, () => ponytailLabel(installed, now))
}

// Ponytail and Caveman switch only on a submitted command: their prompt hooks tell Claude. So a
// pick runs it as if typed (a turn, as typing it is), under the plugin's name if the bare one is
// refused, else leaves it in the box to send. True when it ran.
async function runAsTyped($: EngineInterface, plugin: string, command: string, args = '') {
  for (const name of [command, `${plugin}:${command}`]) {
    if (await $.command.run({ command: name, args }).then(() => true, () => false)) return true
  }
  const text = `/${command}${args && ` ${args}`}`
  const r = await $.prompt.fill({ text })
  if (!r.isFilled) $.ui.toast(`Couldn't run it here: run ${text}`)
  return false
}

// Where each plugin installs from. A mod can't install one, so Install leaves a request in the
// prompt box for Claude to run (behind the usual permission prompts) once it's sent.
const SOURCES = { ponytail: 'DietrichGebert/ponytail', caveman: 'JuliusBrussee/caveman' } as const
async function askToInstall($: EngineInterface, plugin: keyof typeof SOURCES) {
  const text = `Install the ${plugin} Claude Code plugin: run \`claude plugin marketplace add ${SOURCES[plugin]}\` then \`claude plugin install ${plugin}@${plugin}\`.`
  const r = await $.prompt.fill({ text })
  if (!r.isFilled) $.ui.toast(`Couldn't fill the prompt: install ${plugin} from ${SOURCES[plugin]}`)
}

const LEVELS = ['ultra', 'full', 'lite', 'off'] // strongest first, as the dropdown lists them
async function switchPonytail($: EngineInterface, args: string) {
  if (!(await runAsTyped($, 'ponytail', 'ponytail', args))) return
  await update($, level, () => args)
  await readPonytail($)
}

// Caveman keeps each session's mode in <claude dir>/.caveman-sessions/<session id>.mode, so this
// session's is read straight from there, with its lifetime savings from .caveman-statusline-suffix.
// No file means Caveman isn't running here (a session started before it was installed): off. Its
// own statusline falls back to the last-write-wins .caveman-active, which shows another window's
// mode, so that is read only when there is no usable session id.
// Older level names read as Caveman reads them (src/hooks/caveman-statusline.sh, 3.1.0).
const CAVE_MODES = ['megacave', 'ultracave', 'caveman', 'off'] // strongest first
export const caveMode = (raw: unknown) => {
  const m = String(raw ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  return ['caveman', 'lite', 'full'].includes(m) ? 'caveman'
    : ['ultracave', 'ultra'].includes(m) ? 'ultracave'
    : m === 'megacave' || m.startsWith('wenyan') ? 'megacave'
    : ['commit', 'review', 'compress'].includes(m) ? m
    : 'off'
}

const readCaveman = ($: EngineInterface) => checkCaveman($).catch(() => {})

async function checkCaveman($: EngineInterface) {
  if (!(await isInstalled($, 'caveman'))) return update($, caveman, () => ({ mode: '', savings: '' }))
  const dir = await claudeDir($)
  const id = await $.session.id()
  const own = /^[A-Za-z0-9_-]{1,128}$/.test(id) ? `${dir}/.caveman-sessions/${id}.mode` : `${dir}/.caveman-active`
  const raw = await $.fs.read(own).catch(() => undefined)
  const savings = await $.fs.read(`${dir}/.caveman-statusline-suffix`).catch(() => '')
  await update($, caveman, () => ({ mode: caveMode(raw), savings: String(savings).trim() }))
}

// Caveman's modes are commands of their own; off is `/caveman off`.
async function switchCaveman($: EngineInterface, mode: string) {
  if (await (mode === 'off' ? runAsTyped($, 'caveman', 'caveman', 'off') : runAsTyped($, 'caveman', mode))) {
    await readCaveman($)
  }
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

type Prefs = Partial<Record<Field, string | boolean>>
type Options = Parameters<Register>[1]

// Ponytail was an on/off switch before it had a choice of icon or text: on (true) is the icon.
export const ponyMode = (v: unknown) =>
  v === true ? 'icon' : v === false ? 'off' : PONY.find(m => m === String(v).trim().toLowerCase()) ?? 'icon'

// /overalls choices made where the mod has no /config row (the desktop app) live in its
// store and win over userConfig. A typed field, not a picker: the directory doesn't accept
// userConfig `options` yet.
async function prefs($: EngineInterface, options: Options) {
  const saved = ((await $.store.get('prefs')) ?? {}) as Prefs
  const pick = (f: Field) => String(saved[f] ?? options[f]).trim().toLowerCase()
  return {
    detail: DETAILS.find(d => d === pick('weather')) ?? 'full',
    pony: ponyMode(saved.ponytail ?? options.ponytail),
    cave: ponyMode(saved.caveman ?? options.caveman),
    megacave: pick('megacave') === 'on',
    limits: pick('limits') !== 'off',
    cost: pick('cost') === 'on',
  }
}

async function refreshPonytail($: EngineInterface, options: Options) {
  const p = await prefs($, options)
  if (p.pony !== 'off') await readPonytail($)
  if (p.cave !== 'off') await readCaveman($)
}

// Where the mod has a /config row (the terminal), set that and drop any stored choice;
// the engine saves the row and reloads this module with it. Returns why it was refused, if it was.
async function setPref($: EngineInterface, options: Options, field: string, value: string) {
  const row = (await $.config.list()).find(
    r => r.provider.plugin.split('@')[0] === 'overalls' && (r.key === field || r.key.endsWith(`.${field}`)),
  )
  const saved = ((await $.store.get('prefs')) ?? {}) as Record<string, unknown>
  await $.store.set('prefs', row ? { ...saved, [field]: undefined } : { ...saved, [field]: value })
  if (row) {
    const r = await $.config.set({ key: row.key, value }).catch((err: unknown) => ({ deny: String(err) }))
    return r.deny
  }
  await refreshPonytail($, options)
  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'overalls', description: 'Set the Overalls band', argumentHint: USAGE })
    await refreshPonytail($, options)
    return next(e)
  })

  on('command.run', { command: 'overalls' }, async ($, e) => {
    const [field = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const value = field in FIELDS && (FIELDS[field as Field] as readonly string[]).includes(arg) ? arg : undefined
    if (value === undefined) {
      const p = await prefs($, options)
      const now = `weather: ${p.detail}, ponytail: ${p.pony}, caveman: ${p.cave}, megacave: ${p.megacave ? 'on' : 'off'}, limits: ${p.limits ? 'on' : 'off'}, cost: ${p.cost ? 'on' : 'off'}`
      return { text: `Overalls ${now}\nUsage: /overalls ${USAGE}` }
    }
    const deny = await setPref($, options, field, value)
    if (deny) return { text: `Couldn't set ${field}: ${deny}` }
    return { text: `Overalls ${field}: ${value}` }
  })

  // `/ponytail lite` and "stop ponytail" take effect as the prompt goes in.
  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    const to = levelAfter(e.text)
    if (to) await update($, level, () => to === 'default' ? '' : to) // '' reads the default afresh
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
    if (result.messages) {
      await recordDrop($, result.tokensAfter)
      // Ponytail activates afresh after a compaction, at its default.
      await update($, level, () => '')
      await refreshPonytail($, options)
    }
    return result
  })

  // Don't name a local `h`: JSX compiles to the global h().
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { detail, pony: ponyAs, cave: caveAs, megacave, limits, cost } = await prefs($, options)
    const readings = detail === 'off' ? [] : await read($, history)
    const pony = ponyAs !== 'off' ? await read($, ponytail) : ''
    const cave = caveAs !== 'off' ? await read($, caveman) : { mode: '', savings: '' }
    const usage = limits || cost ? await $.session.usage().catch(() => undefined) : undefined
    // With nothing else to show, ⚙ still draws alone, so both turned off can be turned on again.
    if (e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Button, Text } = els
    // Widgets sit a gap apart; the spacer after them takes the slack, so ⚙ (and Compact) keep
    // to the right.
    const widget = (...children: ReturnType<typeof Text>[]) => <Box flexDirection="row">{...children}</Box>
    const band = (widgets: ReturnType<typeof Box>[], ...end: ReturnType<typeof Box>[]) =>
      withPanel(
        <Box flexDirection="row" width="100%" gap={2}>
          {...widgets}
          <Box flexDirection="row" flexGrow={1} />
          {...end}
          {settings}
        </Box>,
      )
    // The Ponytail logo stands for the word: an Svg on the remote surfaces, an Image on the
    // terminal, which draws the word dim in its place where it can't show pictures.
    const ponyIcon =
      ponyAs === 'text' ? (
        <Text dimColor>ponytail:</Text>
      ) : e.surface === 'terminal' && 'Image' in els ? (
        <els.Image source={{ png: PONYTAIL_PNG }} columns={2} rows={1} alt="ponytail:" />
      ) : e.surface !== 'terminal' && 'Svg' in els ? (
        <els.Svg
          alt="Ponytail"
          width={14}
          height={16}
          source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 48"><image width="42" height="48" href="data:image/png;base64,${PONYTAIL_PNG}"/></svg>`}
        />
      ) : (
        <Text dimColor>ponytail:</Text>
      )
    // A plugin's level picks its own: a dropdown showing the current one where the surface draws
    // one; on mobile, which has none, a press steps to the next, strongest first and round.
    const Select = 'Select' in els && e.surface !== 'mobile' ? els.Select : undefined
    const picker = (key: string, current: string, levels: string[], pick: (v: string) => Promise<unknown>) =>
      Select ? (
        <Select
          key={key}
          value={current}
          options={(levels.includes(current) ? levels : [...levels, current]).map(value => ({ value }))}
          onSelect={v => void (v !== current && pick(v))}
        />
      ) : (
        <Button
          key={key}
          label={` ${current}`}
          plain
          dimColor
          hover={{ scope: key, underline: true }}
          onPress={() => void pick(levels[(levels.indexOf(current) + 1) % levels.length] ?? current)}
        />
      )
    const level =
      pony === 'not installed' ? (
        <Text dimColor> {pony}</Text>
      ) : (
        picker('ponytail-level', pony, LEVELS, v => switchPonytail($, v))
      )
    // Caveman's logo is its trademark, so a generic rock stands for it; nothing shows where it
    // isn't installed.
    const caveSegment = cave.mode
      ? [
          widget(
            caveAs === 'text' ? <Text dimColor>caveman:</Text> : <Text>🪨</Text>,
            // Megacave answers in Classical Chinese, so it's offered only when asked for.
            picker('caveman-mode', cave.mode, megacave ? CAVE_MODES : CAVE_MODES.filter(m => m !== 'megacave'), v => switchCaveman($, v)),
            ...(cave.savings ? [<Text dimColor> {cave.savings}</Text>] : []),
          ),
        ]
      : []
    const LIMIT = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' } as Record<string, string>
    const usageSegments = [
      ...(limits && usage?.rateLimits.length
        ? [
            widget(
              ...usage.rateLimits.flatMap((r, i) => [
                ...(i ? [<Text dimColor> · </Text>] : []),
                <Text dimColor>{LIMIT[r.kind] ?? r.kind} </Text>,
                <Text color={heat(r.percentUsed)}>{Math.round(r.percentUsed)}%</Text>,
              ]),
            ),
          ]
        : []),
      ...(cost && usage?.cost ? [widget(<Text dimColor>${usage.cost.usd.toFixed(2)}</Text>)] : []),
    ]
    const ponySegment = [...usageSegments, ...(pony ? [widget(ponyIcon, level)] : []), ...caveSegment]
    // No tooltip prop: each card is drawn hidden over the Config box's blank row, revealed by its
    // hover scope.
    const tip = (scope: keyof typeof TIPS) => (
      <Box position="absolute" top={0} left={0} display="none" hover={{ scope, display: 'flex' }} flexDirection="row">
        <Text inverse> {TIPS[scope]} </Text>
      </Box>
    )
    const set = async (field: string, value: string) => {
      const deny = await setPref($, options, field, value)
      if (deny) $.ui.toast(`Couldn't set ${field}: ${deny}`)
    }
    // ⚙ opens a Config box above the band with every choice, the current one ticked, so each
    // change shows in the band as it's made.
    const choice = (field: string, value: string, current: boolean) => (
      <Button key={`${field}-${value}`} label={`${value}${current ? ' ✓' : ''}`} plain dimColor={!current} onPress={() => void set(field, value)} />
    )
    const setting = (field: Field, name: string, choices: (ReturnType<typeof Button> | ReturnType<typeof Text>)[]) => (
      <Box flexDirection="row">
        <Box flexDirection="row" width={10}>
          <Text hover={{ scope: `cfg-${field}`, underline: true }}>{name}</Text>
        </Box>
        {...choices.flatMap(c => [c, <Text>  </Text>])}
      </Box>
    )
    const open = await read($, configOpen)
    // The Config box offers Install on a plugin's row where it isn't installed.
    const missing = async (plugin: keyof typeof SOURCES) => open && !(await isInstalled($, plugin).catch(() => true))
    const install = async (plugin: keyof typeof SOURCES) =>
      (await missing(plugin))
        ? [<Text dimColor>│</Text>, <Button key={`install-${plugin}`} label="Install" plain onPress={() => void askToInstall($, plugin)} />]
        : []
    const [installPonytail, installCaveman] = await Promise.all([install('ponytail'), install('caveman')])
    const settings = (
      // A Button takes no bold: while the row is open ⚙ is drawn as the primary button instead.
      open ? (
        <Button key="settings" label="⚙" variant="primary" onPress={() => void update($, configOpen, o => !o)} />
      ) : (
        <Button key="settings" label="⚙" plain dimColor onPress={() => void update($, configOpen, o => !o)} />
      )
    )
    const withPanel = (band: ReturnType<typeof Box>) =>
      !open ? band : (
        <Box flexDirection="column" width="100%">
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>Config</Text>
            <Box flexDirection="row">
              <Text> </Text>
              {...(Object.keys(TIPS) as (keyof typeof TIPS)[]).map(tip)}
            </Box>
            {setting('weather', 'Weather', DETAILS.map(d => choice('weather', d, d === detail)))}
            {setting('ponytail', 'Ponytail', [...PONY.map(m => choice('ponytail', m, m === ponyAs)), ...installPonytail])}
            {setting('caveman', 'Caveman', [
              ...PONY.map(m => choice('caveman', m, m === caveAs)),
              // Megacave belongs to Caveman, so its switch shares the row, past a divider.
              <Text dimColor>│</Text>,
              <Text hover={{ scope: 'cfg-megacave', underline: true }}>megacave</Text>,
              ...ONOFF.map(m => choice('megacave', m, (m === 'on') === megacave)),
              ...installCaveman,
            ])}
            {setting('limits', 'Limits', ONOFF.map(m => choice('limits', m, (m === 'on') === limits)))}
            {setting('cost', 'Cost', ONOFF.map(m => choice('cost', m, (m === 'on') === cost)))}
          </Box>
          {band}
        </Box>
      )
    const now = readings.at(-1)
    if (!now) return band(ponySegment)

    const percent = Math.round(pct(now))
    const w = weather(percent)
    const delta = now.tokens - (readings.at(-2)?.tokens ?? 0)

    // Pressing the forecast steps minimal → normal → full → minimal; off is the Config box's.
    const cycle = () => set('weather', DETAILS[(DETAILS.indexOf(detail) % 3) + 1] ?? 'full')

    const compact = async () => {
      try {
        const r = await $.session.compact()
        if (r.skip !== undefined) $.ui.toast(`Compact skipped: ${r.skip}`)
        else await recordDrop($, r.tokensAfter)
      } catch {
        // Headless sessions (the desktop app) can't compact from a plugin yet: run /compact as if
        // typed, else leave it in the box to send. session.compact above records the drop.
        await $.command.run({ command: 'compact' }).catch(async () => {
          const r = await $.prompt.fill({ text: '/compact' })
          if (!r.isFilled) $.ui.toast("Couldn't compact here: run /compact")
        })
      }
    }

    const forecast = (
      <Button key="detail" label={detail === 'minimal' ? `${percent}%` : w.word} plain hover={{ scope: 'forecast', underline: true }} onPress={cycle} />
    )
    return band(
      [
        widget(
          <Text color={heat(percent)}>{w.icon} </Text>,
          forecast,
          ...(detail === 'minimal' ? [] : [<Text> {percent}% · {fmt(now.tokens)} / {fmt(now.window)}</Text>]),
        ),
        ...(detail === 'full'
          ? [
              widget(...readings.map(r => <Text color={heat(pct(r))}>{bar(r)}</Text>)),
              widget(<Text dimColor>{delta >= 0 ? '▲ +' : '▼ -'}{fmt(Math.abs(delta))} last turn</Text>),
            ]
          : []),
        ...ponySegment,
      ],
      ...(percent >= COMPACT_AT && !e.props.isWorking
        ? [<Button key="compact" label="Compact" variant="primary" onPress={compact} />]
        : []),
    )
  })
}
