import { exec, home, appHome, readTextFile, writeTextFile, shared, setShared } from "herdr";
import { writeFile } from "fs/promises";
import { registryRows, hiddenPaths } from "./projects.js";

const CACHE = "q-saddle.project.rows";

export const expand = (path, h) => path.replace(/^~(?=\/|$)/, h);
export const on = (machine) => (machine ? { on: machine } : {});
export const json = (registry) => `${JSON.stringify(registry, null, 2)}\n`;

// One process: a host call per path stalls the window. A missing parent (an unplugged volume) is away, not gone.
export async function missingOf(paths, machine) {
  if (!paths.length) return { missing: [], gone: [] };
  const r = await exec(
    "sh",
    [
      "-c",
      'for p; do [ -d "$p" ] && continue; if [ -d "${p%/*}" ]; then printf "gone\\t%s\\n" "$p"; else printf "away\\t%s\\n" "$p"; fi; done',
      "sh",
      ...paths,
    ],
    on(machine),
  ).catch(() => null);
  if (r?.code !== 0) return null;
  const lines = r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t"));
  return {
    missing: lines.map(([, p]) => p),
    gone: lines.filter(([kind]) => kind === "gone").map(([, p]) => p),
  };
}

async function homeOn(machine) {
  if (!machine) return home();
  const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine });
  if (r.code !== 0 || !r.stdout) throw new Error(`no home on ${machine}`);
  return r.stdout;
}

// writeTextFile writes only here; hc carries the file to another machine.
export async function writeOn(machine, path, next, previous) {
  if (!machine) return writeTextFile(path, next, previous);
  const scratch = `${appHome()}/data/q-lab/q-saddle/registry-write.json`;
  await writeFile(scratch, next);
  const r = await exec("sh", [
    "-c",
    'hc file write --on "$1" "$2" < "$3"',
    "sh",
    machine,
    path,
    scratch,
  ]);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `hc file write: ${r.code}`);
}

export async function registrySetup(machine) {
  const [text, h] = await Promise.all([
    readTextFile(`${appHome()}/data/q-lab/q-saddle/config.json`),
    homeOn(machine),
  ]);
  const config = text ? JSON.parse(text) : {};
  const registryFile = expand(
    config.project_registry_file ?? "~/.local/state/herdr-projects/registry.json",
    h,
  );
  return { config, home: h, registryFile };
}

export const cacheKey = (machine) => (machine ? `${CACHE}.${machine}` : CACHE);

export function patchCache(machine, registry) {
  const cache = shared(cacheKey(machine));
  if (cache)
    setShared(cacheKey(machine), {
      ...cache,
      registered: registryRows(registry),
      hidden: hiddenPaths(registry),
    });
}

export const parseRegistry = (text) => (text ? JSON.parse(text) : { version: 1, projects: {} });

export async function updateRegistry(machine, file, update) {
  const text = await readTextFile(file, on(machine));
  const registry = update(parseRegistry(text));
  await writeOn(machine, file, json(registry), text);
  patchCache(machine, registry);
  return registry;
}
