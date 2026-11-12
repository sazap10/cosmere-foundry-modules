type PartyCandidate = { id: string; hasPlayerOwner: boolean };

/**
 * The party: characters assigned to non-GM users (User Configuration →
 * Character). Worlds accumulate player-owned test builds and group actors, so
 * ownership alone over-counts. Falls back to player-owned characters only when
 * no player has an assigned character.
 */
export function partyActors<T>(isCharacter: (actor: unknown) => actor is T & PartyCandidate): T[] {
  const assigned: T[] = [];
  const seen = new Set<string>();
  for (const user of game.users.contents) {
    const actor = user.isGM ? null : user.character;
    if (actor && isCharacter(actor) && !seen.has(actor.id)) {
      seen.add(actor.id);
      assigned.push(actor);
    }
  }
  if (assigned.length) return assigned;
  return (game.actors.contents as unknown[]).filter(
    (a): a is T & PartyCandidate => isCharacter(a) && a.hasPlayerOwner,
  );
}
