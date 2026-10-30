import { test } from "node:test";
import assert from "node:assert/strict";
import { setWeights } from "../mods/q-saddle-tab/ratios.js";

const block = (id) => ({ type: "block", id, content: { terminal: `t-${id}` } });

// The tree Herdr writes for agent | (files / term): the tab's root row holds the split.
const doc = () => ({
  spaces: [
    {
      id: "sp1",
      tabs: [
        {
          id: "tb1",
          root: {
            id: "tb1",
            type: "row",
            children: [
              {
                id: "s1",
                type: "row",
                size: { weight: 1 },
                children: [
                  block("agent"),
                  {
                    id: "s2",
                    type: "column",
                    children: [block("files"), block("term")],
                  },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
});

const weights = (node) => (node.children ?? []).map((c) => c.size?.weight);

test("setWeights gives each split its new pane's share", () => {
  const d = doc();
  setWeights(d, "tb1", [
    { pane: "files", from: "agent", ratio: 0.62 },
    { pane: "term", from: "files", ratio: 0.1 },
  ]);
  const row = d.spaces[0].tabs[0].root.children[0];
  assert.deepEqual(
    weights(row).map((w) => +w.toFixed(2)),
    [0.38, 0.62],
  );
  assert.deepEqual(
    weights(row.children[1]).map((w) => +w.toFixed(2)),
    [0.9, 0.1],
  );
});

test("setWeights splits a shared share in a flat container", () => {
  const d = doc();
  const tab = d.spaces[0].tabs[0];
  tab.root.children[0].children = [block("a"), block("b"), block("c")];
  setWeights(d, "tb1", [
    { pane: "b", from: "a", ratio: 0.5 },
    { pane: "c", from: "b", ratio: 0.5 },
  ]);
  assert.deepEqual(weights(tab.root.children[0]), [0.5, 0.25, 0.25]);
});

test("setWeights skips a pane that already closed", () => {
  const d = doc();
  setWeights(d, "tb1", [
    { pane: "gone", from: "agent", ratio: 0.3 },
    { pane: "files", from: "agent", ratio: 0.62 },
  ]);
  assert.deepEqual(
    weights(d.spaces[0].tabs[0].root.children[0]).map((w) => +w.toFixed(2)),
    [0.38, 0.62],
  );
});

test("setWeights throws for a tab it cannot find", () => {
  assert.throws(() => setWeights(doc(), "nope", []), /tab nope/);
});
