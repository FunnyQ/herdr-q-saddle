// AWACS look, used only while the awacs layout is shown.
// Mods cannot import across folders, so each q-saddle mod keeps an identical copy.
import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared } from "herdr";

export const isAwacs = () => shared("layout") === "awacs";

export const AWACS_ROW = 38;
export const HIT = "#e8e46a";
export const NO_CONTACT = "NO CONTACT · TRY ANOTHER CALLSIGN";
const IFR = "#6fd6ee";
const CHALK = "#e8f1f5";
const DIM = "#7f9bb0";
const RULE = "#1d3a52";
const RULE_HI = "#2f5a78";

const SNAP_MS = 200;
const SNAP_STEP = 50;
const SNAP_OUT = 4;

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
// SNAP_MS; a view that has not drawn for a while snaps again, which is how a new selection restarts it.
export class Lock extends View {
  init(_props, cx) {
    cx.timer.every(SNAP_STEP, (cx) => {
      if (shared("awacs.motion") !== false && Date.now() - this.since < SNAP_MS)
        cx.notify();
    });
  }

  render() {
    const now = Date.now();
    if (now - (this.drawn ?? 0) > SNAP_MS * 1.5) this.since = now;
    this.drawn = now;
    const still = shared("awacs.motion") === false;
    const age = Math.min(SNAP_MS, now - this.since);
    const out = still ? 0 : Math.round(SNAP_OUT * (1 - age / SNAP_MS));
    return div()
      .size_full()
      .relative()
      .children(brackets(-(3 + out), 10, 1.5, IFR));
  }
}

export const lock = (el, view) =>
  el.relative().child(div().absolute().inset_0().child(view));

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
    .gap(4)
    .child(
      h_flex()
        .items_center()
        .justify_between()
        .child(
          div()
            .text_size(10)
            .font_weight(500)
            .text_color(DIM)
            .child(`OPERATION INFORMATION · ${label}`),
        )
        .child(keycap("ESC", "close")),
    )
    .child(
      div()
        .mt(4)
        .text_size(34)
        .line_height(1.1)
        .font_weight(400)
        .text_color(CHALK)
        .child(title.toUpperCase()),
    )
    .child(
      h_flex()
        .gap(8)
        .items_center()
        .text_size(14)
        .text_color(CHALK)
        .child(div().text_size(18).text_color(DIM).child("["))
        .child(subtitle.toUpperCase())
        .child(div().text_size(18).text_color(DIM).child("]")),
    );

export const field = (el) =>
  el.rounded(0).border_color(RULE_HI).bg("#030a13cc").h(40);

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
            .px(24)
            .pt(22)
            .pb(16)
            .gap(12)
            .bg("#081626f7")
            .border_1()
            .border_color(RULE_HI),
        ),
    )
    .children(brackets(0, 14, 2, "#6fc9dc"));
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
        .bg("#081626f7")
        .border_1()
        .border_color(RULE_HI)
        .children(brackets(0, 14, 2, "#6fc9dc")),
    );
