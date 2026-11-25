/**
 * Multiple sealed decks per wallet (off-chain). The active deck is mirrored into
 * veil_profiles.deck / deck_name, which every older code path (matchmaking client,
 * progress backups, the keeper-signed progress message) keeps reading unchanged.
 *
 * Card ownership is checked by the caller-supplied `owns` (the existing read-only
 * `deckOwned` helper in production), exactly as single-deck sealing did.
 * Takes the SQL client so the rules can be unit-tested against PGLite.
 */
import { randomBytes } from "node:crypto";
import type { Sql } from "@/lib/db";
import { cleanDeckName, deckSeal, parseDeck } from "./ranks";

export const MAX_DECKS = 6;

export type SealedDeck = {
  id: string;
  name: string;
  cards: string[];
  seal: string;
  active: boolean;
  createdAt: string | null;
  /** Server-scored matches played with exactly these cards (from veil_room_results.deck). */
  record: { games: number; wins: number };
};

export type Owns = (
  wallet: string,
  cards: string[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

type DeckRow = {
  id: string;
  wallet: string;
  name: string;
  cards: string;
  created_at: unknown;
  updated_at: unknown;
};

const ID_SHAPE = /^dk[0-9a-f]{16}$/;

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** Order-insensitive key for a card list, so a match result can be tied back to a deck. */
export function deckKey(cards: string[] | string): string {
  const list = Array.isArray(cards) ? cards : cards.split(",");
  return list.filter(Boolean).sort().join(",");
}

function newId(): string {
  return `dk${randomBytes(8).toString("hex")}`;
}

async function profileRow(sql: Sql, wallet: string) {
  const rows = await sql<{
    deck: string;
    deck_name: string;
    active_deck: string;
  }>`select deck, deck_name, active_deck from veil_profiles where address = ${wallet}`;
  return rows[0] ?? null;
}

async function setActive(
  sql: Sql,
  wallet: string,
  deck: { id: string; name: string; cards: string } | null,
): Promise<void> {
  if (deck)
    await sql`update veil_profiles set active_deck = ${deck.id}, deck = ${deck.cards}, deck_name = ${deck.name} where address = ${wallet}`;
  else
    await sql`update veil_profiles set active_deck = ${""}, deck = ${""}, deck_name = ${""} where address = ${wallet}`;
}

/**
 * Bring veil_decks in line with the profile mirror. An older client that still
 * saves through `op: "save"` writes veil_profiles.deck directly; a profile restored
 * from a backup may have a deck but no deck rows. Either way the mirror wins for
 * the active slot, and nothing sealed is ever dropped.
 */
export async function reconcileDecks(sql: Sql, walletIn: string): Promise<void> {
  const wallet = walletIn.toLowerCase();
  const profile = await profileRow(sql, wallet);
  if (!profile) return;
  const mirror = profile.deck ?? "";
  const active = profile.active_deck
    ? (
        await sql<DeckRow>`select * from veil_decks where id = ${profile.active_deck} and wallet = ${wallet}`
      )[0]
    : undefined;
  if (!mirror) {
    if (profile.active_deck)
      await sql`update veil_profiles set active_deck = ${""} where address = ${wallet}`;
    return;
  }
  if (active) {
    if (active.cards !== mirror || active.name !== (profile.deck_name ?? "")) {
      await sql`update veil_decks set cards = ${mirror}, name = ${profile.deck_name ?? ""}, updated_at = now() where id = ${active.id}`;
    }
    return;
  }
  // No active row: reuse a deck with the same cards, or adopt the mirror as a new deck.
  const all = await sql<DeckRow>`select * from veil_decks where wallet = ${wallet}`;
  const same = all.find((row) => deckKey(row.cards) === deckKey(mirror));
  const id = same?.id ?? newId();
  if (!same)
    await sql`insert into veil_decks (id, wallet, name, cards) values (${id}, ${wallet}, ${profile.deck_name ?? ""}, ${mirror})`;
  await sql`update veil_profiles set active_deck = ${id} where address = ${wallet}`;
}

export async function listDecks(sql: Sql, walletIn: string): Promise<SealedDeck[]> {
  const wallet = walletIn.toLowerCase();
  await reconcileDecks(sql, wallet);
  const [rows, profile, results] = await Promise.all([
    sql<DeckRow>`select * from veil_decks where wallet = ${wallet} order by created_at asc, id asc`,
    profileRow(sql, wallet),
    sql<{
      win: boolean;
      deck: string;
    }>`select win, deck from veil_room_results where wallet = ${wallet} and deck <> ''`,
  ]);
  const tally = new Map<string, { games: number; wins: number }>();
  for (const result of results) {
    const key = deckKey(result.deck);
    const t = tally.get(key) ?? { games: 0, wins: 0 };
    t.games += 1;
    if (result.win) t.wins += 1;
    tally.set(key, t);
  }
  return rows.map((row) => {
    const cards = row.cards.split(",").filter(Boolean);
    const sealed = deckSeal(cards);
    return {
      id: row.id,
      name: row.name,
      cards,
      seal: sealed.ok ? sealed.seal : "veil",
      active: row.id === profile?.active_deck,
      createdAt: iso(row.created_at),
      record: tally.get(deckKey(cards)) ?? { games: 0, wins: 0 },
    };
  });
}

export type DeckResult = { decks: SealedDeck[] } | { error: string };

/** Seal a new deck (no id) or reseal an existing one. Same validity and ownership rules as before. */
export async function sealDeck(
  sql: Sql,
  walletIn: string,
  input: { id?: unknown; name?: unknown; cards?: unknown; activate?: unknown },
  owns: Owns,
): Promise<DeckResult> {
  const wallet = walletIn.toLowerCase();
  await reconcileDecks(sql, wallet);
  const parsed = parseDeck(input.cards);
  if (!parsed.ok) return { error: parsed.error };
  const name = cleanDeckName(typeof input.name === "string" ? input.name : "");
  if (name === null) return { error: "Deck names are 2 to 18 letters or numbers." };
  const existing =
    await sql<DeckRow>`select * from veil_decks where wallet = ${wallet} order by created_at asc`;
  const id = typeof input.id === "string" && input.id ? input.id : "";
  if (id && !ID_SHAPE.test(id)) return { error: "Unknown deck." };
  const target = id ? existing.find((row) => row.id === id) : undefined;
  if (id && !target) return { error: "Unknown deck." };
  if (!target && existing.length >= MAX_DECKS)
    return { error: `You can keep ${MAX_DECKS} sealed decks. Unseal one first.` };
  const key = deckKey(parsed.deck);
  const twin = existing.find((row) => row.id !== target?.id && deckKey(row.cards) === key);
  if (twin)
    return { error: `These exact cards are already sealed as ${twin.name || "another deck"}.` };
  const owned = await owns(wallet, parsed.deck);
  if (!owned.ok) return { error: owned.error };
  const cards = parsed.deck.join(",");
  const profile = await profileRow(sql, wallet);
  if (!profile) return { error: "Sign in again." };
  let deckId = target?.id ?? "";
  if (target) {
    await sql`update veil_decks set cards = ${cards}, name = ${name}, updated_at = now() where id = ${target.id}`;
  } else {
    deckId = newId();
    await sql`insert into veil_decks (id, wallet, name, cards) values (${deckId}, ${wallet}, ${name}, ${cards})`;
  }
  const makeActive =
    input.activate === true || !profile.active_deck || profile.active_deck === deckId;
  if (makeActive) await setActive(sql, wallet, { id: deckId, name, cards });
  return { decks: await listDecks(sql, wallet) };
}

export async function renameDeck(
  sql: Sql,
  walletIn: string,
  id: unknown,
  nameIn: unknown,
): Promise<DeckResult> {
  const wallet = walletIn.toLowerCase();
  await reconcileDecks(sql, wallet);
  if (typeof id !== "string" || !ID_SHAPE.test(id)) return { error: "Unknown deck." };
  const name = cleanDeckName(typeof nameIn === "string" ? nameIn : "");
  if (name === null) return { error: "Deck names are 2 to 18 letters or numbers." };
  const rows = await sql<{
    id: string;
  }>`update veil_decks set name = ${name}, updated_at = now() where id = ${id} and wallet = ${wallet} returning id`;
  if (!rows.length) return { error: "Unknown deck." };
  const profile = await profileRow(sql, wallet);
  if (profile?.active_deck === id)
    await sql`update veil_profiles set deck_name = ${name} where address = ${wallet}`;
  return { decks: await listDecks(sql, wallet) };
}

export async function activateDeck(sql: Sql, walletIn: string, id: unknown): Promise<DeckResult> {
  const wallet = walletIn.toLowerCase();
  await reconcileDecks(sql, wallet);
  if (typeof id !== "string" || !ID_SHAPE.test(id)) return { error: "Unknown deck." };
  const rows = await sql<DeckRow>`select * from veil_decks where id = ${id} and wallet = ${wallet}`;
  if (!rows[0]) return { error: "Unknown deck." };
  await setActive(sql, wallet, rows[0]);
  return { decks: await listDecks(sql, wallet) };
}

/** Unseal (delete) a deck. If it was active, the oldest remaining deck becomes active. */
export async function unsealDeck(sql: Sql, walletIn: string, id: unknown): Promise<DeckResult> {
  const wallet = walletIn.toLowerCase();
  await reconcileDecks(sql, wallet);
  if (typeof id !== "string" || !ID_SHAPE.test(id)) return { error: "Unknown deck." };
  const removed = await sql<{
    id: string;
  }>`delete from veil_decks where id = ${id} and wallet = ${wallet} returning id`;
  if (!removed.length) return { error: "Unknown deck." };
  const profile = await profileRow(sql, wallet);
  if (profile?.active_deck === id) {
    const next = (
      await sql<DeckRow>`select * from veil_decks where wallet = ${wallet} order by created_at asc, id asc limit 1`
    )[0];
    await setActive(sql, wallet, next ?? null);
  }
  return { decks: await listDecks(sql, wallet) };
}
