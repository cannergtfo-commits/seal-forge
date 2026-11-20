/**
 * Presentation adapter for card faces: keyword pills, rarity gem tier and the
 * set/format badge.
 *
 * S2 is adding `src/veil/keywords.ts` (KEYWORDS registry, TAG_ORDER) and
 * `src/veil/sets.ts` (SETS, formatsOf, chainRarity). Until those merge, this
 * file carries a small local copy with the same ids, labels and reminder text.
 * Swapping is one step: re-export from the registries and delete the local
 * tables below. Card UI must import only from here.
 */
import type { CardDef } from "@/veil/cards";
import { rarityLabel, rarityTier } from "@/veil/pack-score";

export type PillId =
  | "haste"
  | "swift"
  | "bulwark"
  | "drain"
  | "crush"
  | "noAttack"
  | "aura"
  | "play"
  | "lastBreath"
  | "freeze"
  | "trap";

export type Pill = { id: PillId; label: string; reminder: string; icon: string };

/** Mirrors S2's KEYWORDS (labels + reminders) so the swap is invisible. */
const PILLS: Record<PillId, Omit<Pill, "id">> = {
  haste: { label: "Haste", reminder: "Can attack the turn it's played.", icon: "»" },
  swift: { label: "Swift", reminder: "Can attack the turn it's played.", icon: "»" },
  bulwark: { label: "Bulwark", reminder: "When this attacks, the defender can't block anything else unless this is blocked too.", icon: "⛨" },
  drain: { label: "Drain", reminder: "Damage this deals to a player heals you.", icon: "♥" },
  crush: { label: "Crush", reminder: "Damage past a blocker's health hits the player.", icon: "⚒" },
  noAttack: { label: "Can't attack", reminder: "This unit never attacks. It still blocks.", icon: "⊘" },
  aura: { label: "Aura", reminder: "Always on while this unit is on the board.", icon: "✺" },
  play: { label: "Play", reminder: "Happens when you play this card.", icon: "▶" },
  lastBreath: { label: "Last breath", reminder: "Happens when this unit dies.", icon: "✝" },
  freeze: { label: "Freeze", reminder: "A frozen unit can't block, and it can't attack on its next turn.", icon: "❄" },
  trap: { label: "Trap", reminder: "Set face down. When the rival attacks, you may spring one trap before blocks.", icon: "◆" },
};

const TAG_ORDER = ["haste", "swift", "bulwark", "drain", "crush"] as const;

function pill(id: PillId): Pill {
  return { id, ...PILLS[id] };
}

/** Keyword pills in print order: unit tags, statics, then triggers/effects. */
export function cardPills(card: CardDef): Pill[] {
  const out: Pill[] = [];
  for (const tag of TAG_ORDER) if ((card.tags as string[]).includes(tag)) out.push(pill(tag));
  if ((card as CardDef & { noAttack?: boolean }).noAttack) out.push(pill("noAttack"));
  if (card.aura) out.push(pill("aura"));
  if (card.kind === "unit" && card.play) out.push(pill("play"));
  if (card.deathHeal) out.push(pill("lastBreath"));
  if (card.play?.t === "freeze" || card.trap === "snare" || card.trap === "horizon") out.push(pill("freeze"));
  return out;
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

export type Format = "standard" | "eternal";

/** Mirrors S2's SETS. Founding is evergreen. */
const SETS: Record<CardDef["set"], { setNo: number; name: string; evergreen: boolean }> = {
  founding: { setNo: 1, name: "Founding", evergreen: true },
  blazar: { setNo: 2, name: "Blazar Veil", evergreen: false },
  kage: { setNo: 3, name: "Kage Veil", evergreen: false },
  ashen: { setNo: 4, name: "Ashen Veil", evergreen: false },
};

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** Newest non-evergreen sets in Standard. Until set 5 exists, every card is Standard. */
const STANDARD_SETS = 2;

export type SetBadge = { setNo: number; numeral: string; name: string; format: Format; label: string };

export function setBadge(card: CardDef): SetBadge {
  const info = SETS[card.set] ?? { setNo: 0, name: card.set, evergreen: false };
  const rotating = Object.values(SETS)
    .filter((s) => !s.evergreen)
    .map((s) => s.setNo)
    .sort((a, b) => b - a);
  // Only rotate once there are more rotating sets than Standard holds plus the two released ones.
  const standard = info.evergreen || rotating.length <= STANDARD_SETS + 1 || rotating.slice(0, STANDARD_SETS).includes(info.setNo);
  const format: Format = standard ? "standard" : "eternal";
  return {
    setNo: info.setNo,
    numeral: ROMAN[info.setNo] ?? String(info.setNo),
    name: info.name,
    format,
    label: `Set ${info.setNo} · ${info.name} · ${format === "standard" ? "Standard" : "Eternal only"}`,
  };
}
