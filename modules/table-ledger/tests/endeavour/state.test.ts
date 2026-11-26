import { describe, expect, it } from "vitest";
import {
  addNote,
  counts,
  createEndeavour,
  declare,
  endEndeavour,
  nextRound,
  parseDeclarePayload,
  parseNewEndeavour,
  pushHistory,
  recordContribution,
  removeContribution,
  reportEndeavour,
  roundsTable,
  summarize,
  type Endeavour,
  type EndeavourSummary,
  type NewEndeavourInput,
  type Result,
} from "../../src/endeavour/state";

const NOW = "2026-11-11T20:00:00.000Z";
const PCS = ["Actor.kal", "Actor.shallan", "Actor.adolin", "Actor.jasnah"];

function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

function start(input: Partial<NewEndeavourInput> = {}): Endeavour {
  return unwrap(
    createEndeavour({ name: "Cross the Plains", type: "exploration", difficulty: "easy", playerVisible: true, ...input }, "e1", NOW),
  );
}

function contribute(state: Endeavour, actorUuid: string, result: "success" | "failure" | "none"): Endeavour {
  return unwrap(recordContribution(state, { actorUuid, actorName: actorUuid, result }, NOW));
}

/** Each entry is one contribution; PCs rotate and rounds advance when all have gone. */
function play(state: Endeavour, results: ("success" | "failure" | "none")[]): Endeavour {
  let s = state;
  results.forEach((result, i) => {
    if (i > 0 && i % PCS.length === 0) s = unwrap(nextRound(s));
    s = contribute(s, PCS[i % PCS.length], result);
  });
  return s;
}

describe("presets", () => {
  it.each([
    ["easy", 4, 3],
    ["moderate", 6, 3],
    ["hard", 8, 4],
  ] as const)("%s is %i/%i", (difficulty, s, f) => {
    const e = start({ difficulty });
    expect([e.successesNeeded, e.failuresAllowed]).toEqual([s, f]);
    expect(e.round).toBe(1);
    expect(e.status).toBe("active");
  });
});

describe("outcomes", () => {
  it("succeeds at exactly the success threshold", () => {
    const three = play(start(), ["success", "success", "failure", "success"]);
    expect(three.status).toBe("active");
    expect(counts(three)).toEqual({ successes: 3, failures: 1 });
    const final = contribute(unwrap(nextRound(three)), PCS[0], "success");
    expect(counts(final).successes).toBe(4);
    expect(final.status).toBe("succeeded");
    expect(final.endedAt).toBe(NOW);
  });

  it("fails when the failure limit is reached before the success target", () => {
    const e = play(start(), ["success", "failure", "success", "failure", "success", "failure"]);
    expect(counts(e)).toEqual({ successes: 3, failures: 3 });
    expect(e.status).toBe("failed");
  });

  it("supports a custom 9/4", () => {
    const e = start({ difficulty: "custom", successesNeeded: 9, failuresAllowed: 4 });
    expect([e.successesNeeded, e.failuresAllowed]).toEqual([9, 4]);
    const eight = play(e, Array(8).fill("success"));
    expect(eight.status).toBe("active");
    const nine = contribute(unwrap(nextRound(eight)), PCS[0], "success");
    expect(nine.status).toBe("succeeded");
    expect(summarize(nine)).toMatchObject({ successes: 9, failures: 0, successesNeeded: 9, failuresAllowed: 4, rounds: 3 });
  });

  it("carries a starting failure over", () => {
    const e = start({ initialFailures: 1 });
    expect(counts(e)).toEqual({ successes: 0, failures: 1 });
    const end = play(e, ["failure", "none", "failure"]);
    expect(counts(end).failures).toBe(3);
    expect(end.status).toBe("failed");
  });

  it("rejects starting values that already decide the endeavour", () => {
    const r = createEndeavour({ name: "x", type: "custom", difficulty: "easy", initialFailures: 3, playerVisible: false }, "e", NOW);
    expect(r).toEqual({ ok: false, error: "invalidInitial" });
  });

  it("no-roll contributions count as contributed but change nothing", () => {
    const e = contribute(start(), PCS[0], "none");
    expect(counts(e)).toEqual({ successes: 0, failures: 0 });
    expect(recordContribution(e, { actorUuid: PCS[0], actorName: "Kal", result: "success" }, NOW)).toEqual({
      ok: false,
      error: "alreadyContributed",
    });
  });
});

