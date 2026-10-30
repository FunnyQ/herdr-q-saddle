import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agentArgv,
  effortsFor,
  resolveEffort,
  paneArgv,
  validateConfig,
  menuLabel,
  inFolder,
  layoutTree,
} from "../mods/q-saddle-tab/lib.js";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";

const runArgv = ([cmd, ...args], env = {}) =>
  execFileSync(cmd, args, {
    cwd: "/",
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).trim();

test("inFolder runs argv in the folder", () => {
  assert.equal(runArgv(inFolder("/tmp", ["pwd", "-P"])), realpathSync("/tmp"));
});

test("inFolder starts the person's shell when there is no argv", () => {
  assert.equal(runArgv(inFolder("/tmp", null), { SHELL: "/bin/pwd" }), "/tmp");
});

const claude = {
  name: "claude code",
  command: ["claude"],
  efforts: ["low", "medium", "high"],
  effort_args: ["--effort", "{effort}"],
  extra_args: ["--verbose"],
  options: [
    { name: "Opus", args: ["--model", "opus"], effort: "medium" },
    {
      name: "CCR",
      command: ["ccr", "code"],
      effort: "high",
      efforts: ["high", "max"],
    },
    { name: "Plain", args: ["--model", "x"] },
  ],
};

test("agentArgv orders command, option args, effort args, extra args", () => {
  assert.deepEqual(agentArgv(claude, claude.options[0], "high"), [
    "claude",
    "--model",
    "opus",
    "--effort",
    "high",
    "--verbose",
  ]);
});

test("agentArgv uses the option's command override", () => {
  assert.deepEqual(agentArgv(claude, claude.options[1], "max"), [
    "ccr",
    "code",
    "--effort",
    "max",
    "--verbose",
  ]);
});

test("agentArgv emits no effort args when the option has no default effort", () => {
  assert.deepEqual(agentArgv(claude, claude.options[2], "high"), [
    "claude",
    "--model",
    "x",
    "--verbose",
  ]);
});

test("agentArgv works for an agent without options", () => {
  assert.deepEqual(
    agentArgv({ name: "codex", command: ["codex"] }, null, null),
    ["codex"],
  );
});

test("effortsFor prefers the option's list", () => {
  assert.deepEqual(effortsFor(claude, claude.options[1]), ["high", "max"]);
  assert.deepEqual(effortsFor(claude, claude.options[0]), [
    "low",
    "medium",
    "high",
  ]);
});

test("resolveEffort falls back to the option default for an unknown effort", () => {
  assert.equal(resolveEffort(claude, claude.options[0], "ultra"), "medium");
  assert.equal(resolveEffort(claude, claude.options[0], "low"), "low");
  assert.equal(resolveEffort(claude, claude.options[2], "low"), null);
});

test("paneArgv wraps env and runs commands through sh", () => {
  assert.deepEqual(
    paneArgv(
      { type: "command", command: "yazi .", env: { Q_NO_BANNER: "1" } },
      null,
    ),
    ["env", "Q_NO_BANNER=1", "sh", "-c", 'yazi .; exec "${SHELL:-/bin/sh}"'],
  );
  assert.deepEqual(paneArgv({ type: "agent" }, ["claude"]), ["claude"]);
  assert.equal(paneArgv({ type: "shell", env: { A: "1" } }, null), null);
});

test("menuLabel puts the icon two spaces before the label", () => {
  assert.equal(menuLabel({ name: "x", label: "X", icon: "*" }), "*  X");
  assert.equal(menuLabel({ name: "x" }), "x");
});

const good = {
  default_tab_layout: "coding",
  agents: [claude],
  tab_layouts: [
    {
      name: "coding",
      panes: [
        { name: "agent", type: "agent" },
        {
          name: "files",
          type: "command",
          command: "yazi .",
          direction: "right",
          ratio: 0.62,
        },
        { name: "term", type: "shell", direction: "down", ratio: 0.1 },
      ],
    },
  ],
};

test("validateConfig accepts a good config", () => {
  assert.deepEqual(validateConfig(good), []);
});

test("validateConfig names broken references and geometry", () => {
  const bad = structuredClone(good);
  bad.default_tab_layout = "nope";
  bad.tab_layouts[0].panes[0].direction = "right";
  bad.tab_layouts[0].panes[1].ratio = 1;
  bad.tab_layouts[0].panes[2].split_from = "ghost";
  bad.tab_layouts[0].panes[2].direction = undefined;
  bad.tab_layouts[0].panes.push({
    name: "a2",
    type: "agent",
    agent: "claude code",
    option: "Nope",
    direction: "down",
    ratio: 0.5,
  });
  assert.deepEqual(validateConfig(bad), [
    "default_tab_layout names no tab layout: nope",
    "layout 'coding': the root pane 'agent' cannot set direction",
    "layout 'coding' pane 'files': ratio must be between 0 and 1, exclusive: 1",
    "layout 'coding' pane 'term': split_from names no earlier pane: ghost",
    "layout 'coding' pane 'term': direction must be \"right\" or \"down\"",
    "layout 'coding' pane 'a2': agent 'claude code' has no option: Nope",
  ]);
});

test("validateConfig checks commands and efforts", () => {
  const bad = structuredClone(good);
  bad.tab_layouts[0].panes[1].command = " ";
  bad.agents[0].options[0].effort = "ultra";
  bad.agents.push({ name: "x", command: ["x"], efforts: ["low"] });
  assert.deepEqual(validateConfig(bad), [
    "agent 'claude code' option 'Opus': effort 'ultra' is not one of its efforts",
    "agent 'x': efforts needs effort_args containing {effort}",
    "layout 'coding' pane 'files': type = \"command\" requires command",
  ]);
});

test("layoutTree folds panes into nested splits", () => {
  const panes = [
    { name: "agent", type: "agent" },
    { name: "files", type: "command", direction: "right", ratio: 0.62 },
    { name: "term", type: "shell", direction: "down", ratio: 0.1 },
    { name: "side", type: "shell", split_from: "agent", direction: "down", ratio: 0.3 },
  ];
  const leaf = (name) => ({ pane: panes.find((p) => p.name === name) });
  assert.deepEqual(layoutTree(panes), {
    direction: "right",
    ratio: 0.62,
    first: { direction: "down", ratio: 0.3, first: leaf("agent"), second: leaf("side") },
    second: { direction: "down", ratio: 0.1, first: leaf("files"), second: leaf("term") },
  });
});

test("validateConfig accepts config.example.json", () => {
  const example = JSON.parse(
    readFileSync(new URL("../config.example.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(validateConfig(example), []);
});
