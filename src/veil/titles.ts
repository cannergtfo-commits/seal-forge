/**
 * Title and badge catalog, unlock evaluation, and grant/equip helpers.
 * Rules run against already-tracked stats (wins, XP, gift, sealed decks,
 * per-seal wins, daily-clear streaks). Nothing here talks to the chain.
 */
import type { Sql } from "@/lib/db";
import { utcDay } from "./integrity-store";
import { rankFor } from "./ranks";

export type TitleRarity = "common" | "rare" | "epic" | "legendary";
export type TitleRule =
  | "wins"
  | "xp"
  | "gifted"
  | "streak"
  | "seal-wins"
  | "seals-touched"
  | "decks"
  | "season";

export type TitleDef = {
  id: string;
  name: string;
  flavor: string;
  rarity: TitleRarity;
  badge: string;
  rule: TitleRule;
  threshold: number;
  param: string;
  sort: number;
};

export type TitleProgress = { current: number; target: number; unlocked: boolean };

export type PlayerTitleStats = {
  xp: number;
  wins: number;
  gifted: boolean;
  decks: number;
  sealWins: Record<string, number>;
  clearDays: string[];
  today: string;
  /** Season placement is a placeholder until FEATURE_SEASONS ships. */
  seasonPlace: number | null;
};

export const SEAL_FACTIONS = ["elf", "human", "goblin", "robot", "demon"] as const;

export const TITLES: readonly TitleDef[] = [
  { id: "first-oath", name: "First Oath", flavor: "The first mark on the ledger.", rarity: "common", badge: "spark", rule: "wins", threshold: 1, param: "", sort: 10 },
  { id: "founding-bearer", name: "Founding Bearer", flavor: "A Founding Forge pack, once, from the gift pool.", rarity: "rare", badge: "pack", rule: "gifted", threshold: 1, param: "", sort: 20 },
  { id: "ashborne", name: "Ashborne", flavor: "Out of the spark, into the ash.", rarity: "common", badge: "ash", rule: "xp", threshold: 40, param: "", sort: 30 },
  { id: "the-sealed", name: "The Sealed", flavor: "The name is bound. The work begins.", rarity: "rare", badge: "crest", rule: "xp", threshold: 120, param: "", sort: 40 },
  { id: "wardens-oath", name: "Warden's Oath", flavor: "The five seals keep their watch.", rarity: "rare", badge: "crest", rule: "xp", threshold: 300, param: "", sort: 50 },
  { id: "champions-crest", name: "Champion's Crest", flavor: "A crest earned, not given.", rarity: "epic", badge: "crest", rule: "xp", threshold: 700, param: "", sort: 60 },
  { id: "sovereign-crown", name: "Sovereign", flavor: "The high seat, at the end of the long climb.", rarity: "legendary", badge: "crown", rule: "xp", threshold: 1400, param: "", sort: 70 },
  { id: "proven", name: "Proven", flavor: "Ten victories, counted by the server.", rarity: "common", badge: "spark", rule: "wins", threshold: 10, param: "", sort: 80 },
  { id: "warhost", name: "Warhost", flavor: "Fifty wins. The hall knows the name.", rarity: "rare", badge: "crest", rule: "wins", threshold: 50, param: "", sort: 90 },
  { id: "hundred-seals", name: "Hundred Seals", flavor: "A hundred wins, each one signed in.", rarity: "epic", badge: "crown", rule: "wins", threshold: 100, param: "", sort: 100 },
  { id: "ember-path", name: "Ember Path", flavor: "Three days of claiming every daily win.", rarity: "rare", badge: "flame", rule: "streak", threshold: 3, param: "", sort: 110 },
  { id: "week-of-seals", name: "Week of Seals", flavor: "Seven straight days of a full claim.", rarity: "epic", badge: "flame", rule: "streak", threshold: 7, param: "", sort: 120 },
  { id: "iron-month", name: "Iron Month", flavor: "Thirty days. The path does not break.", rarity: "legendary", badge: "flame", rule: "streak", threshold: 30, param: "", sort: 130 },
  { id: "aureth-adept", name: "Aureth Adept", flavor: "Ten wins under the goldwood seal.", rarity: "rare", badge: "seal-elf", rule: "seal-wins", threshold: 10, param: "elf", sort: 140 },
  { id: "veymar-adept", name: "Veymar Adept", flavor: "Ten wins under the iron oath.", rarity: "rare", badge: "seal-human", rule: "seal-wins", threshold: 10, param: "human", sort: 150 },
  { id: "rixen-adept", name: "Rixen Adept", flavor: "Ten wins under the raider drum.", rarity: "rare", badge: "seal-goblin", rule: "seal-wins", threshold: 10, param: "goblin", sort: 160 },
  { id: "quorin-adept", name: "Quorin Adept", flavor: "Ten wins under the forge-light.", rarity: "rare", badge: "seal-robot", rule: "seal-wins", threshold: 10, param: "robot", sort: 170 },
  { id: "malrec-adept", name: "Malrec Adept", flavor: "Ten wins under the crimson seal.", rarity: "rare", badge: "seal-demon", rule: "seal-wins", threshold: 10, param: "demon", sort: 180 },
  { id: "five-walks", name: "Walker of Five Seals", flavor: "A win in every seal. The pentacle closes.", rarity: "legendary", badge: "pentacle", rule: "seals-touched", threshold: 5, param: "", sort: 190 },
  { id: "two-oaths", name: "Two Oaths", flavor: "Two sealed decks, ready to be called.", rarity: "common", badge: "decks", rule: "decks", threshold: 2, param: "", sort: 200 },
  { id: "hex-of-oaths", name: "Hex of Oaths", flavor: "Six decks sealed. The forge is full.", rarity: "epic", badge: "decks", rule: "decks", threshold: 6, param: "", sort: 210 },
  { id: "season-contender", name: "Season Contender", flavor: "Season ranks are not open yet. This title waits.", rarity: "epic", badge: "season", rule: "season", threshold: 1, param: "", sort: 220 },
] as const;

