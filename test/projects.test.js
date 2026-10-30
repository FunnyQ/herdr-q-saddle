import { test } from "node:test";
import assert from "node:assert/strict";
import {
  registryRows,
  findArgs,
  projectsIn,
  pickerRows,
  matches,
  shortPath,
  useProject,
  spaceShowing,
  withHeaders,
  kindOf,
  ago,
  splitMatch,
} from "../mods/q-saddle-project/projects.js";

test("registryRows drops hidden, puts used first by recency, then the rest by name", () => {
  const rows = registryRows({
    version: 1,
    projects: {
      "/p/zeta": { name: "zeta", sources: [] },
      "/p/alpha": { name: "alpha", sources: ["claude"] },
      "/p/old": { name: "old", sources: [], last_used_at: 10 },
      "/p/new": { name: "new", sources: [], last_used_at: 20 },
      "/p/gone": { name: "gone", sources: [], hidden: true, last_used_at: 30 },
    },
  });
  assert.deepEqual(
    rows.map((r) => r.path),
    ["/p/new", "/p/old", "/p/alpha", "/p/zeta"],
  );
  assert.deepEqual(rows[2], {
    path: "/p/alpha",
    name: "alpha",
    aliases: [],
    used: null,
  });
  assert.equal(rows[0].used, 20);
});

test("registryRows breaks recency ties by name", () => {
  const rows = registryRows({
    projects: {
      "/p/b": { name: "b", last_used_at: 5 },
      "/p/a": { name: "a", last_used_at: 5 },
    },
  });
  assert.deepEqual(
    rows.map((r) => r.name),
    ["a", "b"],
  );
});

test("findArgs prunes build folders and prints markers and kind files", () => {
  const args = findArgs("/root", ["package.json", "Gemfile"]);
  assert.equal(args[0], "/root");
  assert.ok(args.includes("node_modules"));
  assert.ok(args.includes("Gemfile"));
  assert.ok(args.includes("nuxt.config.*"));
  assert.ok(args.includes(".git"));
  assert.equal(args.at(-1), "-print");
});

test("projectsIn keeps the outermost marker folders and skips nested ones", () => {
  const hits = [
    "/root/app/package.json",
    "/root/app/nuxt.config.ts",
    "/root/app/nested/.git",
    "/root/group/lib/Gemfile",
    "/root/group/wt/.git",
    "/root/.hidden/CLAUDE.md",
    "/root/tools/go.mod",
    "",
  ];
  const { swept, kinds } = projectsIn(hits, ["package.json", "Gemfile", "CLAUDE.md"]);
  assert.deepEqual(swept, [
    "/root/.hidden",
    "/root/app",
    "/root/group/lib",
    "/root/group/wt",
  ]);
  assert.deepEqual(kinds, {
    "/root/.hidden": null,
    "/root/app": "nuxt",
    "/root/group/lib": "ruby",
    "/root/group/wt": null,
  });
});

test("pickerRows appends zoxide and swept folders not already registered", () => {
  const registered = [
    { path: "/p/u", name: "u", aliases: [], used: 5 },
    { path: "/p/a", name: "a", aliases: [], used: null },
  ];
  const rows = pickerRows(registered, ["/p/a", "/p/b"], "/z/c");
  assert.deepEqual(
    rows.map((r) => [r.path, r.name, r.group]),
    [
      ["/p/u", "u", "recent"],
      ["/p/a", "a", "registered"],
      ["/z/c", "c", "zoxide"],
      ["/p/b", "b", "found"],
    ],
  );
});

test("withHeaders puts a header before each run of one group", () => {
  const rows = [
    { path: "/a", group: "recent" },
    { path: "/b", group: "recent" },
    { path: "/c", group: "found" },
  ];
  assert.deepEqual(withHeaders(rows), [
    { header: "recent" },
    { row: 0 },
    { row: 1 },
    { header: "found" },
    { row: 2 },
  ]);
});