describe("rejections", () => {
  it("rejects a second contribution from the same PC in one round", () => {
    const e = contribute(start(), PCS[0], "success");
    expect(recordContribution(e, { actorUuid: PCS[0], actorName: "Kal", result: "failure" }, NOW)).toEqual({
      ok: false,
      error: "alreadyContributed",
    });
    // Next round the same PC may contribute again.
    const r2 = contribute(unwrap(nextRound(e)), PCS[0], "failure");
    expect(counts(r2)).toEqual({ successes: 1, failures: 1 });
  });

  it("rejects contributions, notes, declarations and round changes after the end", () => {
    const won = play(start(), ["success", "success", "success", "success"]);
    expect(won.status).toBe("succeeded");
    const abandoned = unwrap(endEndeavour(start(), "abandoned", NOW));
    for (const ended of [won, abandoned]) {
      expect(recordContribution(ended, { actorUuid: "Actor.new", actorName: "N", result: "success" }, NOW)).toEqual({
        ok: false,
        error: "notActive",
      });
      expect(addNote(ended, { kind: "opportunity", note: "late" }).ok).toBe(false);
      expect(declare(ended, { actorUuid: PCS[1], actorName: "S", userId: "u", skill: "lore" }).ok).toBe(false);
      expect(nextRound(ended).ok).toBe(false);
      expect(endEndeavour(ended, "failed", NOW).ok).toBe(false);
    }
  });

  it("undo only touches the current round", () => {
    const e = contribute(start(), PCS[0], "success");
    const undone = unwrap(removeContribution(e, PCS[0]));
    expect(counts(undone).successes).toBe(0);
    expect(removeContribution(unwrap(nextRound(e)), PCS[0])).toEqual({ ok: false, error: "noContribution" });
  });
});

describe("opportunity / complication log", () => {
  it("never changes the counts", () => {
    const e = contribute(start({ initialSuccesses: 1 }), PCS[0], "failure");
    const before = counts(e);
    const logged = unwrap(addNote(unwrap(addNote(e, { kind: "opportunity", note: "Found a chasm path" })), {
      kind: "complication",
      note: "Chull spooked",
      actorUuid: PCS[0],
      actorName: "Kal",
    }));
    expect(counts(logged)).toEqual(before);
    expect(logged.status).toBe("active");
    expect(logged.log).toHaveLength(2);
    expect(addNote(e, { kind: "opportunity", note: "   " })).toEqual({ ok: false, error: "emptyNote" });
    expect(roundsTable(logged)[0].log.map((l) => l.kind)).toEqual(["opportunity", "complication"]);
  });
});

describe("declarations", () => {
  it("are stored apart from results and replaced per actor per round", () => {
    let e = unwrap(declare(start(), { actorUuid: PCS[1], actorName: "Shallan", userId: "u1", skill: "deduction" }));
    e = unwrap(declare(e, { actorUuid: PCS[1], actorName: "Shallan", userId: "u1", skill: "lore", note: "maps" }));
    expect(e.declarations).toEqual([{ round: 1, actorUuid: PCS[1], actorName: "Shallan", userId: "u1", skill: "lore", note: "maps" }]);
    expect(e.contributions).toEqual([]);
    expect(counts(e)).toEqual({ successes: 0, failures: 0 });
    const ruled = contribute(e, PCS[1], "success");
    expect(declare(ruled, { actorUuid: PCS[1], actorName: "Shallan", userId: "u1", skill: "lore" })).toEqual({
      ok: false,
      error: "alreadyContributed",
    });
  });
});

