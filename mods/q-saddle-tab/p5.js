// Persona 5 look, used only while the persona5 layout is shown.
// Mods cannot import across folders, so each q-saddle mod keeps an identical copy.
import { div, PathBuilder } from "gpui-kit";
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

export const slab = (el, id = "p5-slab-shadow") =>
  el
    .relative()
    .child(
      div()
        .id(id)
        .absolute()
        .top(4)
        .left(6)
        .w_full()
        .h_full()
        .loop("top", { from: 1, to: 8, period: 1500 })
        .child(paint(SLAB_FILL, "#e60012").inset_0()),
    )
    .child(paint(SLAB_FILL, "#000000").inset_0())
    .child(paint(SLAB_EDGE, "#ffffff").inset_0());

export const tag = (label) =>
  slab(h_flex().h(30).pl(12).pr(24).items_center().self_start(), "p5-tag-shadow").child(
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
