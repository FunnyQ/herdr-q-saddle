// AWACS look, used only while the awacs layout is shown.
// Mods cannot import across folders, so each q-saddle mod keeps an identical copy.
import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared } from "herdr";

export const isAwacs = () => shared("layout") === "awacs";

export const AWACS_ROW = 38;
export const HIT = "#1e77b9";
export const NO_CONTACT = "NO CONTACT · TRY ANOTHER CALLSIGN";
const IFR = "#7fe36a";
const CHALK = "#c4f0b4";
const DIM = "#6e9a66";
const RULE = "#213d24";
const RULE_HI = "#3d6340";

const SNAP_MS = 200;
const SNAP_STEP = 50;
const SNAP_OUT = 4;
const BREATH = 2;
const BREATH_MS = 1400;

const CORNERS = [
  ["top", "left"],
  ["top", "right"],
  ["bottom", "left"],
  ["bottom", "right"],
];
export const brackets = (gap, arm, stroke, color) =>
  CORNERS.map(([v, h]) =>
    div()
      .absolute()
      .w(arm)
      .h(arm)
      [v](gap)
      [h](gap)
      [v === "top" ? "border_t" : "border_b"](stroke)
      [h === "left" ? "border_l" : "border_r"](stroke)
      .border_color(color),
  );

// Lock-on brackets 3px outside the selected row. They start 4px further out and settle within
// SNAP_MS, then breathe out and back by BREATH px every BREATH_MS while the row stays selected.
let target;

export class Lock extends View {
  init(_props, cx) {
    cx.timer.every(SNAP_STEP, (cx) => {
      if (shared("awacs.motion") !== false || !this.still) cx.notify();
    });
  }

  render() {
    const now = Date.now();
    if (this.shownFor !== target) {
      this.shownFor = target;
      this.since = now;
    }
    this.still = shared("awacs.motion") === false;
    const age = now - this.since;
    const out = this.still
      ? 0
      : age < SNAP_MS
        ? SNAP_OUT * (1 - age / SNAP_MS)
        : (BREATH * (1 - Math.cos(((age - SNAP_MS) / BREATH_MS) * Math.PI * 2))) / 2;
    return div()
      .size_full()
      .relative()
      .children(brackets(-(3 + out), 10, 1.5, IFR));
  }
}

export const lock = (el, view, key) => {
  target = key;
  return el.relative().child(div().absolute().inset_0().child(view));
};

const paint = (path, color) =>
  globalThis.window.paint_path(path, color).absolute().inset_0();
const DIAMOND = [
  ["50%", 0],
  ["100%", "50%"],
  ["50%", "100%"],
  [0, "50%"],
];

export const diamond = (on) =>
  h_flex()
    .w(20)
    .flex_none()
    .items_center()
    .justify_center()
    .child(
      div()
        .relative()
        .size(11)
        .when(on, (el) =>
          el.child(paint(PathBuilder.fill().add_polygon(DIAMOND).build(), IFR)),
        )
        .child(
          paint(
            PathBuilder.stroke(1.5).add_polygon(DIAMOND, true).build(),
            on ? IFR : DIM,
          ),
        ),
    );

export const prompt = () =>
  div().flex_none().text_size(11).font_weight(500).text_color(IFR).child(">>");

export const keycap = (key, label) =>
  h_flex()
    .gap(8)
    .items_center()
    .child(
      div()
        .h(18)
        .px(5)
        .flex()
        .items_center()
        .border_1()
        .border_color(RULE_HI)
        .text_size(10.5)
        .text_color(CHALK)
        .child(key),
    )
    .child(
      div()
        .text_size(10)
        .font_weight(500)
        .text_color(DIM)
        .child(label.toUpperCase()),
    );

export const ticks = () =>
  h_flex()
    .flex_1()
    .h(9)
    .items_end()
    .overflow_hidden()
    .opacity(0.35)
    .children(
      Array.from({ length: 96 }, (_, i) =>
        div()
          .flex_none()
          .w(8)
          .h(i % 5 === 0 ? 9 : 4)
          .border_l(1)
          .border_color(DIM),
      ),
    );

export const header = (label, title, subtitle) =>
  v_flex()
    .gap(8)
    .pb(10)
    .border_b_1()
    .border_color(RULE)
    .child(
      h_flex()
        .items_center()
        .justify_between()
        .child(
          div()
            .px(6)
            .py(2)
            .text_size(9)
            .font_weight(600)
            .bg("#1e77b9")
            .text_color("#040c06")
            .child(`OPERATION / ${label}`),
        )
        .child(keycap("ESC", "close")),
    )
    .child(
      div()
        .text_size(26)
        .line_height(1.1)
        .font_weight(400)
        .text_color(CHALK)
        .child(title.toUpperCase()),
    )
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .text_size(11.5)
        .text_color(CHALK)
        .child(div().text_size(13).text_color(DIM).child("["))
        .child(subtitle.toUpperCase())
        .child(div().text_size(13).text_color(DIM).child("]")),
    );

export const field = (el) =>
  el.rounded(0).border_color(RULE_HI).bg("#040c06cc").h(36);

export const rule = (el) => el.border_t(1).border_color(RULE).pt(12);

export function panel(content) {
  const viewport = globalThis.window.viewport_size();
  return div()
    .relative()
    .w_full()
    .max_w(Math.max(240, viewport.width - 32))
    .child(
      div()
        .id("awacs-modal")
        .max_h(Math.max(200, viewport.height - 40))
        .overflow_y_scrollbar()
        .child(
          content
            .relative()
            .px(20)
            .pt(18)
            .pb(14)
            .gap(12)
            .bg("#09170cf7")
            .border_1()
            .border_color(RULE_HI),
        ),
    )
    .children(brackets(0, 10, 1, "#7fe36a"));
}

export const frame = (width, height, x, y) =>
  div()
    .size_full()
    .relative()
    .overflow_hidden()
    .child(
      div()
        .absolute()
        .left(-x)
        .top(-y)
        .w(width)
        .h(height)
        .bg("#09170cf7")
        .border_1()
        .border_color(RULE_HI)
        .children(brackets(0, 10, 1, "#7fe36a")),
    );
