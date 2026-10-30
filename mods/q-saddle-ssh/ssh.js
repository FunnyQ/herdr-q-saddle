// SSH targets: the registry herdr-workbench keeps (~/.local/state/herdr-ssh-targets/registry.json).

const REGISTRY_VERSION = 1;
const SEPARATOR = "\x1e";

const words = (line) => line.trim().split(/\s+/).filter(Boolean);

export function hostGroups(config) {
  const groups = config.split("\n").flatMap((line) => {
    const [keyword, ...aliases] = words(line);
    if (keyword?.toLowerCase() !== "host") return [];
    const literal = aliases.filter((a) => !/[*!?]/.test(a));
    return literal.length ? [literal] : [];
  });
  const unique = new Map(groups.map((g) => [g.join(" "), g]));
  return [...unique.keys()].sort().map((k) => unique.get(k));
}

// One process resolves every group: mod JS shares the window's thread.
export const resolveArgs = (config, groups) => [
  "-c",
  `cfg=$1; shift; for h; do out=$(ssh -G -F "$cfg" -- "$h" 2>/dev/null | grep -E '^(hostname|user) ') && printf '${SEPARATOR}%s\\n%s\\n' "$h" "$out"; done`,
  "sh",
  config,
  ...groups.map((g) => g[0]),
];

export function parseResolved(stdout, groups) {
  const resolved = new Map(
    stdout
      .split(SEPARATOR)
      .slice(1)
      .map((chunk) => {
        const [target, ...lines] = chunk.split("\n");
        return [target, lines];
      }),
  );
  return groups.flatMap((aliases) => {
    const lines = resolved.get(aliases[0]);
    if (!lines) return [];
    // ssh -G may repeat a key; the first value wins, as in OpenSSH.
    const first = (key) =>
      lines.map(words).find((w) => w[0] === key)?.[1] ?? "";
    return [
      {
        target: aliases[0],
        hostname: first("hostname"),
        user: first("user"),
        aliases,
      },
    ];
  });
}

export function historyTargets(history) {
  const found = history.split("\n").flatMap((line, index) => {
    const m = /^: (\d+):\d+;(.*)$/.exec(line);
    if (!m) return [];
    const command = m[2].replace(/^TERM=\S* /, "");
    if (!command.startsWith("ssh ")) return [];
    const target = words(command).at(-1);
    return validTarget(target) ? [{ epoch: Number(m[1]), index, target }] : [];
  });
  found.sort((a, b) => b.epoch - a.epoch || b.index - a.index);
  return [...new Set(found.map((f) => f.target))];
}

const manualTarget = () => ({
  source: "manual",
  last_used_at: null,
  hidden: false,
});

export function reconcile(targets, records) {
  const configured = new Set(records.map((r) => r.target));
  const next = Object.fromEntries(
    Object.entries(targets).filter(
      ([key, t]) => t.source !== "config" || configured.has(key),
    ),
  );
  for (const { target, hostname, user, aliases } of records) {
    const old = next[target];
    next[target] = {
      source: "config",
      hostname,
      user,
      aliases,
      last_used_at: old?.last_used_at ?? null,
      hidden: old?.hidden ?? false,
    };
  }
  return next;
}

export const validRegistry = (registry) =>
  registry?.version === REGISTRY_VERSION && Boolean(registry.targets);

export function syncTargets(registry, records, history) {
  const targets = validRegistry(registry)
    ? registry.targets
    : Object.fromEntries(history.map((t) => [t, manualTarget()]));
  return reconcile(targets, records);
}

export const registryJson = (targets) =>
  `${JSON.stringify({ version: REGISTRY_VERSION, targets }, null, 2)}\n`;

export function applyUse(targets, requested, now) {
  const target =
    requested in targets
      ? requested
      : (Object.keys(targets).find((k) =>
          targets[k].aliases?.includes(requested),
        ) ?? requested);
  const { user, hostname } = targetDefaults(target);
  const matching = Object.keys(targets).filter((k) => {
    const t = targets[k];
    return (
      t.source === "config" &&
      t.hostname === hostname &&
      (!user || t.user === user)
    );
  });
  let key = target;
  if (targets[target]?.source !== "config" && matching.length === 1) {
    delete targets[target];
    key = matching[0];
  }
  targets[key] = {
    ...(targets[key] ?? manualTarget()),
    last_used_at: now,
    hidden: false,
  };
}

export function applyRemove(targets, key) {
  if (targets[key]?.source === "config") targets[key].hidden = true;
  else delete targets[key];
}

export function pickerRows(targets, query) {
  const rows = Object.entries(targets)
    .filter(([, t]) => !t.hidden)
    .map(([key, t]) => ({
      key,
      source: t.source,
      aliases: t.aliases ?? [key],
      address:
        t.source === "config" ? `${t.user ?? ""}@${t.hostname ?? ""}` : null,
      used: t.last_used_at ?? null,
    }))
    .filter((r) => matches(r, query))
    .sort(
      (a, b) => (b.used ?? -1) - (a.used ?? -1) || (a.key < b.key ? -1 : 1),
    );
  const typed = query.trim();
  if (validTarget(typed) && !rows.some((r) => r.aliases.includes(typed)))
    rows.push({
      key: typed,
      source: "new",
      aliases: [typed],
      address: null,
      used: null,
    });
  return rows;
}

export function matches(row, query) {
  const q = query.trim().toLowerCase();
  return (
    !q ||
    [...row.aliases, row.address ?? ""].some((s) => s.toLowerCase().includes(q))
  );
}

const validName = (s) => /^[A-Za-z0-9_.-]+$/.test(s);

export const FIELDS = ["alias", "hostname", "user", "port"];

export function fieldError(field, value) {
  if (field === "alias" && !validName(value))
    return `Invalid SSH alias: ${value}`;
  if (field === "hostname" && (!value || /\s/.test(value)))
    return `Invalid HostName: ${value}`;
  if (field === "user" && value && !validName(value))
    return `Invalid SSH user: ${value}`;
  if (
    field === "port" &&
    (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535)
  )
    return `Invalid SSH port: ${value}`;
  return null;
}

export const validTarget = (target) =>
  /^[A-Za-z0-9[\]_.@-]+$/.test(target) && !target.startsWith("-");

// ssh uses the first matching Host block, so a second block with the alias would be dead config.
export const aliasTaken = (config, alias) =>
  hostGroups(config).some((g) => g.includes(alias));

export const renderBlock = ({ alias, hostname, user, port }) =>
  `Host ${alias}\n  HostName ${hostname}\n${user ? `  User ${user}\n` : ""}  Port ${port}\n`;

export function appendBlock(existing, fields) {
  if (!existing) return renderBlock(fields);
  const ended = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${ended}\n${renderBlock(fields)}`;
}

export function targetDefaults(target) {
  const at = target.indexOf("@");
  return at < 0
    ? { hostname: target, user: "" }
    : { hostname: target.slice(at + 1), user: target.slice(0, at) };
}

export const historyLine = (target, epoch) => `: ${epoch}:0;ssh ${target}\n`;

// tab.new runs argv as `zsh -ic '"$@"; exec "$0" -i'`, so a leading exec replaces that shell
// and the tab closes when the command exits. pane.split runs argv directly, where this fails.
export const closingTab = (argv) => ["exec", ...argv];
