// mod.open passes no props, and a mod cannot import another mod's files: this one only reopens
// the saddle launcher in its restart mode.

import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay } from "herdr";

export default class SaddleRestart extends View {
  init() {
    const overlay = props()?.overlay;
    if (!overlay) return;
    closeOverlay(overlay);
    openOverlay({
      mod: "q-saddle-tab",
      props: { restart: true },
      kind: "dialog",
      width: 520,
    });
  }

  render() {
    return div();
  }
}
