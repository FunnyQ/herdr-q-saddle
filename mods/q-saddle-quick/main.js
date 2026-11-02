// Opened by mod.open (ctrl-`), this mod is a one-shot runner: it toggles the space's quick
// terminal and closes. Inside the dialog it opens, it draws the frame: `props().look` set.

import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
import * as herdr from "herdr";
import { props, shared, theme, notify, closeOverlay } from "herdr";
import { isP5 } from "./p5.js";
import { VISIBLE, toggle, adopt, forget, stale } from "./quick.js";

// The P5 frame's slab steps to a new pose every MORPH_STEP ms, each corner pulled up to PULL px inward.
const MORPH_STEP = 300;
const PULL = 6;
const noise = (k) => {
  const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const pull = (now, i) => PULL * noise(Math.floor(now / MORPH_STEP) * 8 + i);
const SLAB = 9;
// How far a corner may slant in before the slab's edge, pulled and stroked, reaches the terminal.
const room = (margin) => margin - SLAB - PULL - 4;
const quad = (w, h, now, frame) => [
  [
    Math.min(0.02 * w, room(frame.side)) + pull(now, 0),
    Math.min(0.04 * h, room(frame.top)) + pull(now, 1),
  ],
  [w - Math.min(0.04 * w, room(frame.side)) - pull(now, 2), pull(now, 3)],
  [w - pull(now, 4), h - Math.min(0.04 * h, room(frame.bottom)) - pull(now, 5)],
  [Math.min(0.03 * w, room(frame.side)) + pull(now, 6), h - pull(now, 7)],
];
const SHADOWS = [
  { color: "#ff1a8cb3", lag: 6, x: 8, y: 6 },
  { color: "#00e5ffb3", lag: 3, x: -6, y: -5 },
];

const hideButton = (overlay, color, hover, hoverColor) =>
  div()
    .id("quick-terminal-hide")
    .size(26)
    .flex()
    .items_center()
    .justify_center()
    .rounded(5)
    .text_color(color)
    .hover((s) => s.bg(hover).text_color(hoverColor))
    .tooltip("Hide terminal (Ctrl+`)")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click(() => closeOverlay(overlay))
    .child(svg("mods/pane/close.svg").size(14));

export default class QuickTerminal extends View {
  init(_props, cx) {
    const p = props() ?? {};
    if (p.look) {
      if (p.look === "p5") this.tick(cx);
      return;
    }
    this.runner = p.overlay;
    if (!this.runner) return;
    cx.spawn(async () => {
      try {
        if (p.adopt) adopt(herdr);
        else
          await toggle(herdr, {
            viewport: globalThis.window.viewport_size(),
            look: isP5() ? "p5" : "normal",
            layout: shared("layout"),
            runner: this.runner,
            cancelled: () => this.closed,
          });
      } catch (error) {
        notify({
          title: "Quick terminal",
          body: String(error.message ?? error),
          level: "error",
        });
      }
      if (!this.closed) closeOverlay(this.runner);
    });
  }

  // Each P5 frame part redraws just past the same step boundary, so all four show one pose.
  tick(cx) {
    cx.timer.after(MORPH_STEP - (Date.now() % MORPH_STEP) + 10, (cx) => {
      if (shared("p5.motion") !== false || !this.still) cx.notify();
      this.tick(cx);
    });
  }

  outline(frame, part) {
    const x = part === "right" ? frame.width - frame.side : 0;
    const y =
      part === "bottom" ? frame.height - frame.bottom : part ? frame.top : 0;
    this.still = shared("p5.motion") === false;
    const now = this.still ? 0 : Date.now();
    const w = frame.width - SLAB * 2 - 2;
    const h = frame.height - SLAB * 2 - 2;
    const shape = quad(w, h, now, frame);
    const paint = (path, color, dx = 0, dy = 0) =>
      globalThis.window
        .paint_path(path, color)
        .absolute()
        .w(w)
        .h(h)
        .left(SLAB + dx - x)
        .top(SLAB + dy - y);
    const fill = (shape) => PathBuilder.fill().add_polygon(shape).build();
    const line = (shape) =>
      PathBuilder.stroke(3).add_polygon(shape, true).build();
    return div()
      .size_full()
      .relative()
      .children(
        SHADOWS.map((s) =>
          paint(
            fill(quad(w, h, this.still ? 0 : now - MORPH_STEP * s.lag, frame)),
            s.color,
            s.x,
            s.y,
          ),
        ),
      )
      .child(paint(fill(shape), "#000000"))
      .child(paint(line(shape), "#ffffff"));
  }

  render() {
    const p = props() ?? {};
    if (!p.look) return div();
    if (p.look === "p5" && p.part) return this.outline(p.frame, p.part);
    const visible = shared(VISIBLE);
    if (
      !this.leaving &&
      visible?.id === p.overlay &&
      stale(herdr, visible, shared("layout"))
    ) {
      this.leaving = true;
      closeOverlay(p.overlay);
    }
    if (p.look !== "p5") {
      const t = theme();
      return h_flex()
        .size_full()
        .pl(14)
        .pr(6)
        .items_center()
        .justify_between()
        .border_b(1)
        .border_color(t.border)
        .child(
          div()
            .text_size(13)
            .font_weight(600)
            .text_color(t.foreground)
            .child("Terminal"),
        )
        .child(hideButton(p.overlay, t.muted, t.hover, t.foreground));
    }
    return div()
      .size_full()
      .relative()
      .child(this.outline(p.frame).absolute().inset_0())
      .child(
        image("mods/q-saddle-quick/title-shadow.png")
          .w(196)
          .h(196 / 3)
          .absolute()
          .left(3)
          .top(3),
      )
      .child(
        image("mods/q-saddle-quick/title.png")
          .w(196)
          .h(196 / 3)
          .absolute()
          .left(0)
          .top(0),
      )
      .child(
        div()
          .absolute()
          .right(p.frame.side)
          .top(28)
          .child(hideButton(p.overlay, "#ffb8bd", "#00000033", "#ffffff")),
      );
  }

  close() {
    if (this.runner) {
      this.closed = true;
      return;
    }
    const p = props() ?? {};
    if (p.look && !p.part) forget(herdr, p.overlay);
  }
}
