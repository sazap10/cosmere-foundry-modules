import { MODULE_ID } from "../constants";

export const SETTINGS = {
  widget: "goalsWidget",
  widgetCollapsed: "goalsWidgetCollapsed",
  announceComplete: "goalsAnnounceComplete",
} as const;

/** Client setting: UUIDs of owned, non-assigned characters this user follows in the widget. */
const FOLLOWED = "goalsFollowed";

export function registerSettings(onWidgetToggle: (show: boolean) => void, onViewChange: () => void) {
  game.settings.register(MODULE_ID, SETTINGS.widget, {
    name: "TABLE_LEDGER.Goals.Settings.Widget.Name",
    hint: "TABLE_LEDGER.Goals.Settings.Widget.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: (show: boolean) => onWidgetToggle(show),
  });
  game.settings.register(MODULE_ID, SETTINGS.widgetCollapsed, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false,
    onChange: () => onViewChange(),
  });
  game.settings.register(MODULE_ID, FOLLOWED, {
    scope: "client",
    config: false,
    type: Array,
    default: [],
    onChange: () => onViewChange(),
  });
  game.settings.register(MODULE_ID, SETTINGS.announceComplete, {
    name: "TABLE_LEDGER.Goals.Settings.AnnounceComplete.Name",
    hint: "TABLE_LEDGER.Goals.Settings.AnnounceComplete.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });
}

export const getSetting = (key: (typeof SETTINGS)[keyof typeof SETTINGS]): boolean =>
  Boolean(game.settings.get(MODULE_ID, key));

export const setSetting = (key: (typeof SETTINGS)[keyof typeof SETTINGS], value: boolean): Promise<unknown> =>
  game.settings.set(MODULE_ID, key, value);

export function getFollowed(): string[] {
  const value: unknown = game.settings.get(MODULE_ID, FOLLOWED);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export const setFollowed = (uuids: readonly string[]): Promise<unknown> => game.settings.set(MODULE_ID, FOLLOWED, [...uuids]);
