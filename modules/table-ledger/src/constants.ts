export const MODULE_ID = "table-ledger";

/** Template path helper: templates live in `templates/` at the module root. */
export const template = (path: string) => `modules/${MODULE_ID}/templates/${path}`;

export const localize = (key: string, data?: Record<string, unknown>): string =>
  data
    ? game.i18n.format(`TABLE_LEDGER.${key}`, data)
    : game.i18n.localize(`TABLE_LEDGER.${key}`);
