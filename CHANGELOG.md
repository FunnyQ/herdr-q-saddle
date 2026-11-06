# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
