# Product

<!-- impeccable:product-schema 1 -->

## Platform

Desktop: herdr-app mods (gpui views driven by QuickJS), not web. Not one of web, ios, android, or adaptive.

## Users

Q is the primary user: a designer and Rails/frontend developer who runs coding agents in herdr-app panes all day. The mods also ship on herdr.dev/mods, so other herdr-app users install them with their own paths, agents, and harnesses.

## Product Purpose

q-saddle is a set of keyboard launchers for agent work in herdr-app: open a layout tab with an agent (cmd-t), jump to or open a project (cmd-o), restart an agent in place (cmd-r), open an SSH target (cmd-shift-s), and toggle a per-space quick terminal (ctrl-`). Success is getting from intent to a running agent in the right folder in a few keystrokes.

## Operating Context

- Everything opens as a herdr-app dialog over the window, or as a mod pane beside terminal panes.
- The project picker reads a registry shared with herdr-workbench (`~/.local/state/herdr-projects/registry.json`) and sweeps `~/Projects`. herdr-workbench may be retired, so q-saddle maintains the registry itself.
- Work spans this computer and remote herdr machines; ids and registries can belong to another machine.

## Capabilities and Constraints

- Personal paths, agents, and layouts live in config (`config.example.json`), never in code.
- Mod JS shares the window thread: slow host calls freeze the whole window. Heavy work runs in one `exec`.
- Virtual-list rows must be static (no spinners).
- Ctrl keys avoid letters that Emacs-style remappers take (`a b d e f h i k m n p v [ ]`); defaults avoid alt+letter.

## Brand Commitments

- Three looks, chosen by the herdr-app layout: default (`modal.js`), Persona 5 (`p5.js`), and AWACS (`awacs.js`). Every q-saddle surface supports all three.
- Keyboard first: every action has a key and a footer keycap; rows and buttons also work with the mouse.

## Evidence on Hand

- `preview.png`, `RECIPE.md`, `README.md`, and `keys.json` for the herdr.dev listing.
- Title sprite at `assets/title-sprite.png`, with `sprite-data.js` in each mod that uses it.

## Product Principles

1. Intent to running agent in as few keystrokes as possible.
2. Never block the window: show cached state first, then refresh.
3. Never lose user data silently: anything removed automatically is announced and recoverable for a while.
4. Config over code, so other herdr users can adopt it.
