import type { CharacterGoals, GoalsAdapter } from "../adapters/types";
import { MODULE_ID, localize, template } from "../constants";
import { changeGoalLevel, openActorSheet } from "./actions";
import { toCharacterRows } from "./model";
import { SETTINGS, getSetting, setSetting } from "./settings";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Characters this user owns: the assigned character first, then any other owned characters.
 * OWNER permission is required, so players never receive other PCs' goals here.
 */
export function ownedCharacters(adapter: GoalsAdapter): CharacterGoals[] {
  const assigned = game.user.character;
  const actors: unknown[] = game.actors.contents;
  const owned = actors.filter(
    (a) => typeof a === "object" && a !== null && "isOwner" in a && a.isOwner === true && a !== assigned,
  );
  const ordered = assigned?.isOwner ? [assigned, ...owned] : owned;
  return ordered.map((a) => adapter.forActor(a)).filter((c): c is CharacterGoals => c !== null);
}

/** Small floating widget with the current player's own goals. */
export class GoalsWidget extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-goals-widget`,
    classes: ["tl-goals", "tl-goals-widget"],
    window: { title: "TABLE_LEDGER.Goals.Widget.Title", icon: "fa-solid fa-bullseye", minimizable: true },
    position: { width: 300, height: "auto", top: 80, left: 120 },
    actions: {
      goalPip: { buttons: [0, 2], handler: GoalsWidget.#onPip },
      openSheet: GoalsWidget.#onOpenSheet,
      toggleCollapsed: GoalsWidget.#onToggleCollapsed,
    },
  };

  static PARTS = {
    widget: {
      template: template("goals/widget.hbs"),
      templates: [template("goals/character.hbs")],
      scrollable: [""],
    },
  };

  readonly adapter: GoalsAdapter;

  constructor(adapter: GoalsAdapter, options = {}) {
    super(options);
    this.adapter = adapter;
  }

  async _prepareContext() {
    return {
      rows: toCharacterRows(ownedCharacters(this.adapter)),
      collapsed: getSetting(SETTINGS.widgetCollapsed),
      emptyText: localize("Goals.Widget.Empty"),
    };
  }

  static #onPip(this: GoalsWidget, event: PointerEvent, target: HTMLElement) {
    return changeGoalLevel(this.adapter, event, target);
  }

  static #onOpenSheet(this: GoalsWidget, _event: PointerEvent, target: HTMLElement) {
    openActorSheet(target);
  }

  static #onToggleCollapsed() {
    return setSetting(SETTINGS.widgetCollapsed, !getSetting(SETTINGS.widgetCollapsed));
  }
}
