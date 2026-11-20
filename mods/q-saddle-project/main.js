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
  readTextFile,
  panes,
  spaces,
  focused,
  theme,
  props,
  closeOverlay,
  openOverlay,
  notify,
  run,
  shared,
  setShared,
} from "herdr";
import { readdir } from "fs/promises";
import { expand, on, json, missingOf, writeOn, registrySetup, cacheKey, parseRegistry, updateRegistry } from "./io.js";
import { Review } from "./review.js";
import {
  DEFAULT_MARKERS,
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
  basename,
  hiddenPaths,
  autoHidden,
  purgeHidden,
  setHidden,
  revealIndex,
  PURGE_DAYS,
  moveProject,
  moveCandidate,
} from "./projects.js";
import { isP5, Morph, slab } from "./p5.js";
import { isAwacs, AWACS_ROW, HIT, NO_CONTACT, Lock, lock, diamond, prompt, ticks } from "./awacs.js";
import { ModalFrame, modal, heading, machinePill, searchField, footer as modalFooter, keycap, groupHeader } from "./modal.js";

const OPEN = "q-saddle.project.overlay";
const ROW_HEIGHT = 50;
const SELECTED_EXTRA = 16;
const HEADER_HEIGHT = 28;
const LIST_HEIGHT = 420;
// The spaces sidebar's palette for its theme color names, so a tile matches its space.
const MARK = {
  ansi6: "#22a99a",
  ansi3: "#e3814f",
  ansi4: "#5b8def",
  ansi5: "#8b7cf6",
  ansi2: "#3fae6a",
  ansi1: "#d9649a",
};
const KIND_COLOR = {
  ruby: "ansi1",
  node: "ansi2",
  nuxt: "ansi2",
  vite: "ansi5",
  astro: "ansi5",
  php: "ansi5",
  cargo: "ansi3",
  swift: "ansi3",
  go: "ansi6",
  python: "ansi4",
  dart: "ansi4",
};
const MAIN = "\u{f09d1}  main";

const kindAt = (path, machine) =>
  machine
    ? exec("ls", ["-A", path], { on: machine }).then(
        (r) => (r.code === 0 ? kindOf(r.stdout.split("\n")) : null),
        () => null,
      )
    : readdir(path).then(kindOf, () => null);
const emptyCache = () => ({
  registered: [],
  hidden: [],
  swept: [],
  kinds: {},
  root: null,
  registryFile: null,
  home: null,
});

async function realpath(path, machine) {
  const r = await exec("sh", ["-c", 'cd "$1" && pwd -P', "sh", path], on(machine));
  return r.code === 0 ? r.stdout.trim() : path;
}

