export const menuLabel = (entry) =>
  entry.icon
    ? `${entry.icon}  ${entry.label ?? entry.name}`
    : (entry.label ?? entry.name);

export const effortsFor = (agent, option) =>
  option?.efforts ?? agent.efforts ?? [];

export function resolveEffort(agent, option, requested) {
  if (!option?.effort) return null;
  return effortsFor(agent, option).includes(requested)
    ? requested
    : option.effort;
}

export function agentArgv(agent, option, effort) {
  const resolved = resolveEffort(agent, option, effort);
  return [
    ...(option?.command ?? agent.command),
    ...(option?.args ?? []),
    ...(resolved
      ? (agent.effort_args ?? []).map((a) => a.replaceAll("{effort}", resolved))
      : []),
    ...(agent.extra_args ?? []),
  ];
}

// pane.split execs argv with no shell around it and closes the pane when it exits, so a command
// hands over to the person's shell. A shell pane gets no argv, and env has nothing to wrap.
export function paneArgv(pane, agentLaunch) {
  const argv =
    pane.type === "agent"
      ? agentLaunch
      : pane.type === "command"
        ? ["sh", "-c", `set -m; ${pane.command}; exec "\${SHELL:-/bin/sh}"`]
        : null;
  const env = Object.entries(pane.env ?? {}).map(([k, v]) => `${k}=${v}`);
  return argv && env.length ? ["env", ...env, ...argv] : argv;
}

// pane.split has no folder argument: a new pane starts where the focused terminal is.
export const inFolder = (folder, argv) => [
  "sh",
  "-c",
  'cd "$1" || exit; shift; [ $# -gt 0 ] || set -- "${SHELL:-/bin/sh}"; exec "$@"',
  "sh",
  folder,
  ...(argv ?? []),
];

export function layoutTree(panes) {
  const replace = (node, name, make) =>
    node.pane
      ? node.pane.name === name
        ? make(node)
        : node
      : {
          ...node,
          first: replace(node.first, name, make),
          second: replace(node.second, name, make),
        };
  let tree = { pane: panes[0] };
  panes.slice(1).forEach((pane, i) => {
    const from = pane.split_from ?? panes[i].name;
    tree = replace(tree, from, (old) => ({
      direction: pane.direction,
      ratio: pane.ratio,
      first: old,
      second: { pane },
    }));
  });
  return tree;
}

const duplicates = (names) => names.filter((n, i) => names.indexOf(n) !== i);

export function validateConfig(config) {
  const errors = [];
  const layouts = config.tab_layouts ?? [];
  const agents = config.agents ?? [];

  for (const n of duplicates(layouts.map((l) => l.name)))
    errors.push(`duplicate tab layout name: ${n}`);
  for (const n of duplicates(agents.map((a) => a.name)))
    errors.push(`duplicate agent name: ${n}`);
  if (
    config.default_tab_layout &&
    !layouts.some((l) => l.name === config.default_tab_layout)
  ) {
    errors.push(
      `default_tab_layout names no tab layout: ${config.default_tab_layout}`,
    );
  }

  for (const agent of agents) {
    const options = agent.options ?? [];
    if (!agent.command?.[0])
      errors.push(`agent '${agent.name}': command is empty`);
    for (const n of duplicates(options.map((o) => o.name)))
      errors.push(`agent '${agent.name}': duplicate option name: ${n}`);
    for (const option of options) {
      const where = `agent '${agent.name}' option '${option.name}'`;
      if (option.efforts && !option.effort)
        errors.push(`${where}: efforts needs a default effort`);
      if (option.effort && !effortsFor(agent, option).includes(option.effort)) {
        errors.push(
          `${where}: effort '${option.effort}' is not one of its efforts`,
        );
      }
      if (option.command && !option.command[0])
        errors.push(`${where}: command override is empty`);
    }
    const usesEffort = agent.efforts?.length || options.some((o) => o.effort);
    if (
      usesEffort &&
      !(agent.effort_args ?? []).some((a) => a.includes("{effort}"))
    ) {
      errors.push(
        `agent '${agent.name}': efforts needs effort_args containing {effort}`,
      );
    }
  }

  for (const layout of layouts) {
    const panes = layout.panes ?? [];
    if (!panes.length)
      errors.push(
        `layout '${layout.name}': declares no panes; the first pane is the tab root`,
      );
    for (const n of duplicates(panes.map((p) => p.name)))
      errors.push(`layout '${layout.name}': duplicate pane name: ${n}`);
    panes.forEach((pane, i) => {
      const where = `layout '${layout.name}' pane '${pane.name}'`;
      if (i === 0) {
        for (const key of ["split_from", "direction", "ratio"]) {
          if (pane[key] !== undefined)
            errors.push(
              `layout '${layout.name}': the root pane '${pane.name}' cannot set ${key}`,
            );
        }
      } else {
        if (
          pane.split_from !== undefined &&
          !panes.slice(0, i).some((p) => p.name === pane.split_from)
        ) {
          errors.push(
            `${where}: split_from names no earlier pane: ${pane.split_from}`,
          );
        }
        if (pane.direction !== "right" && pane.direction !== "down")
          errors.push(`${where}: direction must be "right" or "down"`);
        if (!(
          typeof pane.ratio === "number" &&
          pane.ratio > 0 &&
          pane.ratio < 1
        )) {
          errors.push(
            `${where}: ratio must be between 0 and 1, exclusive: ${pane.ratio}`,
          );
        }
      }
      if (!["agent", "command", "shell"].includes(pane.type))
        errors.push(`${where}: type must be "agent", "command" or "shell"`);
      if (pane.type === "command" && !pane.command?.trim())
        errors.push(`${where}: type = "command" requires command`);
      if (pane.type !== "command" && pane.command !== undefined)
        errors.push(`${where}: command is only valid for type = "command"`);
      for (const key of ["agent", "option"]) {
        if (pane.type !== "agent" && pane[key] !== undefined)
          errors.push(`${where}: ${key} is only valid for type = "agent"`);
      }
      if (pane.option !== undefined && pane.agent === undefined) {
        errors.push(
          `${where}: option requires agent, because an option belongs to one agent: ${pane.option}`,
        );
      }
      if (pane.agent !== undefined) {
        const agent = agents.find((a) => a.name === pane.agent);
        if (!agent)
          errors.push(`${where}: agent names no agent entry: ${pane.agent}`);
        else if (
          pane.option !== undefined &&
          !(agent.options ?? []).some((o) => o.name === pane.option)
        ) {
          errors.push(
            `${where}: agent '${agent.name}' has no option: ${pane.option}`,
          );
        }
      }
    });
  }
  return errors;
}
