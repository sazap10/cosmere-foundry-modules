import { registerQuery } from "../queries";
import { commit, startEndeavour } from "./actions";
import type { PcActor } from "./actors";
import { getStore, playersMayDeclare } from "./settings";
import { counts, declare, parseDeclarePayload, parseNewEndeavour, type ErrorCode } from "./state";

export type DeclareResponse = { ok: true } | { ok: false; error: ErrorCode | "notAllowed" };

export type StartResponse =
  | { ok: true; id: string; name: string; successesNeeded: number; failuresAllowed: number; successes: number; failures: number }
  | { ok: false; error: ErrorCode; current?: string };

/**
 * `table-ledger.endeavour.declare` (player → active GM). The declaring user is
 * the authenticated sender, never the payload's `userId`: that must match the
 * sender, and the sender must own the actor and the actor be a player character.
 */
export function registerQueries() {
  registerQuery(
    "endeavour.declare",
    async (data, caller): Promise<DeclareResponse> => {
      const parsed = parseDeclarePayload(data);
      if (!parsed.ok) return parsed;
      const { userId, actorUuid, skill, note } = parsed.value;
      if (!playersMayDeclare() || userId !== caller.id) return { ok: false, error: "notAllowed" };
      const actor = fromUuidSync(actorUuid) as PcActor | null;
      if (!actor || actor.type !== "character" || !actor.testUserPermission(caller, "OWNER"))
        return { ok: false, error: "notAllowed" };
      const result = await commit((state) => declare(state, { actorUuid, actorName: actor.name, userId: caller.id, skill, note }));
      return result.ok ? { ok: true } : { ok: false, error: result.error };
    },
    { access: "player" },
  );

  /**
   * `table-ledger.endeavour.start` (GM, also callable from the foundry-mcp
   * bridge): the same input as the GM panel's start form. An endeavour already
   * in progress is kept unless `replace: true`, which abandons it into history
   * as the panel does.
   */
  registerQuery(
    "endeavour.start",
    async (data): Promise<StartResponse> => {
      const parsed = parseNewEndeavour(data);
      if (!parsed.ok) return parsed;
      const replace = typeof data === "object" && data !== null && "replace" in data && data.replace === true;
      const result = await startEndeavour(parsed.value, { replace });
      if (!result.ok) {
        return result.error === "alreadyActive" ? { ...result, current: getStore().current?.name } : result;
      }
      const e = result.value;
      return { ok: true, id: e.id, name: e.name, successesNeeded: e.successesNeeded, failuresAllowed: e.failuresAllowed, ...counts(e) };
    },
    { external: true },
  );
}
