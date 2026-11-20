import type {
  CardDef,
  PlayEffect,
  RequiemEffect,
  SurgeEffect,
  TitheEffect,
  TrapKind,
} from "./cards";
import { KEYWORDS, TAG_ORDER, type Keyword, type KeywordId } from "./keywords";

/**
 * One template for every card:
 *
 *   `Keyword, Keyword. <static rule>. Play: <effect>. Surge: <effect>. Tithe N: <effect>. Requiem: <effect>. — <flavor>`
 *
 * Spells print their effect without "Play:". Traps start with "Trap. When they attack: …".
 * The text is generated from the data, so a rule change always updates the card face.
 */
export function cardText(card: CardDef): string {
  const rules = rulesText(card);
  if (!card.flavor) return rules;
  return rules ? `${rules} — ${card.flavor}` : card.flavor;
}

/** Rules only, without flavor. */
export function rulesText(card: CardDef): string {
  const parts: string[] = [];
  const tags: string[] = TAG_ORDER.filter((tag) => card.tags.includes(tag)).map(
    (tag) => KEYWORDS[tag].label,
  );
  if (card.plating) tags.push(`${KEYWORDS.plating.label} ${card.plating}`);
  if (tags.length) parts.push(`${tags.join(", ")}.`);
  if (card.noAttack) parts.push("Can't attack.");
  if (card.aura === "goblinAtk") parts.push("Your other Rixen have +1 attack.");
  if (card.aura === "goblinSwift") parts.push("Your Rixen can attack the turn they're played.");
  if (card.kind === "trap" && card.trap) parts.push(trapText(card.trap));
  if (card.play)
    parts.push(
      card.kind === "unit" ? `Play: ${lower(effectText(card.play))}` : effectText(card.play),
    );
  if (card.surge) parts.push(`Surge: ${lower(surgeText(card.surge, card))}`);
  if (card.tithe) parts.push(`Tithe ${card.tithe.n}: ${lower(titheText(card.tithe.effect, card))}`);
  if (card.requiem) parts.push(`Requiem: ${lower(requiemText(card.requiem))}`);
  return parts.join(" ");
}

