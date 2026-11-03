# herdr-q-saddle

Herdr-app mods that open agent layouts, pick projects and SSH targets, restart agents in place, and toggle a quick terminal per space.

## Mods

| Mod                    | Key                | What it does                                                                                           |
| ---------------------- | ------------------ | ------------------------------------------------------------------------------------------------------ |
| `q-saddle-tab`         | `cmd-t`            | Pick a tab layout, harness, model, and effort, then open a tab and apply each pane's split ratio.      |
| `q-saddle-agent`       | `cmd-shift-c`      | Open `q-saddle-tab` with the layout menu skipped, straight to the agent pick.                          |
| `q-saddle-project`     | `cmd-o`            | Pick a project from the registry, zoxide, or a `~/Projects` sweep; focus its space or open one.        |
| `q-saddle-restart`     | `cmd-r`            | Restart the focused agent in place, keeping the pane and its neighbours.                               |
| `q-saddle-ssh`         | `cmd-shift-s`      | Pick an SSH target and open a tab running `ssh`.                                                       |
| `q-saddle-quick`       | `` ctrl-` ``       | Toggle a floating terminal for the active space; it keeps its shell, folder and programs while hidden. |
| `q-saddle-quick-adopt` | `` ctrl-shift-` `` | Move the focused shell pane into the space's quick terminal without ending its shell.                  |

## Install

Install [yazi](https://yazi-rs.github.io) and [zoxide](https://github.com/ajeetdsouza/zoxide) for the best experience. The example `agentic-coding` layout runs `yazi .` in its file pane, and the project picker adds zoxide matches once you type two letters. Without yazi, that pane closes at once; without zoxide, the picker shows only the registry and the `~/Projects` sweep.

Ask the agent in your Herdr window:

> Add herdr.dev/mods/FunnyQ/herdr-q-saddle

It copies the seven folders into `~/.config/herdr-app/mods/` and merges `keys.json` into yours.

Then copy `config.example.json` from this repo to `~/.config/herdr-app/data/q-lab/q-saddle/config.json`. Without `tab_layouts` and `agents`, `cmd-t` has nothing to open. Edit the agents to match the harnesses you have installed.

All seven mods run programs (`exec`, `hc`) and read files outside their folders: the registries in `~/.local/state` and `~/.zsh_history`. Expect `herdr-app check` to fail for `q-saddle-project` while its row cache is filled; the app itself renders it.

### Develop

1. Copy the mod folders into `~/.config/herdr-app/mods/`; copy changes again after each edit. Herdr cannot load title images through a symlink. If an installed folder is already a symlink, move the link aside before copying:

   ```sh
   cp -R mods/q-saddle-* ~/.config/herdr-app/mods/
   mkdir -p ~/.config/herdr-app/assets
   cp assets/title-sprite.png assets/title-sprite.json ~/.config/herdr-app/assets/
   ```

2. Merge `keys.json` into `~/.config/herdr-app/keys.json`.
3. Switch away from the current layout and back after replacing an installed symlink with a copy.

## Quick terminal

Under the `persona5` layout, Projects, SSH, New Tab, Agent and Restart share a black cutout frame with a white outline and cyan/magenta shadows. Japanese/English title badges overlap the top-left edge, matching Quick Terminal. Frames change pose every 300ms; the layout's `ANIMATION` control pauses them. Keep text and inputs stationary. Other layouts use the normal theme styling.

Load all titles from the shared `assets/title-sprite.png`, also used by the Persona 5 layout's Spaces and Agents. Keep `sprite-data.js` in each consuming mod; Herdr does not allow JavaScript imports across mod folders. Copy the shared asset into `~/.config/herdr-app/assets/` with the mods.

Press `` ctrl-` `` to show or hide a centered terminal for the active space. Start each space's first shell in that space's folder. Hide the terminal with `` ctrl-` ``, the × button, or a click outside; Esc goes to the shell; switching spaces or layouts hides it too. Reopen it to reach the same shell, or a new one after the shell exits. Under the `persona5` layout, the terminal gets the Persona 5 frame.

To move an existing shell pane into the quick terminal, focus it and press `` ctrl-shift-` `` (or run `herdr-app do mod.open --name q-saddle-quick-adopt`). Adoption fails when the space already has a quick terminal.

## Files

| What             | Path                                                       | Notes                                                                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config           | `~/.config/herdr-app/data/q-lab/q-saddle/config.json`      | Shared by all seven mods. Start from `config.example.json`.                                                                                                                                                      |
| Project registry | `~/.local/state/herdr-projects/registry.json`              | Written on each pick. Override with `project_registry_file`.                                                                                                                                                     |
| SSH registry     | `~/.local/state/herdr-ssh-targets/registry.json`           | Synced with the SSH config on each open. Override with `ssh_registry_file`.                                                                                                                                      |
| SSH history      | `~/.zsh_history`                                           | Each SSH pick is appended. Override with `ssh_history_file`.                                                                                                                                                     |
| Scratch          | `~/.config/herdr-app/data/q-lab/q-saddle/doc-request.json` | The `doc.set` request for split ratios and restarts. Safe to delete.                                                                                                                                             |
| Cache            | `~/.config/herdr-app/shared.json`, keys `q-saddle.*`       | `q-saddle.project.rows` and `q-saddle.ssh.state` hold the last rows, so a picker draws at once. Herdr owns this file; delete a key only while Herdr is closed.                                                   |
| Quick terminals  | `~/.config/herdr-app/shared.json`, keys `q-saddle.quick.*` | `q-saddle.quick.terminals` maps each space to its shell. Shells carry the label `q-saddle.quick-space`. The first toggle moves the old `p5.quick-terminal.*` keys here and relabels old `p5.quick-space` shells. |

## Config

| Key                     | Default                                              | Used by      |
| ----------------------- | ---------------------------------------------------- | ------------ |
| `tab_layouts`           | `[]`                                                 | tab          |
| `default_tab_layout`    | none                                                 | tab          |
| `agents`                | `[]`                                                 | tab, restart |
| `apply_ratios`          | `true`                                               | tab          |
| `projects_root`         | `~/Projects`                                         | project      |
| `project_markers`       | `package.json`, `Gemfile`, `Cargo.toml`, `CLAUDE.md` | project      |
| `project_registry_file` | `~/.local/state/herdr-projects/registry.json`        | project      |
| `ssh_config_file`       | `~/.ssh/config`                                      | ssh          |
| `ssh_registry_file`     | `~/.local/state/herdr-ssh-targets/registry.json`     | ssh          |
| `ssh_history_file`      | `~/.zsh_history`                                     | ssh          |

Set `apply_ratios` to `false` when a Herdr update breaks split ratios. Ratios write the undocumented `herdr-app` core doc.

## Test

```sh
npm test
```
