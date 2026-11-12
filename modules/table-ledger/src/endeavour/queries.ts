import { registerQuery } from "../queries";
import { commit } from "./actions";
import type { PcActor } from "./actors";
import { playersMayDeclare } from "./settings";
import { declare, parseDeclarePayload, type ErrorCode } from "./state";

export type DeclareResponse = { ok: true } | { ok: false; error: ErrorCode | "notAllowed" };

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
}
