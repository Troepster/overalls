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

In Claude Code:

```
/plugin marketplace add Troepster/overalls
/plugin install overalls@overalls
/reload-plugins
```

If the band doesn't appear, restart Claude Code. Updates arrive with
`/plugin marketplace update overalls`.

A mod runs inside Claude Code with the same access Claude Code has, so read
`hooks/register.tsx` before installing — it's short.

## Settings

Both appear as rows in the Claude Code config menu under `overalls`; changing
one reloads the mod. The `/overalls` command sets them from the prompt, which
also works in the desktop app, where `/config` isn't available:

```
/overalls weather minimal
/overalls ponytail off
/overalls            (shows the current values)
```

The **⚙** button at the end of the band types `/overalls ` into the prompt box
for you.

Where the mod has a `/config` row (the terminal), `/overalls` sets that row.
Where it has none (the desktop app), it keeps the choice in the mod's own store
instead, and that choice wins over the `/config` value in every session until
you set the same setting with `/overalls` in a session that has the row.

| Setting | Values | Default | What it does |
|---|---|---|---|
| Weather detail | `off` · `minimal` · `normal` · `full` (typed; anything else counts as `full`) | `full` | How much of the forecast to show |
| Show Ponytail level | on · off | on | Show whether Ponytail is installed and its level |

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
  band shows `ponytail: not installed`.
- **Level:** read from `.ponytail-active` in your Claude config directory
  (`$CLAUDE_CONFIG_DIR`, or `~/.claude`). No file means `off`.
- **Refreshed** at session start, after each prompt (so `/ponytail lite` shows
  straight away) and at the end of each turn.

Ponytail keeps one level file for all sessions, so if two sessions run at
different levels, both bands show whichever was set most recently.

## Data and access

Overalls makes no network requests and sends nothing anywhere. Everything it
does stays inside your Claude Code session:

- reads the session's context-window usage (`$.session.usage()`) after each turn
- reads your Claude Code settings to see whether Ponytail is enabled
- reads one file, `.ponytail-active` in your Claude config directory, and the
  `HOME` and `CLAUDE_CONFIG_DIR` environment variables to find it
- keeps the last 12 readings in session state, which is gone when the session ends
- compacts the conversation only when you press its **Compact** button
- changes its own two settings only when you run `/overalls weather …` or
  `/overalls ponytail …`: through the `/config` row where there is one (saved in
  your Claude Code settings, as `/config` saves them), otherwise in the mod's own
  store, a small JSON file Claude Code keeps for the plugin in your Claude config
  directory
- types `/overalls ` into the prompt box only when you press its **⚙** button

Apart from that store, it writes no files, and it runs no shell commands.

It hooks three events only to observe them, never changing what they carry:
`turn.complete` (take a reading), `session.compact` (record the drop after a
compaction) and `prompt.submit` (re-read the Ponytail level once your prompt has
gone in, so `/ponytail lite` shows straight away). It also draws the band above
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
