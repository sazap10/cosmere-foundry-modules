import { localize, template } from "../constants";
import { playerCharacters, skillLabel, skillOptions } from "./actors";
import { clearEndeavour, commit, startEndeavour } from "./actions";
import { getStore } from "./settings";
import {
  DIFFICULTIES,
  ENDEAVOUR_TYPES,
  PRESETS,
  addNote,
  contributionFor,
  declarationFor,
  endEndeavour,
  nextRound,
  parseNewEndeavour,
  recordContribution,
  removeContribution,
  setPlayerVisible,
  type ContributionResult,
  type NoteKind,
  type Result,
} from "./state";
import { endeavourView, statusLabel } from "./summary";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const RESULTS: ContributionResult[] = ["success", "failure", "none"];
const END_STATUSES = ["succeeded", "failed", "abandoned"] as const;

function warnOnError(result: Result<unknown>) {
  if (!result.ok) ui.notifications.warn(localize(`Endeavour.Error.${result.error}`));
}

/** Read named inputs from a container (checkboxes as booleans). */
function readFields(root: Element | null): Record<string, string | boolean> {
  const fields: Record<string, string | boolean> = {};
  root?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[name]").forEach((el) => {
    fields[el.name] = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
  });
  return fields;
}

export class EndeavourPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tl-endeavour-panel",
    classes: ["tl-endeavour", "tl-endeavour-panel"],
    window: { title: "TABLE_LEDGER.Endeavour.PanelTitle", icon: "fa-solid fa-mountain-sun", resizable: true },
    position: { width: 560, height: "auto" },
    actions: {
      start: EndeavourPanel.#onStart,
      record: EndeavourPanel.#onRecord,
      undo: EndeavourPanel.#onUndo,
      addNote: EndeavourPanel.#onAddNote,
      nextRound: EndeavourPanel.#onNextRound,
      end: EndeavourPanel.#onEnd,
      toggleVisible: EndeavourPanel.#onToggleVisible,
      clear: EndeavourPanel.#onClear,
    },
  };

  static PARTS = { main: { template: template("endeavour/gm-panel.hbs"), scrollable: [""] } };

  async _prepareContext() {
    const { current, history } = getStore();
    const context = {
      types: ENDEAVOUR_TYPES.map((value) => ({ value, label: localize(`Endeavour.Type.${value}`) })),
      difficulties: DIFFICULTIES.map((value) => ({
        value,
        label:
          value === "custom"
            ? localize("Endeavour.Difficulty.custom")
            : localize("Endeavour.DifficultyPreset", {
                name: localize(`Endeavour.Difficulty.${value}`),
                successes: PRESETS[value].successesNeeded,
                failures: PRESETS[value].failuresAllowed,
              }),
        selected: value === "moderate",
      })),
      history: history.map((h) => ({ ...h, statusLabel: statusLabel(h.status) })),
      hasHistory: history.length > 0,
    };
    if (!current) return { ...context, hasEndeavour: false, showStart: true };

    const pcs = playerCharacters();
    const rows = pcs.map((pc) => {
      const contribution = contributionFor(current, pc.uuid);
      const declaration = declarationFor(current, pc.uuid);
      const skills = skillOptions([pc]).map((s) => ({ ...s, selected: s.key === declaration?.skill }));
      return {
        uuid: pc.uuid,
        name: pc.name,
        img: pc.img,
        contribution: contribution && {
          result: contribution.result,
          resultLabel: localize(`Endeavour.Result.${contribution.result}`),
          skillLabel: skillLabel(contribution.skill),
        },
        declaration: declaration && { skillLabel: skillLabel(declaration.skill), skill: declaration.skill, note: declaration.note },
        skills,
        hasSkills: skills.length > 0,
        results: RESULTS.map((value) => ({ value, label: localize(`Endeavour.Result.${value}`) })),
      };
    });
    return {
      ...context,
      hasEndeavour: true,
      showStart: current.status !== "active",
      endeavour: endeavourView(current),
      rows,
      hasRows: rows.length > 0,
      noteActors: pcs.map((pc) => ({ uuid: pc.uuid, name: pc.name })),
      noteKinds: (["opportunity", "complication"] as const).map((value) => ({ value, label: localize(`Endeavour.Kind.${value}`) })),
      endStatuses: END_STATUSES.map((value) => ({ value, label: localize(`Endeavour.End.${value}`) })),
    };
  }

  static async #onStart(this: EndeavourPanel) {
    const parsed = parseNewEndeavour(readFields(this.element.querySelector(".tl-endeavour-start")));
    if (!parsed.ok) return warnOnError(parsed);
    warnOnError(await startEndeavour(parsed.value));
  }

  static async #onRecord(this: EndeavourPanel, _event: Event, target: HTMLElement) {
    const row = target.closest<HTMLElement>("[data-actor-uuid]");
    const result = target.dataset.result as ContributionResult;
    if (!row || !RESULTS.includes(result)) return;
    const fields = readFields(row);
    const actorUuid = row.dataset.actorUuid!;
    const skill = typeof fields.skill === "string" ? fields.skill.trim() : "";
    const note = typeof fields.note === "string" ? fields.note.trim() : "";
    const actorName = fromUuidSync(actorUuid)?.name ?? actorUuid;
    warnOnError(
      await commit((state, now) =>
        recordContribution(state, { actorUuid, actorName, result, skill: skill || undefined, note: note || undefined }, now),
      ),
    );
  }

  static async #onUndo(this: EndeavourPanel, _event: Event, target: HTMLElement) {
    const actorUuid = target.closest<HTMLElement>("[data-actor-uuid]")?.dataset.actorUuid;
    if (actorUuid) warnOnError(await commit((state) => removeContribution(state, actorUuid)));
  }

  static async #onAddNote(this: EndeavourPanel) {
    const fields = readFields(this.element.querySelector(".tl-endeavour-note"));
    const kind = fields.kind as NoteKind;
    if (kind !== "opportunity" && kind !== "complication") return;
    const actorUuid = typeof fields.actorUuid === "string" && fields.actorUuid ? fields.actorUuid : undefined;
    const actorName = actorUuid ? fromUuidSync(actorUuid)?.name : undefined;
    const note = typeof fields.note === "string" ? fields.note : "";
    warnOnError(await commit((state) => addNote(state, { kind, note, actorUuid, actorName })));
  }

  static async #onNextRound(this: EndeavourPanel) {
    warnOnError(await commit((state) => nextRound(state)));
  }

  static async #onEnd(this: EndeavourPanel, _event: Event, target: HTMLElement) {
    const status = target.dataset.status as (typeof END_STATUSES)[number];
    if (!END_STATUSES.includes(status)) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("Endeavour.End.ConfirmTitle") },
      content: `<p>${localize("Endeavour.End.Confirm", { outcome: localize(`Endeavour.Status.${status}`) })}</p>`,
    });
    if (confirmed) warnOnError(await commit((state, now) => endEndeavour(state, status, now)));
  }

  static async #onToggleVisible(this: EndeavourPanel) {
    warnOnError(await commit((state) => setPlayerVisible(state, !state.playerVisible)));
  }

  static async #onClear(this: EndeavourPanel) {
    await clearEndeavour();
  }
}
