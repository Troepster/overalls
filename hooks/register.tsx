import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Denial, McpTrouble, Reading } from '../types'
import { PONYTAIL_PNG } from './ponytail-icon'

const history = atom({ plugin: 'overalls', key: 'history' } as const, [] as Reading[])
const ponytail = atom({ plugin: 'overalls', key: 'ponytail' } as const, '')
const level = atom({ plugin: 'overalls', key: 'level' } as const, '')
const caveman = atom({ plugin: 'overalls', key: 'caveman' } as const, '')
const mcpDown = atom({ plugin: 'overalls', key: 'mcpDown' } as const, {} as Record<string, McpTrouble>)
// Which box is open above the band, if any: ⚙'s Config box or the MCP errors box. One at a time.
const panel = atom({ plugin: 'overalls', key: 'panel' } as const, '' as '' | 'config' | 'mcp' | 'agents' | 'denials')
const denials = atom({ plugin: 'overalls', key: 'denials' } as const, [] as Denial[])

const BARS = '▁▂▃▄▅▆▇█'
const DETAILS = ['off', 'minimal', 'normal', 'full'] as const
const PONY = ['off', 'icon', 'text'] as const
const ONOFF = ['on', 'off'] as const
// Every setting and what it takes, in /overalls, the Config box and userConfig alike.
const FIELDS = { weather: DETAILS, ponytail: PONY, caveman: PONY, megacave: ONOFF, limits: ONOFF, resets: ONOFF, cost: ONOFF, mcp: ONOFF, agents: ONOFF, turns: ONOFF, denials: ONOFF } as const
type Field = keyof typeof FIELDS
const COMPACT_AT = 75
// The Config box's hover cards, keyed by the hover scope that reveals them. The band has none:
// a card can't leave the band, so there it covers the forecast it would explain.
const TIPS = {
  'cfg-weather': 'Weather: a forecast of how full the context window is',
  'cfg-ponytail': 'Ponytail: the level the Ponytail plugin is running at',
  'cfg-caveman': 'Caveman: the mode the Caveman plugin is running in',
  'cfg-megacave': 'Megacave: offer Caveman\'s Classical Chinese mode in its dropdown',
  'cfg-limits': 'Limits: how much of your 5-hour and weekly usage is spent, and when each resets',
  'cfg-resets': 'Resets: how long until each limit resets',
  'cfg-agents': 'Agents: how many subagents are running; press it to see them',
  'cfg-turns': 'Turns: about how many more turns fit, at the pace of the last few',
  'cfg-denials': 'Denials: tool calls that were refused (by you, a hook or a permission rule); press it to see them',
  'cfg-cost': 'Cost: what this session has cost so far',
  'cfg-mcp': 'MCP: a warning when an MCP server or connector fails or needs signing in again',
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
// session's is read straight from there. (It no longer reports a savings figure: 3.1.0 empties
// .caveman-statusline-suffix as "not measurements".)
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
  if (!(await isInstalled($, 'caveman'))) return update($, caveman, () => '')
  const dir = await claudeDir($)
  const id = await $.session.id()
  const own = /^[A-Za-z0-9_-]{1,128}$/.test(id) ? `${dir}/.caveman-sessions/${id}.mode` : `${dir}/.caveman-active`
  const raw = await $.fs.read(own).catch(() => undefined)
  await update($, caveman, () => caveMode(raw))
}

// Caveman's modes are commands of their own; off is `/caveman off`.
async function switchCaveman($: EngineInterface, mode: string) {
  if (await (mode === 'off' ? runAsTyped($, 'caveman', 'caveman', 'off') : runAsTyped($, 'caveman', mode))) {
    await readCaveman($)
  }
}

// No API lists MCP servers or their state, so the band learns of trouble from Claude's own tool
// calls: an `mcp__<server>__*` call that fails to sign in or connect, or the servers a ToolSearch
// reports as failed. A server's next successful call clears it.
export const mcpServer = (tool: string) => (tool.startsWith('mcp__') ? tool.split('__')[1] ?? '' : '')
export const mcpTrouble = (text: string) =>
  /unauthori[sz]ed|\b40[13]\b|auth(entication|orization)? (required|failed|expired)|sign(ed)? ?in|log(ged)? ?in|re-?auth|oauth|token (has )?(expired|invalid|revoked)|invalid[_ ]token/i.test(text) ? 'sign in'
  : /not connected|disconnected|failed to connect|connection (closed|refused|reset|lost)|econn|etimedout|timed out|server (is )?unavailable|no such server|not found: server/i.test(text) ? 'failed'
  : ''