test("kindOf picks a framework before its language, else null", () => {
  assert.equal(kindOf(["Gemfile", "config.ru"]), "ruby");
  assert.equal(kindOf(["package.json", "nuxt.config.ts"]), "nuxt");
  assert.equal(kindOf(["package.json", "next.config.mjs"]), "next");
  assert.equal(kindOf(["package.json"]), "node");
  assert.equal(kindOf(["Cargo.toml"]), "cargo");
  assert.equal(kindOf(["go.mod"]), "go");
  assert.equal(kindOf(["pyproject.toml"]), "python");
  assert.equal(kindOf(["Package.swift"]), "swift");
  assert.equal(kindOf(["README.md", ".git"]), null);
});

test("ago shortens elapsed seconds to one unit", () => {
  const now = 1_000_000;
  assert.equal(ago(now - 30, now), "now");
  assert.equal(ago(now - 5 * 60, now), "5m");
  assert.equal(ago(now - 3 * 3600, now), "3h");
  assert.equal(ago(now - 2 * 86400, now), "2d");
  assert.equal(ago(now - 70 * 86400, now), "2mo");
  assert.equal(ago(now - 800 * 86400, now), "2y");
});

test("splitMatch finds the query in text, ignoring case", () => {
  assert.deepEqual(splitMatch("herdr-app", "APP"), ["herdr-", "app", ""]);
  assert.deepEqual(splitMatch("herdr-app", " herd "), ["", "herd", "r-app"]);
  assert.equal(splitMatch("herdr-app", "zzz"), null);
  assert.equal(splitMatch("herdr-app", ""), null);
});

test("pickerRows drops a swept folder zoxide already offers", () => {
  const rows = pickerRows([], ["/p/b"], "/p/b");
  assert.deepEqual(
    rows.map((r) => r.group),
    ["zoxide"],
  );
});

test("matches is case-insensitive over name, aliases and the shown path", () => {
  const row = {
    path: "/Users/q/Projects/api",
    name: "API",
    aliases: ["backend"],
  };
  assert.ok(matches(row, "", "/Users/q"));
  assert.ok(matches(row, "api", "/Users/q"));
  assert.ok(matches(row, "BACK", "/Users/q"));
  assert.ok(matches(row, "~/projects", "/Users/q"));
  assert.ok(!matches(row, "frontend", "/Users/q"));
});

test("shortPath replaces the home folder with ~", () => {
  assert.equal(shortPath("/Users/q", "/Users/q"), "~");
  assert.equal(shortPath("/Users/q/Projects/a", "/Users/q"), "~/Projects/a");
  assert.equal(shortPath("/Users/qq/a", "/Users/q"), "/Users/qq/a");
});

test("useProject stamps last_used_at and keeps the other fields", () => {
  const before = {
    version: 1,
    projects: {
      "/p/a": { name: "A", sources: ["claude"], aliases: ["x"], hidden: false },
    },
  };
  const after = useProject(before, "/p/a", 99);
  assert.deepEqual(after.projects["/p/a"], {
    name: "A",
    sources: ["claude"],
    aliases: ["x"],
    hidden: false,
    last_used_at: 99,
  });
  assert.equal(before.projects["/p/a"].last_used_at, undefined);
});

test("useProject registers an unknown folder as manual, keeping keys sorted", () => {
  const after = useProject(
    { version: 1, projects: { "/p/z": { name: "z", sources: [] } } },
    "/p/b",
    7,
  );
  assert.deepEqual(Object.keys(after.projects), ["/p/b", "/p/z"]);
  assert.deepEqual(after.projects["/p/b"], {
    name: "b",
    sources: ["manual"],
    last_used_at: 7,
  });
});

test("spaceShowing finds the local space with a pane in that folder", () => {
  const spaces = [
    { id: "s1", machine: null, tabs: [{ id: "t1" }] },
    { id: "s2", machine: null, tabs: [{ id: "t2" }, { id: "t3" }] },
    { id: "vps/s3", machine: "vps", tabs: [{ id: "vps/t4" }] },
  ];
  const panes = [
    { tab: "t1", cwd: "/p/a/sub" },
    { tab: "t3", cwd: "/p/a" },
    { tab: "vps/t4", cwd: "/p/b" },
  ];
  assert.equal(spaceShowing("/p/a", panes, spaces), spaces[1]);
  assert.equal(spaceShowing("/p/b", panes, spaces), null);
  assert.equal(spaceShowing("/p/c", panes, spaces), null);
});
