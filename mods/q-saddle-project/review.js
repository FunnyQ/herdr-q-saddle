import { View, div } from "gpui-kit";
import {
  v_flex,
  h_flex,
  InputState,
  Input,
  Scrollbar,
  VirtualListScrollHandle,
  v_virtual_list,
} from "gpui-base";
import { readTextFile, theme, notify, shared, closeOverlay } from "herdr";
import {
  reviewRows,
  withHeaders,
  revealIndex,
  PURGE_DAYS,
  matches,
  shortPath,
  moveProject,
  setHidden,
  removeProject,
  editProject,
  parseAliases,
} from "./projects.js";
import { isP5, Morph, slab } from "./p5.js";
import { isAwacs, AWACS_ROW, Lock, lock, diamond, prompt, ticks } from "./awacs.js";
import { ModalFrame, modal, heading, machinePill, searchField, footer as modalFooter, keycap, groupHeader } from "./modal.js";
import { on, missingOf, registrySetup, cacheKey, parseRegistry, updateRegistry } from "./io.js";

const ROW_HEIGHT = 46;
const P5_SELECTED = 62;
const HEADER_HEIGHT = 28;
const DAY = 86400;
const RANK = { attention: 0, hidden: 1, ok: 2, unchecked: 2 };
const GROUP = {
  attention: "Needs attention",
  hidden: "Hidden",
  ok: "OK",
  unchecked: "Projects",
};
const FIELDS = ["filter", "name", "aliases"];

export class Review extends View {
  init({ machine, overlay }, cx) {
    this.machine = machine;
    this.overlay = overlay;
    this.frame = cx.new(ModalFrame, {});
    this.morph = cx.new(Morph, {});
    this.lock = cx.new(Lock, {});
    this.filter = InputState.new({ placeholder: "Filter projects…" });
    this.name = InputState.new({ placeholder: "Folder name" });
    this.aliases = InputState.new({ placeholder: "Comma-separated" });
    this.field = "filter";
    FIELDS.forEach((field) =>
      this[field].on("focus", (_e, cx) => {
        this.field = field;
        cx.notify();
      }),
    );
    this.filter.on("change", (_e, cx) => {
      this.at = 0;
      this.select(false);
      cx.notify();
    });
    this.filter.on("submit", (_e, cx) => this.move(cx));
    this.name.on("submit", (_e, cx) => this.save(cx));
    this.aliases.on("submit", (_e, cx) => this.save(cx));
    this.scroll = VirtualListScrollHandle.new();
    this.at = 0;
    this.registry = null;
    this.base = [];
    this.missing = [];
    this.checked = false;
    this.checking = false;
    this.error = null;
    this.armed = null;
    this.editing = null;
    this.home = null;
    this.swept = shared(cacheKey(machine))?.swept ?? [];
    this.loads = 0;
    this.filter.focus();
    this.load(cx);
  }

  load(cx) {
    const load = ++this.loads;
    this.checking = true;
    cx.spawn(async (cx) => {
      try {
        if (!this.registryFile) {
          const { home, registryFile } = await registrySetup(this.machine);
          this.home = home;
          this.registryFile = registryFile;
        }
        this.registry = parseRegistry(await readTextFile(this.registryFile, on(this.machine)));
        this.error = null;
      } catch (e) {
        this.error = e.message;
        this.checking = false;
        return cx.notify();
      }
      this.refresh();
      this.select(false);
      cx.notify();
      const check = await missingOf(
        Object.keys(this.registry.projects ?? {}),
        this.machine,
      );
      if (load !== this.loads) return;
      this.checking = false;
      this.checked = check !== null;
      this.missing = check?.missing ?? [];
      this.refresh();
      this.select(false);
      cx.notify();
    });
  }

  refresh() {
    this.base = reviewRows(this.registry, this.checked ? this.missing : null, this.swept);
  }

  rows() {
    const query = this.filter.value();
    const group = (r) =>
      r.hidden
        ? "hidden"
        : r.status === "ok" || r.status === "unchecked"
          ? r.status
          : "attention";
    return this.base
      .map((r) => ({ ...r, group: group(r) }))
      .filter((r) => matches(r, query, this.home ?? ""))
      .sort((a, b) => RANK[a.group] - RANK[b.group]);
  }

  selected(rows = this.rows()) {
    return rows[this.at] ?? null;
  }

  select(force, rows) {
    const r = this.selected(rows);
    if (!force && (r?.path ?? null) === this.editing) return;
    this.editing = r?.path ?? null;
    this.armed = null;
    this.name.set_value(r?.name ?? "");
    this.aliases.set_value(r ? r.aliases.join(", ") : "");
  }

