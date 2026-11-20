// Headless bot-vs-bot duel runner. Pure game rules, no UI, no network.
import { startMatch, type Match, type Side } from "../../src/veil/logic.ts";
import { stepRival } from "../../src/veil/ai.ts";
import type { BotStyle } from "../../src/veil/bots.ts";
import type { Faction } from "../../src/veil/cards.ts";

function mirror(m: Match): Match {
  const x = structuredClone(m);
  x.players = [x.players[1], x.players[0]];
  for (const seat of x.players) {
    for (const unit of seat.units) unit.owner = (1 - unit.owner) as Side;
    for (const trap of seat.traps) trap.owner = (1 - trap.owner) as Side;
  }
  x.turn = (1 - x.turn) as Side;
  if (x.winner !== null) x.winner = (1 - x.winner) as Side;
  return x;
}

function seat0Decides(m: Match): boolean {
  return (
    (m.turn === 0 && m.phase === "main") ||
    (m.turn === 1 && (m.phase === "trap" || m.phase === "defend"))
  );
}

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
    let next: Match | null;
    if (seat0Decides(m)) {
      const stepped = stepRival(mirror(m), styles[0]);
      next = stepped ? mirror(stepped) : null;
    } else next = stepRival(m, styles[1]);
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
