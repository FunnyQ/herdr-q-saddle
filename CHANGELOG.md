# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-20

_tracks tag `v1.2.0`_

### Added
- Open a new agent beside the focused pane with the new q-saddle-agent-split mod, instead of in a whole new tab; a zoomed or lone pane stays zoomed and focused.
- Review and tidy the project registry in a draggable window opened with ctrl-r in the project picker, and move, hide, remove or edit entries.
- Picking a project whose folder is gone now offers to move it to the same-named folder or hide it, and auto-hidden entries are purged after seven days, while hand-hidden entries and entries on unplugged volumes are kept.
- A layout can set `zoom: true` to zoom its focus pane when the tab opens, so the agentic-coding layout can start with Neovim zoomed.

### Changed
- The AWACS blue is darker (#1e77b9) because the old shade read too bright.

## [1.1.0] - 2026-11-14

_tracks tag `v1.1.0`_

### Added

- Dialogs adopt a tactical-briefing AWACS look, with lock-on brackets, markers, keycaps and a panel frame, whenever the herdr-layout-awacs layout is active; other layouts are unchanged.
- The lock-on brackets on the selected row now breathe gently after snapping in, and stay still when awacs.motion is off.
- AWACS effort choices in the tab launcher appear as solid boxes with clear selected and focused states.

### Changed

- Layout panes that carry environment variables now start with those variables already set, so shell startup files see them.

## [1.0.1] - 2026-11-06

_tracks tag `v1.0.1`_

### Added
- The cmd-t layout launcher now accepts vim keys: j/k move the selection and h/l change effort, alongside the arrows, without disturbing ctrl/cmd/alt shortcuts.

## [1.0.0] - 2026-11-06

_tracks tag `v1.0.0`_

### Added
- Initial release of the herdr-q-saddle mods: a layout launcher (cmd-t), agent launcher (cmd-shift-c), project picker (cmd-o), in-place agent restart (cmd-r), and SSH picker (cmd-shift-s), with README, recipe and example config for herdr.dev/mods.
- Per-space Quick Terminal (ctrl-` and ctrl-shift-`) that works in every layout and toggles a parked shell in a dialog.
- A headless `cli.js open` lets `herd tell` open a new space with your default layout instead of a single pane.
- Layouts accept an optional `focus` pane name that is focused after launch, and config validation reports a focus naming no pane.
- The project picker, launcher and restart now follow the focused machine, opening tabs, scanning projects and restarting agents on another herdr-app machine, and show the machine name when it is not this computer.
- Project and SSH pickers use fzf-style search, matching letters in order and highlighting them in names, aliases and paths.
- An opt-in Persona 5 look for the launcher, project picker and SSH picker, with animated selection slabs and CMY shadows, active only under the persona5 layout.

### Fixed
- Split panes now run in a login shell, so mise-installed tools such as bun are found on PATH, including after cmd-r restart.
- Restarting with the same setup no longer re-sends the original task prompt.
- Focus lands on the first agent pane after launching a tab with cmd-t, not the last split pane.
- Persona 5 dialog titles are uppercased so they no longer render in a cursive script face.
- Command panes such as yazi are named after their program in Herdr's pane header instead of showing as SH.
- A failed `cli.js open` now closes the half-built space, so callers that fall back to a plain space no longer run the prompt twice; empty HERDR_APP_HOME and non-JSON config.json are also handled.
