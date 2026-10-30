import { View, div, svg } from "gpui-kit";
import {
  v_flex,
  h_flex,
  InputState,
  Input,
  Scrollbar,
  VirtualListScrollHandle,
  v_virtual_list,
} from "gpui-base";
import {
  exec,
  home,
  appHome,
  readTextFile,
  writeTextFile,
  theme,
  props,
  closeOverlay,
  notify,
  run,
  shared,
  setShared,
} from "herdr";
import {
  hostGroups,
  resolveArgs,
  parseResolved,
  historyTargets,
  syncTargets,
  registryJson,
  applyUse,
  applyRemove,
  pickerRows,
  FIELDS,
  fieldError,
  aliasTaken,
  appendBlock,
  renderBlock,
  targetDefaults,
  historyLine,
  validRegistry,
  closingTab,
} from "./ssh.js";

const OPEN = "q-saddle.ssh.overlay";
const CACHE = "q-saddle.ssh.state";
const ROW_HEIGHT = 46;
const LIST_HEIGHT = 414;
const SSH_ICON = "\u{f08a9}";
const LABELS = {
  alias: "Alias",
  hostname: "HostName",
  user: "User",
  port: "Port",
};

const expand = (path) => path.replace(/^~(?=\/|$)/, home());
const now = () => Math.floor(Date.now() / 1000);
const copy = (value) => JSON.parse(JSON.stringify(value));

function ago(then, at) {
  const s = at - then;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)}d`;
  if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))}mo`;
  return `${Math.floor(s / (365 * 86400))}y`;
}

