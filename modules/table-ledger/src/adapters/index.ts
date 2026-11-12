import type { SystemAdapter } from "./types";
import { cosmereAdapter } from "./cosmere";

const ADAPTERS: Record<string, () => SystemAdapter> = {
  "cosmere-rpg": cosmereAdapter,
};

/** Adapter for the active system; an empty adapter when the system is unsupported. */
export function resolveAdapter(systemId: string): SystemAdapter {
  return ADAPTERS[systemId]?.() ?? { systemId };
}
