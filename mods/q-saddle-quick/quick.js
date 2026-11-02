// Per-space Quick Terminal: find, start, show, hide and adopt each space's parked shell.
// Every function takes the herdr API as `a`, so tests run it under plain node.

export const TERMINALS = "q-saddle.quick.terminals";
export const VISIBLE = "q-saddle.quick.visible";
export const LABEL = "q-saddle.quick-space";
const OLD_LABEL = "p5.quick-space";
const OLD_TERMINALS = "p5.quick-terminal.terminals";
// herdr-layout-p5 kept these; setShared cannot delete a key, so they end as null.
const OLD_KEYS = [
  OLD_TERMINALS,
  "p5.quick-terminal.visible",
  "p5.quick-terminal.focus-check",
  "p5.quick-terminal.debug",
  "p5.quick-terminal.trace",
];
const MOD = "q-saddle-quick";

export const keyOf = (space) => `${space.machine ?? "local"}:${space.id}`;
const activeSpace = (a) => a.spaces().find((s) => s.active);

export function migrate(a) {
  const old = a.shared(OLD_TERMINALS);
  if (old) a.setShared(TERMINALS, { ...old, ...(a.shared(TERMINALS) ?? {}) });
  for (const key of OLD_KEYS)
    if (a.shared(key) !== null) a.setShared(key, null);
}

function refocus(a, visible) {
  const space = activeSpace(a);
  if (
    space &&
    keyOf(space) === visible.space &&
    a.panes().some((p) => p.pane === visible.returnPane)
  )
    a.run("pane.focus", { pane: visible.returnPane });
}

export function hide(a, restore = true) {
  const visible = a.shared(VISIBLE);
  if (!visible) return;
  a.setShared(VISIBLE, null);
  a.closeOverlay(visible.id);
  if (restore) refocus(a, visible);
}

// The dialog `id` went by itself (Esc, outside click, ×): drop the record, refocus its pane.
export function forget(a, id) {
  const visible = a.shared(VISIBLE);
  if (visible?.id !== id) return;
  a.setShared(VISIBLE, null);
  refocus(a, visible);
}

export const stale = (a, visible, layout) => {
  const space = activeSpace(a);
  return !space || keyOf(space) !== visible.space || layout !== visible.layout;
};

export function adopt(a) {
  migrate(a);
  const space = activeSpace(a);
  const pane = a.panes().find((p) => p.pane === a.focused()?.pane);
  if (!space || !pane?.terminal || !pane.program?.shell)
    throw new Error("Focus a shell pane before moving it to Quick Terminal.");
  const saved = a.shared(TERMINALS) ?? {};
  const key = keyOf(space);
  if (saved[key] && saved[key] !== pane.terminal)
    throw new Error("This space already has a quick terminal.");
  hide(a, false);
  a.setShared(TERMINALS, { ...saved, [key]: pane.terminal });
  a.run("terminal.park", { terminal: pane.terminal });
}

// Persona 5 reserves 76px above the terminal for its title image; the normal look only a title row.
export function dialog(look, address, viewport, zoom) {
  const height =
    Math.min(viewport.height * 0.65, (viewport.width * 0.78 * 3) / 4) / zoom;
  const width = (height * 4) / 3;
  const terminal = { type: "block", content: { terminal: address } };
  if (look !== "p5")
    return {
      kind: "dialog",
      width,
      height,
      layout: {
        type: "column",
        resizable: false,
        children: [
          {
            type: "block",
            size: { px: 34 },
            content: { mod: MOD, props: { look } },
          },
          terminal,
        ],
      },
    };
  const frame = {
    width,
    height,
    side: Math.max(28, Math.ceil(width * 0.05)),
    top: Math.max(76, Math.ceil(height * 0.06)),
    bottom: Math.max(28, Math.ceil(height * 0.06)),
  };
  const part = (part) => ({
    type: "block",
    size: { px: part === "bottom" ? frame.bottom : frame.side },
    content: { mod: MOD, props: { look, part, frame } },
  });
  return {
    kind: "dialog",
    frame: "none",
    width,
    height,
    layout: {
      type: "column",
      resizable: false,
      children: [
        {
          type: "block",
          size: { px: frame.top },
          content: { mod: MOD, props: { look, frame } },
        },
        {
          type: "row",
          resizable: false,
          children: [part("left"), terminal, part("right")],
        },
        part("bottom"),
      ],
    },
  };
}

async function findOrStart(a, space, key) {
  const saved = a.shared(TERMINALS) ?? {};
  let terminal = a
    .terminals()
    .find(
      (t) =>
        t.state === "live" &&
        (t.address === saved[key] ||
          t.labels?.[LABEL] === key ||
          t.labels?.[OLD_LABEL] === key),
    );
  if (terminal?.labels?.[OLD_LABEL] === key && terminal.labels[LABEL] !== key)
    await a.hc(["label", terminal.address, `${LABEL}=${key}`, `${OLD_LABEL}=`]);
  if (!terminal && saved[key]) {
    const result = await a.hc(["get", saved[key]]);
    if (result.code === 0) {
      const existing = JSON.parse(result.stdout);
      if (existing.state === "live") terminal = existing;
    } else if (result.code !== 3) {
      throw new Error(
        result.stderr || "Cannot reach the saved quick terminal.",
      );
    }
  }
  if (!terminal) {
    const args = [
      "run",
      "--json",
      "--bg",
      "--no-parent",
      "--no-notify",
      "--keep",
      "--label",
      `${LABEL}=${key}`,
    ];
    if (space.folder) args.push("--cwd", space.folder);
    if (space.machine) args.push("--on", space.machine);
    const result = await a.hc(args);
    if (result.code !== 0)
      throw new Error(result.stderr || "Cannot start the quick terminal.");
    terminal = JSON.parse(result.stdout);
  }
  if (space.machine && !terminal.address.includes("/"))
    return `${space.machine}/${terminal.address}`;
  return terminal.address;
}

// `runner` is the one-shot overlay that called this: it closes before the dialog opens so the
// dialog gets keyboard focus. `cancelled` turns true when a second press closed the runner mid-way.
export async function toggle(
  a,
  { viewport, look, layout, runner, cancelled = () => false },
) {
  migrate(a);
  const space = activeSpace(a);
  if (!space) return;
  const key = keyOf(space);
  if (a.shared(VISIBLE)?.space === key) {
    hide(a);
    return;
  }
  hide(a, false);
  const address = await findOrStart(a, space, key);
  a.setShared(TERMINALS, { ...(a.shared(TERMINALS) ?? {}), [key]: address });
  const current = activeSpace(a);
  if (cancelled() || !current || keyOf(current) !== key) return;
  const returnPane = a.focused()?.pane;
  if (runner) a.closeOverlay(runner);
  const id = a.openOverlay(
    dialog(look, address, viewport, a.settings?.()?.zoom ?? 1),
  );
  a.setShared(VISIBLE, {
    id,
    space: key,
    terminal: address,
    returnPane,
    layout,
  });
}
