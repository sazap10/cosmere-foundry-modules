import { MODULE_ID, localize, template } from "../constants";
import { registerTool } from "../controls";
import { askGM, registerQuery } from "../queries";
import { excerpt, linkLabel, recapPageName, recapPageSort, textToHtml, validateRecap, type RecapPayload } from "./payload";
import { sanitizeHtml } from "./sanitize";

declare const CONST: {
  DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: number };
  JOURNAL_ENTRY_PAGE_FORMATS: { HTML: number };
};

/** The slice of Foundry's JournalEntry / JournalEntryPage API used here. */
interface RecapPage {
  uuid: string;
  getFlag(scope: string, key: string): unknown;
  update(data: object): Promise<unknown>;
}

interface RecapJournal {
  name: string;
  uuid: string;
  ownership?: { default?: number };
  pages: { contents: RecapPage[]; find(fn: (p: RecapPage) => boolean): RecapPage | undefined };
  getFlag(scope: string, key: string): unknown;
  update(data: object): Promise<unknown>;
  createEmbeddedDocuments(type: "JournalEntryPage", data: object[]): Promise<RecapPage[]>;
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const JOURNAL_NAME = "Session Recaps";

export interface PostRecapResult {
  ok: true;
  journalUuid: string;
  pageUuid: string;
}

/** The recap journal: flagged by this module, falling back to one named "Session Recaps". */
function findRecapJournal(): RecapJournal | null {
  return (
    game.journal.find((j: RecapJournal) => j.getFlag(MODULE_ID, "recaps") === true) ??
    game.journal.find((j: RecapJournal) => j.name === JOURNAL_NAME) ??
    null
  );
}

async function ensureRecapJournal(): Promise<RecapJournal> {
  const observer = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const existing = findRecapJournal();
  if (!existing) {
    return JournalEntry.create({
      name: JOURNAL_NAME,
      ownership: { default: observer },
      flags: { [MODULE_ID]: { recaps: true } },
    });
  }
  const update: Record<string, unknown> = {};
  if ((existing.ownership?.default ?? 0) < observer) update["ownership.default"] = observer;
  if (existing.getFlag(MODULE_ID, "recaps") !== true) update[`flags.${MODULE_ID}.recaps`] = true;
  if (Object.keys(update).length) await existing.update(update);
  return existing;
}

/** Create or update the page for `recap.session`, then post a chat card linking to it. GM only. */
export async function postRecap(recap: RecapPayload): Promise<PostRecapResult> {
  const journal = await ensureRecapJournal();
  const name = recapPageName(recap.session, recap.title);
  const content = sanitizeHtml(recap.html);
  const flags = { [MODULE_ID]: { session: recap.session, date: recap.date ?? null } };
  const pageData = {
    name,
    sort: recapPageSort(recap.session),
    text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
    flags,
  };

  let page = journal.pages.find((p) => p.getFlag(MODULE_ID, "session") === recap.session);
  if (page) await page.update(pageData);
  else [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{ ...pageData, type: "text" }]);

  const card = await foundry.applications.handlebars.renderTemplate(template("recap/card.hbs"), {
    heading: localize("Recap.Card.Heading", { session: recap.session }),
    title: recap.title,
    date: recap.date,
    excerpt: excerpt(content),
    link: `@UUID[${page.uuid}]{${linkLabel(localize("Recap.Card.Read"))}}`,
  });
  await ChatMessage.create({ content: card, speaker: { alias: localize("Recap.Card.Speaker") } });

  return { ok: true, journalUuid: journal.uuid, pageUuid: page.uuid };
}

/** Next session number: one past the highest recap already posted. */
function nextSession(): number {
  const pages = findRecapJournal()?.pages.contents ?? [];
  const sessions = pages.map((p) => p.getFlag(MODULE_ID, "session")).filter((s): s is number => typeof s === "number");
  return sessions.length ? Math.max(...sessions) + 1 : 1;
}

/** GM form for posting a recap without the planner. */
class RecapForm extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "tl-recap-form",
    tag: "form",
    classes: ["tl-recap-form"],
    window: { title: "TABLE_LEDGER.Recap.Form.Title", icon: "fa-solid fa-scroll", resizable: true },
    position: { width: 520, height: "auto" },
    form: { handler: submitRecapForm, closeOnSubmit: true },
  };

  static PARTS = { form: { template: template("recap/form.hbs") } };

  async _prepareContext() {
    return { session: nextSession() };
  }
}

async function submitRecapForm(_event: Event, _form: HTMLFormElement, formData: { object: Record<string, unknown> }) {
  const o = formData.object;
  const result = validateRecap({
    session: o.session,
    title: o.title,
    date: o.date,
    html: typeof o.body === "string" ? textToHtml(o.body) : o.body,
  });
  if (!result.ok) {
    ui.notifications.error(localize("Recap.Form.Invalid", { error: result.error }));
    throw new Error(result.error);
  }
  await askGM<PostRecapResult>("postRecap", result.value);
  ui.notifications.info(localize("Recap.Form.Posted", { session: result.value.session }));
}

export function init() {
  registerQuery("postRecap", async (data) => {
    const result = validateRecap(data);
    if (!result.ok) throw new Error(`${MODULE_ID}.postRecap: ${result.error}`);
    return postRecap(result.value);
  });

  registerTool({
    name: "recap",
    // Scene-control titles are localized by core; i18n isn't ready during init.
    title: "TABLE_LEDGER.Recap.Tool",
    icon: "fa-solid fa-scroll",
    gmOnly: true,
    onClick: () => new RecapForm().render({ force: true }),
  });
}
