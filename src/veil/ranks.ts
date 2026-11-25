import { cardOf, type Faction } from "./cards";

export const PORTRAITS = [
  "lysara",
  "dawnbow",
  "starlit",
  "thorn-dryad",
  "aldren",
  "oath-knight",
  "marshal",
  "scout",
  "skarn",
  "raider",
  "drummer",
  "scrap",
  "apex",
  "lance",
  "sentry",
  "welder",
  "vex",
  "tyrant",
  "blood-knight",
  "hexbrand",
] as const;

export const DECK_SIZE = 20;
export const COPY_CAP = 2;
export const WIN_XP = 20;
export const LOSS_XP = 10;
/** Bonus XP for claiming all four daily win vouchers. Two wins' worth (WIN_XP * 2). A perfect day is then 120 XP, one step from Spark to Seal. */
export const DAILY_CLEAR_XP = 40;
export const DAILY_CLEAR_WINS = 4;

const RANKS = [
  { name: "Spark", min: 0 },
  { name: "Ash", min: 40 },
  { name: "Seal", min: 120 },
  { name: "Warden", min: 300 },
  { name: "Champion", min: 700 },
  { name: "Sovereign", min: 1400 },
] as const;

export function rankFor(xp: number): { level: number; name: string; min: number; next: number | null } {
  const safe = Math.max(0, Math.floor(xp));
  let index = 0;
  for (let i = 0; i < RANKS.length; i++) if (safe >= RANKS[i].min) index = i;
  const current = RANKS[index] ?? RANKS[0];
  const next = RANKS[index + 1]?.min ?? null;
  return { level: index + 1, name: current.name, min: current.min, next };
}

/** The free Founding Forge pack unlocks after this many server-scored wins (was: reach level 2). */
export const GIFT_WINS = 1;

export { MMR_START, eloDelta, mmrBand } from "./mmr";

export function cleanName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 18) return null;
  if (!/^[\p{L}\p{N} ]+$/u.test(name)) return null;
  return name;
}

export function cleanDeckName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (!name) return "";
  if (name.length < 2 || name.length > 18) return null;
  if (!/^[\p{L}\p{N} ]+$/u.test(name)) return null;
  return name;
}

/** Display-only tier for the matchmaking rating (never used for pairing). */
export function mmrTier(mmr: number, games: number): { name: string; step: number } {
  if (games <= 0) return { name: "Unrated", step: 0 };
  if (mmr >= 1350) return { name: "Mythforged", step: 5 };
  if (mmr >= 1200) return { name: "Runed", step: 4 };
  if (mmr >= 1050) return { name: "Forged", step: 3 };
  if (mmr >= 900) return { name: "Tempered", step: 2 };
  return { name: "Unproven", step: 1 };
}

export const MOTTO_MAX = 80;

// A light filter for the public motto: only clear slurs and the bluntest swears.
// Matching is on letters only, so "a.s.s" style spacing does not slip through,
// while ordinary words that merely contain a fragment ("classic", "Scunthorpe") pass.
const MOTTO_BLOCK = ["fuck", "fucking", "fucker", "shit", "cunt", "nigger", "nigga", "faggot", "fag", "retard", "whore", "slut", "bitch", "kike", "spic", "chink", "tranny"];

/**
 * Clean an owner-written motto. Returns "" for empty, null when it is not allowed.
 * React renders it as text, so this is about length and decency, not HTML.
 */
export function cleanMotto(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/ {2,}/g, " ")
    .trim();
  if (!text) return "";
  if ([...text].length > MOTTO_MAX) return null;
  if (/https?:\/\/|www\.|\.(com|net|io|xyz|gg)\b/i.test(text)) return null;
  const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const squashed = text.toLowerCase().replace(/[^\p{L}]/gu, "");
  for (const bad of MOTTO_BLOCK) {
    if (words.includes(bad)) return null;
    if (bad.length >= 5 && squashed.includes(bad)) return null;
  }
  return text;
}

export function isPortrait(id: string): boolean {
  return (PORTRAITS as readonly string[]).includes(id);
}

export function parseDeck(ids: unknown): { ok: true; deck: string[] } | { ok: false; error: string } {
  if (!Array.isArray(ids) || ids.length !== DECK_SIZE) return { ok: false, error: "A deck is 20 cards." };
  const counts = new Map<string, number>();
  for (const id of ids) {
    if (typeof id !== "string") return { ok: false, error: "Unknown card." };
    let card;
    try {
      card = cardOf(id);
    } catch {
      return { ok: false, error: "Unknown card." };
    }
    const next = (counts.get(card.id) ?? 0) + 1;
    if (next > COPY_CAP) return { ok: false, error: "Two copies of a card is the limit." };
    counts.set(card.id, next);
  }
  const sealed = deckSeal(ids as string[]);
  if (!sealed.ok) return sealed;
  return { ok: true, deck: ids as string[] };
}

export function deckSeal(ids: string[]): { ok: true; seal: Faction } | { ok: false; error: string } {
  if (ids.length === 0) return { ok: false, error: "A deck is 20 cards." };
  let seal: Exclude<Faction, "veil"> | null = null;
  for (const id of ids) {
    let card;
    try {
      card = cardOf(id);
    } catch {
      return { ok: false, error: "Unknown card." };
    }
    if (card.faction === "veil") continue;
    if (!seal) seal = card.faction;
    else if (seal !== card.faction) return { ok: false, error: "A deck is one seal. Unbound cards can join any seal." };
  }
  // Unbound cards join whatever seal is played. A deck of only those is legal in every seal.
  if (!seal) return { ok: true, seal: "veil" };
  return { ok: true, seal };
}

export function deckFits(deck: string[], balances: Map<string, number>): boolean {
  const counts = new Map<string, number>();
  for (const id of deck) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, count] of counts) if ((balances.get(id) ?? 0) < count) return false;
  return true;
}
