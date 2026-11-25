import type { CharacterGoals, GoalsAdapter } from "../adapters/types";
import { MODULE_ID, localize, template } from "../constants";
import { changeGoalLevel, openActorSheet } from "./actions";
import { splitFollowed, toCharacterRows } from "./model";
import { SETTINGS, getFollowed, getSetting, setFollowed, setSetting } from "./settings";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Every character this user owns. OWNER permission is required, so players never receive
 * other PCs' goals here.
 */
export function ownedCharacters(adapter: GoalsAdapter): CharacterGoals[] {
  const actors: unknown[] = game.actors.contents;
  return actors
    .filter((a) => typeof a === "object" && a !== null && "isOwner" in a && a.isOwner === true)
    .map((a) => adapter.forActor(a))
    .filter((c): c is CharacterGoals => c !== null);
}

/** Owned characters split into the widget's rows (assigned + followed) and the rest. */
function followedCharacters(adapter: GoalsAdapter) {
  const assigned = game.user.character;
  return splitFollowed(ownedCharacters(adapter), assigned?.isOwner ? assigned.uuid : undefined, getFollowed());
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
      follow: GoalsWidget.#onFollow,
      unfollow: GoalsWidget.#onUnfollow,
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
    const { shown, available } = followedCharacters(this.adapter);
    const assignedUuid = game.user.character?.uuid;
    return {
      rows: toCharacterRows(shown).map((row) => ({ ...row, unfollowable: row.actorUuid !== assignedUuid })),
      available: available.map(({ actorUuid, actorName }) => ({ actorUuid, actorName })),
      collapsed: getSetting(SETTINGS.widgetCollapsed),
      emptyText: localize(available.length ? "Goals.Widget.NoneFollowed" : "Goals.Widget.Empty"),
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

  static #onFollow(_event: PointerEvent, target: HTMLElement) {
    const uuid = target.dataset.actorUuid;
    const followed = getFollowed();
    if (uuid && !followed.includes(uuid)) return setFollowed([...followed, uuid]);
  }

  static #onUnfollow(_event: PointerEvent, target: HTMLElement) {
    const uuid = target.dataset.actorUuid;
    if (uuid) return setFollowed(getFollowed().filter((u) => u !== uuid));
  }
}
