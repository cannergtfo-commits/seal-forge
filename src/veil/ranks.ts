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

/** Ash, the second rank. One Founding Forge pack. */
export const GIFT_LEVEL = 2;

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
