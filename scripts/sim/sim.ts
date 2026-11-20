// Headless bot-vs-bot duel runner. Pure game rules, no UI, no network.
import { startMatch, type Match, type Side } from "../../src/veil/logic.ts";
import { actorOf, stepRival } from "../../src/veil/ai.ts";
import type { BotStyle } from "../../src/veil/bots.ts";
import type { Faction } from "../../src/veil/cards.ts";

export type Result = { winner: Side | null; turns: number; played: [Set<string>, Set<string>] };

export function duel(
  decks: [string[] | null, string[] | null],
  factions: [Faction, Faction],
  styles: [BotStyle, BotStyle],
  seed: number,
): Result {
  let m = startMatch(factions[0], factions[1], seed, decks);
  const played: [Set<string>, Set<string>] = [new Set(), new Set()];
  for (let i = 0; i < 3000 && m.winner === null; i++) {
    const actor = actorOf(m);
    const next = stepRival(m, styles[actor], actor);
    if (!next) break;
    for (const side of [0, 1] as Side[]) {
      const after = new Set(next.players[side].hand.map((card) => card.uid));
      for (const card of m.players[side].hand)
        if (!after.has(card.uid)) played[side].add(card.defId);
    }
    m = next;
  }
  return { winner: m.winner, turns: m.turnCount, played };
}
