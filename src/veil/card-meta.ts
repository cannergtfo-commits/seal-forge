/**
 * Presentation adapter for card faces: keyword pills, rarity gem tier and the
 * set/format badge.
 *
 * Keyword ids, labels, reminders and icons come from S2's registry
 * (`src/veil/keywords.ts`, `keywordsOf` in `card-text.ts`), and sets from
 * `src/veil/sets.ts`, so rules text and card chrome can't drift. Card UI must
 * import only from here.
 */
import type { CardDef } from "@/veil/cards";
import { keywordsOf } from "@/veil/card-text";
import { KEYWORDS, type KeywordId } from "@/veil/keywords";
import { rarityLabel, rarityTier } from "@/veil/pack-score";
import { STANDARD_SETS, SETS, formatsOf, setInfo, type Format } from "@/veil/sets";

export type PillId = KeywordId | "aura";

export type Pill = { id: PillId; label: string; reminder: string; icon: string };

const AURA: Pill = {
  id: "aura",
  label: "Aura",
  reminder: "Always on while this unit is on the board.",
  icon: "✺",
};

/** Keyword pills in print order: unit tags and statics, aura, then triggers/effects. Trap cards skip the "Trap" pill. */
export function cardPills(card: CardDef): Pill[] {
  const out: Pill[] = [];
  const kws = keywordsOf(card).filter((kw) => kw.id !== "trap");
  for (const kw of kws) if (kw.kind === "tag" || kw.kind === "static") out.push(pillOf(kw.id));
  if (card.aura) out.push(AURA);
  for (const kw of kws) if (kw.kind !== "tag" && kw.kind !== "static") out.push(pillOf(kw.id));
  return out;
}

function pillOf(id: KeywordId): Pill {
  const { label, reminder, icon } = KEYWORDS[id];
  return { id, label, reminder, icon };
}

/**
 * Gem ladder: common grey, rare blue, epic purple, legendary gold.
 * Chain rarity has three tiers today (pinned on-chain), so they map to
 * common/rare/legendary and the labels stay exactly as before. `epic` is held
 * for a future set that ships a fourth tier.
 */
export type GemTier = "common" | "rare" | "epic" | "legendary";

export function gemTier(card: CardDef): GemTier {
  const tier = rarityTier(card.rarity, card.set);
  if (tier === "legendary") return "legendary";
  if (tier === "rare") return "rare";
  return "common";
}

export function rarityName(card: CardDef): string {
  return rarityLabel(card.rarity, card.set);
}

export type { Format };

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export type SetBadge = {
  setNo: number;
  numeral: string;
  name: string;
  format: Format;
  label: string;
};

export function setBadge(card: CardDef): SetBadge {
  const known = SETS.some((s) => s.key === card.set);
  const info = known ? setInfo(card.set) : { setNo: 0, name: card.set };
  const format: Format =
    known && formatsOf(card.set).includes("standard") ? "standard" : known ? "eternal" : "standard";
  return {
    setNo: info.setNo,
    numeral: ROMAN[info.setNo] ?? String(info.setNo),
    name: info.name,
    format,
    label: `Set ${info.setNo} · ${info.name} · ${format === "standard" ? "Standard" : "Eternal only"}`,
  };
}

/** Kept for callers that showed the Standard window size. */
export const STANDARD_WINDOW = STANDARD_SETS;