  focusOn(field) {
    this.field = field;
    this[field].focus();
  }

  reveal(rows) {
    this.scroll.scroll_to_item(revealIndex(rows, this.at));
  }

  async change(cx, update, failure, follow) {
    try {
      this.registry = await updateRegistry(this.machine, this.registryFile, update);
    } catch (e) {
      return notify({ title: failure, body: e.message, level: "warning" });
    }
    this.refresh();
    const rows = this.rows();
    const i = follow ? rows.findIndex((r) => r.path === follow) : -1;
    this.at = i >= 0 ? i : Math.min(this.at, Math.max(0, rows.length - 1));
    this.select(true, rows);
    cx.notify();
  }

  move(cx) {
    const r = this.selected();
    if (!r?.candidate) return;
    cx.spawn((cx) =>
      this.change(
        cx,
        (reg) => moveProject(reg, r.path, r.candidate),
        "Saddle: project not moved",
        r.candidate,
      ),
    );
  }

  save(cx) {
    const r = this.selected();
    if (!r) return;
    const edit = {
      name: this.name.value(),
      aliases: parseAliases(this.aliases.value()),
    };
    this.focusOn("filter");
    cx.spawn((cx) =>
      this.change(
        cx,
        (reg) => editProject(reg, r.path, edit),
        "Saddle: project not saved",
        r.path,
      ),
    );
  }

  toggleHidden(cx) {
    const r = this.selected();
    if (!r) return;
    cx.spawn((cx) =>
      this.change(
        cx,
        (reg) => setHidden(reg, r.path, !r.hidden),
        "Saddle: project not changed",
        r.path,
      ),
    );
  }

  remove(cx) {
    const r = this.selected();
    if (!r) return;
    if (this.armed !== r.path) {
      this.armed = r.path;
      return cx.notify();
    }
    cx.spawn((cx) =>
      this.change(
        cx,
        (reg) => removeProject(reg, r.path),
        "Saddle: project not removed",
      ),
    );
  }

  onKey(e, cx) {
    const k = e.keystroke;
    const action = {
      "ctrl-s": () => this.save(cx),
      "ctrl-x": () => this.remove(cx),
      "ctrl-u": () => this.toggleHidden(cx),
      "ctrl-r": () => this.load(cx),
    }[k];
    if (action) {
      action();
      return cx.stop_propagation();
    }
    if ((k === "tab" || k === "shift-tab") && this.selected()) {
      const i = FIELDS.indexOf(this.field);
      this.focusOn(FIELDS[(i + (k === "tab" ? 1 : FIELDS.length - 1)) % FIELDS.length]);
      cx.stop_propagation();
      return cx.notify();
    }
    if (k === "escape" && this.field !== "filter") {
      this.select(true);
      this.focusOn("filter");
      cx.stop_propagation();
      return cx.notify();
    }
    if (this.field !== "filter") return;
    if (k === "escape") return closeOverlay(this.overlay);
    const rows = this.rows();
    const n = rows.length;
    if (!n) return;
    if (k === "down") this.at = (this.at + 1) % n;
    else if (k === "up") this.at = (this.at + n - 1) % n;
    else return;
    this.select(false, rows);
    this.reveal(rows);
    cx.stop_propagation();
    cx.notify();
  }

  tagFor(r, now) {
    if (r.hidden && r.hiddenAt !== null && r.status === "ok")
      return ["folder is back", "back"];
    if (r.hidden)
      return r.hiddenAt === null
        ? ["hidden", "dim"]
        : [
            `removed in ${Math.max(0, PURGE_DAYS - Math.floor((now - r.hiddenAt) / DAY))}d`,
            "dim",
          ];
    if (r.status === "moved") return ["moved?", "moved"];
    if (r.status === "missing") return ["missing", "missing"];
    return null;
  }

  tag(t, [label, kind]) {
    const color = { moved: t.ansi3, missing: t.blocked, dim: t.dim, back: t.ansi2 }[kind];
    if (isAwacs())
      return div().flex_none().text_size(9.5).text_color(color).child(label.toUpperCase());
    if (isP5()) {
      const [bg, fg] = {
        moved: ["#ffffff", "#000000"],
        missing: ["#e60012", "#ffffff"],
        dim: ["#333333", "#bbbbbb"],
        back: ["#ffffff", "#000000"],
      }[kind];
      return div()
        .flex_none()
        .px(10)
        .py(3)
        .bg(bg)
        .text_size(10)
        .font_weight(900)
        .text_color(fg)
        .child(label);
    }
    return div()
      .flex_none()
      .px(7)
      .py(2)
      .rounded(5)
      .border_1()
      .border_color(kind === "dim" ? t.border : color)
      .text_size(11)
      .text_color(color)
      .child(label);
  }

