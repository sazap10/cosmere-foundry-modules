import type { GoalsAdapter } from "../adapters/types";
import { registerTool } from "../controls";
import { GoalsBoard } from "./board";
import { announceCompletion } from "./complete-card";
import { GoalsWidget, ownedCharacters } from "./player-widget";
import { SETTINGS, getSetting, registerSettings } from "./settings";

let board: GoalsBoard | undefined;
let widget: GoalsWidget | undefined;

const getBoard = (adapter: GoalsAdapter) => (board ??= new GoalsBoard(adapter));
const getWidget = (adapter: GoalsAdapter) => (widget ??= new GoalsWidget(adapter));

function toggle(app: GoalsBoard | GoalsWidget) {
  if (app.rendered) app.close();
  else app.render({ force: true });
}

export function init(adapter: GoalsAdapter) {
  registerSettings(
    (show) => {
      if (game.user.isGM) return;
      if (show) getWidget(adapter).render({ force: true });
      else widget?.close();
    },
    () => widget?.rendered && widget.render(),
  );

  registerTool({
    name: "goals-board",
    title: "TABLE_LEDGER.Goals.Board.Title",
    icon: "fa-solid fa-bullseye",
    gmOnly: true,
    onClick: () => game.user.isGM && toggle(getBoard(adapter)),
  });
  registerTool({
    name: "goals-mine",
    title: "TABLE_LEDGER.Goals.Widget.Title",
    icon: "fa-solid fa-bullseye",
    playerOnly: true,
    onClick: () => toggle(getWidget(adapter)),
  });
}

export function ready(adapter: GoalsAdapter) {
  const rerender = foundry.utils.debounce(() => {
    if (board?.rendered) board.render();
    if (widget?.rendered) widget.render();
  }, 100);
  adapter.onChange(rerender);
  adapter.onComplete((item) => void announceCompletion(item));

  if (!game.user.isGM && getSetting(SETTINGS.widget) && ownedCharacters(adapter).length) {
    getWidget(adapter).render({ force: true });
  }
}
