/** Client side of the off-chain sealed-deck API (src/routes/api/veilforge/profile.ts, src/veil/decks.ts). */
import { FACTIONS, type Faction } from "./cards";

/** One sealed deck as the server lists it (see src/veil/decks.ts). */
export type SealedDeck = {
  id: string;
  name: string;
  cards: string[];
  seal: string;
  active: boolean;
  createdAt: string | null;
  record: { games: number; wins: number };
};

export type DeckReply = {
  decks?: SealedDeck[];
  max?: number;
  profile?: unknown;
  seal?: string;
  error?: string;
};

export const SEAL_ART: Record<Faction, string> = {
  elf: "/assets/veil/seals/aureth.jpg",
  human: "/assets/veil/seals/veymar.jpg",
  goblin: "/assets/veil/seals/rixen.jpg",
  robot: "/assets/veil/seals/quorin.jpg",
  demon: "/assets/veil/seals/malrec.jpg",
  veil: "/assets/veil/seals/unbound.jpg",
};

export function sealLabel(faction: string): string {
  return FACTIONS.find((f) => f.id === faction)?.name ?? "Unbound";
}

export function asFaction(seal: string): Faction {
  return (FACTIONS.some((f) => f.id === seal) ? seal : "veil") as Faction;
}

/** Off-chain deck request. The session token proves the wallet; nothing is signed or sent on chain. */
export async function deckRequest(
  token: string,
  op: "deck-seal" | "deck-rename" | "deck-activate" | "deck-unseal",
  extra: Record<string, unknown>,
): Promise<DeckReply & { status: number }> {
  const res = await fetch("/api/veilforge/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op, token, ...extra }),
  });
  const body = (await res
    .json()
    .catch(() => ({ error: `The server answered ${res.status}.` }))) as DeckReply;
  return { ...body, status: res.status };
}

export async function fetchDecks(
  token: string,
): Promise<{ decks: SealedDeck[]; max: number } | null> {
  try {
    const res = await fetch(`/api/veilforge/profile?decks=1&token=${encodeURIComponent(token)}`);
    if (!res.ok) return null;
    const body = (await res.json()) as DeckReply;
    return body.decks ? { decks: body.decks, max: body.max ?? 6 } : null;
  } catch {
    return null;
  }
}