  tile(t, r, on) {
    if (isAwacs()) return diamond(on);
    const letter = (r.name[0] ?? "?").toUpperCase();
    if (isP5())
      return h_flex()
        .flex_none()
        .size(30)
        .items_center()
        .justify_center()
        .bg("#ffffff")
        .text_color("#000000")
        .font_weight(900)
        .child(letter);
    const color = r.hidden
      ? t.dim
      : r.status === "moved"
        ? t.ansi3
        : r.status === "missing"
          ? t.blocked
          : t.ansi6;
    return h_flex()
      .flex_none()
      .size(30)
      .rounded(7)
      .items_center()
      .justify_center()
      .bg(`${color.slice(0, 7)}2e`)
      .text_size(13)
      .font_semibold()
      .text_color(color)
      .child(letter);
  }

  row(t, r, i, now) {
    const on = i === this.at;
    const p5 = isP5();
    const awacs = isAwacs();
    const neutral = !p5 && !awacs;
    const tag = this.tagFor(r, now);
    const path =
      r.status === "moved"
        ? `${shortPath(r.path, this.home)} → ${shortPath(r.candidate, this.home)}`
        : shortPath(r.path, this.home);
    const name = div()
      .text_size(awacs ? 13 : 13.5)
      .text_color(r.hidden ? t.dim : t.foreground)
      .truncate()
      .child(awacs ? r.name.toUpperCase() : r.name);
    const where = div().text_size(11.5).text_color(t.dim).truncate().child(path);
    return h_flex()
      .h(awacs ? AWACS_ROW : on && p5 ? P5_SELECTED : ROW_HEIGHT)
      .px(10)
      .gap(12)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .when(awacs, (el) => el.px(12).mx(3).rounded(0).font_weight(500))
      .when(on && p5, (el) => el.pl(24).pr(22).mr(8))
      .when(on && neutral, (el) => el.bg(t.selected))
      .when(!on && neutral, (el) => el.hover((s) => s.bg(t.hover)))
      .when(on && p5, (el) => slab(el, this.morph).font_weight(800))
      .when(on && awacs, (el) => lock(el.bg("#6fd6ee1a"), this.lock, r.path))
      .when(p5, (el) => el.italic())
      .child(this.tile(t, r, on))
      .child(
        awacs
          ? h_flex().flex_1().min_w(0).gap(12).items_baseline().child(name).child(where)
          : v_flex().flex_1().min_w(0).gap(2).child(name).child(where),
      )
      .when(tag !== null, (el) => el.child(this.tag(t, tag)));
  }

  header(group) {
    const label = GROUP[group];
    if (!isP5()) return groupHeader(label, HEADER_HEIGHT);
    return h_flex()
      .h(HEADER_HEIGHT)
      .px(10)
      .pb(4)
      .items_end()
      .text_size(12)
      .font_weight(900)
      .italic()
      .text_color("#e60012")
      .child(label.toUpperCase());
  }

  counts() {
    const of = (test) => this.base.filter(test).length;
    return {
      all: this.base.length,
      moved: of((r) => !r.hidden && r.status === "moved"),
      missing: of((r) => !r.hidden && r.status === "missing"),
      hidden: of((r) => r.hidden),
    };
  }

  title(t) {
    const c = this.counts();
    const summary = [
      [`${c.all} entries`, t.muted],
      ...(c.moved ? [[`${c.moved} moved`, t.ansi3]] : []),
      ...(c.missing ? [[`${c.missing} missing`, t.blocked]] : []),
      ...(c.hidden ? [[`${c.hidden} hidden`, t.muted]] : []),
    ];
    const plain = summary.map(([s]) => s).join(" · ");
    if (isAwacs()) return heading("Registry review", plain, this.machine, "REVIEW");
    if (isP5())
      return v_flex()
        .gap(6)
        .child(heading("Review", "Clean up the registry", this.machine, "REVIEW"))
        .child(
          div().text_size(11).font_weight(800).italic().text_color("#bdbdbd").child(plain.toUpperCase()),
        );
    return v_flex()
      .gap(4)
      .child(
        h_flex()
          .gap(10)
          .items_center()
          .child(div().flex_1().text_size(15).font_weight(600).text_color(t.foreground).child("Review projects"))
          .when(Boolean(this.machine), (el) => el.child(machinePill(this.machine))),
      )
      .child(
        h_flex()
          .flex_wrap()
          .gap(6)
          .text_size(12)
          .children(
            summary.flatMap(([s, color], i) => [
              ...(i ? [div().text_color(t.dim).child("·")] : []),
              div().text_color(color).child(s),
            ]),
          ),
      );
  }