function lower(text: string): string {
  // Keyword verbs keep their capital ("Play: Unseal a unit.").
  if (Object.values(KEYWORDS).some((kw) => kw.kind === "effect" && text.startsWith(`${kw.label} `))) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function effectText(effect: PlayEffect): string {
  switch (effect.t) {
    case "healSelf":
      return `Heal ${effect.n}.${effect.bloomDraw ? ` If you control a Bloom unit, draw ${effect.bloomDraw}.` : ""}`;
    case "loseHp":
      return `Lose ${effect.n} life.`;
    case "draw":
      return effect.lose > 0
        ? `Draw ${effect.n} and lose ${effect.lose} life. This can't drop you below 1.`
        : `Draw ${effect.n}.`;
    case "hit":
      return `Deal ${effect.n} to a unit or a player.${effect.selfLose ? ` Then lose ${effect.selfLose} life.` : ""}`;
    case "healUnit":
      return `Heal an ally unit ${effect.n}.`;
    case "buff":
      return `An ally unit gets +${effect.a}/+${effect.h}.`;
    case "rally":
      return "Your units get +1 attack this turn. Your Formation units also get +1 health.";
    case "charge": {
      const n = effect.n ?? 2;
      const hit = effect.selfHit ?? 1;
      return `An ally unit gets +${n} attack this turn${hit ? ` and takes ${hit}` : ""}.`;
    }
    case "freeze":
      return "Freeze a unit.";
    case "overclock":
      return "A Quorin ally gets +2/+1 and can attack this turn.";
    case "twin":
      return "If you control another Rixen, this gets +1/+1.";
    case "apex": {
      const h = effect.h ?? (effect.plating ? 0 : 1);
      const gains = [h ? `+0/+${h}` : "", effect.plating ? `Plating ${effect.plating}` : ""]
        .filter(Boolean)
        .join(" and ");
      return `Your other Quorin get ${gains}.`;
    }
    case "boom":
      return "Deal 1 to the rival.";
    case "grantHaste":
      return "An ally unit gains Haste this turn.";
    case "unseal":
      return effect.freezeEnemy ? "Unseal a unit. If it's an enemy, freeze it." : "Unseal a unit.";
  }
}

export function titheText(effect: TitheEffect, card: Pick<CardDef, "kind">): string {
  switch (effect.t) {
    case "draw":
      return `Draw ${effect.n}${card.kind === "spell" ? " more" : ""}.`;
    case "self":
      return `This gets +${effect.a}/+${effect.h}.`;
    case "grant":
      return `This gains ${effect.tag.charAt(0).toUpperCase()}${effect.tag.slice(1)}.`;
  }
}

export function surgeText(effect: SurgeEffect, card: Pick<CardDef, "kind">): string {
  switch (effect.t) {
    case "self": {
      const stats = effect.a || effect.h ? `+${effect.a}/+${effect.h}` : "";
      if (effect.haste) return stats ? `This gets ${stats} and Haste.` : "This gains Haste.";
      return `This gets ${stats}.`;
    }
    case "target":
      return `${card.kind === "unit" ? "That unit" : "It"} also gets +${effect.a}/+${effect.h}.`;
    case "ping":
      return `Deal ${effect.n} to the rival.`;
    case "draw":
      return `Draw ${effect.n}.`;
  }
}

export function requiemText(effect: RequiemEffect): string {
  switch (effect.t) {
    case "heal":
      return `Heal ${effect.n}.`;
    case "draw":
      return `Draw ${effect.n}.`;
    case "ping":
      return `Deal ${effect.n} to the rival.`;
    case "lose":
      return `You lose ${effect.n} life.`;
    case "healAlly":
      return `Heal your most damaged unit ${effect.n}.`;
    case "recall":
      return `Return another random ${effect.faction === "veil" ? "Unbound" : "seal"} card from your grave to your hand.`;
  }
}

export function trapText(kind: TrapKind): string {
  switch (kind) {
    case "pikes":
      return "Trap. When they attack: deal 3 to an attacker.";
    case "snare":
      return "Trap. When they attack: destroy an attacker with 2 or less attack.";
    case "glade":
      return "Trap. When they attack: heal 2 and deal 1 to an attacker.";
    case "firewall":
      return "Trap. When they attack: prevent the next 4 damage to you.";
    case "cross":
      return "Trap. When they attack: deal 2 to an attacker.";
    case "horizon":
      return "Trap. When they attack: deal 2 to an attacker and freeze it.";
    case "soul":
      return "Trap. Springs by itself when any unit dies: heal 3.";
  }
}

/**
 * Every keyword a card uses, in print order, for card faces, tooltips and the tutorial.
 * Reminder text comes from the registry.
 */
export function keywordsOf(card: CardDef): Keyword[] {
  const ids: KeywordId[] = [];
  for (const tag of TAG_ORDER) if (card.tags.includes(tag)) ids.push(tag);
  if (card.plating) ids.push("plating");
  if (card.noAttack) ids.push("noAttack");
  if (card.kind === "trap") ids.push("trap");
  if (card.play?.t === "unseal") ids.push("unseal");
  if (
    card.play?.t === "freeze" ||
    card.trap === "horizon" ||
    (card.play?.t === "unseal" && card.play.freezeEnemy)
  )
    ids.push("freeze");
  if (card.kind === "unit" && card.play) ids.push("play");
  if (card.surge) ids.push("surge");
  if (card.tithe) ids.push("tithe");
  if (card.tithe?.effect.t === "grant") ids.push(card.tithe.effect.tag);
  if (card.requiem) ids.push("requiem");
  return ids.map((id) => KEYWORDS[id]);
}

/** One reviewable line per card for `__snapshots__/card-text.txt`. */
export function goldenLine(card: CardDef): string {
  return `${card.id}\tv${card.version}\t${card.cost}\t${card.kind === "unit" ? `${card.atk}/${card.hp}` : "-"}\t${card.text}`;
}
