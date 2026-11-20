/**
 * One registry for every keyword and recurring rule term.
 *
 * - `reminder` is the one-line rules text. Card faces, tooltips and the tutorial
 *   should all read it from here so the wording never drifts.
 * - `kind` says where the keyword lives on a card:
 *   - `tag`: a unit keyword stored in `CardDef.tags`.
 *   - `static`: a always-on unit rule stored in its own field (aura, noAttack).
 *   - `trigger`: a timed ability ("Play:", "When this dies:").
 *   - `effect`: a spell or trap verb (Freeze).
 * - `aiValue` is a rough board value in stat points, used by the AI when it
 *   scores plays and threats. Keep it small and honest.
 *
 * Presentation (icons, colors, chips) belongs to the card UI. `icon` is only a
 * short glyph hint the UI may use or ignore.
 */
export type KeywordId =
  "haste" | "bulwark" | "drain" | "crush" | "noAttack" | "play" | "lastBreath" | "freeze" | "trap";

export type KeywordKind = "tag" | "static" | "trigger" | "effect";

export type Keyword = {
  id: KeywordId;
  label: string;
  kind: KeywordKind;
  reminder: string;
  icon: string;
  aiValue: number;
};

export const KEYWORDS: Record<KeywordId, Keyword> = {
  haste: {
    id: "haste",
    label: "Haste",
    kind: "tag",
    reminder: "Can attack the turn it's played.",
    icon: "»",
    aiValue: 1.5,
  },
  bulwark: {
    id: "bulwark",
    label: "Bulwark",
    kind: "tag",
    reminder:
      "When this attacks, the defender can't block anything else unless this is blocked too.",
    icon: "⛨",
    aiValue: 1,
  },
  drain: {
    id: "drain",
    label: "Drain",
    kind: "tag",
    reminder: "Damage this deals to a player heals you.",
    icon: "♥",
    aiValue: 1.5,
  },
  crush: {
    id: "crush",
    label: "Crush",
    kind: "tag",
    reminder: "Damage past a blocker's health hits the player.",
    icon: "⚒",
    aiValue: 1.5,
  },
  noAttack: {
    id: "noAttack",
    label: "Can't attack",
    kind: "static",
    reminder: "This unit never attacks. It still blocks.",
    icon: "⊘",
    aiValue: -2,
  },
  play: {
    id: "play",
    label: "Play",
    kind: "trigger",
    reminder: "Happens when you play this card.",
    icon: "▶",
    aiValue: 0,
  },
  lastBreath: {
    id: "lastBreath",
    label: "When this dies",
    kind: "trigger",
    reminder: "Happens when this unit dies.",
    icon: "✝",
    aiValue: 0,
  },
  freeze: {
    id: "freeze",
    label: "Freeze",
    kind: "effect",
    reminder: "A frozen unit can't block, and it can't attack on its next turn.",
    icon: "❄",
    aiValue: 0,
  },
  trap: {
    id: "trap",
    label: "Trap",
    kind: "effect",
    reminder: "Set face down. When the rival attacks, you may spring one trap before blocks.",
    icon: "◆",
    aiValue: 0,
  },
};

/** Unit keyword tags, in the order they print on a card. */
export const TAG_ORDER = ["haste", "bulwark", "drain", "crush"] as const;

export function keyword(id: KeywordId): Keyword {
  return KEYWORDS[id];
}
