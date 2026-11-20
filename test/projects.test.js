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
  hiddenPaths,
  moveProject,
  purgeHidden,
  autoHidden,
  moveCandidate,
  reviewRows,
  parseAliases,
  editProject,
  setHidden,
  removeProject,
  revealIndex,
  PURGE_DAYS,
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

test("splitMatch marks each query letter it finds in order, ignoring case", () => {
  assert.deepEqual(splitMatch("herdr-app", "APP"), [
    ["herdr-", false],
    ["app", true],
  ]);
  assert.deepEqual(splitMatch("herdr-app", " herd "), [
    ["herd", true],
    ["r-app", false],
  ]);
  assert.deepEqual(splitMatch("herdr-q-saddle", "herdrqsaddle"), [
    ["herdr", true],
    ["-", false],
    ["q", true],
    ["-", false],
    ["saddle", true],
  ]);
  assert.deepEqual(splitMatch("herdr-app", "app herd"), [
    ["herd", true],
    ["r-", false],
    ["app", true],
  ]);
  assert.deepEqual(splitMatch("~/Projects/q-lab/saddle", "saddle"), [
    ["~/Projects/q-lab/", false],
    ["saddle", true],
  ]);
  assert.equal(splitMatch("herdr-app", "zzz"), null);
  assert.equal(splitMatch("herdr-app", "ppa"), null);
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

test("matches takes each word as letters in order within one field", () => {
  const row = {
    path: "/Users/q/Projects/q-lab/herdr-q-saddle",
    name: "herdr-q-saddle",
    aliases: ["saddle"],
  };
  assert.ok(matches(row, "herdrqsaddle", "/Users/q"));
  assert.ok(matches(row, "qlab saddle", "/Users/q"));
  assert.ok(!matches(row, "saddleherdr", "/Users/q"));
  assert.ok(!matches(row, "herdr zzz", "/Users/q"));
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

test("spaceShowing finds the space on that machine with a pane in that folder", () => {
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
  assert.equal(spaceShowing("/p/a", panes, spaces, null), spaces[1]);
  assert.equal(spaceShowing("/p/b", panes, spaces, null), null);
  assert.equal(spaceShowing("/p/b", panes, spaces, "vps"), spaces[2]);
  assert.equal(spaceShowing("/p/a", panes, spaces, "vps"), null);
  assert.equal(spaceShowing("/p/c", panes, spaces, null), null);
});

const DAY = 86400;

test("pickerRows leaves out hidden registry paths from the sweep and zoxide", () => {
  const rows = pickerRows([], ["/p/hid", "/p/b"], "/p/hid", ["/p/hid"]);
  assert.deepEqual(
    rows.map((r) => r.path),
    ["/p/b"],
  );
});

test("hiddenPaths lists every hidden registry path", () => {
  assert.deepEqual(
    hiddenPaths({
      projects: {
        "/p/a": { name: "a", hidden: true },
        "/p/b": { name: "b" },
        "/p/c": { name: "c", hidden: true, hidden_at: 1 },
      },
    }),
    ["/p/a", "/p/c"],
  );
});

test("moveProject re-keys the entry, keeps its metadata and unhides it", () => {
  const before = {
    version: 1,
    projects: {
      "/p/old/foo": {
        name: "Foo",
        sources: ["manual"],
        aliases: ["f"],
        hidden: true,
        hidden_at: 5,
        last_used_at: 9,
      },
      "/p/z": { name: "z", sources: [] },
    },
  };
  const after = moveProject(before, "/p/old/foo", "/p/new/foo");
  assert.deepEqual(Object.keys(after.projects), ["/p/new/foo", "/p/z"]);
  assert.deepEqual(after.projects["/p/new/foo"], {
    name: "Foo",
    sources: ["manual"],
    aliases: ["f"],
    last_used_at: 9,
  });
  assert.ok(before.projects["/p/old/foo"]);
});

test("moveProject onto a registered path merges into it", () => {
  const after = moveProject(
    {
      projects: {
        "/p/old/foo": {
          name: "Old",
          sources: ["manual"],
          aliases: ["f", "g"],
          last_used_at: 9,
        },
        "/p/new/foo": {
          name: "New",
          sources: ["claude"],
          aliases: ["g"],
          last_used_at: 3,
        },
      },
    },
    "/p/old/foo",
    "/p/new/foo",
  );
  assert.deepEqual(after.projects, {
    "/p/new/foo": {
      name: "New",
      sources: ["claude"],
      aliases: ["g", "f"],
      last_used_at: 9,
    },
  });
});

test("setHidden with a time hides the entry and stamps hidden_at", () => {
  const after = setHidden(
    { projects: { "/p/a": { name: "a", sources: [], last_used_at: 2 } } },
    "/p/a",
    true,
    100,
  );
  assert.deepEqual(after.projects["/p/a"], {
    name: "a",
    sources: [],
    last_used_at: 2,
    hidden: true,
    hidden_at: 100,
  });
});

test("purgeHidden deletes auto-hidden entries gone for over 7 days", () => {
  const now = 100 * DAY;
  const { registry, changed } = purgeHidden(
    {
      projects: {
        "/p/old": { name: "old", hidden: true, hidden_at: now - 8 * DAY },
        "/p/young": { name: "young", hidden: true, hidden_at: now - 6 * DAY },
        "/p/byhand": { name: "byhand", hidden: true },
        "/p/back": { name: "back", hidden: true, hidden_at: now - 9 * DAY },
        "/v/away": { name: "away", hidden: true, hidden_at: now - 9 * DAY },
      },
    },
    { missing: ["/p/old", "/p/young", "/p/byhand", "/v/away"], gone: ["/p/old", "/p/young", "/p/byhand"] },
    now,
  );
  assert.equal(changed, true);
  assert.deepEqual(registry.projects, {
    "/p/back": { name: "back" },
    "/p/byhand": { name: "byhand", hidden: true },
    "/p/young": { name: "young", hidden: true, hidden_at: now - 6 * DAY },
    "/v/away": { name: "away", hidden: true, hidden_at: now - 9 * DAY },
  });
});

test("purgeHidden reports no change when nothing is due", () => {
  const before = {
    projects: { "/p/a": { name: "a", hidden: true, hidden_at: 10 } },
  };
  const { registry, changed } = purgeHidden(
    before,
    { missing: ["/p/a"], gone: ["/p/a"] },
    10 + DAY,
  );
  assert.equal(changed, false);
  assert.deepEqual(registry, before);
});

test("autoHidden lists only entries hidden with hidden_at", () => {
  assert.deepEqual(
    autoHidden({
      projects: {
        "/p/a": { name: "a", hidden: true, hidden_at: 1 },
        "/p/b": { name: "b", hidden: true },
        "/p/c": { name: "c" },
      },
    }),
    ["/p/a"],
  );
});

test("moveCandidate returns the one other swept folder with the same name", () => {
  assert.equal(
    moveCandidate("/p/old/foo", ["/p/new/foo", "/p/bar"]),
    "/p/new/foo",
  );
  assert.equal(moveCandidate("/p/old/foo", ["/p/a/foo", "/p/b/foo"]), null);
  assert.equal(moveCandidate("/p/old/foo", ["/p/old/foo"]), null);
  assert.equal(moveCandidate("/p/old/foo", ["/p/foobar"]), null);
});

test("reviewRows tags each entry ok, moved or missing, sorted by name", () => {
  const rows = reviewRows(
    {
      projects: {
        "/p/z": { name: "zed", aliases: ["z"] },
        "/p/old/foo": { name: "foo", hidden: true, hidden_at: 4 },
        "/p/gone": { name: "gone" },
      },
    },
    ["/p/old/foo", "/p/gone"],
    ["/p/new/foo"],
  );
  assert.deepEqual(rows, [
    {
      path: "/p/old/foo",
      name: "foo",
      aliases: [],
      hidden: true,
      hiddenAt: 4,
      status: "moved",
      candidate: "/p/new/foo",
    },
    {
      path: "/p/gone",
      name: "gone",
      aliases: [],
      hidden: false,
      hiddenAt: null,
      status: "missing",
      candidate: null,
    },
    {
      path: "/p/z",
      name: "zed",
      aliases: ["z"],
      hidden: false,
      hiddenAt: null,
      status: "ok",
      candidate: null,
    },
  ]);
});

test("parseAliases trims, drops empties and duplicates", () => {
  assert.deepEqual(parseAliases(" a, b ,,a, c "), ["a", "b", "c"]);
  assert.deepEqual(parseAliases("  "), []);
});

test("editProject sets name and aliases, falling back to the folder name", () => {
  const before = {
    projects: { "/p/foo": { name: "foo", sources: [], aliases: ["x"] } },
  };
  assert.deepEqual(
    editProject(before, "/p/foo", { name: " Foo ", aliases: ["y"] }).projects[
      "/p/foo"
    ],
    { name: "Foo", sources: [], aliases: ["y"] },
  );
  assert.deepEqual(
    editProject(before, "/p/foo", { name: "", aliases: [] }).projects["/p/foo"],
    { name: "foo", sources: [] },
  );
});

test("setHidden hides by hand without hidden_at and unhides fully", () => {
  const hidden = setHidden(
    { projects: { "/p/a": { name: "a", hidden: true, hidden_at: 3 } } },
    "/p/a",
    true,
  );
  assert.deepEqual(hidden.projects["/p/a"], { name: "a", hidden: true });
  const shown = setHidden(hidden, "/p/a", false);
  assert.deepEqual(shown.projects["/p/a"], { name: "a" });
});

test("removeProject deletes the entry", () => {
  const after = removeProject(
    { version: 1, projects: { "/p/a": { name: "a" }, "/p/b": { name: "b" } } },
    "/p/a",
  );
  assert.deepEqual(after, { version: 1, projects: { "/p/b": { name: "b" } } });
});

test("moveProject merge leaves out fields neither entry had", () => {
  const after = moveProject(
    {
      projects: {
        "/p/old/foo": { name: "Old", sources: [] },
        "/p/new/foo": { name: "New", sources: [] },
      },
    },
    "/p/old/foo",
    "/p/new/foo",
  );
  assert.deepEqual(after.projects, { "/p/new/foo": { name: "New", sources: [] } });
});

test("reviewRows marks every entry unchecked when the check has not run", () => {
  const rows = reviewRows({ projects: { "/p/a": { name: "a" } } }, null, ["/x/a"]);
  assert.equal(rows[0].status, "unchecked");
  assert.equal(rows[0].candidate, null);
});

test("revealIndex scrolls to a row's group header when it is the first in its group", () => {
  const rows = [{ group: "a" }, { group: "a" }, { group: "b" }];
  assert.equal(revealIndex(rows, 0), 0);
  assert.equal(revealIndex(rows, 1), 2);
  assert.equal(revealIndex(rows, 2), 3);
});

test("PURGE_DAYS is a week", () => {
  assert.equal(PURGE_DAYS, 7);
});
