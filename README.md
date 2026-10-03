# overalls

A Claude Code mod that draws a status band above the prompt: a live "weather
forecast" of the context window, plus the level [Ponytail](https://github.com/DietrichGebert/ponytail)
is running at.

```
☂ Showers 67% · 134.4k / 200k · ▂▆ · ▲ +98.3k last turn · ponytail: full
```

Once the context passes 75% (and Claude isn't mid-turn), a **Compact** button
appears in the band.

## Install

Clone the repo and point Claude Code at it, either per session:

```bash
claude --plugin-dir ~/Projects/overalls
```

or for every session (including the desktop app), in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/Projects/overalls" } }
```

Saving a file in the folder reloads the mod in an interactive session.

## Settings

Both appear as rows in the Claude Code config menu under `overalls`; changing
one reloads the mod.

| Setting | Values | Default | What it does |
|---|---|---|---|
| Weather detail | `off` · `minimal` · `normal` · `full` | `full` | How much of the forecast to show |
| Show Ponytail level | on · off | on | Show whether Ponytail is installed and its level |

What each weather level shows:

| Level | Band |
|---|---|
| `minimal` | `☂ 67%` |
| `normal` | `☂ Showers 67% · 134.4k / 200k` |
| `full` | `normal` plus the last 12 turns as a sparkline and the change since last turn |
| `off` | nothing (the Ponytail segment still shows if enabled) |

## Ponytail detection

- **Installed:** an enabled `ponytail@…` entry in `enabledPlugins`. Otherwise the
  band shows `ponytail: not installed`.
- **Level:** read from `.ponytail-active` in your Claude config directory
  (`$CLAUDE_CONFIG_DIR`, or `~/.claude`). No file means `off`.
- **Refreshed** at session start, after each prompt (so `/ponytail lite` shows
  straight away) and at the end of each turn.

Ponytail keeps one level file for all sessions, so if two sessions run at
different levels, both bands show whichever was set most recently.

## Development

```bash
claude plugin validate .
claude plugin test .
```

`hooks/register.tsx` is the module; `types/index.d.ts` declares the state it
keeps. To add a setting, declare a field under `userConfig` in
`.claude-plugin/plugin.json` and read it from `options` in `register`.

## Licence

[MIT](LICENSE)
