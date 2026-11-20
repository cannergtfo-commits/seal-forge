// Difficulty ladder check: each level against the one below, all seals, both seats.
//   node --import ./scripts/ts-resolve.mjs scripts/sim/ladder.ts [--games 40]
import type { BotStyle } from "../../src/veil/bots.ts";
import type { Faction } from "../../src/veil/cards.ts";
import { duel } from "./sim.ts";

const at = process.argv.indexOf("--games");
const N = at >= 0 ? Number(process.argv[at + 1]) : 40;
const F: Faction[] = ["elf", "human", "goblin", "robot", "demon"];

export function versus(a: BotStyle, b: BotStyle, games = N): { rate: number; ms: number } {
  let wins = 0;
  let total = 0;
  const start = Date.now();
  for (const fa of F)
    for (const fb of F)
      for (let i = 0; i < games; i++) {
        const seed = 7 + i * 104729 + F.indexOf(fa) * 13 + F.indexOf(fb) * 101;
        const first = duel([null, null], [fa, fb], [a, b], seed);
        const second = duel([null, null], [fb, fa], [b, a], seed + 1);
        if (first.winner === 0) wins++;
        if (second.winner === 1) wins++;
        total += 2;
      }
  return { rate: wins / total, ms: (Date.now() - start) / total };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [a, b] of [
    ["guard", "easy"],
    ["aggro", "easy"],
    ["hard", "guard"],
    ["hard", "aggro"],
    ["hard", "easy"],
  ] as [BotStyle, BotStyle][]) {
    const { rate, ms } = versus(a, b);
    console.log(
      `${a.padEnd(6)} vs ${b.padEnd(6)} ${(rate * 100).toFixed(1)}%  (${ms.toFixed(1)} ms/game)`,
    );
  }
}
