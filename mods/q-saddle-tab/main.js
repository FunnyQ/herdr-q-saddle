import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  exec,
  appHome,
  readTextFile,
  focused,
  panes,
  terminals,
  theme,
  props,
  closeOverlay,
  notify,
  knownAgents,
  run,
  shared,
  setShared,
} from "herdr";
import { writeFile } from "fs/promises";
import {
  agentArgv,
  effortsFor,
  paneArgv,
  validateConfig,
  layoutTree,
} from "./lib.js";
import { buildTab, herdrDo } from "./build.js";
import { isAgentPane, targetPane, restart } from "./restart.js";
import { isP5, slab, tag, keycap as p5Keycap } from "./p5.js";

const dataDir = () => `${appHome()}/data/q-lab/q-saddle`;

const USAGES = ["\u{f442}  discuss", "\u{f4af}  review", "\u{ead8}  debug"];
const WRITE_OWN = "\u{f19b9}  let me write…";

// Always offered first: what plain tab.new opened before cmd-t opened this launcher.
const BLANK = {
  name: "blank",
  label: "Blank terminal",
  panes: [{ name: "shell", type: "shell" }],
};

const RESTART = {
  name: "restart",
  label: "Restart",
  panes: [{ name: "agent", type: "agent" }],
};
const SAME = "same";

const OPEN = "q-saddle.overlay";

const nameOf = (entry) => entry.label ?? entry.name;

