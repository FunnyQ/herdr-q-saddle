import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hostGroups,
  parseResolved,
  historyTargets,
  reconcile,
  syncTargets,
  applyUse,
  applyRemove,
  pickerRows,
  matches,
  fieldError,
  closingTab,
  aliasTaken,
  appendBlock,
  targetDefaults,
  historyLine,
  validTarget,
} from "../mods/q-saddle-ssh/ssh.js";

const manual = (last_used_at = null) => ({
  source: "manual",
  last_used_at,
  hidden: false,
});
const configured = (hostname, user, aliases, last_used_at = null) => ({
  source: "config",
  hostname,
  user,
  aliases,
  last_used_at,
  hidden: false,
});

test("hostGroups keeps literal aliases, drops patterns, sorts and dedups", () => {
  const config = `Host *
  ServerAliveInterval 30
Host web1 web-primary
Host !prod
Host staging? *.internal
host api api-primary
Host web1 web-primary
`;
  assert.deepEqual(hostGroups(config), [
    ["api", "api-primary"],
    ["web1", "web-primary"],
  ]);
});

test("parseResolved reads the first hostname and user of each resolved group", () => {
  const stdout =
    "\x1eweb\nhostname first.test\nhostname second.test\nuser deploy\n" +
    "\x1eapi\nuser ops\nhostname api.test\n";
  const groups = [["api", "api-primary"], ["broken"], ["web", "web-alt"]];
  assert.deepEqual(parseResolved(stdout, groups), [
    {
      target: "api",
      hostname: "api.test",
      user: "ops",
      aliases: ["api", "api-primary"],
    },
    {
      target: "web",
      hostname: "first.test",
      user: "deploy",
      aliases: ["web", "web-alt"],
    },
  ]);
});

test("historyTargets parses zsh extended history, most recent first", () => {
  const history = `: 100:0;ssh old
: 400:1;TERM=xterm-256color ssh -p 22 web
: 300:2;ssh deploy@example.com
: 500:0;ssh old
: 600:0;ssh "bad target"
: 550:0;ssh admin@[server]
plain ssh ignored
`;
  assert.deepEqual(historyTargets(history), [
    "admin@[server]",
    "old",
    "web",
    "deploy@example.com",
  ]);
});

test("reconcile drops stale config targets and keeps manual ones", () => {
  const targets = reconcile(
    {
      changed: configured("old.example", "old-user", ["changed"], 10),
      removed: configured("removed.example", "deploy", ["removed"]),
      manual: manual(20),
    },
    [
      {
        target: "changed",
        hostname: "new.example",
        user: "new-user",
        aliases: ["changed", "changed-alt"],
      },
      {
        target: "added",
        hostname: "added.example",
        user: "deploy",
        aliases: ["added"],
      },
    ],
  );
  assert.equal("removed" in targets, false);
  assert.deepEqual(targets.manual, manual(20));
  assert.equal(targets.changed.hostname, "new.example");
  assert.equal(targets.changed.last_used_at, 10);
  assert.deepEqual(
    targets.added,
    configured("added.example", "deploy", ["added"]),
  );
});

test("syncTargets seeds from history only when the registry is absent or invalid, so removed targets stay removed", () => {
  const valid = { version: 1, targets: { kept: manual() } };
  for (const [name, registry, seeded] of [
    ["absent", null, true],
    ["wrong version", { version: 2, targets: {} }, true],
    ["no targets", { version: 1 }, true],
    ["valid", valid, false],
  ]) {
    const targets = syncTargets(registry, [], ["seeded"]);
    assert.equal("seeded" in targets, seeded, name);
    assert.equal("kept" in targets, !seeded, name);
  }
});

test("applyUse resolves an alias and folds a unique manual target into config", () => {
  const targets = {
    server: configured("server.example", "deploy", ["server", "server-alt"]),
    "deploy@server.example": manual(),
  };
  applyUse(targets, "deploy@server.example", 100);
  assert.equal("deploy@server.example" in targets, false);
  assert.equal(targets.server.last_used_at, 100);
  targets.server.hidden = true;
  applyUse(targets, "server-alt", 200);
  assert.equal(targets.server.last_used_at, 200);
  assert.equal(targets.server.hidden, false);
});

test("applyUse keeps the manual target when two config targets match", () => {
  const targets = {
    first: configured("shared.example", "deploy", ["first"]),
    second: configured("shared.example", "deploy", ["second"]),
    "deploy@shared.example": manual(),
  };
  applyUse(targets, "deploy@shared.example", 100);
  assert.equal(targets["deploy@shared.example"].last_used_at, 100);
  assert.equal(targets.first.last_used_at, null);
  assert.equal(targets.second.last_used_at, null);
});

test("applyUse adds a new manual target", () => {
  const targets = {};
  applyUse(targets, "new@example.com", 123);
  assert.deepEqual(targets["new@example.com"], manual(123));
});

test("applyRemove hides config targets, which the next sync would recreate, and deletes manual ones", () => {
  const targets = {
    configured: configured("host", "user", ["configured"]),
    manual: manual(),
  };
  applyRemove(targets, "configured");
  applyRemove(targets, "manual");
  assert.equal(targets.configured.hidden, true);
  assert.equal("manual" in targets, false);
});

