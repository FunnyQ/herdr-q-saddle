import { inFolder } from "./lib.js";
import { applyRatios } from "./ratios.js";

export async function herdrDo(exec, command, args) {
  const r = await exec("herdr-app", ["do", command, JSON.stringify(args)]);
  const out = JSON.parse(r.stdout || "{}");
  if (r.code !== 0 || out.error)
    throw new Error(`${command}: ${out.error ?? r.stderr.trim()}`);
  return out;
}

async function paneOf(exec, terminal) {
  const r = await exec("herdr-app", ["ls"]);
  const panes = JSON.parse(r.stdout).spaces.flatMap((s) =>
    s.tabs.flatMap((t) => t.terminals),
  );
  const pane = panes.find((p) => p.terminal === terminal)?.pane;
  if (!pane) throw new Error(`no pane shows ${terminal}`);
  return pane;
}

export async function buildTab(io, { panes, folder, argvOf, open, ratios }) {
  const [root, ...rest] = panes;
  const tab = await open(argvOf(root));
  const ids = { [root.name]: await paneOf(io.exec, tab.terminal) };
  const splits = [];
  let previous = root.name;
  for (const pane of rest) {
    const from = pane.split_from ?? previous;
    const argv = folder ? inFolder(folder, argvOf(pane)) : argvOf(pane);
    const made = await herdrDo(io.exec, "pane.split", {
      direction: pane.direction,
      pane: ids[from],
      ...(argv && { argv }),
    });
    ids[pane.name] = made.pane;
    splits.push({ pane: made.pane, from: ids[from], ratio: pane.ratio });
    previous = pane.name;
  }
  let ratioError = null;
  if (splits.length && ratios)
    await applyRatios(io, tab.tab, splits).catch((e) => (ratioError = e));
  return { tab, ids, ratioError };
}