describe("payload validation", () => {
  it.each([
    null,
    "declare",
    42,
    [],
    {},
    { userId: "u1", actorUuid: "Actor.a" },
    { userId: 7, actorUuid: "Actor.a", skill: "lore" },
    { userId: "u1", actorUuid: "Actor.a", skill: "" },
    { userId: "u1", actorUuid: "Actor.a", skill: "lore", note: 5 },
    { userId: "u1", actorUuid: "Actor.a", skill: "x".repeat(61) },
    { userId: "u1", actorUuid: "Actor.a", skill: "lore", note: "x".repeat(501) },
  ])("rejects malformed declare payload %j", (payload) => {
    expect(parseDeclarePayload(payload)).toEqual({ ok: false, error: "invalidPayload" });
  });

  it("accepts a well-formed declare payload and trims it", () => {
    expect(parseDeclarePayload({ userId: "u1", actorUuid: "Actor.a", skill: " lore ", note: "" })).toEqual({
      ok: true,
      value: { userId: "u1", actorUuid: "Actor.a", skill: "lore" },
    });
  });

  it("validates new-endeavour form input", () => {
    expect(parseNewEndeavour({ name: "", type: "mission", difficulty: "easy" }).ok).toBe(false);
    expect(parseNewEndeavour({ name: "a", type: "heist", difficulty: "easy" }).ok).toBe(false);
    expect(parseNewEndeavour({ name: "a", type: "mission", difficulty: "custom", successesNeeded: "9" })).toEqual({
      ok: false,
      error: "invalidThresholds",
    });
    expect(parseNewEndeavour({ name: "a", type: "mission", difficulty: "easy", initialFailures: "-1" })).toEqual({
      ok: false,
      error: "invalidInitial",
    });
    expect(
      parseNewEndeavour({
        name: " Escape ",
        type: "pursuit",
        difficulty: "custom",
        successesNeeded: "9",
        failuresAllowed: "4",
        initialFailures: "1",
        playerVisible: true,
      }),
    ).toEqual({
      ok: true,
      value: { name: "Escape", type: "pursuit", difficulty: "custom", successesNeeded: 9, failuresAllowed: 4, initialFailures: 1, playerVisible: true },
    });
  });
});

describe("history", () => {
  it("keeps the newest 10 and dedupes by id", () => {
    let history: EndeavourSummary[] = [];
    for (let i = 0; i < 12; i++) history = pushHistory(history, { ...summarize(start()), id: `e${i}` });
    expect(history).toHaveLength(10);
    expect(history[0].id).toBe("e11");
    history = pushHistory(history, { ...summarize(start()), id: "e5", status: "failed" });
    expect(history.filter((h) => h.id === "e5")).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: "e5", status: "failed" });
  });
});

describe("report", () => {
  it("carries counts, head start and each round's results and notes, without declarations", () => {
    let e = start({ initialSuccesses: 1 });
    e = unwrap(recordContribution(e, { actorUuid: PCS[0], actorName: "Kal", skill: "ath", result: "success", note: "vaulted the gap" }, NOW));
    e = unwrap(addNote(e, { kind: "complication", note: "Chull spooked", actorUuid: PCS[0], actorName: "Kal" }));
    e = unwrap(nextRound(e));
    e = unwrap(declare(e, { actorUuid: PCS[1], actorName: "Shallan", userId: "u1", skill: "lore" }));
    e = unwrap(recordContribution(e, { actorUuid: PCS[2], actorName: "Adolin", result: "failure" }, NOW));

    const report = reportEndeavour(e, (key) => key.toUpperCase());
    expect(report).toMatchObject({ name: "Cross the Plains", status: "active", successes: 2, failures: 1, initialSuccesses: 1, rounds: 2 });
    expect(report.byRound).toEqual([
      {
        round: 1,
        contributions: [{ actorName: "Kal", skill: "ATH", result: "success", note: "vaulted the gap" }],
        log: [{ kind: "complication", actorName: "Kal", note: "Chull spooked" }],
      },
      { round: 2, contributions: [{ actorName: "Adolin", result: "failure" }], log: [] },
    ]);
  });
});
