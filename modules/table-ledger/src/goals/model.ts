import type { CharacterGoals, GoalView } from "../adapters/types";

/** Clamp a goal level to the integer range [0, max]. */
export function clampLevel(level: number, max: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.min(Math.max(Math.trunc(level), 0), Math.max(0, Math.trunc(max)));
}

export const isComplete = (goal: Pick<GoalView, "level" | "max">): boolean => goal.level >= goal.max;

/** Level after a left-click (+1) or right-click (-1), clamped. */
export const stepLevel = (goal: Pick<GoalView, "level" | "max">, delta: 1 | -1): number =>
  clampLevel(goal.level + delta, goal.max);

export interface Pip {
  index: number;
  filled: boolean;
}

export function buildPips(level: number, max: number): Pip[] {
  const filled = clampLevel(level, max);
  return Array.from({ length: Math.max(0, Math.trunc(max)) }, (_, index) => ({ index, filled: index < filled }));
}

/** Incomplete goals first; original order kept within each group. */
export function sortGoals<T extends Pick<GoalView, "level" | "max">>(goals: readonly T[]): T[] {
  return goals
    .map((goal, i) => ({ goal, i }))
    .sort((a, b) => Number(isComplete(a.goal)) - Number(isComplete(b.goal)) || a.i - b.i)
    .map(({ goal }) => goal);
}

export function sortCharacters<T extends Pick<CharacterGoals, "actorName">>(characters: readonly T[]): T[] {
  return [...characters].sort((a, b) => a.actorName.localeCompare(b.actorName));
}

export const filterCompleted = <T extends Pick<GoalView, "level" | "max">>(goals: readonly T[], hideCompleted: boolean): T[] =>
  hideCompleted ? goals.filter((g) => !isComplete(g)) : [...goals];

export interface GoalRow extends GoalView {
  complete: boolean;
  pips: Pip[];
}

export interface CharacterRow extends CharacterGoals {
  goals: GoalRow[];
  completedCount: number;
  totalCount: number;
  /** Goals were hidden by the completed filter. */
  hiddenCount: number;
}

/** View model for one character: sorted, optionally filtered goals with pips. */
export function toCharacterRow(character: CharacterGoals, hideCompleted = false): CharacterRow {
  const completedCount = character.goals.filter(isComplete).length;
  const visible = filterCompleted(sortGoals(character.goals), hideCompleted);
  return {
    ...character,
    goals: visible.map((g) => ({ ...g, complete: isComplete(g), pips: buildPips(g.level, g.max) })),
    completedCount,
    totalCount: character.goals.length,
    hiddenCount: character.goals.length - visible.length,
  };
}

export const toCharacterRows = (characters: readonly CharacterGoals[], hideCompleted = false): CharacterRow[] =>
  sortCharacters(characters).map((c) => toCharacterRow(c, hideCompleted));