// A claude.ai connector is named claude_ai_<Name>, or by its id; it's signed in from claude.ai.
export const isConnector = (server: string) => /^claude_ai_/.test(server) || /^[0-9a-f]{8}-/.test(server)
// Customize › Connectors, as Claude's support article links it (support.claude.com/en/articles/11176164);
// the old /settings/connectors only says they moved.
export const CONNECTORS_URL = 'https://claude.ai/customize/connectors'
// The desktop app (CLAUDE_CODE_ENTRYPOINT=claude-desktop) opens the same page in itself from its
// claude:// scheme (claude://claude.ai/<path>), which a Link can't carry (https only), so there it
// goes to the system's opener; the CLI and the web get the https link, the web's own site.
const CONNECTORS_APP_URL = 'claude://claude.ai/customize/connectors'
const OPENERS = [['open'], ['xdg-open'], ['cmd', '/c', 'start', '']] // macOS, Linux, Windows
async function openConnectors($: EngineInterface) {
  for (const opener of OPENERS) {
    const r = await $.process.run([...opener, CONNECTORS_APP_URL]).catch(() => undefined)
    if (r?.exitCode === 0) return
  }
  $.ui.toast(`Sign the connector back in at ${CONNECTORS_URL}`)
}

// claude_ai_Gmail → Gmail, plugin_productivity_atlassian → atlassian; a connector id is cut short.
export const mcpLabel = (server: string) => {
  const name = server.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '').replace(/_/g, ' ')
  return /^[0-9a-f]{8}-/.test(name) ? `connector ${name.slice(0, 8)}` : name
}

// Any other server signs in through /mcp's menu, which the terminal has; the desktop app's /mcp
// only prints a count. The entry stays until the server answers or is dismissed.
async function reconnectMcp($: EngineInterface, surface: string, server: string) {
  if (surface !== 'terminal') {
    $.ui.toast(`Sign ${mcpLabel(server)} in with /mcp in a terminal session (claude): the desktop app's /mcp only lists servers`)
    return
  }
  const ran = await $.command.run({ command: 'mcp' }).then(() => true, () => false)
  if (!ran) $.ui.toast(`Reconnect ${mcpLabel(server)} with /mcp`)
}

const dismissMcp = ($: EngineInterface, server?: string) =>
  update($, mcpDown, prev => {
    if (server === undefined) return {}
    const { [server]: _, ...rest } = prev
    return rest
  })

// The error as Claude saw it, on one line and cut short.
const detailOf = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 100)

// How long until a limit resets, at the two largest units: 1h20m, 3d4h, 12m; now or past, 0m.
export const untilReset = (resetsAt: string, now: number) => {
  const m = Math.max(0, Math.round((Date.parse(resetsAt) - now) / 60000))
  const [d, h, min] = [Math.floor(m / 1440), Math.floor((m % 1440) / 60), m % 60]
  return d ? `${d}d${h ? `${h}h` : ''}` : h ? `${h}h${min ? `${min}m` : ''}` : `${min}m`
}

// About how many more turns fit: the space left over the average growth of the last 5 turns that
// grew (a compaction's drop isn't a turn's growth). Undefined until 3 readings, or with no growth.
export const turnsLeft = (readings: Reading[]) => {
  const growth = readings.slice(1).map((r, i) => r.tokens - readings[i]!.tokens).filter(d => d > 0).slice(-5)
  const now = readings.at(-1)
  if (readings.length < 3 || !growth.length || !now) return undefined
  return Math.max(0, Math.floor((now.window - now.tokens) / (growth.reduce((a, b) => a + b, 0) / growth.length)))
}

