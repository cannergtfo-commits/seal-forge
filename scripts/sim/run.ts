// Balance sims. Usage:
//   npm run sim -- [--games 20000] [--starter 200] [--style hard] [--threads 8] [--min 300] [--gate] [--csv out.csv]
//                  [--unbound-share 0.5] [--max-unbound 20]
// Gate (Techno #6): every seal 45-55% and every card's played win rate 40-60% (cards played in >= --min games).
// Each game seeds its own RNG, so results are the same however the games are split across workers.
import { writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { CARDS, type Faction } from "../../src/veil/cards.ts";
import type { BotStyle } from "../../src/veil/bots.ts";
import { duel } from "./sim.ts";

const args = process.argv.slice(2);
function opt(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback;
}
const GAMES = Number(opt("games", "20000"));
const STARTER = Number(opt("starter", "0"));
const STYLES = opt("style", "hard").split(",") as BotStyle[];
const MIN = Number(opt("min", "300"));
const GATE = args.includes("--gate");
const THREADS = Math.max(1, Number(opt("threads", String(Math.min(8, availableParallelism())))));
/** Chance each Unbound card joins a random pool, and an optional cap on Unbound cards per deck (deck-rule test). */
const UNBOUND_SHARE = Number(opt("unbound-share", "0.5"));
const MAX_UNBOUND = Number(opt("max-unbound", "20"));
const F: Faction[] = ["elf", "human", "goblin", "robot", "demon"];

type Tally = Record<string, [number, number]>;
type Chunk = {
  seal: Tally;
  played: Tally;
  included: Tally;
  matrix: Tally;
  unbound: Tally;
  stalls: number;
  firstWins: number;
  decided: number;
  turns: number;
};

const empty = (): Chunk => ({
  seal: {},
  played: {},
  included: {},
  matrix: {},
  unbound: {},
  stalls: 0,
  firstWins: 0,
  decided: 0,
  turns: 0,
});

function bump(tally: Tally, key: string, won: number): void {
  tally[key] ??= [0, 0];
  tally[key][0] += won;
  tally[key][1]++;
}

function rng(seed: number): () => number {
  let s = (Math.imul(seed + 1, 2654435761) + 12345) >>> 0;
  return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
}

/** A random-pool deck: cards from the seal's pool plus about half the Unbound pool. */
function deck(f: Faction, rand: () => number): string[] {
  const pool = CARDS.filter(
    (card) => card.faction === f || (card.faction === "veil" && rand() < UNBOUND_SHARE),
  );
  const out: string[] = [];
  let unbound = 0;
  while (out.length < 20) {
    const card = pool[Math.floor(rand() * pool.length)]!;
    if (card.faction === "veil" && unbound >= MAX_UNBOUND) continue;
    if (out.filter((id) => id === card.id).length < 2) {
      out.push(card.id);
      if (card.faction === "veil") unbound++;
    }
  }
  return out;
}

/** Jobs 0..STARTER*25-1 are starter-deck matrix games; the rest are random-pool games. */
function playJob(job: number, out: Chunk): void {
  const starterJobs = STARTER * 25;
  if (job < starterJobs) {
    const cell = Math.floor(job / STARTER);
    const a = F[Math.floor(cell / 5)]!;
    const b = F[cell % 5]!;
    const style = STYLES[0]!;
    const res = duel([null, null], [a, b], [style, style], 1 + (job % STARTER) * 7919 + cell * 31);
    bump(out.matrix, `${a}>${b}`, res.winner === 0 ? 1 : 0);
    return;
  }
  const g = job - starterJobs;
  const rand = rng(g);
  const a = F[Math.floor(rand() * 5)]!;
  const b = F[Math.floor(rand() * 5)]!;
  const da = deck(a, rand);
  const db = deck(b, rand);
  const styles: [BotStyle, BotStyle] = [
    STYLES[g % STYLES.length]!,
    STYLES[Math.floor(g / STYLES.length) % STYLES.length]!,
  ];
  const res = duel([da, db], [a, b], styles, g + 99);
  out.turns += res.turns;
  if (res.winner === null) {
    out.stalls++;
    return;
  }
  out.decided++;
  if (res.winner === 0) out.firstWins++;
  for (const [side, list, f] of [
    [0, da, a],
    [1, db, b],
  ] as const) {
    const won = res.winner === side ? 1 : 0;
    bump(out.seal, f, won);
    const ub = list.filter((id) => UNBOUND_IDS.has(id)).length;
    bump(out.unbound, ub <= 4 ? "0-4" : ub <= 8 ? "5-8" : ub <= 12 ? "9-12" : "13+", won);
    for (const id of new Set(list)) bump(out.included, id, won);
    for (const id of res.played[side]) bump(out.played, id, won);
  }
}

function merge(into: Chunk, part: Chunk): void {
  for (const key of ["seal", "played", "included", "matrix", "unbound"] as const) {
    for (const [id, [w, n]] of Object.entries(part[key])) {
      into[key][id] ??= [0, 0];
      into[key][id][0] += w;
      into[key][id][1] += n;
    }
  }
  into.stalls += part.stalls;
  into.firstWins += part.firstWins;
  into.decided += part.decided;
  into.turns += part.turns;
}

const UNBOUND_IDS = new Set(CARDS.filter((card) => card.faction === "veil").map((card) => card.id));

const JOBS = STARTER * 25 + GAMES;

if (!isMainThread) {
  const { shard, shards } = workerData as { shard: number; shards: number };
  const out = empty();
  for (let job = shard; job < JOBS; job += shards) playJob(job, out);
  parentPort!.postMessage(out);
} else {
  const total = empty();
  const parts = await Promise.all(
    Array.from(
      { length: THREADS },
      (_, shard) =>
        new Promise<Chunk>((resolve, reject) => {
          const worker = new Worker(new URL(import.meta.url), {
            workerData: { shard, shards: THREADS },
            argv: args,
          });
          worker.once("message", resolve);
          worker.once("error", reject);
        }),
    ),
  );
  for (const part of parts) merge(total, part);
  report(total);
}

function report(total: Chunk): void {
  const pct = (w: number, n: number) => (n ? ((w / n) * 100).toFixed(1) : "-");
  const failures: string[] = [];
  if (STARTER > 0) {
    console.log(
      `STARTER ${STYLES[0]} vs ${STYLES[0]}, ${STARTER} games per cell (row = seat 0, plays first)`,
    );
    console.log("        " + F.map((f) => f.padStart(7)).join(""));
    for (const a of F)
      console.log(
        a.padEnd(8) +
          F.map((b) => pct(...(total.matrix[`${a}>${b}`] ?? [0, 0])).padStart(7)).join(""),
      );
  }
  if (!GAMES) return;
  console.log(
    `\nRANDOM-POOL ${GAMES} games, styles ${STYLES.join("/")}, first-player win ${pct(total.firstWins, total.decided)}%, avg turns ${(total.turns / GAMES).toFixed(1)}, stalls ${total.stalls}`,
  );
  const sealRate: Record<string, number> = {};
  for (const f of F) {
    const [w, n] = total.seal[f] ?? [0, 0];
    sealRate[f] = n ? w / n : 0;
    console.log(`  ${f.padEnd(7)} ${pct(w, n)}%`);
    if (sealRate[f]! < 0.45 || sealRate[f]! > 0.55) failures.push(`seal ${f} ${pct(w, n)}%`);
  }
  console.log("  win rate by Unbound cards in deck:");
  for (const bucket of ["0-4", "5-8", "9-12", "13+"]) {
    const [w, n] = total.unbound[bucket] ?? [0, 0];
    if (n) console.log(`    ${bucket.padEnd(5)} ${pct(w, n)}% (n=${n})`);
  }
  const rows = CARDS.map((card) => {
    const [pw, pn] = total.played[card.id] ?? [0, 0];
    const [iw, inn] = total.included[card.id] ?? [0, 0];
    const playedRate = pn ? pw / pn : NaN;
    // Unbound cards are judged against the seals they were played in, so compare to 50%.
    const base = card.faction === "veil" ? 0.5 : (sealRate[card.faction] ?? 0.5);
    return {
      id: card.id,
      faction: card.faction,
      cost: card.cost,
      played: playedRate,
      pn,
      included: inn ? iw / inn : NaN,
      inn,
      delta: playedRate - base,
    };
  }).sort((x, y) => y.played - x.played);
  for (const row of rows)
    if (row.pn >= MIN && (row.played < 0.4 || row.played > 0.6))
      failures.push(`card ${row.id} ${(row.played * 100).toFixed(1)}%`);
  const line = (row: (typeof rows)[number]) =>
    `  ${row.id.padEnd(22)} ${row.faction.padEnd(6)} ${(row.played * 100).toFixed(1)}% (${row.delta >= 0 ? "+" : ""}${(row.delta * 100).toFixed(1)} vs seal, n=${row.pn})`;
  const enough = rows.filter((row) => row.pn >= MIN);
  console.log("\nTop 12 cards by played win rate:");
  for (const row of enough.slice(0, 12)) console.log(line(row));
  console.log("Bottom 12:");
  for (const row of enough.slice(-12)) console.log(line(row));
  const csv = opt("csv", "");
  if (csv) {
    writeFileSync(
      csv,
      [
        "id,faction,cost,played_wr,played_n,delta_vs_seal,included_wr,included_n",
        ...rows.map((r) =>
          [
            r.id,
            r.faction,
            r.cost,
            r.played.toFixed(3),
            r.pn,
            r.delta.toFixed(3),
            r.included.toFixed(3),
            r.inn,
          ].join(","),
        ),
      ].join("\n") + "\n",
    );
  }
  console.log(`\nGate: ${failures.length ? `${failures.length} outside bounds` : "pass"}`);
  if (failures.length)
    console.log(
      "  " +
        failures.slice(0, 30).join("\n  ") +
        (failures.length > 30 ? `\n  … ${failures.length - 30} more` : ""),
    );
  if (GATE && failures.length) process.exit(1);
}
