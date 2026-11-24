// GM-side writes. Every change reads the latest store, applies a pure reducer
// and saves; writes are chained so two quick clicks never read the same stale
// store. When a change ends the tracker, the summary card is posted and the
// summary pushed into history in the same save.

import { getStore, setStore } from "./settings";
import { postSummary } from "./summary";
import {
  createEndeavour,
  pushHistory,
  summarize,
  type Endeavour,
  type NewEndeavourInput,
  type Result,
} from "./state";

let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const now = () => new Date().toISOString();

// Writes are serialized per client only, so a second (non-active) GM could read
// stale state and overwrite the active GM's save. Only the active GM writes.
const notActiveGM = { ok: false, error: "notActiveGM" } as const;

/** Apply a reducer to the current tracker. Reducers receive `now` for end timestamps. */
export function commit(reducer: (state: Endeavour, now: string) => Result): Promise<Result> {
  return serialize(async () => {
    if (!game.user.isActiveGM) return notActiveGM;
    const store = getStore();
    if (!store.current) return { ok: false, error: "notActive" } as const;
    const wasActive = store.current.status === "active";
    const result = reducer(store.current, now());
    if (!result.ok) return result;
    const ended = wasActive && result.value.status !== "active";
    await setStore({
      current: result.value,
      history: ended ? pushHistory(store.history, summarize(result.value)) : store.history,
    });
    if (ended) await postSummary(result.value);
    return result;
  });
}

/**
 * Start a new tracker. An active one is abandoned into history, unless
 * `replace` is false: then it is kept and the start fails with `alreadyActive`.
 * The check runs inside the write queue, so two starts can't both see none active.
 */
export function startEndeavour(input: NewEndeavourInput, { replace = true }: { replace?: boolean } = {}): Promise<Result> {
  return serialize(async () => {
    if (!game.user.isActiveGM) return notActiveGM;
    const store = getStore();
    const previous = store.current;
    if (previous?.status === "active" && !replace) return { ok: false, error: "alreadyActive" } as const;
    const result = createEndeavour(input, foundry.utils.randomID(), now());
    if (!result.ok) return result;
    const history =
      previous?.status === "active"
        ? pushHistory(store.history, summarize({ ...previous, status: "abandoned", endedAt: now() }))
        : store.history;
    await setStore({ current: result.value, history });
    return result;
  });
}

/** Remove the (ended) tracker from the HUD. History is kept. */
export function clearEndeavour(): Promise<Result<null>> {
  return serialize(async () => {
    if (!game.user.isActiveGM) return notActiveGM;
    const store = getStore();
    await setStore({ current: null, history: store.history });
    return { ok: true, value: null } as const;
  });
}
