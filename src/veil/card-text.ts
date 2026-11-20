import type { CardDef, PlayEffect, TrapKind } from "./cards";
import { KEYWORDS, TAG_ORDER, type Keyword, type KeywordId } from "./keywords";

/**
 * One template for every card:
 *
 *   `Keyword, Keyword. <static rule>. Play: <effect>. When this dies: <effect>. — <flavor>`
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
  const tags = TAG_ORDER.filter((tag) => card.tags.includes(tag)).map((tag) => KEYWORDS[tag].label);
  if (tags.length) parts.push(`${tags.join(", ")}.`);
  if (card.noAttack) parts.push("Can't attack.");
  if (card.aura === "goblinAtk") parts.push("Your other Rixen have +1 attack.");
  if (card.aura === "goblinSwift") parts.push("Your Rixen can attack the turn they're played.");
  if (card.kind === "trap" && card.trap) parts.push(trapText(card.trap));
  if (card.play)
    parts.push(
      card.kind === "unit" ? `Play: ${lower(effectText(card.play))}` : effectText(card.play),
    );
  if (card.deathHeal) parts.push(`When this dies: heal ${card.deathHeal}.`);
  return parts.join(" ");
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function effectText(effect: PlayEffect): string {
  switch (effect.t) {
    case "healSelf":
      return `Heal ${effect.n}.`;
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
      return "Your units get +1 attack this turn.";
    case "charge":
      return "An ally unit gets +2 attack this turn and takes 1.";
    case "freeze":
      return "Freeze a unit.";
    case "overclock":
      return "A Quorin ally gets +2/+1 and can attack this turn.";
    case "twin":
      return "If you control another Rixen, this gets +1/+1.";
    case "apex":
      return "Your other Quorin get +0/+1.";
    case "boom":
      return "Deal 1 to the rival.";
    case "grantHaste":
      return "An ally unit gains Haste this turn.";
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
  if (card.noAttack) ids.push("noAttack");
  if (card.kind === "trap") ids.push("trap");
  if (card.play?.t === "freeze" || card.trap === "horizon") ids.push("freeze");
  if (card.kind === "unit" && card.play) ids.push("play");
  if (card.deathHeal) ids.push("lastBreath");
  return ids.map((id) => KEYWORDS[id]);
}