export function titleOf(id: string | null | undefined): TitleDef | null {
  if (!id) return null;
  return TITLES.find((row) => row.id === id) ?? null;
}

export function prevUtcDay(day: string): string {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return day;
  return new Date(ms - 86_400_000).toISOString().slice(0, 10);
}

/** Consecutive daily-clear days ending today, or yesterday if today is not yet cleared. */
export function clearStreak(days: string[], today: string): number {
  const set = new Set(days);
  let cursor = set.has(today) ? today : prevUtcDay(today);
  let n = 0;
  while (set.has(cursor)) {
    n += 1;
    cursor = prevUtcDay(cursor);
  }
  return n;
}

export function progressOf(def: TitleDef, stats: PlayerTitleStats): TitleProgress {
  const target = Math.max(1, def.threshold);
  let current = 0;
  if (def.rule === "wins") current = stats.wins;
  else if (def.rule === "xp") current = stats.xp;
  else if (def.rule === "gifted") current = stats.gifted ? 1 : 0;
  else if (def.rule === "streak") current = clearStreak(stats.clearDays, stats.today);
  else if (def.rule === "seal-wins") current = stats.sealWins[def.param] ?? 0;
  else if (def.rule === "seals-touched") {
    current = SEAL_FACTIONS.filter((faction) => (stats.sealWins[faction] ?? 0) > 0).length;
  } else if (def.rule === "decks") current = stats.decks;
  else current = stats.seasonPlace != null && stats.seasonPlace > 0 ? 1 : 0;
  return { current, target, unlocked: current >= target };
}

export function unlockedIds(defs: readonly TitleDef[], stats: PlayerTitleStats): string[] {
  return defs.filter((def) => progressOf(def, stats).unlocked).map((def) => def.id);
}

export async function loadTitleStats(sql: Sql, wallet: string, today: string = utcDay()): Promise<PlayerTitleStats> {
  const id = wallet.toLowerCase();
  const [profile, decks, seals, clears] = await Promise.all([
    sql<{ xp: number; wins: number; gifted: number }>`select xp, wins, gifted from veil_profiles where address = ${id}`,
    sql<{ n: number }>`select count(*)::int as n from veil_decks where wallet = ${id}`,
    sql<{ faction: string; n: number }>`
      select faction, count(*)::int as n
        from veil_room_results
       where wallet = ${id} and win and faction in ('elf', 'human', 'goblin', 'robot', 'demon')
       group by faction`,
    sql<{ utc_day: string }>`select utc_day from veil_daily_clears where wallet = ${id} order by utc_day asc`,
  ]);
  const sealWins: Record<string, number> = {};
  for (const row of seals) sealWins[row.faction] = Number(row.n);
  return {
    xp: Number(profile[0]?.xp ?? 0) || 0,
    wins: Number(profile[0]?.wins ?? 0) || 0,
    gifted: Number(profile[0]?.gifted ?? 0) === 1,
    decks: Number(decks[0]?.n ?? 0) || 0,
    sealWins,
    clearDays: clears.map((row) => row.utc_day),
    today,
    seasonPlace: null,
  };
}

