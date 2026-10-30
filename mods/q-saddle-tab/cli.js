#!/usr/bin/env node
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { agentArgv, paneArgv, validateConfig } from "./lib.js";
import { buildTab, herdrDo } from "./build.js";

const USAGE =
  "usage: cli.js open --folder <abs path> [--name <space name>] [--layout <layout name>] [--agent-argv '<json array>']";
const FLAGS = ["--folder", "--name", "--layout", "--agent-argv"];

const fail = (code, message) =>
  Object.assign(new Error(message), { exit: code });

function parseArgs(args) {
  const [command, ...rest] = args;
  if (command !== "open") throw fail(1, USAGE);
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!FLAGS.includes(rest[i]) || rest[i + 1] === undefined)
      throw fail(1, `${rest[i]}: ${USAGE}`);
    flags[rest[i].slice(2)] = rest[i + 1];
  }
  if (!flags.folder?.startsWith("/"))
    throw fail(1, `--folder needs an absolute path: ${USAGE}`);
  if (flags["agent-argv"] !== undefined) {
    let argv;
    try {
      argv = JSON.parse(flags["agent-argv"]);
    } catch {}
    if (
      !Array.isArray(argv) ||
      !argv.length ||
      !argv.every((a) => typeof a === "string")
    )
      throw fail(1, "--agent-argv needs a non-empty JSON array of strings");
    flags["agent-argv"] = argv;
  }
  return flags;
}

async function open(args, io) {
  const flags = parseArgs(args);
  const dataDir = `${io.home}/data/q-lab/q-saddle`;
  let text;
  try {
    text = await io.readFile(`${dataDir}/config.json`, "utf8");
  } catch (e) {
    if (e.code === "ENOENT")
      throw fail(2, `No config at ${dataDir}/config.json`);
    throw e;
  }
  const config = JSON.parse(text);
  const errors = validateConfig(config);
  if (errors.length) throw fail(1, `config.json: ${errors.join("; ")}`);
  const name = flags.layout ?? config.default_tab_layout;
  const layout = config.tab_layouts?.find((l) => l.name === name);
  if (!layout)
    throw fail(2, `no tab layout: ${name ?? "(no default_tab_layout)"}`);

  const agentLaunch = (pane) => {
    if (flags["agent-argv"]) return flags["agent-argv"];
    const agent =
      config.agents?.find((a) => a.name === pane.agent) ?? config.agents?.[0];
    if (!agent) throw fail(1, "config.json has no agents for an agent pane");
    return agentArgv(
      agent,
      agent.options?.find((o) => o.name === pane.option),
      null,
    );
  };
  const { tab, ids, terminals, ratioError } = await buildTab(
    {
      exec: io.exec,
      writeFile: io.writeFile,
      scratch: `${dataDir}/cli-doc-request.json`,
    },
    {
      panes: layout.panes,
      folder: flags.folder,
      argvOf: (pane) =>
        paneArgv(pane, pane.type === "agent" ? agentLaunch(pane) : null),
      ratios: config.apply_ratios !== false,
      open: (argv) =>
        herdrDo(io.exec, "space.new", {
          ...(flags.name && { name: flags.name }),
          folder: flags.folder,
          ...(argv && { argv }),
        }),
    },
  );
  if (ratioError) io.warn?.(`split ratios not applied: ${ratioError.message}`);
  const agent = layout.panes.find((p) => p.type === "agent");
  return {
    space: tab.space,
    tab: tab.tab,
    agent_terminal: agent ? terminals[agent.name] : null,
    panes: ids,
  };
}

export async function main(args, io) {
  try {
    return { code: 0, out: await open(args, io) };
  } catch (e) {
    return { code: e.exit ?? 1, out: { error: e.message } };
  }
}

const exec = (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, { maxBuffer: 64 << 20 }, (err, stdout, stderr) =>
      resolve({
        code: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        stdout,
        stderr: stderr || err?.message || "",
      }),
    ),
  );

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out } = await main(process.argv.slice(2), {
    exec,
    readFile,
    writeFile,
    home: process.env.HERDR_APP_HOME ?? `${homedir()}/.config/herdr-app`,
    warn: (message) => console.error(message),
  });
  console.log(JSON.stringify(out));
  process.exit(code);
}
