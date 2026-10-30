// Project registry and folder sweep, ported from herdr-workbench's src/registry/project.rs.

export const DEFAULT_MARKERS = [
  "package.json",
  "Gemfile",
  "Cargo.toml",
  "CLAUDE.md",
];

const PRUNED = [
  "node_modules",
  "vendor",
  "tmp",
  "log",
  "coverage",
  "dist",
  "build",
  ".nuxt",
  ".next",
];

export const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

export function registryRows(registry) {
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return Object.entries(registry.projects ?? {})
    .filter(([, p]) => p.hidden !== true)
    .map(([path, p]) => ({
      path,
      name: p.name,
      aliases: p.aliases ?? [],
      used: p.last_used_at ?? null,
    }))
    .sort((a, b) => (b.used ?? -1) - (a.used ?? -1) || byName(a, b));
}

// One `find` over the root, run outside the app: a readdir per folder runs on the window's
// thread and freezes it for seconds.
export function findArgs(root, markers) {
  const any = (names) =>
    names.flatMap((n, i) => (i ? ["-o", "-name", n] : ["-name", n]));
  return [
    root,
    "(",
    ...any(PRUNED),
    ")",
    "-prune",
    "-o",
    "-name",
    ".git",
    "-prune",
    "-print",
    "-o",
    "(",
    ...any([...markers, ...KINDS.map(([glob]) => glob)]),
    ")",
    "-print",
  ];
}

export function projectsIn(hits, markers) {
  const byDir = new Map();
  for (const hit of hits) {
    if (!hit) continue;
    const dir = hit.slice(0, hit.lastIndexOf("/"));
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(basename(hit));
  }
  const projects = [...byDir.keys()]
    .filter((dir) =>
      byDir.get(dir).some((n) => n === ".git" || markers.includes(n)),
    )
    .sort();
  const swept = projects.filter(
    (dir) => !projects.some((p) => dir.startsWith(`${p}/`)),
  );
  const kinds = Object.fromEntries(
    swept.map((dir) => [dir, kindOf(byDir.get(dir))]),
  );
  return { swept, kinds };
}

export function pickerRows(registered, swept, zoxide) {
  const seen = new Set(registered.map((r) => r.path));
  const extra = (path, group) => ({
    path,
    name: basename(path),
    aliases: [],
    used: null,
    group,
  });
  const rows = registered.map((r) => ({
    ...r,
    group: r.used === null ? "registered" : "recent",
  }));
  if (zoxide && !seen.has(zoxide)) {
    rows.push(extra(zoxide, "zoxide"));
    seen.add(zoxide);
  }
  for (const path of swept)
    if (!seen.has(path)) rows.push(extra(path, "found"));
  return rows;
}

export function withHeaders(rows) {
  const items = [];
  rows.forEach((r, i) => {
    if (r.group !== rows[i - 1]?.group) items.push({ header: r.group });
    items.push({ row: i });
  });
  return items;
}

const KINDS = [
  ["nuxt.config.*", "nuxt"],
  ["next.config.*", "next"],
  ["astro.config.*", "astro"],
  ["vite.config.*", "vite"],
  ["Gemfile", "ruby"],
  ["Cargo.toml", "cargo"],
  ["go.mod", "go"],
  ["pyproject.toml", "python"],
  ["requirements.txt", "python"],
  ["setup.py", "python"],
  ["Package.swift", "swift"],
  ["pubspec.yaml", "dart"],
  ["composer.json", "php"],
  ["deno.json", "deno"],
  ["deno.jsonc", "deno"],
  ["package.json", "node"],
];

const globMatches = (glob, name) =>
  glob.endsWith("*") ? name.startsWith(glob.slice(0, -1)) : name === glob;

export function kindOf(names) {
  for (const [glob, kind] of KINDS)
    if (names.some((n) => globMatches(glob, n))) return kind;
  return null;
}

export function ago(then, now) {
  const s = now - then;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))}mo`;
  return `${Math.floor(s / (365 * 86400))}y`;
}

export function splitMatch(text, query) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return null;
  return [
    text.slice(0, at),
    text.slice(at, at + q.length),
    text.slice(at + q.length),
  ];
}

export function shortPath(path, home) {
  if (path === home) return "~";
  if (path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

export function matches(row, query, home) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [row.name, ...row.aliases, shortPath(row.path, home)]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

export function useProject(registry, path, now) {
  const projects = { ...registry.projects };
  projects[path] = projects[path]
    ? { ...projects[path], last_used_at: now }
    : { name: basename(path), sources: ["manual"], last_used_at: now };
  const sorted = Object.fromEntries(
    Object.keys(projects)
      .sort()
      .map((k) => [k, projects[k]]),
  );
  return { ...registry, projects: sorted };
}

export function spaceShowing(path, panes, spaces) {
  const local = spaces.filter((s) => s.machine === null);
  for (const pane of panes) {
    if (pane.cwd !== path) continue;
    const space = local.find((s) => s.tabs.some((t) => t.id === pane.tab));
    if (space) return space;
  }
  return null;
}
