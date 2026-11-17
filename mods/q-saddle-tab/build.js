import { inFolder, inShell, withEnv } from "./lib.js";
import { applyRatios, splitId } from "./ratios.js";

export async function herdrDo(exec, command, args) {
  const r = await exec("herdr-app", ["do", command, JSON.stringify(args)]);
  const out = JSON.parse(r.stdout || "{}");
  if (r.code !== 0 || out.error)
    throw new Error(`${command}: ${out.error ?? r.stderr.trim()}`);
  return out;
}

// A terminal started by `hc run` shows up in `herdr-app ls` a moment later.
async function placeOf(exec, terminal) {
  for (let attempt = 0; ; attempt++) {
    const r = await exec("herdr-app", ["ls"]);
    for (const space of JSON.parse(r.stdout).spaces)
      for (const tab of space.tabs) {
        const pane = tab.terminals.find((p) => p.terminal === terminal)?.pane;
        if (pane) return { tab: tab.id, pane };
      }
    if (attempt === 20) throw new Error(`no pane shows ${terminal}`);
    await exec("sleep", ["0.1"]);
  }
}

// tab.new and space.new take no env and start the shell themselves. A terminal labelled with a
// space becomes a new tab there (undocumented), so `hc run` can set env before the shell starts.
async function openWithEnv(io, { open, space, folder, name }, argv) {
  const stray = space ? null : await open(null);
  const target = space ?? stray.space;
  const [machine, id] = splitId(target);
  const r = await io.exec("hc", [
    "run",
    "--bg",
    "--json",
    "--no-parent",
    ...(machine ? ["--on", machine] : []),
    ...(folder ? ["--cwd", folder] : []),
    "--label",
    `herdr.space=${id}`,
    "--",
    ...argv,
  ]);
  if (r.code !== 0) throw new Error(`hc run: ${r.stderr.trim()}`);
  const terminal = JSON.parse(r.stdout).address;
  const { tab, pane } = await placeOf(io.exec, terminal);
  if (name) await herdrDo(io.exec, "tab.rename", { id: tab, name });
  await herdrDo(io.exec, "tab.select", { id: tab });
  if (stray)
    await herdrDo(io.exec, "tab.close", { id: stray.tab, confirmed: true });
  return { tab: { space: target, tab, terminal }, pane };
}

// A child of the focused terminal gets its tab's `where` label and no pane; it ends with that
// terminal's program. --no-notify keeps hc from typing notes into it.
export async function startPaneless(exec, { argv, folder, parent }) {
  if (splitId(parent)[0])
    throw new Error("A no-pane agent starts only on this computer.");
  const r = await exec("hc", [
    "run",
    "--bg",
    "--json",
    "--no-notify",
    "--parent",
    parent,
    "--",
    ...inFolder(folder, argv),
  ]);
  if (r.code !== 0) throw new Error(`hc run: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout).address;
}

export async function buildTab(
  io,
  { panes, folder, argvOf, open, space, name, ratios },
) {
  const [root, ...rest] = panes;
  const rootArgv = withEnv(root, inShell(argvOf(root)));
  let tab, rootPane;
  if (rootArgv[0] === "env")
    ({ tab, pane: rootPane } = await openWithEnv(
      io,
      { open, space, folder, name },
      rootArgv,
    ));
  else {
    tab = await open(argvOf(root));
    rootPane = (await placeOf(io.exec, tab.terminal)).pane;
  }
  const ids = { [root.name]: rootPane };
  const terminals = { [root.name]: tab.terminal };
  const splits = [];
  let previous = root.name;
  for (const pane of rest) {
    const from = pane.split_from ?? previous;
    const argv = withEnv(
      pane,
      folder ? inFolder(folder, argvOf(pane)) : argvOf(pane),
    );
    const made = await herdrDo(io.exec, "pane.split", {
      direction: pane.direction,
      pane: ids[from],
      ...(argv && { argv }),
    });
    ids[pane.name] = made.pane;
    terminals[pane.name] = made.terminal;
    splits.push({ pane: made.pane, from: ids[from], ratio: pane.ratio });
    previous = pane.name;
  }
  let ratioError = null;
  if (splits.length && ratios)
    await applyRatios(io, tab.tab, splits).catch((e) => (ratioError = e));
  return { tab, ids, terminals, ratioError };
}