export default class Saddle extends View {
  init(_props, cx) {
    // mod.open stacks a new copy per key press: keep only the newest.
    const mine = props()?.overlay;
    const previous = shared(OPEN);
    if (previous && previous !== mine) closeOverlay(previous);
    if (mine) setShared(OPEN, mine);
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "label for this tab…" });
    this.input.on("submit", (_e, cx) => this.submitText(cx));
    this.errors = [];
    this.programs = [];
    this.history = [];
    this.at = 0;
    cx.spawn(async (cx) => {
      this.programs = await knownAgents().catch(() => []);
      cx.notify();
    });
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${dataDir()}/config.json`);
        if (text === null)
          this.errors = [`No config at ${dataDir()}/config.json`];
        else {
          this.config = JSON.parse(text);
          this.errors = validateConfig(this.config);
        }
      } catch (e) {
        this.errors = [`config.json: ${e.message}`];
      }
      this.handle.focus();
      if (!this.errors.length && props()?.restart) this.startRestartStep();
      else if (!this.errors.length) {
        this.startLayoutStep();
        if (props()?.direct) {
          this.at = Math.max(
            0,
            this.step.rows.findIndex(
              (r) => r.value.name === this.config.default_tab_layout,
            ),
          );
          return this.choose(cx);
        }
      }
      cx.notify();
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  close() {
    if (shared(OPEN) === props()?.overlay) setShared(OPEN, null);
  }

  startLayoutStep() {
    const layouts = [BLANK, ...this.config.tab_layouts];
    this.layout = undefined;
    this.step = {
      kind: "layout",
      title: "Choose a layout",
      rows: layouts.map((l) => ({ label: nameOf(l), value: l })),
    };
    this.at = 0;
  }

  startRestartStep() {
    const argvOf = (terminal) =>
      terminals().find((x) => x.address === terminal)?.argv;
    this.target = targetPane(
      panes(),
      focused(),
      isAgentPane(this.config.agents, argvOf),
    );
    this.layout = undefined;
    this.at = 0;
    if (!this.target) {
      this.errors = ["No agent pane in this tab to restart."];
      return;
    }
    const argv = argvOf(this.target.terminal) ?? [];
    const running = this.config.agents.find((a) => argv.includes(a.command[0]));
    this.step = {
      kind: "restart",
      title: `Restart ${running ? nameOf(running) : this.target.program.name}`,
      rows: [
        { glyph: "\u{f0453}", label: "Same setup", value: SAME },
        ...this.config.agents.map((a) => ({ label: nameOf(a), value: a })),
      ],
    };
  }

  advance(cx) {
    const agentPanes = this.layout.panes.filter((p) => p.type === "agent");
    const qualify = (title, pane) =>
      agentPanes.length > 1 ? `${title} · ${nameOf(pane)}` : title;
    this.at = 0;
    for (const pane of agentPanes) {
      const pick = (this.picks[pane.name] ??= {});
      if (!pick.agent) {
        if (pane.agent)
          pick.agent = this.config.agents.find((a) => a.name === pane.agent);
        else {
          this.step = {
            kind: "harness",
            pane,
            title: qualify("Choose a harness", pane),
            rows: this.config.agents.map((a) => ({
              label: nameOf(a),
              value: a,
            })),
          };
          return cx.notify();
        }
      }
      const options = pick.agent.options ?? [];
      if (pick.option === undefined) {
        if (pane.option)
          pick.option = options.find((o) => o.name === pane.option);
        else if (!options.length) pick.option = null;
        else {
          const rows = options.map((o) => ({
            label: o.name,
            value: o,
            efforts: o.effort ? effortsFor(pick.agent, o) : [],
            effort: o.effort,
          }));
          this.step = {
            kind: "model",
            pane,
            title: qualify("Choose a model", pane),
            rows,
          };
          return cx.notify();
        }
        pick.effort = pick.option?.effort ?? null;
      }
    }
    if (this.label === undefined) {
      if (this.layout.tab_label) this.label = this.layout.tab_label;
      else if (agentPanes.length) {
        this.step = {
          kind: "usage",
          title: "What is this tab for?",
          rows: [...USAGES, WRITE_OWN].map((u) => {
            const [glyph, label] = u.split("  ");
            return { glyph, label, value: u };
          }),
        };
        return cx.notify();
      } else
        return this.askText(cx, nameOf(this.layout).replace(/…$/, "").trim());
    }
    this.startLaunch(cx);
  }

  startLaunch(cx) {
    this.launchHeight = Math.max(1, this.step?.rows.length ?? 1) * 40 - 2;
    this.step = {
      kind: "launching",
      title: this.target ? "Restarting…" : `Opening ${nameOf(this.layout)}…`,
      rows: [],
    };
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.launch();
        this.dismiss();
      } catch (e) {
        this.errors = [e.message];
        cx.notify();
      }
    });
  }

  askText(cx, fallback) {
    this.step = { kind: "text", title: "Name this tab", fallback, rows: [] };
    this.input.set_value("");
    this.input.focus();
    cx.notify();
  }

  submitText(cx) {
    const text = this.input.value().trim();
    if (!text && !this.step.fallback) return;
    this.label = text || this.step.fallback;
    this.advance(cx);
  }

  remember() {
    const picks = Object.fromEntries(
      Object.entries(this.picks ?? {}).map(([k, v]) => [k, { ...v }]),
    );
    this.history.push({
      layout: this.layout,
      picks,
      label: this.label,
      at: this.at,
    });
  }

  back(cx) {
    const last = this.history.pop();
    if (!last) return;
    if (!last.layout)
      this.target ? this.startRestartStep() : this.startLayoutStep();
    else {
      Object.assign(this, {
        layout: last.layout,
        picks: last.picks,
        label: last.label,
      });
      this.advance(cx);
    }
    this.at = last.at;
    cx.notify();
  }

  choose(cx) {
    const row = this.step.rows[this.at];
    if (!row) return;
    const { kind, pane } = this.step;
    this.remember();
    if (row.value === BLANK) {
      this.dismiss();
      return run("tab.new");
    }
    if (kind === "layout") {
      this.layout = row.value;
      this.picks = {};
      this.label = props()?.label;
    } else if (kind === "restart") {
      if (row.value === SAME) return this.startLaunch(cx);
      this.layout = RESTART;
      this.picks = { [RESTART.panes[0].name]: { agent: row.value } };
      this.label = null;
    } else if (kind === "harness") this.picks[pane.name].agent = row.value;
    else if (kind === "model") {
      this.picks[pane.name].option = row.value;
      this.picks[pane.name].effort = row.effort ?? null;
    } else if (kind === "usage") {
      if (row.value === WRITE_OWN) return this.askText(cx, null);
      this.label = row.value;
    }
    this.advance(cx);
  }

  async launch() {
    const io = { exec, writeFile, scratch: `${dataDir()}/doc-request.json` };
    if (this.target) {
      const pick = this.layout && this.picks[RESTART.panes[0].name];
      return restart(
        io,
        this.target.terminal,
        pick ? agentArgv(pick.agent, pick.option, pick.effort) : null,
      );
    }
    const here = focused();
    const project = props()?.folder;
    let folder = project ?? here?.cwd;
    if (folder && !project) {
      const top = await exec("git", ["rev-parse", "--show-toplevel"], {
        cwd: folder,
      }).catch(() => null);
      if (top?.code === 0) folder = top.stdout.trim();
    }
    const argvOf = (pane) => {
      const pick = this.picks[pane.name];
      return paneArgv(
        pane,
        pick ? agentArgv(pick.agent, pick.option, pick.effort) : null,
      );
    };
    const { ids, ratioError } = await buildTab(io, {
      panes: this.layout.panes,
      folder,
      argvOf,
      ratios: this.config.apply_ratios !== false,
      open: (argv) =>
        project
          ? herdrDo(exec, "space.new", {
              ...(props().name && { name: props().name }),
              tab: this.label,
              folder,
              ...(argv && { argv }),
            })
          : herdrDo(exec, "tab.new", {
              name: this.label,
              space: here?.space,
              folder,
              ...(argv && { argv }),
            }),
    });
    if (ratioError) {
      notify({
        title: "Saddle: split ratios not applied",
        body: ratioError.message,
        level: "warning",
      });
    }
    await herdrDo(exec, "pane.focus", { pane: ids[this.layout.panes[0].name] });
  }

  onKey(e, cx) {
    const step = this.step;
    // Closing the overlay cancels its tasks, which would leave a half-built tab.
    if (step?.kind === "launching") return;
    if (e.key === "escape") return this.dismiss();
    if (!step || step.kind === "text") return;
    const n = step.rows.length;
    const row = step.rows[this.at];
    const plain =
      !e.modifiers.control && !e.modifiers.platform && !e.modifiers.alt;
    if (e.key === "down") this.at = (this.at + 1) % n;
    else if (e.key === "up") this.at = (this.at + n - 1) % n;
    else if (e.key === "enter") return this.choose(cx);
    else if (e.key === "backspace") return this.back(cx);
    else if (plain && /^[1-9]$/.test(e.key) && Number(e.key) <= n) {
      this.at = Number(e.key) - 1;
      return this.choose(cx);
    } else if (
      (e.key === "left" || e.key === "right") &&
      row?.efforts?.length
    ) {
      const i = row.efforts.indexOf(row.effort) + (e.key === "right" ? 1 : -1);
      row.effort =
        row.efforts[Math.min(row.efforts.length - 1, Math.max(0, i))];
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  trail() {
    if (!this.layout) return [];
    const parts = [nameOf(this.layout)];
    for (const pane of this.layout.panes.filter((p) => p.type === "agent")) {
      const pick = this.picks?.[pane.name];
      if (pick?.agent) parts.push(nameOf(pick.agent));
      if (pick?.option)
        parts.push(
          pick.effort
            ? `${pick.option.name} · ${pick.effort}`
            : pick.option.name,
        );
    }
    if (this.label) parts.push(this.label);
    return parts;
  }

  programFor(agent) {
    return this.programs.find(
      (p) => p.run?.[0] === agent.command?.[0] || p.key === agent.kind,
    );
  }

  agentIcon(t, agent) {
    const p = this.programFor(agent);
    const tile = h_flex()
      .size(24)
      .flex_none()
      .rounded(6)
      .items_center()
      .justify_center()
      .bg(p?.tile ?? t.raised);
    if (!p?.icon)
      return tile
        .text_size(12)
        .font_semibold()
        .text_color(t.foreground)
        .child([...nameOf(agent)][0].toUpperCase());
    return tile.child(
      p.tint
        ? svg(p.icon)
            .size(15)
            .text_color(p.color ?? (p.tile ? "#ffffff" : t.foreground))
        : image(p.icon).size(15),
    );
  }

  preview(t, node, w, h) {
    const gap = 2;
    if (node.pane) {
      const leaf = div().w(w).h(h).flex_none().rounded(2);
      if (node.pane.type === "agent") return leaf.bg(t.accent);
      if (node.pane.type === "command")
        return leaf.border_1().border_color(t.ansi6);
      return leaf.border_1().border_dashed().border_color(t.muted);
    }
    const right = node.direction === "right";
    const span = (right ? w : h) - gap;
    const second = Math.min(
      span - 5,
      Math.max(5, Math.round(span * node.ratio)),
    );
    const first = span - second;
    return (right ? h_flex() : v_flex())
      .flex_none()
      .gap(gap)
      .child(
        right
          ? this.preview(t, node.first, first, h)
          : this.preview(t, node.first, w, first),
      )
      .child(
        right
          ? this.preview(t, node.second, second, h)
          : this.preview(t, node.second, w, second),
      );
  }

  efforts(t, row, i) {
    return h_flex()
      .gap(2)
      .p(2)
      .rounded(6)
      .bg(t.background)
      .children(
        row.efforts.map((e) => {
          const on = e === row.effort;
          return div()
            .id(`effort-${i}-${e}`)
            .px(7)
            .h(20)
            .flex()
            .items_center()
            .rounded(4)
            .text_size(11)
            .cursor_pointer()
            .when(on, (el) =>
              el
                .bg(i === this.at ? t.accent : t.raised)
                .text_color(i === this.at ? t.accent_foreground : t.foreground),
            )
            .when(!on, (el) =>
              el.text_color(t.dim).hover((s) => s.text_color(t.foreground)),
            )
            .on_click((_e, cx) => {
              row.effort = e;
              this.at = i;
              cx.stop_propagation();
              cx.notify();
            })
            .child(e);
        }),
      );
  }

  row(t, r, i) {
    const kind = this.step.kind;
    const on = i === this.at;
    let lead = h_flex().w(44).flex_none().justify_center();
    const harness =
      kind === "harness" || (kind === "restart" && r.value !== SAME);
    if (kind === "layout")
      lead = lead.child(this.preview(t, layoutTree(r.value.panes), 40, 26));
    else if (harness) lead = lead.child(this.agentIcon(t, r.value));
    else if (r.glyph)
      lead = lead.child(div().text_size(14).text_color(t.muted).child(r.glyph));
    const missing = harness && this.programFor(r.value)?.installed === false;
    const p5 = isP5();
    const label = p5 ? r.label.toUpperCase() : r.label;
    return h_flex()
      .id(`row-${i}`)
      .h(on && p5 ? 54 : 38)
      .px(10)
      .when(on && p5, (el) => el.pl(24).pr(22))
      .gap(12)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .when(on && !p5, (el) => el.bg(t.selected))
      .when(!on && !p5, (el) => el.hover((s) => s.bg(t.hover)))
      .when(on && p5, (el) => slab(el).font_weight(800))
      .when(p5, (el) => el.italic())
      .on_click((_e, cx) => {
        this.at = i;
        this.choose(cx);
      })
      .child(lead)
      .child(
        div()
          .flex_1()
          .truncate()
          .text_color(
            missing ? t.dim : p5 ? (on ? "#ffffff" : "#bdbdbd") : t.foreground,
          )
          .child(label),
      )
      .when(missing, (el) =>
        el.child(div().text_size(11).text_color(t.dim).child("not installed")),
      )
      .when(r.efforts?.length > 0, (el) => el.child(this.efforts(t, r, i)))
      .when(i < 9, (el) =>
        el.child(
          div()
            .w(14)
            .flex_none()
            .text_size(12)
            .text_color(on ? t.foreground : t.muted)
            .child(String(i + 1)),
        ),
      );
  }

  keycap(t, key, label) {
    return h_flex()
      .gap(5)
      .items_center()
      .child(
        div()
          .px(5)
          .h(18)
          .flex()
          .items_center()
          .rounded(4)
          .border_1()
          .border_color(t.border)
          .bg(t.raised)
          .text_size(10.5)
          .text_color(t.foreground)
          .child(key),
      )
      .child(div().text_size(11.5).text_color(t.muted).child(label));
  }

  footer(t) {
    const kind = this.step?.kind;
    const keys = [];
    if (
      !this.errors.length &&
      kind !== "text" &&
      kind !== "launching" &&
      this.step
    ) {
      keys.push(["↑↓", "select"], ["1–9", "pick"], ["⏎", "choose"]);
      if (kind === "model" && this.step.rows.some((r) => r.efforts.length))
        keys.push(["←→", "effort"]);
      if (this.history.length) keys.push(["⌫", "back"]);
    }
    if (kind === "text") keys.push(["⏎", "open"]);
    if (kind !== "launching") keys.push(["esc", "close"]);
    if (isP5())
      return h_flex()
        .gap(14)
        .pt(12)
        .children(keys.map(([k, l]) => p5Keycap(k, l)));
    return h_flex()
      .gap(14)
      .pt(12)
      .border_t(1)
      .border_color(t.border)
      .children(keys.map(([k, l]) => this.keycap(t, k, l)));
  }

  body(t) {
    const step = this.step;
    if (this.errors.length)
      return v_flex()
        .gap(4)
        .children(
          this.errors.map((m, i) =>
            div().id(`err-${i}`).text_color(t.blocked).child(m),
          ),
        );
    if (!step) return div().h(34);
    if (step.kind === "launching") {
      return h_flex()
        .h(this.launchHeight)
        .gap(10)
        .items_center()
        .justify_center()
        .child(
          svg("mods/workspace-chrome/spinner.svg")
            .size(16)
            .text_color(t.accent)
            .spin(900),
        )
        .child(div().text_color(t.muted).child("Starting panes"));
    }
    if (step.kind === "text") {
      return h_flex()
        .h(36)
        .px(10)
        .items_center()
        .rounded(8)
        .border_1()
        .border_color(t.accent)
        .bg(t.background)
        .child(
          Input.new(this.input).flex_1().h_full().text_color(t.foreground),
        );
    }
    return v_flex()
      .gap(2)
      .children(step.rows.map((r, i) => this.row(t, r, i)));
  }

  render() {
    const t = theme();
    const trail = this.trail();
    const title = this.errors.length
      ? "Saddle"
      : (this.step?.title ?? "Loading…");
    const p5 = isP5();
    return v_flex()
      .id("q-saddle-tab")
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.onKey(e, cx))
      .w_full()
      .p(16)
      .gap(12)
      .bg(t.popover)
      .text_size(13)
      .child(
        v_flex()
          .gap(4)
          .child(
            h_flex()
              .h(16)
              .gap(6)
              .text_size(11.5)
              .when(p5, (el) => el.italic().font_weight(800))
              .when(!trail.length, (el) =>
                el
                  .text_color(t.dim)
                  .child(
                    p5
                      ? (props()?.restart ? "Restart agent" : "New tab").toUpperCase()
                      : props()?.restart
                        ? "Restart agent"
                        : "New tab",
                  ),
              )
              .children(
                trail.flatMap((part, i) => [
                  ...(i ? [div().text_color(t.dim).child("›")] : []),
                  div()
                    .text_color(t.muted)
                    .child(p5 ? part.toUpperCase() : part),
                ]),
              ),
          )
          .child(
            p5
              ? tag(title)
              : div()
                  .text_size(16)
                  .font_semibold()
                  .text_color(t.foreground)
                  .child(title),
          ),
      )
      .child(this.body(t))
      .child(this.footer(t));
  }
}
