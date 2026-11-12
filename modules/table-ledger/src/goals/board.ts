import type { GoalsAdapter } from "../adapters/types";
import { MODULE_ID, localize, template } from "../constants";
import { changeGoalLevel, openActorSheet } from "./actions";
import { toCharacterRows } from "./model";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** GM-only overview of every player character's goals. */
export class GoalsBoard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-goals-board`,
    classes: ["tl-goals", "tl-goals-board"],
    window: { title: "TABLE_LEDGER.Goals.Board.Title", icon: "fa-solid fa-bullseye", resizable: true },
    position: { width: 460, height: 560 },
    actions: {
      goalPip: { buttons: [0, 2], handler: GoalsBoard.#onPip },
      openSheet: GoalsBoard.#onOpenSheet,
      toggleCompleted: GoalsBoard.#onToggleCompleted,
    },
  };

  static PARTS = {
    board: {
      template: template("goals/board.hbs"),
      templates: [template("goals/character.hbs")],
      scrollable: [""],
    },
  };

  readonly adapter: GoalsAdapter;
  hideCompleted = false;

  constructor(adapter: GoalsAdapter, options = {}) {
    super(options);
    this.adapter = adapter;
  }

  async _prepareContext() {
    return {
      rows: toCharacterRows(this.adapter.listCharacters(), this.hideCompleted),
      hideCompleted: this.hideCompleted,
      emptyText: localize("Goals.Board.Empty"),
    };
  }

  static #onPip(this: GoalsBoard, event: PointerEvent, target: HTMLElement) {
    return changeGoalLevel(this.adapter, event, target);
  }

  static #onOpenSheet(this: GoalsBoard, _event: PointerEvent, target: HTMLElement) {
    openActorSheet(target);
  }

  static #onToggleCompleted(this: GoalsBoard) {
    this.hideCompleted = !this.hideCompleted;
    this.render();
  }
}
