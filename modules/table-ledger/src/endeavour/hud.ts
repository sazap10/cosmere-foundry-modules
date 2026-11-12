import { localize, template } from "../constants";
import { askGM } from "../queries";
import { playerCharacters, skillLabel, skillOptions } from "./actors";
import type { DeclareResponse } from "./queries";
import { getStore, playersMayDeclare } from "./settings";
import { contributionFor, declarationFor, type Endeavour } from "./state";
import { endeavourView } from "./summary";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Whether this user may see the current tracker at all. */
export function hudVisible(state: Endeavour | null): state is Endeavour {
  return !!state && (state.playerVisible || game.user.isGM);
}

export class EndeavourHud extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tl-endeavour-hud",
    classes: ["tl-endeavour", "tl-endeavour-hud"],
    window: { title: "TABLE_LEDGER.Endeavour.Title", icon: "fa-solid fa-mountain-sun", resizable: false },
    position: { width: 320, height: "auto", top: 80, left: 120 },
    actions: { declare: EndeavourHud.#onDeclare },
  };

  static PARTS = { main: { template: template("endeavour/hud.hbs"), scrollable: [""] } };

  async _prepareContext() {
    const state = getStore().current;
    if (!hudVisible(state)) return { hasEndeavour: false };
    const pcs = playerCharacters();
    const party = pcs.map((pc) => {
      const contribution = contributionFor(state, pc.uuid);
      return {
        name: pc.name,
        contributed: !!contribution,
        result: contribution?.result ?? "pending",
        resultLabel: localize(`Endeavour.Result.${contribution?.result ?? "pending"}`),
      };
    });
    const mine = pcs.filter((pc) => pc.isOwner && !contributionFor(state, pc.uuid));
    const canDeclare = state.status === "active" && !game.user.isGM && playersMayDeclare() && mine.length > 0;
    const skills = canDeclare ? skillOptions(mine) : [];
    return {
      hasEndeavour: true,
      endeavour: endeavourView(state),
      party,
      canDeclare,
      declareActors: mine.map((pc) => ({ uuid: pc.uuid, name: pc.name })),
      multipleActors: mine.length > 1,
      skills,
      hasSkills: skills.length > 0,
      declarations: state.declarations
        .filter((d) => d.round === state.round && !contributionFor(state, d.actorUuid))
        .map((d) => ({ actorName: d.actorName, skillLabel: skillLabel(d.skill), note: d.note })),
      myDeclarations: mine.flatMap((pc) => {
        const d = declarationFor(state, pc.uuid);
        return d ? [{ actorName: d.actorName, skillLabel: skillLabel(d.skill) }] : [];
      }),
    };
  }

  static async #onDeclare(this: EndeavourHud) {
    const form = this.element.querySelector(".tl-endeavour-declare") as HTMLElement | null;
    if (!form) return;
    const value = (name: string) => (form.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
    const payload = { userId: game.user.id, actorUuid: value("actorUuid"), skill: value("skill"), note: value("note") };
    try {
      const response = await askGM<DeclareResponse>("endeavour.declare", payload);
      if (response.ok) ui.notifications.info(localize("Endeavour.Declared"));
      else ui.notifications.warn(localize(`Endeavour.Error.${response.error}`));
    } catch (err) {
      ui.notifications.warn(err instanceof Error ? err.message : String(err));
    }
  }
}