test("pickerRows drops hidden, puts used first by recency, then the rest by key", () => {
  const hidden = { ...manual(30), hidden: true };
  const rows = pickerRows({
    "z-used": manual(20),
    config: configured(
      "config.example",
      "deploy",
      ["config", "config-alt"],
      10,
    ),
    "b-never": manual(),
    "a-never": manual(),
    gone: hidden,
  }, "");
  assert.deepEqual(
    rows.map((r) => r.key),
    ["z-used", "config", "a-never", "b-never"],
  );
  assert.deepEqual(rows[1], {
    key: "config",
    source: "config",
    aliases: ["config", "config-alt"],
    address: "deploy@config.example",
    used: 10,
  });
  assert.deepEqual(rows[0], {
    key: "z-used",
    source: "manual",
    aliases: ["z-used"],
    address: null,
    used: 20,
  });
});

test("pickerRows filters by query and offers a typed target no row names", () => {
  const targets = {
    web: configured("web.example", "deploy", ["web", "web-alt"], 10),
    other: manual(5),
  };
  assert.deepEqual(
    pickerRows(targets, "web").map((r) => r.key),
    ["web"],
  );
  assert.deepEqual(
    pickerRows(targets, "web-alt").map((r) => r.key),
    ["web"],
  );
  const typed = pickerRows(targets, "ops@web.example");
  assert.deepEqual(
    typed.map((r) => [r.key, r.source]),
    [["ops@web.example", "new"]],
  );
  assert.deepEqual(
    pickerRows(targets, "-oProxyCommand=x").map((r) => r.key),
    [],
  );
});

test("pickerRows orders rows used at the same time by key", () => {
  assert.deepEqual(
    pickerRows({ b: manual(7), a: manual(7) }, "").map((r) => r.key),
    ["a", "b"],
  );
});

test("matches checks aliases and address, case-insensitively", () => {
  const row = {
    key: "web",
    aliases: ["web", "web-alt"],
    address: "deploy@web.example",
  };
  assert.equal(matches(row, ""), true);
  assert.equal(matches(row, "ALT"), true);
  assert.equal(matches(row, "web.example"), true);
  assert.equal(matches(row, "nope"), false);
});

test("fieldError rejects every bad field", () => {
  for (const [field, value] of [
    ["alias", "myhost"],
    ["hostname", "example.com"],
    ["user", "alice"],
    ["user", ""],
    ["port", "2222"],
  ])
    assert.equal(fieldError(field, value), null, field);
  for (const [field, value, error] of [
    ["alias", "bad alias", "Invalid SSH alias: bad alias"],
    ["alias", "", "Invalid SSH alias: "],
    ["hostname", "", "Invalid HostName: "],
    ["hostname", "bad hostname", "Invalid HostName: bad hostname"],
    ["user", "bad user", "Invalid SSH user: bad user"],
    ["port", "0", "Invalid SSH port: 0"],
    ["port", "65536", "Invalid SSH port: 65536"],
    ["port", "abc", "Invalid SSH port: abc"],
    ["port", "", "Invalid SSH port: "],
    ["port", "+22", "Invalid SSH port: +22"],
    ["port", " 22", "Invalid SSH port:  22"],
  ])
    assert.equal(fieldError(field, value), error, field);
});

test("aliasTaken matches the Host keyword case-insensitively and the alias exactly", () => {
  assert.equal(aliasTaken("hOsT other myhost\n", "myhost"), true);
  assert.equal(aliasTaken("Host MyHost\n", "myhost"), false);
  assert.equal(aliasTaken("  HostName myhost\n", "myhost"), false);
});

test("appendBlock writes the exact bytes for every file and user combination", () => {
  const fields = (user) => ({
    alias: "myhost",
    hostname: "example.com",
    user,
    port: "2222",
  });
  for (const [existing, user, expected] of [
    [
      "",
      "alice",
      "Host myhost\n  HostName example.com\n  User alice\n  Port 2222\n",
    ],
    ["", "", "Host myhost\n  HostName example.com\n  Port 2222\n"],
    [
      "Host old\n",
      "alice",
      "Host old\n\nHost myhost\n  HostName example.com\n  User alice\n  Port 2222\n",
    ],
    [
      "Host old",
      "",
      "Host old\n\nHost myhost\n  HostName example.com\n  Port 2222\n",
    ],
  ])
    assert.equal(appendBlock(existing, fields(user)), expected);
});

test("targetDefaults splits user@host at the first @", () => {
  assert.deepEqual(targetDefaults("alice@example.com"), {
    hostname: "example.com",
    user: "alice",
  });
  assert.deepEqual(targetDefaults("example.com"), {
    hostname: "example.com",
    user: "",
  });
  assert.deepEqual(targetDefaults("a@b@c"), { hostname: "b@c", user: "a" });
});

test("validTarget refuses spaces and anything ssh would read as an option", () => {
  assert.equal(validTarget("admin@[server]"), true);
  assert.equal(validTarget("-oProxyCommand=x"), false);
  assert.equal(validTarget("bad target"), false);
  assert.equal(validTarget(""), false);
});

test("closingTab prefixes exec so tab.new's shell is replaced", () => {
  assert.deepEqual(closingTab(["ssh", "--", "web"]), [
    "exec",
    "ssh",
    "--",
    "web",
  ]);
});

test("historyLine is a zsh extended history entry", () => {
  assert.equal(
    historyLine("user@example.com", 1722222222),
    ": 1722222222:0;ssh user@example.com\n",
  );
});
