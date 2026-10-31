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
  panes,
  spaces,
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
} from "./projects.js";
import { isP5, slab, keycap as p5Keycap } from "./p5.js";

const OPEN = "q-saddle.project.overlay";
const CACHE = "q-saddle.project.rows";
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

const expand = (path) => path.replace(/^~(?=\/|$)/, home());

const kindAt = (path) => readdir(path).then(kindOf, () => null);
const emptyCache = () => ({
  registered: [],
  swept: [],
  kinds: {},
  root: null,
  registryFile: null,
});

async function realpath(path) {
  const r = await exec("sh", ["-c", 'cd "$1" && pwd -P', "sh", path]);
  return r.code === 0 ? r.stdout.trim() : path;
}

export default class Projects extends View {
  init(_props, cx) {
    // mod.open stacks a new copy per key press: keep only the newest.
    const mine = props()?.overlay;
    const previous = shared(OPEN);
    if (previous && previous !== mine) closeOverlay(previous);
    if (mine) setShared(OPEN, mine);
    this.input = InputState.new({ placeholder: "Open a project…" });
    this.input.on("change", (_e, cx) => this.filterChanged(cx));
    this.input.on("submit", (_e, cx) => this.open(cx));
    this.input.focus();
    this.query = "";
    this.at = 0;
    this.scroll = VirtualListScrollHandle.new();
    this.zoxide = null;
    this.asked = 0;
    this.error = null;
    // The last open's rows, drawn at once: reads and the sweep stall while the dialog opens.
    const cache = shared(CACHE);
    Object.assign(this, emptyCache(), cache);
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(
          `${appHome()}/data/q-lab/q-saddle/config.json`,
        );
        const config = text ? JSON.parse(text) : {};
        this.registryFile = expand(
          config.project_registry_file ??
            "~/.local/state/herdr-projects/registry.json",
        );
        this.markers = config.project_markers ?? DEFAULT_MARKERS;
        const registry = await readTextFile(this.registryFile);
        this.registered = registry ? registryRows(JSON.parse(registry)) : [];
        cx.notify();
        this.root = await realpath(
          expand(config.projects_root ?? "~/Projects"),
        );
      } catch (e) {
        this.error = e.message;
        return cx.notify();
      }
      const found = await exec("find", findArgs(this.root, this.markers));
      const { swept, kinds } = projectsIn(
        found.stdout.split("\n"),
        this.markers,
      );
      for (const r of this.registered)
        if (!(r.path in kinds)) kinds[r.path] = await kindAt(r.path);
      Object.assign(this, { swept, kinds });
      cx.notify();
      const fresh = Object.fromEntries(
        Object.keys(emptyCache()).map((k) => [k, this[k]]),
      );
      // setShared re-renders every mod, so skip it when nothing changed.
      if (JSON.stringify(fresh) !== JSON.stringify(cache))
        setShared(CACHE, fresh);
    });
  }

  dismiss() {
    closeOverlay(props().overlay);
  }

  close() {
    if (shared(OPEN) === props()?.overlay) setShared(OPEN, null);
  }

  rows() {
    const h = home();
    return pickerRows(this.registered, this.swept, this.zoxide).filter((r) =>
      matches(r, this.query, h),
    );
  }

  filterChanged(cx) {
    this.query = this.input.value();
    this.at = 0;
    this.scroll.scroll_to_item(0);
    this.zoxide = null;
    cx.notify();
    const query = this.query.trim();
    if (query.length < 2) return;
    const asked = ++this.asked;
    cx.spawn(async (cx) => {
      const r = await exec("zoxide", ["query", "--", query]).catch(() => null);
      if (asked !== this.asked || r?.code !== 0) return;
      this.zoxide = r.stdout.trim() || null;
      if (this.zoxide && !(this.zoxide in this.kinds))
        this.kinds[this.zoxide] = await kindAt(this.zoxide);
      cx.notify();
    });
  }

  open(cx) {
    const row = this.rows()[this.at];
    if (!row) return;
    cx.spawn(async () => {
      await this.remember(row.path).catch((e) =>
        notify({
          title: "Saddle: project not recorded",
          body: e.message,
          level: "warning",
        }),
      );
      // Closing this overlay hands the keyboard back; open the launcher after so it keeps it.
      this.dismiss();
      const space = spaceShowing(row.path, panes(), spaces());
      if (space) return run("space.select", { id: space.id });
      openOverlay({
        mod: "q-saddle-tab",
        props: {
          direct: true,
          folder: row.path,
          label: MAIN,
          ...(row.name !== basename(row.path) && { name: row.name }),
        },
        kind: "dialog",
        width: 520,
      });
    });
  }

  // As herdr-workbench's `project use`: a folder inside a repo is recorded as the repo.
  async remember(path) {
    const top = await exec("git", ["rev-parse", "--show-toplevel"], {
      cwd: path,
    }).catch(() => null);
    const key = top?.code === 0 ? top.stdout.trim() : path;
    const text = await readTextFile(this.registryFile);
    const registry = text ? JSON.parse(text) : { version: 1, projects: {} };
    const now = Math.floor(Date.now() / 1000);
    const next = `${JSON.stringify(useProject(registry, key, now), null, 2)}\n`;
    await writeTextFile(this.registryFile, next, text);
  }

  onKey(e, cx) {
    if (e.key === "escape") return this.dismiss();
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
    const items = withHeaders(this.rows());
    const i = items.findIndex((item) => item.row === this.at);
    this.scroll.scroll_to_item(items[i - 1]?.header ? i - 1 : i);
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
    const label = { working: "working", blocked: "needs you", done: "done" }[
      space.status
    ];
    // No spinner: an animation in a virtual list re-runs its JS renderer every frame.
    if (label)
      return line
        .text_color(t[space.status])
        .child(div().size(6).rounded(3).bg(t[space.status]))
        .child(label);
    return line
      .text_color(t.idle)
      .child(div().size(6).rounded(3).border_1().border_color(t.idle))
      .child("idle");
  }

  name(t, r) {
    const parts = splitMatch(r.name, this.query);
    return h_flex()
      .min_w(0)
      .gap(6)
      .items_baseline()
      .child(
        parts
          ? h_flex()
              .flex_none()
              .text_color(t.foreground)
              .child(parts[0])
              .child(div().text_color(t.accent).font_semibold().child(parts[1]))
              .child(parts[2])
          : div().flex_none().text_color(t.foreground).child(r.name),
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
      .h(on && p5 ? ROW_HEIGHT + SELECTED_EXTRA : ROW_HEIGHT)
      .px(10)
      .when(on && p5, (el) => el.pl(24).pr(22).mr(8))
      .gap(12)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .when(on && !p5, (el) => el.bg(t.selected))
      .when(!on && !p5, (el) => el.hover((s) => s.bg(t.hover)))
      .when(on && p5, (el) => slab(el).font_weight(800))
      .when(p5, (el) => el.italic())
      .child(this.tile(t, r, space))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(2)
          .child(this.name(t, r))
          .child(
            div()
              .truncate()
              .text_size(11.5)
              .text_color(t.dim)
              .child(shortPath(r.path, home())),
          ),
      )
      .when(meta !== null, (el) => el.child(meta));
  }

  header(t, group) {
    const label = {
      recent: "Recent",
      registered: "Registered",
      zoxide: "zoxide match",
      found: `In ${shortPath(this.root ?? "", home())}`,
    }[group];
    return h_flex()
      .h(HEADER_HEIGHT)
      .px(10)
      .pb(4)
      .items_end()
      .text_size(11.5)
      .font_medium()
      .text_color(t.muted)
      .child(label);
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

  body(t, rows) {
    if (this.error) return div().text_color(t.blocked).child(this.error);
    if (!rows.length)
      return v_flex()
        .h(ROW_HEIGHT * 2)
        .items_center()
        .justify_center()
        .gap(4)
        .child(
          div()
            .text_color(t.muted)
            .child(this.registryFile ? "No project matches" : "Loading…"),
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
                ? this.header(t, item.header)
                : this.row(
                    t,
                    rows[item.row],
                    item.row,
                    spaceShowing(rows[item.row].path, shownPanes, shownSpaces),
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
    const t = theme();
    const rows = this.rows();
    const p5 = isP5();
    const keycap = (k, l) => (p5 ? p5Keycap(k, l) : this.keycap(t, k, l));
    return v_flex()
      .id("q-saddle-project")
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
          .child(
            svg("mods/workspace-chrome/search.svg")
              .size(15)
              .text_color(t.muted),
          )
          .child(
            Input.new(this.input)
              .flex_1()
              .h_full()
              .text_size(14)
              .text_color(t.foreground),
          ),
      )
      .child(this.body(t, rows))
      .child(
        h_flex()
          .gap(14)
          .pt(12)
          .when(!p5, (el) => el.border_t(1).border_color(t.border))
          .child(keycap("↑↓", "select"))
          .child(keycap("⏎", "open"))
          .child(keycap("esc", "close"))
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