  notice(t) {
    if (this.checking && this.registry)
      return div()
        .text_size(11.5)
        .text_color(t.dim)
        .child(`Checking ${Object.keys(this.registry.projects ?? {}).length} folders…`);
    if (this.registry && !this.checked)
      return div()
        .text_size(11.5)
        .text_color(t.blocked)
        .child(
          `Could not check folders${this.machine ? ` on ${this.machine}` : ""} · ctrl-r to retry`,
        );
    return null;
  }

  body(t, rows) {
    const center = (lines) =>
      v_flex().flex_1().items_center().justify_center().gap(4).children(lines);
    if (this.error) return center([div().text_color(t.blocked).child(this.error)]);
    if (!this.registry) return center([div().text_color(t.muted).child("Loading…")]);
    if (!Object.keys(this.registry.projects ?? {}).length)
      return center([
        div().text_color(t.foreground).child("No projects registered yet"),
        div().text_size(11.5).text_color(t.dim).child("Open one with cmd-o and it shows up here"),
      ]);
    if (!rows.length) return center([div().text_color(t.muted).child("No project matches")]);
    const items = withHeaders(rows);
    const sizes = items.map((item) =>
      item.header
        ? HEADER_HEIGHT
        : isAwacs()
          ? AWACS_ROW
          : item.row === this.at && isP5()
            ? P5_SELECTED
            : ROW_HEIGHT,
    );
    const now = Math.floor(Date.now() / 1000);
    const key = (i) =>
      items[i].header ? `header:${items[i].header}` : rows[items[i].row].path;
    return v_flex()
      .flex_1()
      .min_h(0)
      .relative()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .child(
        v_virtual_list("review", items.length, sizes, key, (range) =>
          items
            .slice(range.start, range.end)
            .map((item) =>
              item.header
                ? this.header(item.header)
                : this.row(t, rows[item.row], item.row, now),
            ),
        )
          .size_full()
          .track_scroll(this.scroll)
          .on_item_click((k, cx) => {
            const i = rows.findIndex((r) => r.path === k);
            if (i < 0) return;
            this.at = i;
            this.select(false, rows);
            cx.notify();
          }),
      )
      .child(Scrollbar.vertical("review").absolute().inset_0());
  }

  input(t, state, field) {
    const focused = this.field === field;
    const p5 = isP5();
    const awacs = isAwacs();
    return h_flex()
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .flex_1()
      .h(32)
      .px(10)
      .items_center()
      .border_1()
      .when(!p5 && !awacs, (el) =>
        el.rounded(8).bg(t.background).border_color(focused ? t.accent : t.border),
      )
      .when(p5, (el) =>
        el.border_2().bg("#171717").border_color(focused ? "#ffffff" : "#555555"),
      )
      .when(awacs, (el) => el.bg("#040c06cc").border_color(focused ? "#7fe36a" : "#3d6340"))
      .child(Input.new(state).flex_1().h_full().text_size(13).text_color(t.foreground));
  }

