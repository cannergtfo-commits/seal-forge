/**
 * Releases, NFT editions, formats and reserved id space.
 *
 * Token ids are frozen. Every card carries an explicit `tokenId` literal and
 * `chainRarity`, checked against a snapshot of the chain in
 * `src/veil/__snapshots__/token-map.json`. Never derive them from array order,
 * never reorder or renumber them.
 */
export type CardSet = "founding" | "blazar" | "kage" | "ashen";
export type Edition = "core" | "blazar" | "kage" | "ashen";
export type Format = "standard" | "eternal";

/** Bump when card stats, text or rules change, so stale clients can be told to refresh. */
export const RULES_VERSION = 1;

export type SetInfo = {
  key: CardSet;
  setNo: number;
  name: string;
  /** Off-chain card id prefix. Founding uses bare ids (core) and `un-` (Unbound). */
  prefixes: string[];
  /** Evergreen sets never rotate out of Standard. */
  evergreen: boolean;
};

export const SETS: SetInfo[] = [
  { key: "founding", setNo: 1, name: "Founding", prefixes: ["", "un-"], evergreen: true },
  { key: "blazar", setNo: 2, name: "Blazar Veil", prefixes: ["bz-"], evergreen: false },
  { key: "kage", setNo: 3, name: "Kage Veil", prefixes: ["kg-"], evergreen: false },
  { key: "ashen", setNo: 4, name: "Ashen Veil", prefixes: ["as-"], evergreen: false },
];

/**
 * Space held for the next two releases. Each future set ships as its own NFT
 * edition (a new deployment that needs explicit approval), so its token ids
 * start at 1 again; ownership is keyed by `(edition, tokenId)`.
 * Until a contract exists, a reserved set can ship as free-play-only cards.
 */
export const RESERVED_SETS = [
  { key: "s5", setNo: 5, prefix: "s5-", tokenIds: [1, 120] as const },
  { key: "s6", setNo: 6, prefix: "s6-", tokenIds: [1, 120] as const },
] as const;

/** Minted supply per NFT edition. These ids exist on chain and are pinned. */
export const EDITION_TOKENS: Record<Edition, number> = {
  core: 45,
  blazar: 44,
  kage: 90,
  ashen: 36,
};

/** How many of the newest non-evergreen sets are in Standard. */
export const STANDARD_SETS = 2;

export function setInfo(key: CardSet): SetInfo {
  const found = SETS.find((item) => item.key === key);
  if (!found) throw new Error(`unknown set ${key}`);
  return found;
}

/**
 * Standard is the evergreen Founding cards plus the newest sets.
 * Until a fifth set exists, every released card is Standard.
 * Eternal accepts every card ever printed, forever.
 */
export function formatsOf(set: CardSet): Format[] {
  const info = setInfo(set);
  if (info.evergreen) return ["standard", "eternal"];
  const rotating = SETS.filter((item) => !item.evergreen).sort((a, b) => b.setNo - a.setNo);
  const keep = SETS.length < 5 ? rotating : rotating.slice(0, STANDARD_SETS);
  return keep.some((item) => item.key === set) ? ["standard", "eternal"] : ["eternal"];
}

/** Chain rarity codes stored in `rarityOf[tokenId]`. 1 = base slot, 2/3 = premium. */
export type ChainRarity = 1 | 2 | 3;
