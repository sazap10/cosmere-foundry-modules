// Endeavour tracker (R1). System-neutral: works in any system with `character` actors.
//
// No `cosmere-rpg.skillRoll` auto-fill: the hook is fired with `Hooks.callAll`
// inside `d20Roll` (src/system/dice/index.ts, release-3.1.2), so it runs only
// on the rolling client — the active GM never sees players' rolls. And a
// skill D20Roll carries no DC (`targetValue` is unused), so it cannot say
// whether the roll succeeded. The GM records the result by hand instead.

import { localize } from "../constants";
import { registerTool } from "../controls";
import { EndeavourPanel } from "./gm-panel";
import { EndeavourHud, hudVisible } from "./hud";
import { registerQueries } from "./queries";
import { getStore, onSettingsChange, registerSettings } from "./settings";

let hud: EndeavourHud | undefined;
let panel: EndeavourPanel | undefined;
/** Id of the tracker the HUD last auto-opened for; a new tracker opens it again. */
let autoOpenedFor: string | null = null;

const getHud = () => (hud ??= new EndeavourHud());
const getPanel = () => (panel ??= new EndeavourPanel());

function syncHud() {
  const { current } = getStore();
  if (!hudVisible(current)) {
    if (hud?.rendered) hud.close();
    return;
  }
  if (hud?.rendered) hud.render();
  else if (current.status === "active" && current.id !== autoOpenedFor) {
    autoOpenedFor = current.id;
    getHud().render({ force: true });
  }
}

function toggleHud() {
  if (hud?.rendered) return void hud.close();
  if (!hudVisible(getStore().current)) return void ui.notifications.info(localize("Endeavour.NoneActive"));
  getHud().render({ force: true });
}

export function init() {
  registerSettings();
  registerQueries();
  onSettingsChange(() => {
    syncHud();
    if (panel?.rendered) panel.render();
  });
  registerTool({
    name: "endeavour-panel",
    title: "TABLE_LEDGER.Endeavour.PanelTitle",
    icon: "fa-solid fa-mountain-sun",
    gmOnly: true,
    onClick: () => getPanel().render({ force: true }),
  });
  registerTool({
    name: "endeavour-hud",
    title: "TABLE_LEDGER.Endeavour.ToggleHud",
    icon: "fa-solid fa-list-check",
    onClick: toggleHud,
  });
}

export function ready() {
  syncHud();
}
