// Pure endeavour state and reducers. No Foundry globals here: the GM panel,
// the query handlers and the tests all share these functions.

export const ENDEAVOUR_TYPES = ["discovery", "exploration", "mission", "pursuit", "custom"] as const;
export type EndeavourType = (typeof ENDEAVOUR_TYPES)[number];

export const DIFFICULTIES = ["easy", "moderate", "hard", "custom"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/** Successes needed / failures allowed (Cosmere RPG endeavour table). */
export const PRESETS: Record<Exclude<Difficulty, "custom">, { successesNeeded: number; failuresAllowed: number }> = {
  easy: { successesNeeded: 4, failuresAllowed: 3 },
  moderate: { successesNeeded: 6, failuresAllowed: 3 },
  hard: { successesNeeded: 8, failuresAllowed: 4 },
};

export type ContributionResult = "success" | "failure" | "none";
export type NoteKind = "opportunity" | "complication";
export type EndeavourStatus = "active" | "succeeded" | "failed" | "abandoned";

export const LIMITS = { name: 100, skill: 60, note: 500, threshold: 50, history: 10 } as const;

/** A GM-decided result for one PC in one round. */
export interface Contribution {
  round: number;
  actorUuid: string;
  actorName: string;
  skill?: string;
  result: ContributionResult;
  note?: string;
}

/** A player's stated intent for the round. Never carries a result. */
export interface Declaration {
  round: number;
  actorUuid: string;
  actorName: string;
  userId: string;
  skill: string;
  note?: string;
}

/** Opportunity/Complication log entry. Never affects the counts. */
export interface LogEntry {
  round: number;
  kind: NoteKind;
  actorUuid?: string;
  actorName?: string;
  note: string;
}

export interface Endeavour {
  id: string;
  name: string;
  type: EndeavourType;
  successesNeeded: number;
  failuresAllowed: number;
  initialSuccesses: number;
  initialFailures: number;
  round: number;
  contributions: Contribution[];
  declarations: Declaration[];
  log: LogEntry[];
  status: EndeavourStatus;
  playerVisible: boolean;
  startedAt: string;
  endedAt?: string;
}

export interface EndeavourSummary {
  id: string;
  name: string;
  type: EndeavourType;
  status: EndeavourStatus;
  successes: number;
  failures: number;
  successesNeeded: number;
  failuresAllowed: number;
  rounds: number;
  startedAt: string;
  endedAt?: string;
}

export interface EndeavourStore {
  current: Endeavour | null;
  history: EndeavourSummary[];
}

/** Error codes map to `TABLE_LEDGER.Endeavour.Error.<code>`. */
export type ErrorCode =
  | "invalidPayload"
  | "invalidThresholds"
  | "invalidInitial"
  | "notActive"
  | "notActiveGM"
  | "alreadyContributed"
  | "noContribution"
  | "emptyNote";

export type Result<T = Endeavour> = { ok: true; value: T } | { ok: false; error: ErrorCode };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T = Endeavour>(error: ErrorCode): Result<T> => ({ ok: false, error });

export interface NewEndeavourInput {
  name: string;
  type: EndeavourType;
  difficulty: Difficulty;
  /** Used only when difficulty is "custom". */
  successesNeeded?: number;
  failuresAllowed?: number;
  initialSuccesses?: number;
  initialFailures?: number;
  playerVisible: boolean;
}

/* -------------------------------------------- */
/*  Validation helpers                          */
/* -------------------------------------------- */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function str(v: unknown, max: number, required: boolean): string | undefined | null {
  if (v === undefined || v === null || v === "") return required ? null : undefined;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return required ? null : undefined;
  return s.length > max ? null : s;
}

function int(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** Validate untrusted "start endeavour" input (form data). */
export function parseNewEndeavour(data: unknown): Result<NewEndeavourInput> {
  if (!isRecord(data)) return fail("invalidPayload");
  const name = str(data.name, LIMITS.name, true);
  if (!name || !oneOf(ENDEAVOUR_TYPES, data.type) || !oneOf(DIFFICULTIES, data.difficulty)) return fail("invalidPayload");
  const input: NewEndeavourInput = { name, type: data.type, difficulty: data.difficulty, playerVisible: data.playerVisible === true };
  if (data.difficulty === "custom") {
    const s = int(data.successesNeeded, 1, LIMITS.threshold);
    const f = int(data.failuresAllowed, 1, LIMITS.threshold);
    if (s === null || f === null) return fail("invalidThresholds");
    input.successesNeeded = s;
    input.failuresAllowed = f;
  }
  for (const key of ["initialSuccesses", "initialFailures"] as const) {
    if (data[key] === undefined || data[key] === "") continue;
    const n = int(data[key], 0, LIMITS.threshold);
    if (n === null) return fail("invalidInitial");
    input[key] = n;
  }
  return ok(input);
}

export interface DeclarePayload {
  userId: string;
  actorUuid: string;
  skill: string;
  note?: string;
}

/** Validate an untrusted `endeavour.declare` query payload. */
export function parseDeclarePayload(data: unknown): Result<DeclarePayload> {
  if (!isRecord(data)) return fail("invalidPayload");
  const userId = str(data.userId, 64, true);
  const actorUuid = str(data.actorUuid, 200, true);
  const skill = str(data.skill, LIMITS.skill, true);
  const note = str(data.note, LIMITS.note, false);
  if (!userId || !actorUuid || !skill || note === null) return fail("invalidPayload");
  return ok(note ? { userId, actorUuid, skill, note } : { userId, actorUuid, skill });
}

/* -------------------------------------------- */
/*  Derived values                              */
/* -------------------------------------------- */

export function counts(state: Endeavour): { successes: number; failures: number } {
  let successes = state.initialSuccesses;
  let failures = state.initialFailures;
  for (const c of state.contributions) {
    if (c.result === "success") successes++;
    else if (c.result === "failure") failures++;
  }
  return { successes, failures };
}

/**
 * Outcome from the counts alone. Each contribution moves one counter by one,
 * so the first threshold crossed wins: reducers settle the status right after
 * every contribution and reject anything once it is no longer active.
 */
export function deriveStatus(state: Endeavour): EndeavourStatus {
  const { successes, failures } = counts(state);
  if (successes >= state.successesNeeded) return "succeeded";
  if (failures >= state.failuresAllowed) return "failed";
  return "active";
}

export const isActive = (state: Endeavour | null | undefined): state is Endeavour => state?.status === "active";

export const contributionFor = (state: Endeavour, actorUuid: string, round = state.round) =>
  state.contributions.find((c) => c.round === round && c.actorUuid === actorUuid);

export const declarationFor = (state: Endeavour, actorUuid: string, round = state.round) =>
  state.declarations.find((d) => d.round === round && d.actorUuid === actorUuid);

/* -------------------------------------------- */
/*  Reducers                                    */
/* -------------------------------------------- */

export function createEndeavour(input: NewEndeavourInput, id: string, now: string): Result {
  const thresholds =
    input.difficulty === "custom"
      ? { successesNeeded: input.successesNeeded ?? 0, failuresAllowed: input.failuresAllowed ?? 0 }
      : PRESETS[input.difficulty];
  const { successesNeeded, failuresAllowed } = thresholds;
  if (int(successesNeeded, 1, LIMITS.threshold) === null || int(failuresAllowed, 1, LIMITS.threshold) === null)
    return fail("invalidThresholds");
  const initialSuccesses = input.initialSuccesses ?? 0;
  const initialFailures = input.initialFailures ?? 0;
  // A tracker that starts already decided is a GM mistake, not an endeavour.
  if (
    int(initialSuccesses, 0, successesNeeded - 1) === null ||
    int(initialFailures, 0, failuresAllowed - 1) === null
  )
    return fail("invalidInitial");
  return ok({
    id,
    name: input.name,
    type: input.type,
    successesNeeded,
    failuresAllowed,
    initialSuccesses,
    initialFailures,
    round: 1,
    contributions: [],
    declarations: [],
    log: [],
    status: "active",
    playerVisible: input.playerVisible,
    startedAt: now,
  });
}

export interface ContributionInput {
  actorUuid: string;
  actorName: string;
  result: ContributionResult;
  skill?: string;
  note?: string;
}

/** Record the GM's ruling for one PC this round. Settles the outcome when a threshold is reached. */
export function recordContribution(state: Endeavour, input: ContributionInput, now: string): Result {
  if (!isActive(state)) return fail("notActive");
  if (contributionFor(state, input.actorUuid)) return fail("alreadyContributed");
  const contribution: Contribution = { round: state.round, actorUuid: input.actorUuid, actorName: input.actorName, result: input.result };
  if (input.skill) contribution.skill = input.skill;
  if (input.note) contribution.note = input.note;
  const next: Endeavour = { ...state, contributions: [...state.contributions, contribution] };
  const status = deriveStatus(next);
  return ok(status === "active" ? next : { ...next, status, endedAt: now });
}

/** Show or hide the tracker from players (works after the end too, so a result can be revealed). */
export function setPlayerVisible(state: Endeavour, playerVisible: boolean): Result {
  return ok({ ...state, playerVisible });
}

/** Undo a misclicked contribution in the current round (only while active). */
export function removeContribution(state: Endeavour, actorUuid: string): Result {
  if (!isActive(state)) return fail("notActive");
  if (!contributionFor(state, actorUuid)) return fail("noContribution");
  return ok({
    ...state,
    contributions: state.contributions.filter((c) => !(c.round === state.round && c.actorUuid === actorUuid)),
  });
}

export interface NoteInput {
  kind: NoteKind;
  note: string;
  actorUuid?: string;
  actorName?: string;
}

/** Log an Opportunity or Complication. Counts never change. */
export function addNote(state: Endeavour, input: NoteInput): Result {
  if (!isActive(state)) return fail("notActive");
  const note = input.note.trim();
  if (!note) return fail("emptyNote");
  const entry: LogEntry = { round: state.round, kind: input.kind, note: note.slice(0, LIMITS.note) };
  if (input.actorUuid) {
    entry.actorUuid = input.actorUuid;
    entry.actorName = input.actorName;
  }
  return ok({ ...state, log: [...state.log, entry] });
}

/** Store (or replace) a player's declared intent for the current round. */
export function declare(
  state: Endeavour,
  input: { actorUuid: string; actorName: string; userId: string; skill: string; note?: string },
): Result {
  if (!isActive(state)) return fail("notActive");
  if (contributionFor(state, input.actorUuid)) return fail("alreadyContributed");
  const declaration: Declaration = { round: state.round, ...input };
  if (!input.note) delete declaration.note;
  return ok({
    ...state,
    declarations: [
      ...state.declarations.filter((d) => !(d.round === state.round && d.actorUuid === input.actorUuid)),
      declaration,
    ],
  });
}

export function nextRound(state: Endeavour): Result {
  if (!isActive(state)) return fail("notActive");
  return ok({ ...state, round: state.round + 1 });
}

/** GM ends the tracker by ruling (or abandons it). */
export function endEndeavour(state: Endeavour, status: Exclude<EndeavourStatus, "active">, now: string): Result {
  if (!isActive(state)) return fail("notActive");
  return ok({ ...state, status, endedAt: now });
}

/* -------------------------------------------- */
/*  Summary / history                           */
/* -------------------------------------------- */

export function summarize(state: Endeavour): EndeavourSummary {
  const summary: EndeavourSummary = {
    id: state.id,
    name: state.name,
    type: state.type,
    status: state.status,
    ...counts(state),
    successesNeeded: state.successesNeeded,
    failuresAllowed: state.failuresAllowed,
    rounds: state.round,
    startedAt: state.startedAt,
  };
  if (state.endedAt) summary.endedAt = state.endedAt;
  return summary;
}

/** Newest first, capped, one entry per endeavour id. */
export function pushHistory(history: EndeavourSummary[], summary: EndeavourSummary): EndeavourSummary[] {
  return [summary, ...history.filter((h) => h.id !== summary.id)].slice(0, LIMITS.history);
}

export interface RoundRow {
  round: number;
  contributions: Contribution[];
  log: LogEntry[];
}

/** Contributions and O/C entries grouped per round, oldest first, rounds 1..state.round. */
export function roundsTable(state: Endeavour): RoundRow[] {
  const rows: RoundRow[] = [];
  for (let round = 1; round <= state.round; round++) {
    rows.push({
      round,
      contributions: state.contributions.filter((c) => c.round === round),
      log: state.log.filter((l) => l.round === round),
    });
  }
  return rows;
}

/** Pips for HUD/panel: `max` slots, the first `filled` marked. Overflow adds filled pips. */
export function pips(filled: number, max: number): { filled: boolean }[] {
  return Array.from({ length: Math.max(filled, max) }, (_, i) => ({ filled: i < filled }));
}

/** Coerce whatever is in the world setting into a store shape. */
export function normalizeStore(raw: unknown): EndeavourStore {
  if (!isRecord(raw)) return { current: null, history: [] };
  const current = isRecord(raw.current) && typeof raw.current.id === "string" ? (raw.current as unknown as Endeavour) : null;
  const history = Array.isArray(raw.history) ? (raw.history as EndeavourSummary[]).slice(0, LIMITS.history) : [];
  if (current) {
    current.contributions ??= [];
    current.declarations ??= [];
    current.log ??= [];
  }
  return { current, history };
}
