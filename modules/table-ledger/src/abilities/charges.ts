// Pure helpers for item counters (charges, uses, ammo). No Foundry globals.

export interface Counter {
  key: string;
  value: number;
  max: number;
}

type RawCounter = { value?: number | null; max?: number | null } | null | undefined;

/** Order shown on a row when an item has more than one counter. */
export const COUNTER_KEYS = ["charges", "uses", "ammo"] as const;

/** Counters an action spends only through a consumption entry (`uses` is spent by the action itself). */
export const CONSUMED_KEYS = ["charges", "ammo"] as const;

/** First counter the item has, or null. */
export function firstCounter(resources: Record<string, RawCounter> | null | undefined): Counter | null {
  for (const key of COUNTER_KEYS) {
    const raw = resources?.[key];
    if (raw && typeof raw.value === "number" && typeof raw.max === "number") return { key, value: raw.value, max: raw.max };
  }
  return null;
}

/** The consumable counter (charges, then ammo) the item carries, or null. */
export function consumableCounter(resources: Record<string, RawCounter> | null | undefined): Counter | null {
  for (const key of CONSUMED_KEYS) {
    const raw = resources?.[key];
    if (raw && typeof raw.value === "number" && typeof raw.max === "number") return { key, value: raw.value, max: raw.max };
  }
  return null;
}

/** A consumption entry that spends one of an item's own counters, for the action embedded in it. */
export function consumptionEntry(key: string) {
  return {
    type: "item_resource",
    resource: key,
    value: { min: 1, max: 1, actual: 1 },
    matchDocument: { steps: [{ target: "parent", reference: null, matchBy: "name", matchMode: "first" }] },
  };
}
