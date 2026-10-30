import { test } from "node:test";
import assert from "node:assert/strict";
import { main } from "../mods/q-saddle-tab/cli.js";
import { inFolder } from "../mods/q-saddle-tab/lib.js";

const config = {
  default_tab_layout: "coding",
  apply_ratios: false,
  agents: [
    { name: "claude", command: ["claude"] },
    {
      name: "codex",
      command: ["codex"],
      options: [{ name: "fast", args: ["-m", "mini"] }],
    },
  ],
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
          ratio: 0.6,
        },
        { name: "term", type: "shell", direction: "down", ratio: 0.5 },
      ],
    },
    {
      name: "shell-first",
      panes: [
        { name: "shell", type: "shell" },
        {
          name: "agent",
          type: "agent",
          agent: "codex",
          option: "fast",
          direction: "right",
          ratio: 0.5,
        },
      ],
    },
    { name: "plain", panes: [{ name: "shell", type: "shell" }] },
  ],
};

function fakeHerdr(text = JSON.stringify(config)) {
  const calls = [];
  let made = 1;
  const exec = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "herdr-app" && args[0] === "ls")
      return {
        code: 0,
        stdout: JSON.stringify({
          spaces: [{ tabs: [{ terminals: [{ terminal: "t1", pane: "p1" }] }] }],
        }),
        stderr: "",
      };
    if (args[1] === "space.new")
      return {
        code: 0,
        stdout: JSON.stringify({ space: "sp1", tab: "tb1", terminal: "t1" }),
        stderr: "",
      };
    if (args[1] === "pane.split") {
      made++;
      return {
        code: 0,
        stdout: JSON.stringify({ pane: `p${made}`, terminal: `t${made}` }),
        stderr: "",
      };
    }
    throw new Error(`unexpected exec: ${cmd} ${args.join(" ")}`);
  };
  const readFile = async (path) => {
    if (text === null)
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    return text;
  };
  const writeFile = async () => {};
  return { calls, io: { exec, readFile, writeFile, home: "/h" } };
}

const sent = (calls, command) =>
  calls
    .filter(([, args]) => args[1] === command)
    .map(([, args]) => JSON.parse(args[2]));

test("opens the default layout in a new space and reports its ids", async () => {
  const { calls, io } = fakeHerdr();
  const r = await main(
    [
      "open",
      "--folder",
      "/p/app",
      "--name",
      "app",
      "--agent-argv",
      '["claude","hi"]',
    ],
    io,
  );
  assert.equal(r.code, 0);
  assert.deepEqual(r.out, {
    space: "sp1",
    tab: "tb1",
    agent_terminal: "t1",
    panes: { agent: "p1", files: "p2", term: "p3" },
  });
  assert.deepEqual(sent(calls, "space.new"), [
    { name: "app", folder: "/p/app", argv: ["claude", "hi"] },
  ]);
  assert.deepEqual(sent(calls, "pane.split"), [
    {
      direction: "right",
      pane: "p1",
      argv: inFolder("/p/app", [
        "sh",
        "-c",
        'yazi .; exec "${SHELL:-/bin/sh}"',
      ]),
    },
    { direction: "down", pane: "p2", argv: inFolder("/p/app", null) },
  ]);
  assert.equal(sent(calls, "pane.focus").length, 0);
});

test("reads the config under HERDR_APP_HOME", async () => {
  const { io } = fakeHerdr();
  const paths = [];
  const read = io.readFile;
  io.readFile = (path) => (paths.push(path), read(path));
  await main(["open", "--folder", "/p"], io);
  assert.deepEqual(paths, ["/h/data/q-lab/q-saddle/config.json"]);
});

test("--layout picks the layout and agent_terminal follows the agent pane", async () => {
  const { calls, io } = fakeHerdr();
  const r = await main(
    ["open", "--folder", "/p", "--layout", "shell-first"],
    io,
  );
  assert.equal(r.code, 0);
  assert.equal(r.out.agent_terminal, "t2");
  assert.deepEqual(sent(calls, "space.new"), [{ folder: "/p" }]);
  assert.deepEqual(sent(calls, "pane.split")[0].argv, inFolder("/p", ["codex", "-m", "mini"]));
});

test("without --agent-argv an unnamed agent pane runs the first agent", async () => {
  const { calls, io } = fakeHerdr();
  await main(["open", "--folder", "/p"], io);
  assert.deepEqual(sent(calls, "space.new")[0].argv, ["claude"]);
});

test("a layout without an agent pane reports a null agent_terminal", async () => {
  const { io } = fakeHerdr();
  const r = await main(["open", "--folder", "/p", "--layout", "plain"], io);
  assert.equal(r.code, 0);
  assert.equal(r.out.agent_terminal, null);
});

test("exit 2 when there is no config file", async () => {
  const { io } = fakeHerdr(null);
  const r = await main(["open", "--folder", "/p"], io);
  assert.equal(r.code, 2);
  assert.match(r.out.error, /config/);
});

test("exit 2 for a layout the config does not have", async () => {
  const { calls, io } = fakeHerdr();
  const r = await main(["open", "--folder", "/p", "--layout", "nope"], io);
  assert.equal(r.code, 2);
  assert.match(r.out.error, /nope/);
  assert.equal(calls.length, 0);
});

test("exit 2 when no --layout is given and the config names no default", async () => {
  const { io } = fakeHerdr(
    JSON.stringify({ ...config, default_tab_layout: undefined }),
  );
  const r = await main(["open", "--folder", "/p"], io);
  assert.equal(r.code, 2);
});

test("exit 1 for a config that fails validation", async () => {
  const { io } = fakeHerdr(
    JSON.stringify({ ...config, default_tab_layout: "missing" }),
  );
  const r = await main(["open", "--folder", "/p", "--layout", "plain"], io);
  assert.equal(r.code, 1);
  assert.match(r.out.error, /default_tab_layout/);
});

test("exit 1 for a herdr-app failure", async () => {
  const { io } = fakeHerdr();
  io.exec = async () => ({ code: 1, stdout: "", stderr: "no window" });
  const r = await main(["open", "--folder", "/p"], io);
  assert.deepEqual(r, { code: 1, out: { error: "space.new: no window" } });
});

for (const [why, args] of [
  ["no command", []],
  ["an unknown command", ["close", "--folder", "/p"]],
  ["no --folder", ["open"]],
  ["a relative --folder", ["open", "--folder", "p"]],
  ["an unknown flag", ["open", "--folder", "/p", "--tab", "x"]],
  ["a flag with no value", ["open", "--folder"]],
  [
    "--agent-argv that is not JSON",
    ["open", "--folder", "/p", "--agent-argv", "claude"],
  ],
  [
    "--agent-argv that is not a string array",
    ["open", "--folder", "/p", "--agent-argv", '["a",1]'],
  ],
  ["an empty --agent-argv", ["open", "--folder", "/p", "--agent-argv", "[]"]],
]) {
  test(`exit 1 for ${why}`, async () => {
    const { calls, io } = fakeHerdr();
    const r = await main(args, io);
    assert.equal(r.code, 1);
    assert.equal(typeof r.out.error, "string");
    assert.equal(calls.length, 0);
  });
}
