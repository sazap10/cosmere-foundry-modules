import { MODULE_ID } from "../constants";
import { normalizeStore, type EndeavourStore } from "./state";

const STORE = "endeavour";
const PLAYER_DECLARE = "endeavourPlayerDeclare";

const listeners: (() => void)[] = [];

/** Called on every client whenever either endeavour setting changes. */
export function onSettingsChange(listener: () => void) {
  listeners.push(listener);
}

const notify = () => listeners.forEach((l) => l());

export function registerSettings() {
  game.settings.register(MODULE_ID, STORE, {
    scope: "world",
    config: false,
    type: Object,
    default: { current: null, history: [] },
    onChange: notify,
  });
  game.settings.register(MODULE_ID, PLAYER_DECLARE, {
    name: "TABLE_LEDGER.Endeavour.Settings.PlayerDeclare.Name",
    hint: "TABLE_LEDGER.Endeavour.Settings.PlayerDeclare.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: notify,
  });
}

export const getStore = (): EndeavourStore => normalizeStore(game.settings.get(MODULE_ID, STORE));

/** GM only: world settings are GM-writable. */
export const setStore = (store: EndeavourStore): Promise<unknown> => game.settings.set(MODULE_ID, STORE, store);

export const playersMayDeclare = (): boolean => game.settings.get(MODULE_ID, PLAYER_DECLARE) === true;