// A tool call refused rather than failed: denied by a hook (`deny`), declined by the person, or
// refused by a permission rule or the auto-mode classifier. Its own error (a command that failed)
// is not a denial.
export const deniedBy = (text: string) =>
  /permission for this action was denied|doesn't want to proceed|user (has )?(rejected|denied|declined)|was (denied|blocked) by|blocked by (a |the )?hook|not allowed by (your )?(permission|settings)|permission (rule|settings) (deny|denied)/i.test(text)

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

// The same bars as an Svg: 4 px wide, 1 px apart, rising from the bottom of a 14 px line, at least
// 1 px tall so an empty turn still shows.
export const sparkSvg = (readings: Reading[]) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${readings.length * 5} 14">` +
  readings
    .map((r, i) => {
      const h = Math.max(1, Math.round((Math.min(100, pct(r)) / 100) * 14))
      return `<rect x="${i * 5}" y="${14 - h}" width="4" height="${h}" rx="0.5" fill="${heat(pct(r))}"/>`
    })
    .join('') +
  '</svg>'

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
    resets: pick('resets') !== 'off',
    agents: pick('agents') !== 'off',
    turns: pick('turns') !== 'off',
    denials: pick('denials') !== 'off',
    cost: pick('cost') === 'on',
    mcp: pick('mcp') !== 'off',
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
    // Redraw every 30 s, so reset countdowns and the agent count move while nothing else happens.
    // A reload drops this environment's timers, so there is only ever the one.
    try {
      $.clock.every(30_000, () => $.ui.invalidate('ui.render'))
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'overalls' }, async ($, e) => {
    const [field = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)
    const value = field in FIELDS && (FIELDS[field as Field] as readonly string[]).includes(arg) ? arg : undefined
    if (value === undefined) {
      const p = await prefs($, options)
      const now = `weather: ${p.detail}, ponytail: ${p.pony}, caveman: ${p.cave}, megacave: ${p.megacave ? 'on' : 'off'}, limits: ${p.limits ? 'on' : 'off'}, resets: ${p.resets ? 'on' : 'off'}, agents: ${p.agents ? 'on' : 'off'}, turns: ${p.turns ? 'on' : 'off'}, denials: ${p.denials ? 'on' : 'off'}, cost: ${p.cost ? 'on' : 'off'}, mcp: ${p.mcp ? 'on' : 'off'}`
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

  // Observed only: the result goes on as it came.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const server = mcpServer(e.tool)
    if (server) {
      const text = result.isError ? result.text ?? String(result.result ?? '') : ''
      const why = mcpTrouble(text)
      if (why) await update($, mcpDown, prev => ({ ...prev, [server]: { why, detail: detailOf(text) } }))
      else if (!result.isError && !('deny' in result && result.deny)) {
        await update($, mcpDown, prev => {
          const { [server]: _, ...rest } = prev
          return server in prev ? rest : prev
        })
      }
    }
    const refusal = 'deny' in result && result.deny ? result.deny : result.isError && deniedBy(result.text ?? '') ? (result.text ?? '') : ''
    if (refusal) await update($, denials, prev => [...prev, { tool: e.tool, reason: detailOf(refusal) }].slice(-20))
    if (e.tool === 'ToolSearch' && !result.isError && result.result) {
      const failed = (result.result as { failed_mcp_servers?: { name: string; error?: string }[] }).failed_mcp_servers ?? []
      if (failed.length) {
        await update($, mcpDown, prev => ({
          ...prev,
          ...Object.fromEntries(
            failed.map(f => [f.name, { why: mcpTrouble(f.error ?? '') || 'failed', detail: detailOf(f.error ?? '') }]),
          ),
        }))
      }
    }
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
    const { detail, pony: ponyAs, cave: caveAs, megacave, limits, resets, cost, mcp, agents, turns, denials: showDenials } = await prefs($, options)
    const refused = showDenials ? await read($, denials) : []
    const down = mcp ? Object.entries(await read($, mcpDown)) : []
    const readings = detail === 'off' ? [] : await read($, history)
    const pony = ponyAs !== 'off' ? await read($, ponytail) : ''
    const cave = caveAs !== 'off' ? await read($, caveman) : ''
    const usage = limits || cost ? await $.session.usage().catch(() => undefined) : undefined
    // With nothing else to show, ⚙ still draws alone, so both turned off can be turned on again.
    if (e.props.hasSurvey) return next(e)
    const els = $.ui.resolve(e)
    const { Box, Button, Link, Text } = els
    // Widgets never shrink (the desktop app would wrap the text inside one); they wrap whole onto
    // further rows of their own box, which takes the free width, so Compact and ⚙ hold the right
    // end of the first row.
    type El = ReturnType<typeof Box>
    const widget = (...children: El[]) => <Box flexDirection="row" flexShrink={0}>{...children}</Box>
    const band = (widgets: El[], ...end: El[]) =>
      withPanel(
        <Box flexDirection="row" width="100%" alignItems="flex-start" gap={2}>
          <Box flexDirection="row" flexWrap="wrap" flexGrow={1} flexShrink={1} columnGap={2} rowGap={1}>
            {...widgets}
          </Box>
          {...end}
          {settings}
        </Box>,
      )
    // The Ponytail logo stands for the word: an Svg on the remote surfaces, an Image on the
    // terminal, which draws the word dim in its place where it can't show pictures.
    // A cell between a plugin's icon (or word) and its level.
    const iconGap = <Box flexDirection="row" width={1} flexShrink={0} />
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
    const caveSegment = cave
      ? [
          widget(
            caveAs === 'text' ? <Text dimColor>caveman:</Text> : <Text>🪨</Text>,
            iconGap,
            // Megacave answers in Classical Chinese, so it's offered only when asked for.
            picker('caveman-mode', cave, megacave ? CAVE_MODES : CAVE_MODES.filter(m => m !== 'megacave'), v => switchCaveman($, v)),
          ),
        ]
      : []
    const LIMIT = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' } as Record<string, string>
    const nowMs = await $.clock.now().catch(() => Date.now())
    // Subagents still running, the model's and plugins' alike; pressing the count lists them.
    const running = agents ? (await $.agent.list().catch(() => [])).filter(a => a.status === 'running') : []
    const agentSegment = running.length
      ? [
          widget(
            <Text dimColor>⧗ </Text>,
            <Button
              key="agents"
              label={`${running.length} agent${running.length === 1 ? '' : 's'}`}
              plain
              hover={{ scope: 'agents', underline: true }}
              onPress={() => void update($, panel, p => (p === 'agents' ? '' : 'agents'))}
            />,
          ),
        ]
      : []
    const usageSegments = [
      ...(limits && usage?.rateLimits.length
        ? [
            widget(
              ...usage.rateLimits.flatMap((r, i) => [
                ...(i ? [<Text dimColor> · </Text>] : []),
                <Text dimColor>{LIMIT[r.kind] ?? r.kind} </Text>,
                <Text color={heat(r.percentUsed)}>{Math.round(r.percentUsed)}%</Text>,
                ...(resets && r.resetsAt ? [<Text dimColor> ↻{untilReset(r.resetsAt, nowMs)}</Text>] : []),
              ]),
            ),
          ]
        : []),
      ...(cost && usage?.cost ? [widget(<Text dimColor>${usage.cost.usd.toFixed(2)}</Text>)] : []),
    ]
    // Only while something is down: a count that opens the MCP errors box.
    const mcpSegment = down.length
      ? [
          widget(
            <Text color={heat(100)}>⚠ </Text>,
            <Button
              key="mcp"
              label={`${down.length} MCP error${down.length === 1 ? '' : 's'}`}
              plain
              hover={{ scope: 'mcp', underline: true }}
              onPress={() => void update($, panel, p => (p === 'mcp' ? '' : 'mcp'))}
            />,
          ),
        ]
      : []
    // Refused tool calls, until dismissed: a count that opens the Tool denials box.
    const denialSegment = refused.length
      ? [
          widget(
            <Text color={heat(100)}>⛔ </Text>,
            <Button
              key="denials"
              label={`${refused.length} denied`}
              plain
              hover={{ scope: 'denials', underline: true }}
              onPress={() => void update($, panel, p => (p === 'denials' ? '' : 'denials'))}
            />,
          ),
        ]
      : []
    const ponySegment = [...mcpSegment, ...denialSegment, ...agentSegment, ...usageSegments, ...(pony ? [widget(ponyIcon, iconGap, level)] : []), ...caveSegment]
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
    // Settings sit in two bordered columns (the band's slot is capped at half the window's height).
    const setting = (field: Field, name: string, choices: (ReturnType<typeof Button> | ReturnType<typeof Text>)[]) => (
      <Box flexDirection="row">
        <Box flexDirection="row" width={10}>
          <Text hover={{ scope: `cfg-${field}`, underline: true }}>{name}</Text>
        </Box>
        {...choices.flatMap(c => [c, <Text>  </Text>])}
      </Box>
    )
    const shown = await read($, panel)
    const open = shown === 'config'
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
        <Button key="settings" label="⚙" variant="primary" onPress={() => void update($, panel, p => (p === 'config' ? '' : 'config'))} />
      ) : (
        <Button key="settings" label="⚙" plain dimColor onPress={() => void update($, panel, p => (p === 'config' ? '' : 'config'))} />
      )
    )
    const inApp = shown === 'mcp' && (await $.env.get('CLAUDE_CODE_ENTRYPOINT').catch(() => undefined)) === 'claude-desktop'
    // One row per failing server: its name, why, the error as Claude saw it, and what to do.
    const mcpBox = (
      <Box flexDirection="column" borderStyle="round" borderColor={heat(100)} paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text bold>MCP errors</Text>
          <Box flexDirection="row" flexGrow={1} />
          <Button key="mcp-dismiss-all" label="Dismiss all" plain dimColor onPress={() => void dismissMcp($)} />
        </Box>
        <Text> </Text>
        {...down.map(([server, t]) => (
          <Box flexDirection="row" gap={2}>
            <Box flexDirection="row" width={14}>
              <Text>{mcpLabel(server)}</Text>
            </Box>
            <Text color={heat(100)}>{t.why}</Text>
            <Box flexDirection="row" flexGrow={1} flexShrink={1}>
              <Text dimColor>{t.detail}</Text>
            </Box>
            {isConnector(server) && inApp ? (
              <Button key={`mcp-reconnect-${server}`} label="Reconnect" plain onPress={() => void openConnectors($)} />
            ) : isConnector(server) ? (
              <Link href={CONNECTORS_URL} label="Reconnect" />
            ) : (
              <Button key={`mcp-reconnect-${server}`} label="Reconnect" plain onPress={() => void reconnectMcp($, e.surface ?? '', server)} />
            )}
            <Button key={`mcp-dismiss-${server}`} label="Dismiss" plain dimColor onPress={() => void dismissMcp($, server)} />
          </Box>
        ))}
      </Box>
    )
    const agentsBox = (
      <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
        <Text bold>Agents running</Text>
        <Text> </Text>
        {...running.map(a => (
          <Box flexDirection="row" gap={2}>
            <Box flexDirection="row" width={18}>
              <Text dimColor>{a.type}</Text>
            </Box>
            <Text>{a.description.replace(/\s+/g, ' ').slice(0, 80)}</Text>
          </Box>
        ))}
      </Box>
    )
    // One row per refused call, newest last: the tool and why, with Dismiss.
    const denialsBox = (
      <Box flexDirection="column" borderStyle="round" borderColor={heat(100)} paddingX={1} marginBottom={1}>
        <Box flexDirection="row">
          <Text bold>Tool denials</Text>
          <Box flexDirection="row" flexGrow={1} />
          <Button key="denials-dismiss-all" label="Dismiss all" plain dimColor onPress={() => void update($, denials, () => [])} />
        </Box>
        <Text> </Text>
        {...refused.map((d, i) => (
          <Box flexDirection="row" gap={2}>
            <Box flexDirection="row" width={18}>
              <Text>{d.tool.startsWith('mcp__') ? `${mcpLabel(mcpServer(d.tool))} ${d.tool.split('__')[2] ?? ''}` : d.tool}</Text>
            </Box>
            <Box flexDirection="row" flexGrow={1} flexShrink={1}>
              <Text dimColor>{d.reason}</Text>
            </Box>
            <Button key={`denials-dismiss-${i}`} label="Dismiss" plain dimColor onPress={() => void update($, denials, prev => prev.filter((_, j) => j !== i))} />
          </Box>
        ))}
      </Box>
    )
    const withPanel = (band: ReturnType<typeof Box>) =>
      shown === 'denials' && refused.length ? (
        <Box flexDirection="column" width="100%">
          {denialsBox}
          {band}
        </Box>
      ) : shown === 'agents' && running.length ? (
        <Box flexDirection="column" width="100%">
          {agentsBox}
          {band}
        </Box>
      ) : shown === 'mcp' && down.length ? (
        <Box flexDirection="column" width="100%">
          {mcpBox}
          {band}
        </Box>
      ) : !open ? band : (
        <Box flexDirection="column" width="100%">
          <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
            <Text bold>Config</Text>
            <Box flexDirection="row">
              <Text> </Text>
              {...(Object.keys(TIPS) as (keyof typeof TIPS)[]).map(tip)}
            </Box>
            <Box flexDirection="row" gap={1}>
              <Box flexDirection="column" width="50%" borderStyle="round" borderDimColor paddingX={1}>
                {setting('weather', 'Weather', DETAILS.map(d => choice('weather', d, d === detail)))}
                {setting('turns', 'Turns', ONOFF.map(m => choice('turns', m, (m === 'on') === turns)))}
                {setting('caveman', 'Caveman', [
                  ...PONY.map(m => choice('caveman', m, m === caveAs)),
                  // Megacave belongs to Caveman, so its switch shares the row, past a divider.
                  <Text dimColor>│</Text>,
                  <Text hover={{ scope: 'cfg-megacave', underline: true }}>megacave</Text>,
                  ...ONOFF.map(m => choice('megacave', m, (m === 'on') === megacave)),
                  ...installCaveman,
                ])}
                {setting('limits', 'Limits', [
                  ...ONOFF.map(m => choice('limits', m, (m === 'on') === limits)),
                  // Resets belong to the limits, so their switch shares the row, past a divider.
                  <Text dimColor>│</Text>,
                  <Text hover={{ scope: 'cfg-resets', underline: true }}>resets</Text>,
                  ...ONOFF.map(m => choice('resets', m, (m === 'on') === resets)),
                ])}
                {setting('agents', 'Agents', ONOFF.map(m => choice('agents', m, (m === 'on') === agents)))}
              </Box>
              <Box flexDirection="column" width="50%" borderStyle="round" borderDimColor paddingX={1}>
                {setting('ponytail', 'Ponytail', [...PONY.map(m => choice('ponytail', m, m === ponyAs)), ...installPonytail])}
                {setting('cost', 'Cost', ONOFF.map(m => choice('cost', m, (m === 'on') === cost)))}
                {setting('mcp', 'MCP', ONOFF.map(m => choice('mcp', m, (m === 'on') === mcp)))}
                {setting('denials', 'Denials', ONOFF.map(m => choice('denials', m, (m === 'on') === showDenials)))}
              </Box>
            </Box>
          </Box>
          {band}
        </Box>
      )
    const now = readings.at(-1)
    if (!now) return band(ponySegment)

    const percent = Math.round(pct(now))
    const w = weather(percent)
    const delta = now.tokens - (readings.at(-2)?.tokens ?? 0)
    const left = turnsLeft(readings)

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

    // Block characters sit on the font's baseline and widen in the desktop app's font, so the remote
    // surfaces get the bars as an Svg the height of a line; the terminal keeps the characters.
    const sparkline =
      e.surface !== 'terminal' && 'Svg' in els ? (
        <els.Svg alt={`Context over the last ${readings.length} turns`} width={readings.length * 5} height={14} source={sparkSvg(readings)} />
      ) : (
        <Text>{...readings.map(r => <Text color={heat(pct(r))}>{bar(r)}</Text>)}</Text>
      )
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
              widget(sparkline),
              widget(<Text dimColor>{delta >= 0 ? '▲ +' : '▼ -'}{fmt(Math.abs(delta))} last turn</Text>),
            ]
          : []),
        ...(turns && left !== undefined
          ? [widget(<Text color={left <= 3 ? heat(100) : undefined} dimColor={left > 3}>⌛ ~{left} turn{left === 1 ? '' : 's'}</Text>)]
          : []),
        ...ponySegment,
      ],
      ...(percent >= COMPACT_AT && !e.props.isWorking
        ? [<Button key="compact" label="Compact" variant="primary" onPress={compact} />]
        : []),
    )
  })
}