function parseRegistry(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default class Ssh extends View {
  init(_props, cx) {
    // mod.open stacks a new copy per key press: keep only the newest.
    const mine = props()?.overlay;
    const previous = shared(OPEN);
    if (previous && previous !== mine) closeOverlay(previous);
    if (mine) setShared(OPEN, mine);
    this.input = InputState.new({ placeholder: "Connect to…" });
    this.input.on("change", (_e, cx) => this.changed(cx));
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.focus();
    this.field = InputState.new({ placeholder: "server-name" });
    this.field.on("submit", (_e, cx) => this.formNext(cx));
    this.query = "";
    this.at = 0;
    this.scroll = VirtualListScrollHandle.new();
    this.targets = null;
    this.registryText = null;
    this.form = null;
    this.error = null;
    // The last open's state, drawn at once: file reads stall while the dialog opens.
    Object.assign(this, shared(CACHE));
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(
          `${appHome()}/data/q-lab/q-saddle/config.json`,
        );
        const config = text ? JSON.parse(text) : {};
        this.registryFile = expand(
          config.ssh_registry_file ??
            "~/.local/state/herdr-ssh-targets/registry.json",
        );
        this.configFile = expand(config.ssh_config_file ?? "~/.ssh/config");
        this.historyFile = expand(config.ssh_history_file ?? "~/.zsh_history");
        this.registryText = await readTextFile(this.registryFile);
        // Draw the registry at once; resolving the config takes a moment.
        this.targets = parseRegistry(this.registryText)?.targets ?? null;
        cx.notify();
        await this.save(await this.reconciled());
      } catch (e) {
        this.error = e.message;
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

  share() {
    const fresh = {
      targets: this.targets,
      registryText: this.registryText,
      registryFile: this.registryFile,
      configFile: this.configFile,
      historyFile: this.historyFile,
    };
    // setShared re-renders every mod, so skip it when nothing changed.
    if (JSON.stringify(fresh) !== JSON.stringify(shared(CACHE)))
      setShared(CACHE, fresh);
  }

  // As herdr-workbench's `ssh list`: the registry reconciled with the config, not yet saved.
  async reconciled() {
    const config = (await readTextFile(this.configFile)) ?? "";
    const groups = hostGroups(config);
    const resolved = groups.length
      ? await exec("sh", resolveArgs(this.configFile, groups))
      : { stdout: "" };
    const registry = parseRegistry(this.registryText);
    let history = [];
    if (!validRegistry(registry)) {
      const found = await exec("grep", ["-a", "ssh ", this.historyFile]);
      history = historyTargets(found.stdout);
    }
    return syncTargets(registry, parseResolved(resolved.stdout, groups), history);
  }

  async save(targets) {
    const text = registryJson(targets);
    if (text !== this.registryText)
      await writeTextFile(this.registryFile, text, this.registryText);
    this.registryText = text;
    this.targets = targets;
    this.share();
  }

  rows() {
    return pickerRows(this.targets ?? {}, this.query);
  }

  changed(cx) {
    this.query = this.input.value();
    this.at = 0;
    this.scroll.scroll_to_item(0);
    cx.notify();
  }

  submit(cx) {
    const row = this.rows()[this.at];
    if (row) this.connect(row.key, cx);
  }

  connect(target, cx) {
    cx.spawn(async () => {
      try {
        const targets = copy(this.targets ?? {});
        applyUse(targets, target, now());
        await Promise.all([
          this.save(targets),
          exec("sh", [
            "-c",
            'printf %s "$2" >> "$1"',
            "sh",
            this.historyFile,
            historyLine(target, now()),
          ]),
        ]);
      } catch (e) {
        notify({
          title: "Saddle: SSH target not recorded",
          body: e.message,
          level: "warning",
        });
      }
      this.dismiss();
      run("tab.new", {
        name: `${SSH_ICON}  ${target}`,
        argv: closingTab(["ssh", "--", target]),
      });
    });
  }

  remove(cx) {
    const row = this.rows()[this.at];
    if (!row || row.source === "new") return;
    cx.spawn(async (cx) => {
      try {
        const targets = copy(this.targets);
        applyRemove(targets, row.key);
        await this.save(targets);
        this.at = Math.min(this.at, Math.max(0, this.rows().length - 1));
      } catch (e) {
        this.error = e.message;
      }
      cx.notify();
    });
  }

  // As herdr-workbench's `ssh edit`: a config target opens the config in an editor, any other
  // target fills a new Host block.
  edit(cx) {
    const row = this.rows()[this.at];
    if (!row) return;
    if (row.source === "config") {
      this.dismiss();
      return run("tab.new", {
        name: "ssh config",
        argv: closingTab([
          "sh",
          "-c",
          'exec "${VISUAL:-${EDITOR:-nvim}}" "$1"',
          "sh",
          this.configFile,
        ]),
      });
    }
    const { hostname, user } = targetDefaults(row.key);
    this.form = {
      target: row.key,
      step: 0,
      values: { alias: "", hostname, user, port: "22" },
      error: null,
    };
    this.showField(cx);
  }

  showField(cx) {
    const field = FIELDS[this.form.step];
    if (field) this.field.set_value(this.form.values[field]);
    this.field.focus();
    cx.notify();
  }

  formNext(cx) {
    const form = this.form;
    const field = FIELDS[form.step];
    if (!field) return this.addHost(cx);
    const value = this.field.value().trim();
    form.error = fieldError(field, value);
    if (form.error) return cx.notify();
    form.values[field] = value;
    form.step += 1;
    this.showField(cx);
  }

  addHost(cx) {
    const form = this.form;
    cx.spawn(async (cx) => {
      try {
        const config = await readTextFile(this.configFile);
        if (aliasTaken(config ?? "", form.values.alias))
          throw new Error(`SSH alias already exists: ${form.values.alias}`);
        await writeTextFile(
          this.configFile,
          appendBlock(config ?? "", form.values),
          config,
        );
        const targets = await this.reconciled();
        applyUse(targets, form.target, now());
        await this.save(targets);
        notify({ title: `Added SSH config: ${form.values.alias}` });
        this.leaveForm(cx);
      } catch (e) {
        form.error = e.message;
        cx.notify();
      }
    });
  }

  leaveForm(cx) {
    this.form = null;
    this.input.focus();
    cx.notify();
  }

  onKey(e, cx) {
    if (e.keystroke === "escape") {
      if (this.form) return this.leaveForm(cx);
      return this.dismiss();
    }
    if (this.form) return;
    if (e.keystroke === "ctrl-s") {
      cx.stop_propagation();
      return this.edit(cx);
    }
    if (e.keystroke === "ctrl-x") {
      cx.stop_propagation();
      return this.remove(cx);
    }
    const n = this.rows().length;
    if (!n) return;
    if (e.keystroke === "down") this.at = (this.at + 1) % n;
    else if (e.keystroke === "up") this.at = (this.at + n - 1) % n;
    else return;
    this.scroll.scroll_to_item(this.at);
    cx.stop_propagation();
    cx.notify();
  }

  tile(t, r) {
    const box = h_flex()
      .size(30)
      .flex_none()
      .rounded(7)
      .items_center()
      .justify_center()
      .bg(t.raised);
    const icon = {
      config: "mods/workspace-chrome/server.svg",
      manual: "icons/ssh.svg",
      new: "mods/workspace-chrome/plus.svg",
    }[r.source];
    return box.child(
      svg(icon)
        .size(15)
        .text_color(r.source === "config" ? t.accent : t.dim),
    );
  }

  row(t, r, i, at) {
    const on = i === this.at;
    const [name, ...aliases] = r.aliases;
    return h_flex()
      .h(ROW_HEIGHT)
      .px(10)
      .gap(12)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.selected))
      .when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .child(this.tile(t, r))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .child(
            h_flex()
              .gap(6)
              .items_baseline()
              .child(div().flex_none().text_color(t.foreground).child(name))
              .children(
                aliases.map((a) =>
                  div().flex_none().text_size(11.5).text_color(t.dim).child(a),
                ),
              ),
          )
          .child(
            div()
              .truncate()
              .text_size(11.5)
              .text_color(t.dim)
              .child(
                r.source === "new"
                  ? "connect as typed"
                  : (r.address ?? "manual"),
              ),
          ),
      )
      .when(r.used !== null, (el) =>
        el.child(
          div()
            .flex_none()
            .text_size(11.5)
            .text_color(t.dim)
            .child(ago(r.used, at)),
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

  list(t, rows) {
    if (this.error) return div().text_color(t.blocked).child(this.error);
    if (!rows.length)
      return v_flex()
        .h(ROW_HEIGHT * 2)
        .items_center()
        .justify_center()
        .child(
          div()
            .text_color(t.muted)
            .child(this.targets ? "No SSH target matches" : "Loading…"),
        );
    const sizes = rows.map(() => ROW_HEIGHT);
    const at = now();
    return v_flex()
      .relative()
      .h(Math.min(LIST_HEIGHT, rows.length * ROW_HEIGHT))
      .child(
        v_virtual_list(
          "ssh-targets",
          rows.length,
          sizes,
          (i) => rows[i].key,
          (range) =>
            rows
              .slice(range.start, range.end)
              .map((r, k) => this.row(t, r, range.start + k, at)),
        )
          .track_scroll(this.scroll)
          .on_item_click((key, cx) => this.connect(key, cx)),
      )
      .child(Scrollbar.vertical("ssh-targets").absolute().inset_0());
  }

  formBody(t) {
    const { values, step, error } = this.form;
    const preview = !FIELDS[step];
    return v_flex()
      .gap(8)
      .child(
        div()
          .text_color(t.foreground)
          .font_medium()
          .child(
            preview
              ? "Add this host to SSH config?"
              : `Create SSH config · ${LABELS[FIELDS[step]]}`,
          ),
      )
      .child(
        div()
          .p(10)
          .rounded(8)
          .bg(t.background)
          .text_size(12)
          .text_color(t.muted)
          .font_family("monospace")
          .child(
            renderBlock({
              ...values,
              alias: values.alias || "…",
            }).trimEnd(),
          ),
      )
      .when(Boolean(error), (el) =>
        el.child(div().text_size(12).text_color(t.blocked).child(error)),
      );
  }

  render() {
    const t = theme();
    const rows = this.form ? [] : this.rows();
    const preview = this.form && !FIELDS[this.form.step];
    const keys = this.form
      ? [
          ["⏎", preview ? "add" : "next"],
          ["esc", "cancel"],
        ]
      : [
          ["↑↓", "select"],
          ["⏎", "connect"],
          ["^S", "edit"],
          ["^X", "remove"],
          ["esc", "close"],
        ];
    return v_flex()
      .id("q-saddle-ssh")
      .on_key_down((e, cx) => this.onKey(e, cx))
      .w_full()
      .p(16)
      .gap(12)
      .bg(t.popover)
      .text_size(13)
      .child(
        h_flex()
          .h(40)
          .px(12)
          .gap(10)
          .items_center()
          .rounded(10)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .when(preview, (el) => el.opacity(0.4))
          .child(
            svg(
              this.form
                ? "mods/workspace-chrome/square-pen.svg"
                : "mods/workspace-chrome/search.svg",
            )
              .size(15)
              .text_color(t.muted),
          )
          .child(
            Input.new(this.form ? this.field : this.input)
              .flex_1()
              .h_full()
              .text_size(14)
              .text_color(t.foreground),
          ),
      )
      .child(this.form ? this.formBody(t) : this.list(t, rows))
      .child(
        h_flex()
          .gap(14)
          .pt(12)
          .border_t(1)
          .border_color(t.border)
          .children(keys.map(([k, l]) => this.keycap(t, k, l)))
          .child(div().flex_1())
          .child(
            div()
              .text_size(11.5)
              .text_color(t.dim)
              .child(rows.length ? `${this.at + 1} of ${rows.length}` : ""),
          ),
      );
  }
}
