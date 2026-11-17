import { test } from "node:test";
import assert from "node:assert/strict";
import { startPaneless } from "../mods/q-saddle-tab/build.js";
import { inFolder } from "../mods/q-saddle-tab/lib.js";

test("startPaneless runs the agent under the focused terminal, quietly, in its folder", async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, args]);
    return { code: 0, stdout: '{"address":"t9"}', stderr: "" };
  };
  const address = await startPaneless(exec, {
    argv: ["claude", "--model", "opus"],
    folder: "/p",
    parent: "t3",
  });
  assert.equal(address, "t9");
  assert.deepEqual(calls, [
    [
      "hc",
      [
        "run",
        "--bg",
        "--json",
        "--no-notify",
        "--parent",
        "t3",
        "--",
        ...inFolder("/p", ["claude", "--model", "opus"]),
      ],
    ],
  ]);
});

test("startPaneless refuses another machine's terminal", async () => {
  const exec = async () => assert.fail("ran hc");
  await assert.rejects(
    startPaneless(exec, { argv: ["claude"], folder: "/p", parent: "mini/t3" }),
    /this computer/,
  );
});

test("startPaneless reports hc run's error", async () => {
  const exec = async () => ({
    code: 1,
    stdout: "",
    stderr: "no such parent\n",
  });
  await assert.rejects(
    startPaneless(exec, { argv: ["claude"], folder: "/p", parent: "t3" }),
    /hc run: no such parent/,
  );
});
