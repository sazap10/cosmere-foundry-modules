import { MODULE_ID } from "./constants";
import { resolveAdapter } from "./adapters";
import type { SystemAdapter } from "./adapters/types";
import * as endeavour from "./endeavour";
import * as goals from "./goals";
import * as clock from "./clock";
import * as recap from "./recap";
import * as abilities from "./abilities";

let adapter: SystemAdapter;

Hooks.once("init", () => {
  adapter = resolveAdapter(game.system.id);
  endeavour.init();
  clock.init();
  recap.init();
  if (adapter.goals) goals.init(adapter.goals);
  if (adapter.abilities) abilities.init(adapter.abilities);
  console.log(`${MODULE_ID} | init (system adapter: ${adapter.goals || adapter.abilities ? adapter.systemId : "none"})`);
});

Hooks.once("ready", () => {
  endeavour.ready();
  clock.ready();
  if (adapter.goals) goals.ready(adapter.goals);
  if (adapter.abilities) abilities.ready();
});
