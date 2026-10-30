import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isAgentPane,
  targetPane,
  relaunchArgv,
  swapTerminal,
  restart,
} from "../mods/q-saddle-tab/restart.js";

const AGENTS = [{ command: ["claude"] }, { command: ["codex"] }];
const CODEX_ARGV = [
  "/bin/zsh",
  "-ic",
  '"$@"; exec "$0" -i',
  "/bin/zsh",
  "env",
  "Q_NO_BANNER=1",
  "codex",
  "--model",
  "gpt-6.1-sol",
];
const HANDOVER = ["sh", "-c", '"$@"; exec "${SHELL:-/bin/sh}"', "sh"];

const pane = (id, tab, terminal, agent) => ({
  pane: id,
  tab,
  terminal,
  program: { agent },
});

test("isAgentPane trusts Herdr, else finds a configured harness in the argv", () => {
  const argvOf = { c1: CODEX_ARGV, y1: ["yazi", "."] };
  const agent = isAgentPane(AGENTS, (t) => argvOf[t]);
  assert.ok(agent(pane("p1", "t1", "a1", true)));
  assert.ok(agent(pane("p2", "t1", "c1", false)));
  assert.ok(!agent(pane("p3", "t1", "y1", false)));
  assert.ok(!agent(pane("p4", "t1", "gone", false)));
});

test("targetPane takes the focused pane when it runs an agent", () => {
  const panes = [pane("p1", "t1", "a1", true), pane("p2", "t1", "a2", true)];
  const agent = (p) => p.program.agent;
  assert.equal(targetPane(panes, { tab: "t1", pane: "p2" }, agent).pane, "p2");
});

test("targetPane falls back to the first agent in the focused tab", () => {
  const panes = [
    pane("p0", "t0", "a0", true),
    pane("p1", "t1", "y1", false),
    pane("p2", "t1", "a2", true),
    pane("p3", "t1", "a3", true),
  ];
  const agent = (p) => p.program.agent;
  assert.equal(targetPane(panes, { tab: "t1", pane: "p1" }, agent).pane, "p2");
});

test("targetPane is null without an agent in the tab, a mod pane, or focus", () => {
  const panes = [pane("p1", "t1", "y1", false), pane("p2", "t1", null, true)];
  const agent = (p) => p.program.agent;
  assert.equal(targetPane(panes, { tab: "t1", pane: "p1" }, agent), null);
  assert.equal(targetPane(panes, null, agent), null);
});

test("relaunchArgv reruns a terminal's own command as it is", () => {
  assert.deepEqual(relaunchArgv({ argv: CODEX_ARGV }, null), CODEX_ARGV);
});

test("relaunchArgv hands an agent typed into a shell back to a shell", () => {
  assert.deepEqual(
    relaunchArgv(
      { argv: ["/bin/zsh"], foreground: { argv: ["claude"] } },
      null,
    ),
    [...HANDOVER, "claude"],
  );
});

test("relaunchArgv starts a new launch in the folder, keeping the old env", () => {
  const old = { argv: CODEX_ARGV, foreground: { cwd: "/p/a" } };
  const argv = relaunchArgv(old, ["claude", "--model", "opus"]);
  assert.deepEqual(argv.slice(4), [
    "/p/a",
    ...HANDOVER,
    "env",
    "Q_NO_BANNER=1",
    "claude",
    "--model",
    "opus",
  ]);
  assert.deepEqual(
    relaunchArgv({ argv: ["/bin/zsh"], cwd: "/p/b" }, ["codex"]).slice(4),
    ["/p/b", ...HANDOVER, "codex"],
  );
});

test("swapTerminal points the pane holding one terminal at another", () => {
  const doc = {
    spaces: [
      {
        tabs: [
          {
            id: "tb",
            root: {
              type: "split",
              children: [
                { id: "p1", type: "block", content: { terminal: "t1" } },
                { id: "p2", type: "block", content: { terminal: "t2" } },
              ],
            },
          },
        ],
      },
    ],
  };
  const next = swapTerminal(doc, "t2", "t9");
  assert.deepEqual(
    next.spaces[0].tabs[0].root.children.map((c) => c.content.terminal),
    ["t1", "t9"],
  );
});

test("swapTerminal throws for a terminal no pane holds", () => {
  assert.throws(() => swapTerminal({ spaces: [] }, "t2", "t9"), /t2/);
});

function fakeIo(docHolds) {
  const calls = [];
  let request;
  const doc = () => ({
    spaces: [{ tabs: [{ root: { content: { terminal: docHolds } } }] }],
  });
  const io = {
    scratch: "/tmp/req.json",
    writeFile: async (_path, text) => {
      request = JSON.parse(text);
    },
    exec: async (cmd, args) => {
      if (cmd === "sh") {
        calls.push(request.method);
        const result =
          request.method === "doc.get" ? { value: doc(), version: 3 } : {};
        return { code: 0, stdout: JSON.stringify({ result }) };
      }
      calls.push(`hc ${args[0]} ${args.at(-1)}`);
      if (args[0] === "get")
        return {
          code: 0,
          stdout: JSON.stringify({
            argv: ["/bin/zsh"],
            cwd: "/stale",
            foreground: { argv: ["claude"], cwd: "/p/a" },
          }),
        };
      if (args[0] === "run")
        return { code: 0, stdout: JSON.stringify({ address: "t9" }) };
      return { code: 0, stdout: "" };
    },
  };
  return { io, calls };
}

test("restart starts the replacement, swaps it in, then ends the old terminal", async () => {
  const { io, calls } = fakeIo("t2");
  await restart(io, "t2", ["codex"]);
  assert.deepEqual(calls, [
    "hc get --json",
    "hc run codex",
    "doc.get",
    "doc.set",
    "hc kill t2",
  ]);
});

test("restart ends the replacement and keeps the old terminal when the swap fails", async () => {
  const { io, calls } = fakeIo("t5");
  await assert.rejects(restart(io, "t2", null), /t2/);
  assert.deepEqual(calls.slice(-2), ["doc.get", "hc kill t9"]);
});
