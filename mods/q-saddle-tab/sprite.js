import { div, image } from "gpui-kit";
import { SPRITE } from "./sprite-data.js";

export function sprite(name, width, height) {
  const entry = SPRITE.entries[name];
  const scaleX = width / entry.width;
  const displayHeight = height ?? entry.height * scaleX;
  const scaleY = displayHeight / entry.height;
  return div().relative().w(width).h(displayHeight).overflow_hidden()
    .child(image("assets/title-sprite.png").absolute()
      .w(SPRITE.width * scaleX).h(SPRITE.height * scaleY)
      .left(-entry.x * scaleX).top(-entry.y * scaleY));
}
