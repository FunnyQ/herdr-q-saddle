// mod.open passes no props, and a mod cannot import another mod's files: this one only reopens
// q-saddle-quick in its adopt mode.

import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay } from "herdr";

export default class AdoptQuickTerminal extends View {
  init() {
    const overlay = props()?.overlay;
    if (!overlay) return;
    closeOverlay(overlay);
    openOverlay({
      mod: "q-saddle-quick",
      props: { adopt: true },
      kind: "popup",
      width: 1,
      height: 1,
    });
  }

  render() {
    return div();
  }
}
