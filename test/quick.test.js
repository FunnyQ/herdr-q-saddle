import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TERMINALS,
  VISIBLE,
  LABEL,
  migrate,
  toggle,
  adopt,
  dialog,
  stale,
} from "../mods/q-saddle-quick/quick.js";

const SPACE = { id: "sp1", machine: null, folder: "/work/a", active: true };
const KEY = "local:sp1";

function fakeApi(over = {}) {
  const calls = { hc: [], run: [], opened: [], closed: [] };
  const store = { ...(over.shared ?? {}) };
  const a = {
    calls,
    store,
    shared: (k) => store[k] ?? null,
    setShared: (k, v) => {
      store[k] = v;
    },
    spaces: () => over.spaces ?? [SPACE],
    panes: () =>
      over.panes ?? [{ pane: "p1", terminal: "t1", program: { shell: true } }],
    focused: () => over.focused ?? { pane: "p1" },
    terminals: () => over.terminals ?? [],
    settings: () => ({ zoom: 1 }),
    hc: async (args) => {
      calls.hc.push(args);
      if (args[0] === "run")
        return {
          code: 0,
          stdout: JSON.stringify({ address: "t9", state: "live" }),
        };
      return over.hc?.(args) ?? { code: 0, stdout: "{}" };
    },
    run: (name, args) => calls.run.push([name, args]),
    openOverlay: (spec) => {
      calls.opened.push(spec);
      return "o1";
    },
    closeOverlay: (id) => calls.closed.push(id),
  };
  return a;
}

const OPTS = {
  viewport: { width: 1600, height: 1000 },
  look: "normal",
  layout: "terminals",
};

test("migrate moves the old terminals map, keeps newer entries, and clears old keys", () => {
  const a = fakeApi({
    shared: {
      "p5.quick-terminal.terminals": { [KEY]: "t1", "local:sp2": "t2" },
      "p5.quick-terminal.trace": [["x"]],
      [TERMINALS]: { [KEY]: "t5" },
    },
  });
  migrate(a);
  assert.deepEqual(a.store[TERMINALS], { [KEY]: "t5", "local:sp2": "t2" });
  assert.equal(a.store["p5.quick-terminal.terminals"], null);
  assert.equal(a.store["p5.quick-terminal.trace"], null);
  assert.ok(!("p5.quick-terminal.debug" in a.store));
});

test("toggle starts a labelled shell in the space folder and opens it", async () => {
  const a = fakeApi();
  await toggle(a, { ...OPTS, runner: "r1" });
  const run = a.calls.hc.find((c) => c[0] === "run");
  assert.ok(run.includes(`${LABEL}=${KEY}`));
  assert.deepEqual(run.slice(run.indexOf("--cwd"), run.indexOf("--cwd") + 2), [
    "--cwd",
    "/work/a",
  ]);
  assert.deepEqual(a.store[TERMINALS], { [KEY]: "t9" });
  assert.deepEqual(a.calls.closed, ["r1"]);
  assert.equal(a.calls.opened.length, 1);
  assert.deepEqual(a.store[VISIBLE], {
    id: "o1",
    space: KEY,
    terminal: "t9",
    returnPane: "p1",
    layout: "terminals",
  });
});

test("toggle reuses the saved live shell without starting one", async () => {
  const a = fakeApi({
    shared: { [TERMINALS]: { [KEY]: "t4" } },
    terminals: [{ address: "t4", state: "live" }],
  });
  await toggle(a, OPTS);
  assert.equal(a.calls.hc.length, 0);
  assert.equal(a.store[VISIBLE].terminal, "t4");
});

test("toggle finds a shell carrying the old label and relabels it", async () => {
  const a = fakeApi({
    terminals: [
      { address: "t3", state: "live", labels: { "p5.quick-space": KEY } },
    ],
  });
  await toggle(a, OPTS);
  assert.deepEqual(a.calls.hc, [
    ["label", "t3", `${LABEL}=${KEY}`, "p5.quick-space="],
  ]);
  assert.equal(a.store[VISIBLE].terminal, "t3");
});

test("toggle hides the shown terminal and refocuses the pane it came from", async () => {
  const a = fakeApi({
    shared: {
      [VISIBLE]: { id: "o7", space: KEY, terminal: "t4", returnPane: "p1" },
    },
  });
  await toggle(a, OPTS);
  assert.deepEqual(a.calls.closed, ["o7"]);
  assert.equal(a.store[VISIBLE], null);
  assert.deepEqual(a.calls.run, [["pane.focus", { pane: "p1" }]]);
  assert.equal(a.calls.opened.length, 0);
});

test("toggle saves a new shell but opens nothing once the runner was cancelled", async () => {
  const a = fakeApi();
  await toggle(a, { ...OPTS, cancelled: () => true });
  assert.deepEqual(a.store[TERMINALS], { [KEY]: "t9" });
  assert.equal(a.calls.opened.length, 0);
});

test("adopt parks the focused shell as the space's quick terminal", () => {
  const a = fakeApi();
  adopt(a);
  assert.deepEqual(a.store[TERMINALS], { [KEY]: "t1" });
  assert.deepEqual(a.calls.run, [["terminal.park", { terminal: "t1" }]]);
});

test("adopt refuses a non-shell pane and a space that already has one", () => {
  assert.throws(
    () =>
      adopt(
        fakeApi({
          panes: [{ pane: "p1", terminal: "t1", program: { shell: false } }],
        }),
      ),
    /shell pane/,
  );
  assert.throws(
    () => adopt(fakeApi({ shared: { [TERMINALS]: { [KEY]: "t8" } } })),
    /already/,
  );
});

test("dialog draws its own frame in persona5 and uses Herdr's frame otherwise", () => {
  const p5 = dialog("p5", "t9", OPTS.viewport, 1);
  assert.equal(p5.frame, "none");
  assert.ok(p5.layout.children[0].size.px >= 76);
  const normal = dialog("normal", "t9", OPTS.viewport, 1);
  assert.notEqual(normal.frame, "none");
  assert.ok(normal.layout.children[0].size.px < 76);
  assert.equal(normal.width / normal.height, 4 / 3);
});

test("stale is true once the active space or the layout changed", () => {
  const visible = { space: KEY, layout: "terminals" };
  assert.ok(!stale(fakeApi(), visible, "terminals"));
  assert.ok(stale(fakeApi(), visible, "persona5"));
  assert.ok(
    stale(fakeApi({ spaces: [{ ...SPACE, id: "sp2" }] }), visible, "terminals"),
  );
});