  button(t, key, label, kind, onClick) {
    const p5 = isP5();
    const awacs = isAwacs();
    const color = { move: t.ansi3, remove: t.blocked, save: t.solid_foreground }[kind] ?? t.foreground;
    return h_flex()
      .id(`review-${label}`)
      .h(28)
      .px(10)
      .gap(8)
      .items_center()
      .cursor_pointer()
      .text_size(awacs ? 11 : 12)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => onClick(cx))
      .when(!p5 && !awacs, (el) =>
        kind === "save"
          ? el.rounded(7).bg(t.solid).text_color(t.solid_foreground).font_weight(600)
          : el.rounded(7).border_1().border_color(kind === "move" ? t.ansi3 : t.border).bg(t.raised).text_color(color),
      )
      .when(p5, (el) =>
        el
          .px(14)
          .font_weight(900)
          .italic()
          .bg(kind === "remove" || kind === "save" ? "#e60012" : "#ffffff")
          .text_color(kind === "remove" || kind === "save" ? "#ffffff" : "#000000"),
      )
      .when(awacs, (el) =>
        el
          .border_1()
          .border_color(kind === "save" ? "#7fe36a" : kind === "move" ? t.ansi3 : "#3d6340")
          .text_color(kind === "save" ? "#7fe36a" : kind === "remove" ? t.blocked : kind === "move" ? t.ansi3 : "#c4f0b4"),
      )
      .child(div().text_size(10.5).opacity(0.8).child(key))
      .child(awacs ? label.toUpperCase() : label);
  }

  editor(t, r) {
    if (!r) return null;
    const awacs = isAwacs();
    const p5 = isP5();
    const label = (s) =>
      div()
        .w(72)
        .flex_none()
        .text_size(awacs ? 10 : 12)
        .text_color(p5 ? "#e60012" : awacs ? "#6e9a66" : t.muted)
        .when(p5, (el) => el.font_weight(900).italic())
        .child(awacs ? s.toUpperCase() : s);
    const moved = r.status === "moved";
    const gone = moved || r.status === "missing";
    return v_flex()
      .gap(10)
      .pt(12)
      .border_t(p5 ? 2 : 1)
      .border_color(p5 ? "#e60012" : awacs ? "#213d24" : t.border)
      .child(
        v_flex()
          .gap(4)
          .child(
            div()
              .text_size(p5 ? 16 : 13.5)
              .font_weight(p5 ? 900 : 600)
              .text_color(t.foreground)
              .when(p5, (el) => el.italic())
              .child(awacs ? r.name.toUpperCase() : r.name),
          )
          .child(
            h_flex()
              .flex_wrap()
              .gap(6)
              .text_size(11.5)
              .text_color(t.dim)
              .child(
                div()
                  .when(gone, (el) => el.line_through().text_color(t.blocked))
                  .child(shortPath(r.path, this.home)),
              )
              .when(moved, (el) =>
                el.child("→").child(div().text_color(t.ansi3).child(shortPath(r.candidate, this.home))),
              ),
          ),
      )
      .child(h_flex().gap(10).items_center().child(label("Name")).child(this.input(t, this.name, "name")))
      .child(h_flex().gap(10).items_center().child(label("Aliases")).child(this.input(t, this.aliases, "aliases")))
      .child(
        h_flex()
          .flex_wrap()
          .gap(8)
          .items_center()
          .when(moved, (el) => el.child(this.button(t, "⏎", "Move here", "move", (cx) => this.move(cx))))
          .child(this.button(t, "^U", r.hidden ? "Unhide" : "Hide", "hide", (cx) => this.toggleHidden(cx)))
          .child(
            this.button(
              t,
              "^X",
              this.armed === r.path ? "Press again to remove" : "Remove",
              "remove",
              (cx) => this.remove(cx),
            ),
          )
          .child(div().flex_1())
          .child(this.button(t, "^S", "Save", "save", (cx) => this.save(cx))),
      );
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const r = this.selected(rows);
    const p5 = isP5();
    const awacs = isAwacs();
    const editing = this.field !== "filter";
    const notice = this.notice(t);
    return modal(
      v_flex()
        .id("q-saddle-review")
        .size_full()
        .on_key_down((e, cx) => this.onKey(e, cx))
        .p(16)
        .gap(12)
        .bg(t.popover)
        .text_size(13)
        .child(this.title(t))
        .child(
          h_flex()
            .h(40)
            .px(12)
            .gap(10)
            .items_center()
            .rounded(10)
            .border_1()
            .border_color(this.field === "filter" ? t.accent : t.border)
            .bg(t.background)
            .map(searchField)
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .when(awacs, (el) => el.child(prompt()))
            .child(Input.new(this.filter).flex_1().h_full().text_size(14).text_color(t.foreground)),
        )
        .when(notice !== null, (el) => el.child(notice))
        .child(this.body(t, rows))
        .when(r !== null, (el) => el.child(this.editor(t, r)))
        .child(
          h_flex()
            .gap(14)
            .pt(12)
            .when(!p5, (el) => el.border_t(1).border_color(t.border))
            .when(p5, (el) => el.flex_wrap())
            .map(modalFooter)
            .when(editing, (el) =>
              el
                .child(keycap("^S", "save"))
                .child(keycap("tab", "next field"))
                .child(keycap("esc", "back to list")),
            )
            .when(!editing, (el) =>
              el
                .child(keycap("↑↓", "select"))
                .child(keycap("tab", "edit"))
                .child(keycap("^R", "refresh"))
                .child(keycap("esc", "close")),
            )
            .child(awacs ? ticks() : div().flex_1())
            .child(
              div()
                .text_size(11.5)
                .text_color(t.dim)
                .child(rows.length ? `${this.at + 1} of ${rows.length}` : ""),
            ),
        ),
      this.frame,
      null,
    );
  }
}
