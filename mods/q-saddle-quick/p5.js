// Persona 5 look, used only while the persona5 layout is shown.
// Mods cannot import across folders, so each q-saddle mod keeps an identical copy.
import { View, div, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
import { shared } from "herdr";

export const isP5 = () => shared("layout") === "persona5";

const SLAB = [
  [0, "14%"],
  ["97%", 0],
  ["100%", "84%"],
  ["4%", "100%"],
];
const SLAB_FILL = PathBuilder.fill().add_polygon(SLAB).build();
const SLAB_EDGE = PathBuilder.stroke(2).add_polygon(SLAB, true).build();
const CHIP = PathBuilder.fill()
  .add_polygon([
    ["3%", 0],
    ["100%", "12%"],
    ["96%", "100%"],
    [0, "88%"],
  ])
  .build();
const paint = (path, color) =>
  globalThis.window.paint_path(path, color).absolute();

const MORPH_STEP = 300;
// Step motion: a new pose every MORPH_STEP ms, no in-between. Each corner's pull is a hash of the pose number.
const pull = (now, i) => {
  const s =
    Math.sin((Math.floor(now / MORPH_STEP) * 8 + i) * 127.1 + 311.7) *
    43758.5453;
  return s - Math.floor(s);
};
const morphed = (now) => [
  [`${2 * pull(now, 0)}%`, `${14 + 8 * pull(now, 1)}%`],
  [`${97 - 2 * pull(now, 2)}%`, `${8 * pull(now, 3)}%`],
  [`${100 - 2 * pull(now, 4)}%`, `${84 - 8 * pull(now, 5)}%`],
  [`${4 + 2 * pull(now, 6)}%`, `${100 - 8 * pull(now, 7)}%`],
];

// The selected slab: black with a white edge, a magenta and a cyan shadow lagging behind it.
const SHADOWS = [
  { color: "#ff1a8cb3", lag: 6, x: 10, y: 6 },
  { color: "#00e5ffb3", lag: 3, x: -8, y: -5 },
];

export class Morph extends View {
  init(_props, cx) {
    cx.timer.every(MORPH_STEP, (cx) => {
      if (shared("p5.motion") !== false || !this.still) cx.notify();
    });
  }

  render() {
    this.still = shared("p5.motion") === false;
    const now = this.still ? 0 : Date.now();
    const shape = morphed(now);
    const fill = (shape, color) =>
      paint(PathBuilder.fill().add_polygon(shape).build(), color).inset_0();
    return div()
      .size_full()
      .relative()
      .children(
        SHADOWS.map((s) =>
          div()
            .absolute()
            .left(s.x)
            .top(s.y)
            .size_full()
            .child(
              fill(morphed(this.still ? 0 : now - MORPH_STEP * s.lag), s.color),
            ),
        ),
      )
      .child(fill(shape, "#000000"))
      .child(
        paint(
          PathBuilder.stroke(2).add_polygon(shape, true).build(),
          "#ffffff",
        ).inset_0(),
      );
  }
}

export const slab = (el, morph) =>
  el.relative().child(div().absolute().inset_0().child(morph));

export const tag = (title) => {
  const label = title.toUpperCase();
  return h_flex()
    .relative()
    .h(30)
    .pl(12)
    .pr(24)
    .items_center()
    .self_start()
    .child(paint(SLAB_FILL, "#e60012").top(4).left(6).right(-6).bottom(-4))
    .child(paint(SLAB_FILL, "#000000").inset_0())
    .child(paint(SLAB_EDGE, "#ffffff").inset_0())
    .child(
      h_flex()
        .items_end()
        .italic()
        .font_weight(900)
        .text_color("#ffffff")
        .child(
          div()
            .text_size(16 * 1.45)
            .line_height(1)
            .child(label[0]),
        )
        .child(div().text_size(16).line_height(1.1).child(label.slice(1))),
    );
};

export const keycap = (key, label) =>
  h_flex()
    .gap(6)
    .items_center()
    .child(
      h_flex()
        .relative()
        .h(18)
        .px(7)
        .items_center()
        .text_size(10.5)
        .font_weight(800)
        .text_color("#000000")
        .child(paint(CHIP, "#ffffff").inset_0())
        .child(key),
    )
    .child(
      div()
        .text_size(11)
        .italic()
        .font_weight(800)
        .text_color("#ffffff")
        .child(label.toUpperCase()),
    );
