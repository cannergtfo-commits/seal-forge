// Balance sims. Usage:
//   node --import ./scripts/ts-resolve.mjs scripts/sim/run.ts [--games 20000] [--starter 200] [--style guard,aggro] [--gate] [--csv out.csv]
// Gate (Techno #6): every seal 45-55% and every card's played win rate 40-60% (cards played in >= --min games).
import { writeFileSync } from "node:fs";
import { CARDS, type Faction } from "../../src/veil/cards.ts";
import type { BotStyle } from "../../src/veil/bots.ts";
import { duel } from "./sim.ts";

const args = process.argv.slice(2);
function opt(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback;
}
const GAMES = Number(opt("games", "20000"));
const STARTER = Number(opt("starter", "200"));
const STYLES = opt("style", "guard,aggro").split(",") as BotStyle[];
const MIN = Number(opt("min", "300"));
const GATE = args.includes("--gate");
const F: Faction[] = ["elf", "human", "goblin", "robot", "demon"];

let rng = 12345;
const rand = () => (rng = (Math.imul(rng, 1103515245) + 12345) >>> 0) / 4294967296;
const pct = (w: number, n: number) => (n ? ((w / n) * 100).toFixed(1) : "-");

// 1) Starter decks, every pairing, both seats.
if (STARTER > 0) {
  const style = STYLES[0]!;
  let first = 0;
  let games = 0;
  let turns = 0;
  console.log(
    `STARTER ${style} vs ${style}, ${STARTER} games per cell (row = seat 0, plays first)`,
  );
  console.log("        " + F.map((f) => f.padStart(7)).join(""));
  for (const a of F) {
    const row: string[] = [];
    for (const b of F) {
      let w = 0;
      for (let i = 0; i < STARTER; i++) {
        const res = duel(
          [null, null],
          [a, b],
          [style, style],
          1 + i * 7919 + F.indexOf(a) * 31 + F.indexOf(b),
        );
        if (res.winner === 0) w++;
        games++;
        turns += res.turns;
      }
      first += w;
      row.push(pct(w, STARTER).padStart(7));
    }
    console.log(a.padEnd(8) + row.join(""));
  }
  console.log(`first-player win ${pct(first, games)}%, avg turns ${(turns / games).toFixed(1)}`);
}

// 2) Random-pool decks: the seal's pool plus about half the Unbound pool.
function deck(f: Faction): string[] {
  const pool = CARDS.filter(
    (card) => card.faction === f || (card.faction === "veil" && rand() < 0.5),
  );
  const out: string[] = [];
  while (out.length < 20) {
    const card = pool[Math.floor(rand() * pool.length)]!;
    if (out.filter((id) => id === card.id).length < 2) out.push(card.id);
  }
  return out;
}

const seal: Record<string, [number, number]> = {};
const played: Record<string, [number, number]> = {};
const included: Record<string, [number, number]> = {};
let stalls = 0;
let firstWins = 0;
let decided = 0;
for (let g = 0; g < GAMES; g++) {
  const a = F[Math.floor(rand() * 5)]!;
  const b = F[Math.floor(rand() * 5)]!;
  const da = deck(a);
  const db = deck(b);
  const styles: [BotStyle, BotStyle] = [
    STYLES[g % STYLES.length]!,
    STYLES[Math.floor(g / STYLES.length) % STYLES.length]!,
  ];
  const res = duel([da, db], [a, b], styles, g + 99);
  if (res.winner === null) {
    stalls++;
    continue;
  }
  decided++;
  if (res.winner === 0) firstWins++;
  for (const [side, list, f] of [
    [0, da, a],
    [1, db, b],
  ] as const) {
    const won = res.winner === side ? 1 : 0;
    seal[f] ??= [0, 0];
    seal[f][0] += won;
    seal[f][1]++;
    for (const id of new Set(list)) {
      included[id] ??= [0, 0];
      included[id][0] += won;
      included[id][1]++;
    }
    for (const id of res.played[side]) {
      played[id] ??= [0, 0];
      played[id][0] += won;
      played[id][1]++;
    }
  }
}

console.log(
  `\nRANDOM-POOL ${GAMES} games, styles ${STYLES.join("/")}, first-player win ${pct(firstWins, decided)}%, stalls ${stalls}`,
);
const failures: string[] = [];
for (const f of F) {
  const [w, n] = seal[f] ?? [0, 0];
  const rate = n ? w / n : 0;
  console.log(`  ${f.padEnd(7)} ${pct(w, n)}%`);
  if (rate < 0.45 || rate > 0.55) failures.push(`seal ${f} ${pct(w, n)}%`);
}
const rows = CARDS.map((card) => {
  const [pw, pn] = played[card.id] ?? [0, 0];
  const [iw, inn] = included[card.id] ?? [0, 0];
  return {
    id: card.id,
    faction: card.faction,
    cost: card.cost,
    played: pn ? pw / pn : NaN,
    pn,
    included: inn ? iw / inn : NaN,
    inn,
  };
}).sort((x, y) => y.played - x.played);
for (const row of rows)
  if (row.pn >= MIN && (row.played < 0.4 || row.played > 0.6))
    failures.push(`card ${row.id} ${(row.played * 100).toFixed(1)}%`);
console.log("\nTop 12 cards by played win rate:");
for (const row of rows.filter((r) => r.pn >= MIN).slice(0, 12))
  console.log(
    `  ${row.id.padEnd(22)} ${row.faction.padEnd(6)} ${(row.played * 100).toFixed(1)}% (${row.pn})`,
  );
console.log("Bottom 12:");
for (const row of rows.filter((r) => r.pn >= MIN).slice(-12))
  console.log(
    `  ${row.id.padEnd(22)} ${row.faction.padEnd(6)} ${(row.played * 100).toFixed(1)}% (${row.pn})`,
  );
const csv = opt("csv", "");
if (csv) {
  writeFileSync(
    csv,
    [
      "id,faction,cost,played_wr,played_n,included_wr,included_n",
      ...rows.map((r) =>
        [r.id, r.faction, r.cost, r.played.toFixed(3), r.pn, r.included.toFixed(3), r.inn].join(
          ",",
        ),
      ),
    ].join("\n") + "\n",
  );
}
console.log(`\nGate: ${failures.length ? `${failures.length} outside bounds` : "pass"}`);
if (failures.length) console.log("  " + failures.slice(0, 40).join("\n  "));
if (GATE && failures.length) process.exit(1);