export async function catalog(sql: Sql): Promise<TitleDef[]> {
  const rows = await sql<TitleDef>`
    select id, name, flavor, rarity, badge, rule, threshold, param, sort
      from veil_titles
     order by sort asc, name asc`;
  return rows.map((row) => ({
    ...row,
    threshold: Number(row.threshold) || 0,
    sort: Number(row.sort) || 0,
    param: row.param ?? "",
  }));
}

/**
 * Grant every title the wallet currently qualifies for. Returns only the rows
 * inserted by this call, so a toast can fire once.
 */
export async function grantDueTitles(sql: Sql, wallet: string, today: string = utcDay()): Promise<TitleDef[]> {
  const id = wallet.toLowerCase();
  const [defs, stats] = await Promise.all([catalog(sql), loadTitleStats(sql, id, today)]);
  const due = unlockedIds(defs, stats);
  if (!due.length) return [];
  const fresh: TitleDef[] = [];
  for (const titleId of due) {
    const inserted = await sql<{ title_id: string }>`
      insert into veil_title_unlocks (wallet, title_id) values (${id}, ${titleId})
      on conflict (wallet, title_id) do nothing
      returning title_id`;
    if (inserted.length) {
      const def = defs.find((row) => row.id === titleId);
      if (def) fresh.push(def);
    }
  }
  return fresh;
}

export type EquippedTitle = { id: string; name: string; rarity: TitleRarity; badge: string; flavor: string };

export async function equippedTitle(sql: Sql, wallet: string): Promise<EquippedTitle | null> {
  const rows = await sql<{ title_id: string | null }>`select title_id from veil_profiles where address = ${wallet.toLowerCase()}`;
  const def = titleOf(rows[0]?.title_id);
  return def ? { id: def.id, name: def.name, rarity: def.rarity, badge: def.badge, flavor: def.flavor } : null;
}

export async function equipTitle(sql: Sql, wallet: string, titleId: string | null): Promise<{ equipped: EquippedTitle | null } | { error: string }> {
  const id = wallet.toLowerCase();
  if (!titleId) {
    await sql`update veil_profiles set title_id = '' where address = ${id}`;
    return { equipped: null };
  }
  const def = titleOf(titleId);
  if (!def) return { error: "Unknown title." };
  const held = await sql<{ title_id: string }>`select title_id from veil_title_unlocks where wallet = ${id} and title_id = ${titleId}`;
  if (!held.length) return { error: "That title is still locked." };
  await sql`update veil_profiles set title_id = ${titleId} where address = ${id}`;
  return { equipped: { id: def.id, name: def.name, rarity: def.rarity, badge: def.badge, flavor: def.flavor } };
}

export type TitleView = TitleDef & TitleProgress & { held: boolean };

export async function titlesFor(sql: Sql, wallet: string, today: string = utcDay()): Promise<{ titles: TitleView[]; equipped: string; fresh: TitleDef[] }> {
  const id = wallet.toLowerCase();
  const fresh = await grantDueTitles(sql, id, today);
  const [defs, stats, held, profile] = await Promise.all([
    catalog(sql),
    loadTitleStats(sql, id, today),
    sql<{ title_id: string }>`select title_id from veil_title_unlocks where wallet = ${id}`,
    sql<{ title_id: string | null }>`select title_id from veil_profiles where address = ${id}`,
  ]);
  const unlocked = new Set(held.map((row) => row.title_id));
  const titles = defs.map((def) => ({ ...def, ...progressOf(def, stats), held: unlocked.has(def.id) }));
  return { titles, equipped: profile[0]?.title_id ?? "", fresh };
}

export function rankNameForXp(xp: number): string {
  return rankFor(xp).name;
}
