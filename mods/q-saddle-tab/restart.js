// herdr-core's `herdr-app` document format is undocumented.

import { inFolder } from "./lib.js";

// Herdr marks only agents that report a status; codex and opencode don't, so also look for a
// configured harness in the command the terminal was started with.
export const isAgentPane = (agents, argvOf) => (pane) =>
  Boolean(pane.program?.agent) ||
  (argvOf(pane.terminal) ?? []).some((word) =>
    agents.some((a) => a.command[0] === word),
  );

export function targetPane(panes, focused, isAgent) {
  if (!focused) return null;
  const agents = panes.filter(
    (p) => p.tab === focused.tab && p.terminal && isAgent(p),
  );
  return agents.find((p) => p.pane === focused.pane) ?? agents[0] ?? null;
}

const HANDOVER = ["sh", "-c", 'set -m; "$@"; exec "${SHELL:-/bin/sh}"', "sh"];

function envOf(argv) {
  const at = argv.indexOf("env");
  if (at < 0) return [];
  const pairs = [];
  for (const word of argv.slice(at + 1)) {
    if (!/^\w+=/.test(word)) break;
    pairs.push(word);
  }
  return pairs.length ? ["env", ...pairs] : [];
}

export function relaunchArgv(old, launch) {
  if (launch)
    return inFolder(old.foreground?.cwd ?? old.cwd, [
      ...HANDOVER,
      ...envOf(old.argv),
      ...launch,
    ]);
  return old.argv.length > 1 ? old.argv : [...HANDOVER, ...old.foreground.argv];
}

function holding(node, terminal) {
  if (node.content?.terminal === terminal) return node;
  for (const child of node.children ?? []) {
    const found = holding(child, terminal);
    if (found) return found;
  }
  return null;
}

export function swapTerminal(doc, from, to) {
  for (const tab of doc.spaces?.flatMap((s) => s.tabs ?? []) ?? []) {
    const node = holding(tab.root, from);
    if (node) {
      node.content = { ...node.content, terminal: to };
      return doc;
    }
  }
  throw new Error(`no pane holds terminal ${from}`);
}

async function rpc(exec, path, writeFile, method, params) {
  await writeFile(
    path,
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n",
  );
  const r = await exec("sh", ["-c", 'hc connect --json < "$1"', "sh", path]);
  const reply = JSON.parse(r.stdout.split("\n")[0] || "{}");
  if (reply.error)
    throw Object.assign(new Error(`${method}: ${reply.error.message}`), {
      kind: reply.error.data?.kind,
    });
  return reply.result;
}

// The request goes through a file: a whole document can outgrow one argv entry.
async function swapInDoc({ exec, writeFile, scratch }, from, to) {
  for (let attempt = 0; ; attempt++) {
    const { value, version } = await rpc(exec, scratch, writeFile, "doc.get", {
      name: "herdr-app",
    });
    try {
      return await rpc(exec, scratch, writeFile, "doc.set", {
        name: "herdr-app",
        value: swapTerminal(value, from, to),
        version,
      });
    } catch (e) {
      if (e.kind !== "conflict" || attempt > 0) throw e;
    }
  }
}

async function hc(exec, args) {
  const r = await exec("hc", args);
  if (r.code !== 0) throw new Error(`hc ${args[0]}: ${r.stderr.trim()}`);
  return r.stdout;
}

export async function restart(io, terminal, launch) {
  const old = JSON.parse(await hc(io.exec, ["get", terminal, "--json"]));
  const made = JSON.parse(
    await hc(io.exec, [
      "run",
      "--bg",
      "--no-parent",
      "--json",
      "--cwd",
      old.foreground?.cwd ?? old.cwd,
      "--",
      ...relaunchArgv(old, launch),
    ]),
  );
  try {
    await swapInDoc(io, terminal, made.address);
  } catch (e) {
    await io.exec("hc", ["kill", made.address]);
    throw e;
  }
  await hc(io.exec, ["kill", terminal]);
}
