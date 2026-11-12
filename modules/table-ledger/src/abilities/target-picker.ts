// Target picker shown before a targeted ability is used. Choosing a token
// targets it for the user (so the system's hit/miss tray and Apply buttons
// work); party members without a token can still be chosen for ally
// abilities, which only the heal prompt needs.
import { localize } from "../constants";
import { partyActors } from "../party";
import { orderCandidates, type TargetCandidate, type TargetSide } from "./targeting";

export type PickResult = { kind: "target"; actorUuid: string; tokenId?: string } | { kind: "none" } | { kind: "cancel" };

interface ActorLike {
  id: string;
  uuid: string;
  name: string;
  img?: string;
  type: string;
  hasPlayerOwner: boolean;
}

interface TokenLike {
  id: string;
  name: string;
  actor: ActorLike | null;
  document: { disposition: number; hidden: boolean; texture?: { src?: string } };
  setTarget(targeted: boolean, options: { releaseOthers: boolean; groupSelection: boolean }): void;
}

function isCharacter(actor: unknown): actor is ActorLike {
  return typeof actor === "object" && actor !== null && "type" in actor && actor.type === "character";
}

function sceneTokens(): TokenLike[] {
  const placeables: unknown = game.canvas?.tokens?.placeables;
  return Array.isArray(placeables) ? (placeables as TokenLike[]) : [];
}

function candidates(side: TargetSide, user: ActorLike | null): TargetCandidate[] {
  const party = partyActors<ActorLike>(isCharacter);
  const partyIds = new Set(party.map((a) => a.id));
  const out: TargetCandidate[] = [];
  const onScene = new Set<string>();
  for (const token of sceneTokens()) {
    const actor = token.actor;
    // Players never see hidden tokens; the GM does.
    if (!actor || (token.document.hidden && !game.user.isGM)) continue;
    onScene.add(actor.id);
    out.push({
      actorUuid: actor.uuid,
      // PC tokens may carry the player's name; NPC tokens carry the specific label ("Nimbleform scout (2)").
      name: isCharacter(actor) ? actor.name : token.name,
      img: token.document.texture?.src ?? actor.img,
      tokenId: token.id,
      disposition: partyIds.has(actor.id) ? 1 : token.document.disposition,
      isSelf: actor.id === user?.id,
    });
  }
  // Ally abilities can reach party members who aren't on this scene.
  if (side === "ally") {
    for (const actor of party) {
      if (onScene.has(actor.id)) continue;
      out.push({ actorUuid: actor.uuid, name: actor.name, img: actor.img, disposition: 1, isSelf: actor.id === user?.id });
    }
  }
  return orderCandidates(out, side);
}

function row(c: TargetCandidate, index: number): string {
  const esc = foundry.utils.escapeHTML;
  const where = c.tokenId ? "" : ` <span class="tl-abilities-picker-note">${esc(localize("Abilities.Picker.OffScene"))}</span>`;
  return `<label class="tl-abilities-picker-row">
    <input type="radio" name="target" value="${index}" ${index === 0 ? "checked" : ""}>
    ${c.img ? `<img src="${esc(c.img)}" alt="">` : ""}
    <span>${esc(c.name)}${c.isSelf ? ` ${esc(localize("Abilities.Picker.Self"))}` : ""}${where}</span>
  </label>`;
}

/** Ask who the ability is used on. Resolves after the target (if any) is set. */
export async function pickTarget(abilityName: string, side: TargetSide, user: ActorLike | null): Promise<PickResult> {
  const list = candidates(side, user);
  const esc = foundry.utils.escapeHTML;
  const content = `<p>${esc(localize(side === "ally" ? "Abilities.Picker.AllyPrompt" : "Abilities.Picker.EnemyPrompt", { name: abilityName }))}</p>
    ${list.length ? `<div class="tl-abilities-picker">${list.map(row).join("")}</div>` : `<p>${esc(localize("Abilities.Picker.Empty"))}</p>`}`;
  const choice: unknown = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("Abilities.Picker.Title"), icon: "fa-solid fa-crosshairs" },
    classes: ["tl-abilities-picker-dialog"],
    content,
    buttons: [
      ...(list.length
        ? [
            {
              action: "target",
              label: localize("Abilities.Picker.Use"),
              icon: "fa-solid fa-bullseye",
              default: true,
              callback: (_event: Event, button: HTMLButtonElement) =>
                Number(new FormData(button.form ?? undefined).get("target")),
            },
          ]
        : []),
      { action: "none", label: localize("Abilities.Picker.NoTarget"), icon: "fa-solid fa-dice-d20" },
      { action: "cancel", label: localize("Abilities.Picker.Cancel"), icon: "fa-solid fa-xmark" },
    ],
    rejectClose: false,
  });
  if (choice === "none") return { kind: "none" };
  if (typeof choice !== "number" || !list[choice]) return { kind: "cancel" };
  const picked = list[choice];
  if (picked.tokenId) {
    sceneTokens()
      .find((t) => t.id === picked.tokenId)
      ?.setTarget(true, { releaseOthers: true, groupSelection: false });
  }
  return { kind: "target", actorUuid: picked.actorUuid, tokenId: picked.tokenId };
}
