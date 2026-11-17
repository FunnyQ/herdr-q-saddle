import { test } from "node:test";
import assert from "node:assert/strict";
import { splitAgent } from "../mods/q-saddle-tab/build.js";
import { inFolder } from "../mods/q-saddle-tab/lib.js";

const fakeExec = (calls) => async (cmd, args) => {
  calls.push([cmd, args]);
  return { code: 0, stdout: '{"pane":"p9","terminal":"t9"}', stderr: "" };
};

test("splitAgent splits the given pane with the layout pane's direction and env, in the folder", async () => {
  const calls = [];
  const made = await splitAgent(
    { exec: fakeExec(calls) },
    {
      pane: {
        name: "agent",
        type: "agent",
        direction: "down",
        env: { Q: "1" },
      },
      from: "p1",
      folder: "/p",
      argv: ["claude"],
    },
  );
  assert.equal(made.pane, "p9");
  assert.deepEqual(calls, [
    [
      "herdr-app",
      [
        "do",
        "pane.split",
        JSON.stringify({
          direction: "down",
          pane: "p1",
          argv: ["env", "Q=1", ...inFolder("/p", ["claude"])],
        }),
      ],
    ],
  ]);
});

test("splitAgent splits right when the layout pane is a tab root with no direction", async () => {
  const calls = [];
  await splitAgent(
    { exec: fakeExec(calls) },
    {
      pane: { name: "agent", type: "agent" },
      from: "p1",
      folder: "/p",
      argv: ["codex"],
    },
  );
  assert.equal(JSON.parse(calls[0][1][2]).direction, "right");
});
