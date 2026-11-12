import { localize, template } from "../constants";
import { skillLabel } from "./actors";
import { counts, pips, roundsTable, type Endeavour, type EndeavourStatus } from "./state";

export interface ContributionView {
  actorName: string;
  skillLabel: string;
  result: string;
  resultLabel: string;
  note?: string;
}

export interface LogView {
  round: number;
  kind: string;
  kindLabel: string;
  actorName?: string;
  note: string;
}

/** Shared view model for the HUD, the GM panel and the chat card. */
export interface EndeavourView {
  id: string;
  name: string;
  typeLabel: string;
  status: EndeavourStatus;
  statusLabel: string;
  active: boolean;
  playerVisible: boolean;
  round: number;
  successes: number;
  failures: number;
  successesNeeded: number;
  failuresAllowed: number;
  successPips: { filled: boolean }[];
  failurePips: { filled: boolean }[];
  rounds: { round: number; contributions: ContributionView[] }[];
  log: LogView[];
}

export const statusLabel = (status: EndeavourStatus) => localize(`Endeavour.Status.${status}`);

export function endeavourView(state: Endeavour): EndeavourView {
  const { successes, failures } = counts(state);
  return {
    id: state.id,
    name: state.name,
    typeLabel: localize(`Endeavour.Type.${state.type}`),
    status: state.status,
    statusLabel: statusLabel(state.status),
    active: state.status === "active",
    playerVisible: state.playerVisible,
    round: state.round,
    successes,
    failures,
    successesNeeded: state.successesNeeded,
    failuresAllowed: state.failuresAllowed,
    successPips: pips(successes, state.successesNeeded),
    failurePips: pips(failures, state.failuresAllowed),
    rounds: roundsTable(state).map((row) => ({
      round: row.round,
      contributions: row.contributions.map((c) => ({
        actorName: c.actorName,
        skillLabel: skillLabel(c.skill),
        result: c.result,
        resultLabel: localize(`Endeavour.Result.${c.result}`),
        note: c.note,
      })),
    })),
    log: state.log.map((l) => ({
      round: l.round,
      kind: l.kind,
      kindLabel: localize(`Endeavour.Kind.${l.kind}`),
      actorName: l.actorName,
      note: l.note,
    })),
  };
}

/** Post the end-of-endeavour card. Hidden trackers are whispered to GMs only. */
export async function postSummary(state: Endeavour): Promise<void> {
  const view = endeavourView(state);
  const content = await foundry.applications.handlebars.renderTemplate(template("endeavour/summary.hbs"), {
    ...view,
    initialSuccesses: state.initialSuccesses,
    initialFailures: state.initialFailures,
    hasInitial: state.initialSuccesses > 0 || state.initialFailures > 0,
    hasLog: view.log.length > 0,
  });
  const data: Record<string, unknown> = { content, speaker: { alias: localize("Endeavour.Title") } };
  if (!state.playerVisible) data.whisper = ChatMessage.getWhisperRecipients("GM").map((u: { id: string }) => u.id);
  await ChatMessage.create(data);
}
