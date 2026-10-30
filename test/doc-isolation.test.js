import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const allowed = ["mods/q-saddle-tab/ratios.js", "mods/q-saddle-tab/restart.js"];

test("only ratios.js and restart.js touch the undocumented herdr-app document", () => {
  const offenders = readdirSync("mods", { recursive: true })
    .filter((f) => f.endsWith(".js"))
    .map((f) => join("mods", f))
    .filter((f) => !allowed.includes(f))
    .filter((f) => /doc\.(get|set)/.test(readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});
