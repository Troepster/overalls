# overalls

A Claude Code mod that draws a status band above the prompt: a live "weather
forecast" of the context window, how much of your usage limits is spent, and the
level [Ponytail](https://github.com/DietrichGebert/ponytail) and
[Caveman](https://github.com/JuliusBrussee/caveman) are running at.

![The band in the desktop app: forecast, usage limits, session cost, and the Ponytail and Caveman dropdowns, with ⚙ at the right](assets/band.png)

Once the context passes 75% (and Claude isn't mid-turn), a **Compact** button
appears in the band.

## Install

In the Claude Code terminal:

```
/plugin marketplace add Troepster/overalls
/plugin install overalls@overalls
/reload-plugins
```

Or from any shell, which also covers the desktop app (new sessions pick it up):

```bash
claude plugin marketplace add Troepster/overalls
claude plugin install overalls@overalls
```

If the band doesn't appear, start a new session or restart Claude Code.

To update: `/plugin marketplace update overalls` in Claude Code, or from a
shell:

```bash
claude plugin marketplace update overalls
claude plugin update overalls@overalls
```

Ponytail and Caveman are optional. Without Caveman its widget doesn't show;
without Ponytail its widget reads `not installed` until you set it to `off`.
Either way, the **⚙** Config box offers to install them.

A mod runs inside Claude Code with the same access Claude Code has, so read
`hooks/register.tsx` before installing.

## Settings

Each appears as a row in the Claude Code config menu under `overalls`; changing
one reloads the mod. The `/overalls` command sets them from the prompt, which
also works in the desktop app, where `/config` isn't available:

```
/overalls weather minimal
/overalls ponytail off
/overalls            (shows the current values)
```

![The Config box open above the band, with every choice for each setting and the current one ticked](assets/config-box.png)

The **⚙** at the right of the band opens a **Config** box above it with every
choice for every setting, the current one ticked; pressing one sets it, so you
see the change in the band as you make it. Press **⚙** again to close it. Hover
over a setting's name in the Config box for a line on what it is.

Pressing the forecast itself (`Showers`, or `67%` at `minimal`) steps
the weather detail through `minimal` → `normal` → `full` and round again; `off`
is set in the Config box.

Where the mod has a `/config` row (the terminal), `/overalls` sets that row.
Where it has none (the desktop app), it keeps the choice in the mod's own store
instead, and that choice wins over the `/config` value in every session until
you set the same setting with `/overalls` in a session that has the row.

| Setting | Values | Default | What it does |
|---|---|---|---|
| Weather detail | `off` · `minimal` · `normal` · `full` (typed; anything else counts as `full`) | `full` | How much of the forecast to show |
| Ponytail level | `off` · `icon` · `text` (typed; anything else counts as `icon`, and an old on/off value as `icon`/`off`) | `icon` | Show whether Ponytail is installed and its level, after its logo or the word `ponytail:` |
| Caveman mode | `off` · `icon` · `text` (typed; anything else counts as `icon`) | `icon` | Show Caveman's mode and lifetime savings where it's installed, after 🪨 or the word `caveman:` |
| Offer megacave | `on` · `off` | `off` | List Caveman's Classical Chinese mode (`megacave`) in its dropdown; in the Config box it sits on Caveman's row |
| Usage limits | `on` · `off` | `on` | Show how much of your 5-hour and weekly limits is spent (subscriptions only) |
| Session cost | `on` · `off` | `off` | Show what this session has cost so far |

What each weather level shows:

| Level | Band |
|---|---|
| `minimal` | `☂ 67%` |
| `normal` | `☂ Showers 67% · 134.4k / 200k` |
| `full` | `normal` plus the last 12 turns as a sparkline and the change since last turn |
| `off` | nothing (the Ponytail segment still shows if enabled) |

## Ponytail detection

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/ponytail-logo-dark.png">
  <img src="assets/ponytail-logo.png" width="110" alt="Ponytail, the lazy senior dev">
</picture>

- **Installed:** an enabled `ponytail@…` entry in `enabledPlugins`. Otherwise the
  band shows `not installed` beside the logo.
- **Level:** this session's own. Ponytail keeps a single level file for every
  session, so it can't say what *this* session runs at; Overalls tracks it per
  session instead, by Ponytail's rules:
  - a new session, and a compaction (Ponytail activates afresh), start at
    Ponytail's default: `$PONYTAIL_DEFAULT_MODE`, else `defaultMode` in its
    `config.json` (`$XDG_CONFIG_HOME/ponytail/`, or `~/.config/ponytail/`), else
    `full`
  - `/ponytail <level>` (or `/ponytail:ponytail <level>`), `/ponytail-review`,
    `stop ponytail` and `normal mode` change it as they go in.
  Another session's switch doesn't change this band.
- **Switched** by picking a level from the dropdown the level is drawn as (on
  mobile, which has no dropdown, a press steps ultra → full → lite → off), through
  Ponytail's own `/ponytail <level>` command.

## Installing Ponytail or Caveman

Where either isn't installed, its row in the **⚙** Config box has an **Install**
button. A mod can't install plugins, so it types a request into the prompt box,
for example:

```
Install the caveman Claude Code plugin: run `claude plugin marketplace add JuliusBrussee/caveman` then `claude plugin install caveman@caveman`.
```

Send it and Claude runs the two commands, each behind the usual permission
prompt. A plugin's hooks start with the next session.

## Caveman

- **Installed:** an enabled `caveman@…` entry in `enabledPlugins`; otherwise
  nothing shows.
- **Mode:** this session's own. Caveman keeps each session's mode in
  `.caveman-sessions/<session id>.mode` in your Claude config directory, so the
  band reads that, with the lifetime savings Caveman writes to
  `.caveman-statusline-suffix`. A session with no file of its own (one started
  before Caveman was installed) shows `off`; the shared `.caveman-active`, which
  holds the last mode set in any window, is read only when there's no session id.
- **Switched** by picking a mode from its dropdown (ultracave, caveman, off, and
  megacave when **Offer megacave** is on, since it answers in Classical Chinese; on mobile a press steps through them), through Caveman's own
  `/megacave`, `/ultracave`, `/caveman` and `/caveman off` commands.

## Data and access

Overalls makes no network requests and sends nothing anywhere. Everything it
does stays inside your Claude Code session:

- reads the session's context-window usage (`$.session.usage()`) after each turn
- reads your Claude Code settings to see whether Ponytail is enabled
- reads the session's usage-limit percentages and cost (`$.session.usage()`)
  when those widgets are on
- reads your Claude Code settings to see whether Caveman is enabled and, if it
  is, this session's id and three of Caveman's files in your Claude config
  directory: `.caveman-sessions/<session id>.mode`, `.caveman-active` and
  `.caveman-statusline-suffix`
- reads Ponytail's `config.json`, for its default level, and the
  `PONYTAIL_DEFAULT_MODE`, `XDG_CONFIG_HOME`, `CLAUDE_CONFIG_DIR` and `HOME`
  environment variables
- reads each prompt you submit only to spot a Ponytail command (`/ponytail …`,
  `stop ponytail`, `normal mode`), keeping nothing of it but the level
- keeps the last 12 readings and the Ponytail level in session state, which is
  gone when the session ends
- switches Ponytail's level or Caveman's mode only when you pick one from the
  band: it runs `/ponytail <level>`, or Caveman's command for the mode, as if you
  had typed it (which Claude reads, as it
  would your typing), or types it into the prompt box if it can't run it
- types an install request into the prompt box only when you press **Install**
  in the Config box; nothing is installed unless you send it and approve
  Claude's commands
- compacts the conversation only when you press its **Compact** button; where
  Claude Code doesn't let a plugin compact (the desktop app), that press runs
  `/compact` for you, or types it into the prompt box if it can't run it
- changes its own settings only when you run `/overalls weather …` or
  `/overalls ponytail …` (and the rest), pick one in the **⚙** Config box, or press the
  forecast to step the weather detail: through the `/config` row where there is one (saved in
  your Claude Code settings, as `/config` saves them), otherwise in the mod's own
  store, a small JSON file Claude Code keeps for the plugin in your Claude config
  directory.

Apart from that store, it writes no files, and it runs no shell commands.

It hooks three events only to observe them, never changing what they carry:
`turn.complete` (take a reading), `session.compact` (record the drop after a
compaction, and reset the Ponytail level to its default) and `prompt.submit`
(note a Ponytail switch once your prompt has gone in, so `/ponytail lite` shows
straight away). It also draws the band above
the prompt.

## Development

Load your clone directly instead of the installed copy, so saves hot-reload:

```bash
claude --plugin-dir ~/Projects/overalls
```

or for every session (including the desktop app), in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/Projects/overalls" } }
```

Don't also have the marketplace copy installed, or you'll get two bands.

```bash
claude plugin validate .
claude plugin test .
```

`hooks/register.tsx` is the module; `types/index.d.ts` declares the state it
keeps. To add a setting, declare a field under `userConfig` in
`.claude-plugin/plugin.json` and read it from `options` in `register`.

## Licence

[MIT](LICENSE)

## Credits

[Ponytail](https://github.com/DietrichGebert/ponytail) and its logo are by
[Dietrich Gebert](https://github.com/DietrichGebert), used under the MIT licence
([`assets/PONYTAIL-LICENSE`](assets/PONYTAIL-LICENSE)). Overalls only reads the
level Ponytail writes; it isn't affiliated with or endorsed by the Ponytail project.

Caveman is by [Julius Brussee](https://github.com/JuliusBrussee); "Caveman" is
his trademark. Overalls only reads the mode Caveman writes and runs its
commands, uses none of its logos (🪨 is a stock emoji), and isn't affiliated
with or endorsed by the Caveman project.
