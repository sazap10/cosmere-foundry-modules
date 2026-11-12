import type { SystemAdapter } from "../types";
import { cosmereGoals } from "./goals";
import { cosmereAbilities } from "./abilities";

export function cosmereAdapter(): SystemAdapter {
  return { systemId: "cosmere-rpg", goals: cosmereGoals, abilities: cosmereAbilities };
}
