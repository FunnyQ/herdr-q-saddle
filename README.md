# herdr-q-saddle

Herdr-app mods that open agent layouts, pick projects and SSH targets, and restart agents in place.

## Mods

| Mod                | Key           | What it does                                                                                      |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------------- |
| `q-saddle-tab`     | `cmd-t`       | Pick a tab layout, harness, model, and effort, then open a tab and apply each pane's split ratio. |
| `q-saddle-agent`   | `cmd-shift-c` | Open `q-saddle-tab` with the layout menu skipped, straight to the agent pick.                     |
| `q-saddle-project` | `cmd-o`       | Pick a project from the registry, zoxide, or a `~/Projects` sweep; focus its space or open one.   |
| `q-saddle-restart` | `cmd-r`       | Restart the focused agent in place, keeping the pane and its neighbours.                          |
| `q-saddle-ssh`     | `cmd-shift-s` | Pick an SSH target and open a tab running `ssh`.                                                  |

## Install

Install [yazi](https://yazi-rs.github.io) and [zoxide](https://github.com/ajeetdsouza/zoxide) for the best experience. The example `agentic-coding` layout runs `yazi .` in its file pane, and the project picker adds zoxide matches once you type two letters. Without yazi, that pane closes at once; without zoxide, the picker shows only the registry and the `~/Projects` sweep.

Ask the agent in your Herdr window:

> Add herdr.dev/mods/FunnyQ/herdr-q-saddle

It copies the five folders into `~/.config/herdr-app/mods/` and merges `keys.json` into yours.

Then copy `config.example.json` from this repo to `~/.config/herdr-app/data/q-lab/q-saddle/config.json`. Without `tab_layouts` and `agents`, `cmd-t` has nothing to open. Edit the agents to match the harnesses you have installed.

All five mods run programs (`exec`, `hc`) and read files outside their folders: the registries in `~/.local/state` and `~/.zsh_history`. Expect `herdr-app check` to fail for `q-saddle-project` while its row cache is filled; the app itself renders it.

### Develop

1. Link each folder in `mods/` into `~/.config/herdr-app/mods/`, so edits apply without copying:

   ```sh
   for m in mods/*; do ln -sfn "$PWD/$m" ~/.config/herdr-app/mods/; done
   ```

2. Merge `keys.json` into `~/.config/herdr-app/keys.json`.
3. Restart Herdr.

## Files

| What             | Path                                                       | Notes                                                                                                                                                          |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config           | `~/.config/herdr-app/data/q-lab/q-saddle/config.json`      | Shared by all five mods. Start from `config.example.json`.                                                                                                     |
| Project registry | `~/.local/state/herdr-projects/registry.json`              | Written on each pick. Override with `project_registry_file`.                                                                                                   |
| SSH registry     | `~/.local/state/herdr-ssh-targets/registry.json`           | Synced with the SSH config on each open. Override with `ssh_registry_file`.                                                                                    |
| SSH history      | `~/.zsh_history`                                           | Each SSH pick is appended. Override with `ssh_history_file`.                                                                                                   |
| Scratch          | `~/.config/herdr-app/data/q-lab/q-saddle/doc-request.json` | The `doc.set` request for split ratios and restarts. Safe to delete.                                                                                           |
| Cache            | `~/.config/herdr-app/shared.json`, keys `q-saddle.*`       | `q-saddle.project.rows` and `q-saddle.ssh.state` hold the last rows, so a picker draws at once. Herdr owns this file; delete a key only while Herdr is closed. |

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
