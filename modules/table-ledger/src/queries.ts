import { MODULE_ID } from "./constants";

/** The user that sent the request, as established by the server (not taken from the payload). */
export interface QueryUser {
  id: string;
  name: string;
  isGM: boolean;
  [key: string]: unknown;
}

export type QueryHandler = (data: unknown, caller: QueryUser) => Promise<unknown> | unknown;

/**
 * Who may invoke a GM-side query. Both run on the active GM:
 * - `gm`: only GM callers. For anything that writes world state.
 * - `player`: any caller; the handler must authorise the caller itself.
 */
export type QueryAccess = "gm" | "player";

const EVENT = `module.${MODULE_ID}`;
const TIMEOUT = 10_000;

interface RequestMessage {
  type: "request";
  id: string;
  name: string;
  data: unknown;
}
interface ResponseMessage {
  type: "response";
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

const handlers = new Map<string, { handler: QueryHandler; access: QueryAccess }>();
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
let listening = false;

/**
 * Core queries (`CONFIG.queries`) don't say who sent them on v13: the handler
 * only gets the payload. Module socket listeners do get the sender's user id,
 * stamped by the server, so GM-side requests travel over the module socket and
 * the sender is resolved from that id, never from the payload.
 */
function listen() {
  if (listening) return;
  listening = true;
  game.socket.on(EVENT, (message: RequestMessage | ResponseMessage, senderId: string) => {
    if (message?.type === "request") void onRequest(message, senderId);
    else if (message?.type === "response") onResponse(message, senderId);
  });
}

async function run(name: string, data: unknown, caller: QueryUser | undefined): Promise<unknown> {
  const entry = handlers.get(name);
  if (!entry) throw new Error(`${MODULE_ID}.${name}: unknown query`);
  if (!caller) throw new Error(`${MODULE_ID}.${name}: caller unknown`);
  if (entry.access === "gm" && !caller.isGM) throw new Error(`${MODULE_ID}.${name}: GM only`);
  return entry.handler(data, caller);
}

async function onRequest({ id, name, data }: RequestMessage, senderId: string) {
  if (!game.user.isActiveGM) return; // only the active GM answers
  const reply = (body: Omit<ResponseMessage, "type" | "id">) =>
    game.socket.emit(EVENT, { type: "response", id, ...body } satisfies ResponseMessage, { recipients: [senderId] });
  try {
    reply({ ok: true, value: await run(name, data, game.users.get(senderId)) });
  } catch (err) {
    reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function onResponse({ id, ok, value, error }: ResponseMessage, senderId: string) {
  // Only the active GM's answers count; other players see request ids too.
  if (senderId !== game.users.activeGM?.id) return;
  const waiter = pending.get(id);
  if (!waiter) return;
  pending.delete(id);
  if (ok) waiter.resolve(value);
  else waiter.reject(new Error(error));
}

/** Register a GM-side query. Names are prefixed with the module id in errors only. */
export function registerQuery(name: string, handler: QueryHandler, { access = "gm" }: { access?: QueryAccess } = {}) {
  handlers.set(name, { handler, access });
  listen();
}

/**
 * Register a core query (`CONFIG.queries`) that runs on the receiving client.
 * The sender is unknown, so only use this for handlers that are harmless to
 * trigger, e.g. opening a dialog.
 */
export function registerClientQuery(name: string, handler: (data: unknown) => Promise<unknown> | unknown) {
  CONFIG.queries[`${MODULE_ID}.${name}`] = async (data: unknown) => handler(data);
}

/** Run a GM-side query: locally when this client is the active GM, else via the active GM. */
export async function askGM<T = unknown>(name: string, data: unknown): Promise<T> {
  if (game.user.isActiveGM) return (await run(name, data, game.user)) as T;
  const gm = game.users.activeGM;
  if (!gm) throw new Error("No GM is connected.");
  const id = foundry.utils.randomID();
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`${MODULE_ID}.${name}: no answer from the GM`));
  }, TIMEOUT);
  pending.set(id, {
    resolve: (value) => (clearTimeout(timer), resolve(value as T)),
    reject: (err) => (clearTimeout(timer), reject(err)),
  });
  game.socket.emit(EVENT, { type: "request", id, name, data } satisfies RequestMessage, { recipients: [gm.id] });
  return promise;
}

/** Wrap an async handler so calls run one at a time: two requests can't both pass a check before the first records its result. */
export function serialize<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let queue: Promise<unknown> = Promise.resolve();
  return (...args) => {
    const run = queue.then(() => fn(...args));
    queue = run.catch(() => undefined);
    return run;
  };
}
