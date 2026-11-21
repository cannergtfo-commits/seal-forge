/**
 * Profile page stats, aggregated from what the server already records:
 * veil_room_results (one row per scored server match), veil_prizes (one signed
 * win voucher per room) and veil_profiles. Read-only. Nothing here talks to the
 * chain or signs anything; it takes the SQL client so it can be unit-tested.
 */
import type { Sql } from "@/lib/db";

export type SealPlay = { faction: string; games: number; wins: number };
export type CardPlay = { id: string; games: number };

export type ProfileStats = {
  /** Server-scored matches in the result ledger (may be fewer than the profile record, which includes restored backups). */
  scored: number;
  wins: number;
  losses: number;
  vsBot: { games: number; wins: number };
  vsHuman: { games: number; wins: number };
  streak: { current: number; currentWin: boolean | null; best: number };
  /** Last ten results, newest first. */
  form: boolean[];
  avgTurns: number | null;
  /** Per-seal plays, most played first. faction "" = played before seal tracking existed. */
  seals: SealPlay[];
  mostPlayedSeal: string | null;
  /** Cards that appeared in the most recorded decks (only matches that brought a deck). */
  favoriteCards: CardPlay[];
  firstMatchAt: string | null;
  /** Win vouchers the server signed for this wallet. Whether each was claimed is on chain. */
  vouchers: { signed: number; matchIds: string[] };
  mmr: number;
  mmrGames: number;
  /** Token ids of the five Founding cards the first-win gift transferred. */
  giftTokens: string[];
};

type ResultRow = {
  win: boolean;
  vs_bot: boolean;
  turns: number;
  faction: string | null;
  deck: string | null;
  created_at: unknown;
};

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function summarize(
  rows: ResultRow[],
): Omit<ProfileStats, "vouchers" | "mmr" | "mmrGames" | "giftTokens"> {
  const vsBot = { games: 0, wins: 0 };
  const vsHuman = { games: 0, wins: 0 };
  const seals = new Map<string, SealPlay>();
  const cards = new Map<string, number>();
  let wins = 0;
  let turns = 0;
  let turnGames = 0;
  let run = 0;
  let best = 0;
  for (const row of rows) {
    const win = Boolean(row.win);
    if (win) wins += 1;
    const bucket = row.vs_bot ? vsBot : vsHuman;
    bucket.games += 1;
    if (win) bucket.wins += 1;
    const t = Number(row.turns) || 0;
    if (t > 0) {
      turns += t;
      turnGames += 1;
    }
    const faction = row.faction ?? "";
    const seal = seals.get(faction) ?? { faction, games: 0, wins: 0 };
    seal.games += 1;
    if (win) seal.wins += 1;
    seals.set(faction, seal);
    const deck = (row.deck ?? "").split(",").filter(Boolean);
    for (const id of new Set(deck)) cards.set(id, (cards.get(id) ?? 0) + 1);
    run = win ? run + 1 : 0;
    if (run > best) best = run;
  }
  let current = 0;
  let currentWin: boolean | null = null;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const win = Boolean(rows[i]!.win);
    if (currentWin === null) currentWin = win;
    if (win !== currentWin) break;
    current += 1;
  }
  const sealList = [...seals.values()].sort(
    (a, b) => b.games - a.games || b.wins - a.wins || a.faction.localeCompare(b.faction),
  );
  const known = sealList.filter((seal) => seal.faction);
  const favoriteCards = [...cards.entries()]
    .map(([id, games]) => ({ id, games }))
    .sort((a, b) => b.games - a.games || a.id.localeCompare(b.id))
    .slice(0, 3);
  return {
    scored: rows.length,
    wins,
    losses: rows.length - wins,
    vsBot,
    vsHuman,
    streak: { current, currentWin, best },
    form: rows
      .slice(-10)
      .reverse()
      .map((row) => Boolean(row.win)),
    avgTurns: turnGames ? Math.round((turns / turnGames) * 10) / 10 : null,
    seals: sealList,
    mostPlayedSeal: known[0]?.faction ?? null,
    favoriteCards,
    firstMatchAt: rows[0] ? iso(rows[0].created_at) : null,
  };
}

export async function profileStats(sql: Sql, wallet: string): Promise<ProfileStats> {
  const id = wallet.toLowerCase();
  const [rows, prizes, profile] = await Promise.all([
    sql<ResultRow>`select win, vs_bot, turns, faction, deck, created_at from veil_room_results where wallet = ${id} order by created_at asc, room_id asc`,
    sql<{
      match_id: string;
    }>`select match_id from veil_prizes where wallet = ${id} and signed_at is not null order by created_at asc`,
    sql<{
      mmr: number;
      mmr_games: number;
      gift_cards: string | null;
    }>`select mmr, mmr_games, gift_cards from veil_profiles where address = ${id}`,
  ]);
  return {
    ...summarize(rows),
    vouchers: {
      signed: prizes.length,
      matchIds: prizes.map((row) => row.match_id).filter((m) => /^0x[0-9a-fA-F]{64}$/.test(m)),
    },
    mmr: Number(profile[0]?.mmr ?? 1000) || 1000,
    mmrGames: Number(profile[0]?.mmr_games ?? 0) || 0,
    giftTokens: (profile[0]?.gift_cards ?? "").split(",").filter((t) => /^\d+$/.test(t)),
  };
}
