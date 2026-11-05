// Split ratios through herdr-core's `herdr-app` document, whose format is undocumented.

const contains = (node, id) =>
  node.id === id || (node.children ?? []).some((c) => contains(c, id));

function lowestCommon(node, a, b) {
  for (const child of node.children ?? []) {
    if (contains(child, a) && contains(child, b))
      return lowestCommon(child, a, b);
  }
  return node;
}

const weight = (node) => node.size?.weight ?? 1;

export function setWeights(doc, tabId, splits) {
  const tab = doc.spaces
    ?.flatMap((s) => s.tabs ?? [])
    .find((t) => t.id === tabId);
  if (!tab) throw new Error(`tab ${tabId} is not in the herdr-app document`);
  for (const { pane, from, ratio } of splits) {
    const parent = lowestCommon(tab.root, pane, from);
    const mine = parent.children.find((c) => contains(c, pane));
    const theirs = parent.children.find((c) => contains(c, from));
    if (!mine || !theirs) continue;
    const share = weight(theirs);
    mine.size = { ...mine.size, weight: share * ratio };
    theirs.size = { ...theirs.size, weight: share * (1 - ratio) };
  }
  return doc;
}

// Another machine's ids carry a `machine/` prefix; its own document uses the bare id.
export function splitId(id) {
  const at = id.indexOf("/");
  return at < 0 ? [null, id] : [id.slice(0, at), id.slice(at + 1)];
}

// Each machine keeps its document in its own core, reached through `hc exec --on`.
const CONNECT =
  'if [ -n "$2" ]; then hc exec --on "$2" -i -- hc connect --json < "$1"; else hc connect --json < "$1"; fi';

export async function rpc(exec, path, writeFile, method, params, machine) {
  await writeFile(
    path,
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) + "\n",
  );
  const r = await exec("sh", ["-c", CONNECT, "sh", path, machine ?? ""]);
  const reply = JSON.parse(r.stdout.split("\n")[0] || "{}");
  if (reply.error)
    throw Object.assign(new Error(`${method}: ${reply.error.message}`), {
      kind: reply.error.data?.kind,
    });
  return reply.result;
}

// The request goes through a file: a whole document can outgrow one argv entry.
export async function applyRatios({ exec, writeFile, scratch }, tabId, splits) {
  const [machine, tab] = splitId(tabId);
  const local = splits.map((s) => ({
    ...s,
    pane: splitId(s.pane)[1],
    from: splitId(s.from)[1],
  }));
  for (let attempt = 0; ; attempt++) {
    const { value, version } = await rpc(
      exec,
      scratch,
      writeFile,
      "doc.get",
      { name: "herdr-app" },
      machine,
    );
    try {
      return await rpc(
        exec,
        scratch,
        writeFile,
        "doc.set",
        { name: "herdr-app", value: setWeights(value, tab, local), version },
        machine,
      );
    } catch (e) {
      if (e.kind !== "conflict" || attempt > 0) throw e;
    }
  }
}
