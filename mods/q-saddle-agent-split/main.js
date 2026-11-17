// mod.open passes no props, and a mod cannot import another mod's files: this one only reopens
// the saddle launcher to split an agent beside the focused pane.

import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay, shared } from "herdr";

export default class SaddleAgentSplit extends View {
  init() {
    const overlay = props()?.overlay;
    if (!overlay) return;
    closeOverlay(overlay);
    const framed = ["persona5", "awacs"].includes(shared("layout"));
    openOverlay({
      mod: "q-saddle-tab",
      props: { split: true },
      kind: "dialog",
      width: framed ? 620 : 520,
      ...(framed ? { frame: "none" } : {}),
    });
  }

  render() {
    return div();
  }
}