export default class Projects extends View {
  init(_props, cx) {
    if (props()?.review) {
      this.review = cx.new(Review, {
        machine: props().machine ?? null,
        overlay: props().overlay,
      });
      return;
    }
    this.frame = cx.new(ModalFrame, {});
    this.morph = cx.new(Morph, {});
    this.lock = cx.new(Lock, {});
    // mod.open stacks a new copy per key press: keep only the newest.
    const mine = props()?.overlay;
    const previous = shared(OPEN);
    if (previous && previous !== mine) closeOverlay(previous);
    if (mine) setShared(OPEN, mine);
    // Like space.new from a key: the focused space's machine.
    this.machine =
      spaces().find((s) => s.id === focused()?.space)?.machine ?? null;
    this.cacheKey = cacheKey(this.machine);
    this.input = InputState.new({ placeholder: "Open a project…" });
    this.input.on("change", (_e, cx) => this.filterChanged(cx));
    this.input.on("submit", (_e, cx) => this.open(cx));
    this.input.focus();
    this.query = "";
    this.at = 0;
    this.scroll = VirtualListScrollHandle.new();
    this.zoxide = null;
    this.pending = null;
    this.opening = false;
    this.asked = 0;
    this.error = null;
    // The last open's rows, drawn at once: reads and the sweep stall while the dialog opens.
    const cache = shared(this.cacheKey);
    Object.assign(this, emptyCache(), { home: this.machine ? null : home() }, cache);
    cx.spawn(async (cx) => {
      try {
        const { config, home: h, registryFile } = await registrySetup(this.machine);
        this.home = h;
        this.registryFile = registryFile;
        this.markers = config.project_markers ?? DEFAULT_MARKERS;
        const saved = await readTextFile(this.registryFile, on(this.machine));
        const registry = parseRegistry(saved);
        this.show(registry);
        cx.notify();
        if (saved) this.show(await this.purged(registry, saved));
        cx.notify();
        this.root = await realpath(
          expand(config.projects_root ?? "~/Projects", this.home),
          this.machine,
        );
      } catch (e) {
        this.error = e.message;
        return cx.notify();
      }
      const found = await exec(
        "find",
        findArgs(this.root, this.markers),
        on(this.machine),
      );
      const { swept, kinds } = projectsIn(
        found.stdout.split("\n"),
        this.markers,
      );
      for (const r of this.registered)
        if (!(r.path in kinds)) kinds[r.path] = await kindAt(r.path, this.machine);
      Object.assign(this, { swept, kinds });
      cx.notify();
      const fresh = Object.fromEntries(
        Object.keys(emptyCache()).map((k) => [k, this[k]]),
      );
      // setShared re-renders every mod, so skip it when nothing changed.
      if (JSON.stringify(fresh) !== JSON.stringify(cache))
        setShared(this.cacheKey, fresh);
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  close() {
    if (shared(OPEN) === props()?.overlay) setShared(OPEN, null);
  }

  show(registry) {
    this.registered = registryRows(registry);
    this.hidden = hiddenPaths(registry);
  }

  async purged(registry, text) {
    const check = await missingOf(autoHidden(registry), this.machine);
    if (!check) return registry;
    const next = purgeHidden(registry, check, Math.floor(Date.now() / 1000));
    if (!next.changed) return registry;
    try {
      await writeOn(this.machine, this.registryFile, json(next.registry), text);
      return next.registry;
    } catch {
      return registry;
    }
  }

  async changeRegistry(change) {
    this.show(await updateRegistry(this.machine, this.registryFile, change));
  }

  rows() {
    return pickerRows(
      this.registered,
      this.swept,
      this.zoxide,
      this.hidden,
    ).filter((r) => matches(r, this.query, this.home));
  }

  filterChanged(cx) {
    this.query = this.input.value();
    this.pending = null;
    this.at = 0;
    this.scroll.scroll_to_item(0);
    this.zoxide = null;
    cx.notify();
    const query = this.query.trim();
    if (query.length < 2) return;
    const asked = ++this.asked;
    cx.spawn(async (cx) => {
      const r = await exec(
        "zoxide",
        ["query", "--", query],
        on(this.machine),
      ).catch(() => null);
      if (asked !== this.asked || r?.code !== 0) return;
      this.zoxide = r.stdout.trim() || null;
      if (this.zoxide && !(this.zoxide in this.kinds))
        this.kinds[this.zoxide] = await kindAt(this.zoxide, this.machine);
      cx.notify();
    });
  }

  open(cx) {
    if (this.pending) return this.move(cx);
    if (this.opening) return;
    const row = this.rows()[this.at];
    if (!row) return;
    const query = this.query;
    this.opening = true;
    cx.spawn(async (cx) => {
      const check = await missingOf([row.path], this.machine);
      this.opening = false;
      if (this.query !== query) return;
      if (check?.missing.length) {
        if (row.group !== "recent" && row.group !== "registered") {
          notify({
            title: `Saddle: ${row.name} is gone`,
            body: `${shortPath(row.path, this.home)} no longer exists.`,
          });
          return;
        }
        const to = moveCandidate(row.path, this.swept);
        if (to) this.pending = { row, to };
        else await this.hide(row);
        return cx.notify();
      }
      this.launch(row);
    });
  }

  move(cx) {
    const { row, to } = this.pending;
    this.pending = null;
    cx.spawn(async () => {
      try {
        await this.changeRegistry((r) => moveProject(r, row.path, to));
      } catch (e) {
        return notify({
          title: "Saddle: project not moved",
          body: e.message,
          level: "warning",
        });
      }
      this.launch({ ...row, path: to });
    });
  }

  async hide(row) {
    const now = Math.floor(Date.now() / 1000);
    try {
      await this.changeRegistry((r) => setHidden(r, row.path, true, now));
      notify({
        title: `Saddle: ${row.name} is gone`,
        body: `${shortPath(row.path, this.home)} no longer exists; hidden, removed in ${PURGE_DAYS} days.`,
      });
    } catch (e) {
      notify({ title: "Saddle: project not hidden", body: e.message, level: "warning" });
    }
    this.at = 0;
    this.scroll.scroll_to_item(0);
  }

  async launch(row) {
    await this.remember(row.path).catch((e) =>
      notify({
        title: "Saddle: project not recorded",
        body: e.message,
        level: "warning",
      }),
    );
    // Closing this overlay hands the keyboard back; open the launcher after so it keeps it.
    this.dismiss();
    const space = spaceShowing(row.path, panes(), spaces(), this.machine);
    if (space) return run("space.select", { id: space.id });
    openOverlay({
      mod: "q-saddle-tab",
      props: {
        direct: true,
        folder: row.path,
        machine: this.machine,
        label: MAIN,
        ...(row.name !== basename(row.path) && { name: row.name }),
      },
      kind: "dialog",
      width: isP5() || isAwacs() ? 620 : 520,
      ...(isP5() || isAwacs() ? { frame: "none" } : {}),
    });
  }

  // As herdr-workbench's `project use`: a folder inside a repo is recorded as the repo.
  async remember(path) {
    const top = await exec("git", ["rev-parse", "--show-toplevel"], {
      cwd: path,
      ...on(this.machine),
    }).catch(() => null);
    const key = top?.code === 0 ? top.stdout.trim() : path;
    const now = Math.floor(Date.now() / 1000);
    await this.changeRegistry((r) => useProject(r, key, now));
  }

  onKey(e, cx) {
    if (e.key === "escape" && this.pending) {
      const { row } = this.pending;
      this.pending = null;
      cx.spawn(async (cx) => {
        await this.hide(row);
        cx.notify();
      });
      cx.stop_propagation();
      return cx.notify();
    }
    if (e.key === "escape") return this.dismiss();
    if (this.pending) return;
    if (e.keystroke === "ctrl-r") {
      this.dismiss();
      return openOverlay({
        mod: "q-saddle-project",
        props: { review: true, machine: this.machine },
        kind: "window",
        key: "q-saddle-review",
        width: 560,
        height: 0.8,
        frame: "none",
      });
    }
    const n = this.rows().length;
    if (!n) return;
    if (e.key === "down") this.at = (this.at + 1) % n;
    else if (e.key === "up") this.at = (this.at + n - 1) % n;
    else return;
    this.reveal();
    cx.stop_propagation();
    cx.notify();
  }

  reveal() {
    this.scroll.scroll_to_item(revealIndex(this.rows(), this.at));
  }

  tile(t, r, space) {
    const box = h_flex()
      .size(30)
      .flex_none()
      .rounded(7)
      .items_center()
      .justify_center();
    if (space) {
      const color = shared("space.colors")?.[space.id] ?? "ansi6";
      return box
        .bg(color.startsWith("#") ? color : (MARK[color] ?? t[color]))
        .text_size(13)
        .font_semibold()
        .text_color("#ffffff")
        .child([...space.name][0]?.toUpperCase() ?? "");
    }
    const kind = this.kinds[r.path];
    if (!kind)
      return box
        .bg(t.raised)
        .child(
          svg("mods/workspace-chrome/folder.svg").size(15).text_color(t.dim),
        );
    const tint = t[KIND_COLOR[kind]] ?? t.foreground;
    return box
      .bg(`${tint.slice(0, 7)}2e`)
      .child(svg(`icons/${kind}.svg`).size(15).text_color(tint));
  }

  status(t, space) {
    const line = h_flex().gap(6).items_center().text_size(11.5);
    const label = (isAwacs()
      ? { working: "WORKING", blocked: "NEEDS YOU", done: "RTB" }
      : { working: "working", blocked: "needs you", done: "done" })[space.status];
    // No spinner: an animation in a virtual list re-runs its JS renderer every frame.
    if (label)
      return line
        .text_color(t[space.status])
        .child(div().size(6).rounded(3).bg(t[space.status]))
        .child(label);
    return line
      .text_color(t.idle)
      .child(div().size(6).rounded(3).border_1().border_color(t.idle))
      .child(isAwacs() ? "STANDBY" : "idle");
  }

  marked(t, el, text) {
    const parts = splitMatch(text, this.query);
    if (!parts) return el.child(text);
    return el.children(
      parts.map(([s, hit]) =>
        hit ? div().text_color(isAwacs() ? HIT : t.accent).font_semibold().child(s) : s,
      ),
    );
  }

  name(t, r) {
    return h_flex()
      .min_w(0)
      .gap(6)
      .items_baseline()
      .child(
        this.marked(t, h_flex().flex_none().text_color(t.foreground), r.name),
      )
      .children(
        r.aliases.map((a) =>
          div().flex_none().text_size(11.5).text_color(t.dim).child(a),
        ),
      );
  }

  row(t, r, i, space, now) {
    const on = i === this.at;
    const p5 = isP5();
    const awacs = isAwacs();
    const neutral = !p5 && !awacs;
    const meta = space
      ? v_flex()
          .flex_none()
          .items_end()
          .gap(3)
          .child(this.status(t, space))
          .when(Boolean(space.branch), (el) =>
            el.child(
              h_flex()
                .gap(4)
                .items_center()
                .text_size(11)
                .text_color(t.dim)
                .child(
                  svg("mods/workspace-chrome/git-branch.svg")
                    .size(11)
                    .text_color(t.dim),
                )
                .child(space.branch),
            ),
          )
      : r.used !== null
        ? div()
            .flex_none()
            .text_size(11.5)
            .text_color(t.dim)
            .child(ago(r.used, now))
        : null;
    return h_flex()
      .h(awacs ? AWACS_ROW : on && p5 ? ROW_HEIGHT + SELECTED_EXTRA : ROW_HEIGHT)
      .px(10)
      .when(awacs, (el) => el.px(12).mx(3).font_weight(500))
      .when(on && p5, (el) => el.pl(24).pr(22).mr(8))
      .gap(12)
      .items_center()
      .rounded(8)
      .when(awacs, (el) => el.rounded(0))
      .cursor_pointer()
      .when(on && neutral, (el) => el.bg(t.selected))
      .when(!on && neutral, (el) => el.hover((s) => s.bg(t.hover)))
      .when(on && p5, (el) => slab(el, this.morph).font_weight(800))
      .when(on && awacs, (el) => lock(el.bg("#6fd6ee1a"), this.lock, i))
      .when(p5, (el) => el.italic())
      .child(awacs ? diamond(on) : this.tile(t, r, space))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .child(this.name(t, r))
          .child(
            this.marked(
              t,
              h_flex()
                .min_w(0)
                .overflow_hidden()
                .text_size(11.5)
                .text_color(t.dim),
              shortPath(r.path, this.home),
            ),
          ),
      )
      .when(meta !== null, (el) => el.child(meta));
  }

  header(group) {
    const label = {
      recent: "Recent",
      registered: "Registered",
      zoxide: "zoxide match",
      found: `In ${shortPath(this.root ?? "", this.home)}`,
    }[group];
    return groupHeader(label, HEADER_HEIGHT);
  }

  body(t, rows) {
    if (this.error) return div().text_color(t.blocked).child(this.error);
    if (this.pending)
      return v_flex()
        .h(ROW_HEIGHT * 2)
        .items_center()
        .justify_center()
        .gap(4)
        .child(
          div()
            .text_color(t.foreground)
            .child(
              `${this.pending.row.name} is gone from ${shortPath(this.pending.row.path, this.home)}`,
            ),
        )
        .child(
          div()
            .text_color(t.muted)
            .child(`Moved to ${shortPath(this.pending.to, this.home)}?`),
        );
    if (!rows.length)
      return v_flex()
        .h(ROW_HEIGHT * 2)
        .items_center()
        .justify_center()
        .gap(4)
        .child(
          div()
            .text_color(t.muted)
            .child(
              this.registryFile
                ? isAwacs()
                  ? NO_CONTACT
                  : "No project matches"
                : "Loading…",
            ),
        )
        .when(
          Boolean(this.registryFile) && this.query.trim().length < 2,
          (el) =>
            el.child(
              div()
                .text_size(11.5)
                .text_color(t.dim)
                .child("Type two letters to ask zoxide too"),
            ),
        );
    const items = withHeaders(rows);
    const sizes = items.map((item) =>
      item.header
        ? HEADER_HEIGHT
        : isAwacs()
          ? AWACS_ROW
          : item.row === this.at && isP5()
            ? ROW_HEIGHT + SELECTED_EXTRA
            : ROW_HEIGHT,
    );
    const height = Math.min(
      LIST_HEIGHT,
      sizes.reduce((a, b) => a + b, 0),
    );
    const shownPanes = panes();
    const shownSpaces = spaces();
    const now = Math.floor(Date.now() / 1000);
    const key = (i) =>
      items[i].header ? `header:${items[i].header}` : rows[items[i].row].path;
    return v_flex()
      .relative()
      .h(height)
      .child(
        v_virtual_list("projects", items.length, sizes, key, (range) =>
          items
            .slice(range.start, range.end)
            .map((item) =>
              item.header
                ? this.header(item.header)
                : this.row(
                    t,
                    rows[item.row],
                    item.row,
                    spaceShowing(
                      rows[item.row].path,
                      shownPanes,
                      shownSpaces,
                      this.machine,
                    ),
                    now,
                  ),
            ),
        )
          .track_scroll(this.scroll)
          .on_item_click((k, cx) => {
            const i = rows.findIndex((r) => r.path === k);
            if (i < 0) return;
            this.at = i;
            this.open(cx);
          }),
      )
      .child(Scrollbar.vertical("projects").absolute().inset_0());
  }

  render() {
    if (this.review) return div().size_full().child(this.review);
    const t = theme();
    const rows = this.rows();
    const p5 = isP5();
    const awacs = isAwacs();
    return modal(v_flex()
      .id("q-saddle-project")
      .on_key_down((e, cx) => this.onKey(e, cx))
      .w_full()
      .p(16)
      .gap(12)
      .bg(t.popover)
      .text_size(13)
      .when(p5 || awacs, (el) => el.child(heading("Projects", "Choose your next target", this.machine, "PROJECTS")))
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
          .map(searchField)
          .child(
            awacs
              ? prompt()
              : svg("mods/workspace-chrome/search.svg")
                  .size(15)
                  .text_color(t.muted),
          )
          .child(
            Input.new(this.input)
              .flex_1()
              .h_full()
              .text_size(14)
              .text_color(t.foreground),
          )
          .when(!p5 && !awacs && Boolean(this.machine), (el) =>
            el.child(machinePill(this.machine)),
          ),
      )
      .child(this.body(t, rows))
      .child(
        h_flex()
          .gap(14)
          .pt(12)
          .when(!p5, (el) => el.border_t(1).border_color(t.border))
          .when(p5, (el) => el.flex_wrap())
          .map(modalFooter)
          .when(Boolean(this.pending), (el) =>
            el.child(keycap("⏎", "move & open")).child(keycap("esc", "hide it")),
          )
          .when(!this.pending, (el) =>
            el
              .child(keycap("↑↓", "select"))
              .child(keycap("⏎", "open"))
              .child(keycap("^R", "review"))
              .child(keycap("esc", "close")),
          )
          .child(awacs ? ticks() : div().flex_1())
          .child(
            div()
              .text_size(11.5)
              .text_color(t.dim)
              .child(rows.length ? `${this.at + 1} of ${rows.length}` : ""),
          ),
      ), this.frame, { title: "projects" });
  }
}
