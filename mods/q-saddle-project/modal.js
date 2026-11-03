import { View, div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { isP5 } from "./p5.js";
import { shared, theme } from "herdr";
import { sprite } from "./sprite.js";

const paint = (shape, color, stroke = 0) => globalThis.window
  .paint_path((stroke ? PathBuilder.stroke(stroke) : PathBuilder.fill()).add_polygon(shape, true).build(), color)
  .absolute().inset_0();

const MORPH_STEP = 300;
const pull = (now, corner) => {
  const value = Math.sin((Math.floor(now / MORPH_STEP) * 8 + corner) * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const panel = (now) => [
  [`${1.5 + 0.8 * pull(now, 0)}%`, `${2 + 0.8 * pull(now, 1)}%`],
  [`${98 - 0.8 * pull(now, 2)}%`, `${0.8 * pull(now, 3)}%`],
  [`${100 - 0.8 * pull(now, 4)}%`, `${98 - 0.8 * pull(now, 5)}%`],
  [`${0.8 * pull(now, 6)}%`, `${100 - 0.8 * pull(now, 7)}%`],
];

export class ModalFrame extends View {
  init(_props, cx) {
    this.tick(cx);
  }

  tick(cx) {
    cx.timer.after(MORPH_STEP - (Date.now() % MORPH_STEP) + 10, (cx) => {
      if (isP5() && (shared("p5.motion") !== false || !this.still)) cx.notify();
      this.tick(cx);
    });
  }

  render() {
    this.still = shared("p5.motion") === false;
    const now = this.still ? 0 : Date.now();
    return div().relative().size_full()
      .child(div().absolute().top(10).left(7).right(27).bottom(25).child(paint(panel(this.still ? 0 : now - MORPH_STEP * 3), "#00e5ffb3")))
      .child(div().absolute().top(25).left(26).right(5).bottom(7).child(paint(panel(this.still ? 0 : now - MORPH_STEP * 6), "#ff1a8cb3")))
      .child(div().absolute().inset(18).child(paint(panel(now), "#080808")).child(paint(panel(now), "#ffffff", 3)));
  }
}

export function titleBadge(kind) {
  return sprite(kind, 260);
}

export function modal(content, frame, badge) {
  if (!isP5()) return content.rounded(12).border_1().border_color(theme().border);
  const viewport = globalThis.window.viewport_size();
  return div().id("p5-modal").relative().w_full().p(18).pl(badge ? 38 : 18).pt(badge ? 88 : 18)
    .max_w(Math.max(240, viewport.width - 32))
    .max_h(Math.max(200, viewport.height - 40)).overflow_y_scrollbar()
    .child(div().absolute().top(badge ? 48 : 0).left(badge ? 20 : 0).right(0).bottom(0).child(frame))
    .child(content.relative().bg("#00000000").px(26).py(28).gap(16))
    .when(Boolean(badge), (el) => el.child(div().absolute().top(0).left(0).child(titleBadge(badge.title))));
}

export function heading(title, kicker) {
  const known = ["projects", "ssh", "switch", "commands"].includes(title.toLowerCase());
  return v_flex().gap(8)
    .child(h_flex().items_center().justify_between()
      .child(div().relative().px(12).py(4)
        .child(paint([["4%", 0], ["100%", "12%"], ["96%", "100%"], [0, "84%"]], "#e60012"))
        .child(div().relative().text_size(10).font_weight(800).italic().text_color("#ffffff").child(kicker.toUpperCase())))
      .child(div().text_size(10).text_color("#969696").child("ESC / CLOSE")))
    .when(!known, (el) => el.child(div().text_size(22).line_height(1.05).font_weight(900).italic().text_color("#ffffff").child(title.toUpperCase())));
}

export function searchField(el) {
  return isP5() ? el.rounded(0).border_color("#ffffff").bg("#171717").h(44) : el;
}

export function footer(el) {
  return isP5() ? el.border_t(2).border_color("#e60012").pt(14) : el;
}
