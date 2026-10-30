# CLAUDE.md

## What this is

`herdr-q-saddle` is a set of **herdr-app mods**, published on herdr.dev/mods.

The mod API is documented in `~/.config/herdr-app/AGENTS.md`, `herdr.d.ts`, and `gpui-kit.d.ts`. Those files are rewritten on every herdr-app start; treat them as the source of truth.

## Layout

`mods/q-saddle-tab/` (layout launcher), `mods/q-saddle-agent/`, `mods/q-saddle-project/` (project picker), `mods/q-saddle-restart/` (reopens `q-saddle-tab` in restart mode), and `mods/q-saddle-ssh/` (SSH picker) are the mod folders that get copied into `~/.config/herdr-app/mods/`. The repo root also holds `README.md`, `config.example.json`, and `RECIPE.md`, `preview.png`, and `keys.json`, which herdr.dev requires for sharing (see "Layouts and mods other people made" in `AGENTS.md`).

## Scope

Personal paths and agents live in config, not code.

| Feature         | Key           | Notes                                                                                                           |
| --------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| Layout launcher | `cmd-t`       | Pick harness + model, open a tab from a `tab_layouts` entry, then apply each pane's `ratio` via `doc.set`.      |
| Project picker  | `cmd-o`       | Registry + `~/Projects` sweep; focus the existing space or `space.new`.                                         |
| Project review  | not built     | Scan and curate the project registry.                                                                           |
| SSH picker      | `cmd-shift-s` | Pick a target, open a tab running `ssh`. Not `hc machine`: that is for devices running hc, not plain SSH hosts. |
| Restart agent   | `cmd-r`       | In place, keeping side panes. Swap a replacement terminal into the pane (see spike findings).                   |

Out of v1: worktree launcher (built-in `worktree` mod covers it), personal assistant, dashboard, fork agent, even out panes.

## Spike findings (2026-10-30)

- `tab.new {argv}` + `pane.split {direction, pane, argv}` builds the agent + yazi + term layout. Pass the returned `pane` id; implicit split targets the focused pane.
- No command sets split ratios. Every tab's tree lives in the core doc `herdr-app` (`hc connect` → `doc.get` / `doc.set` with `version`); nodes carry `size: {weight}`. Writing weights works, but the format is undocumented, so keep it behind a config flag (`apply_ratios`, default on) and isolate it in one module.
- No env argument on `pane.split`; wrap with `["env", "K=V", cmd...]`.
- Defaults must avoid alt+letter keys: option+letters type characters on many Mac keyboards.
- Restart in place works by swapping terminals: `hc run --bg --no-parent --cwd <dir> <argv>` starts the replacement, `doc.set` rewrites the pane's `content.terminal` from old to new, then `hc kill <old>`. The pane id and neighbouring panes stay. `hc keep` does not help: it only covers core loss, and `hc kill` still closes the pane.
- `hc kill` on the wrong address can end the caller's own session. Always compare against `$HC_TERMINAL_ID` first.
- `hc ls --json` gives `address`, `agent`, `status`, `cwd`, and `where` ("space / tab") per terminal. Reported `cwd` can be stale.

## Launcher findings (2026-10-30)

- `run()` in a mod returns null. Call `exec("herdr-app", ["do", cmd, json])` to get ids back.
- `tab.new` returns `{space, tab, terminal}` but no pane. Find the pane in `herdr-app ls` (plain `ls` is JSON).
- `tab.new` runs argv inside the interactive shell, which stays after it exits. `pane.split` execs argv directly and closes the pane when it exits.
- `pane.split` has no folder argument; a new pane starts in the focused terminal's folder. Wrap argv in `cd` (`inFolder` in `lib.js`).
- No command renames a pane, so `label` and `icon` on panes are ignored; only the tab gets a name.
- `doc.get` / `doc.set` need no `hello`: one JSON-RPC line to `hc connect --json` on stdin.
- `mod.open` passes no props, and a mod cannot import another mod folder's files (`resolves outside the application directory`). `mods/q-saddle-agent/` only reopens `q-saddle-tab` with `openOverlay({props: {direct: true}})`.
- `pane.split` returns `{pane, terminal}`.
- `build.js` builds a layout for both the overlay and `cli.js open` (a plain-`node` CLI that cc-plugins' `herd tell` calls). Change the layout logic there, not in either caller.
- Run `npm test` (node --test) for `lib.js`, `ratios.js`, `build.js`, `cli.js`, `projects.js`, `restart.js`, and `ssh.js`; they import nothing from `herdr`.

## Picker findings (2026-10-30)

- Mod JS (QuickJS) shares the window's thread. A `readdir` walk of `~/Projects` froze the whole window for seconds; run one `exec("find", ...)` instead, which works in another process.
- Closing an overlay hands keyboard focus back. To chain overlays, close the current one first, then open the next.
- `readTextFile` is slow while a dialog opens (~0.5 s for two files); `shared()` is synchronous, so the picker draws its last rows from `shared("q-saddle.project.rows")` before reading anything.
- `.spin()` inside a `v_virtual_list` row made the window unresponsive. The likely cause is the list re-running its JS renderer every frame. This was not isolated, because Herdr crashed and restarted between tries. Use static marks in virtual lists.
- `herdr-app check` panics (`window.rs:5226`, `Option::unwrap()` on `None`) when a `v_virtual_list` has items, even plain-text ones; the app itself renders it. `q-saddle-project` passes check only when the shared row cache is empty.

## Restart findings (2026-10-30)

- `hc get <t> --json` gives `foreground.argv` and `foreground.cwd`: the agent a shell pane runs, and its live folder. `hc ls --json` has neither, and its `agent` field also names yazi; use `panes()[].program.agent` to tell agents apart.
- `hc run --bg --json` prints the new terminal's `address`.
- Codex and opencode report no status, so `program.agent` is false for them. `restart.js` also matches a configured harness command in the terminal's `argv` (`terminals()`).
- A launcher-built terminal's `argv` holds the whole launch (`cd` wrapper, `env K=V`, agent and flags), so "Same setup" reruns it as is. Only a bare shell (`["/bin/zsh"]`) needs `foreground.argv`.
- Herdr reports no agent session ids, so restart starts fresh; resume would need a per-harness transcript lookup.
- The shipped `confirm` mod only runs a `{name, args}` command, and `mod.open` passes no props, so it cannot carry a target pane.

## SSH findings (2026-10-30)

- `tab.new` wraps argv as `zsh -ic '"$@"; exec "$0" -i'`. A leading `exec` (`closingTab` in `ssh.js`) replaces that shell, so the tab closes when ssh exits. `pane.split` runs argv directly, where `exec` is not a program.
- `writeTextFile` writes outside `~/.config/herdr-app` (verified for the SSH registry in `~/.local/state`); only `fs/promises` is limited to it. Appending to `~/.zsh_history` goes through `exec("sh", ...)`, because `writeTextFile` replaces the whole file and reads stop at 1 MiB.
- Keyboard remappers with Emacs-style ctrl bindings (a common Karabiner rule) turn ctrl+`a b d e f h i k m n p v [ ]` into other keys. ctrl-i arrives as `tab`. Pick ctrl keys outside that list (`ctrl-s` edits, `ctrl-x` removes).
- A long-running Herdr slowed every host call while an overlay was open: two `readTextFile` calls took 1.6–2.7 s, the first keystroke landed after 2 s, with only 24 renders. A Herdr restart fixed it. Restart Herdr before you profile a slow overlay.
