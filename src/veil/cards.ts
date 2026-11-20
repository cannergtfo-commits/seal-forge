import type { CardSet, ChainRarity, Edition, Format } from "./sets";

export type { CardSet, Edition, Format } from "./sets";
export type Faction = "elf" | "human" | "goblin" | "robot" | "demon" | "veil";
export type Rarity = "common" | "uncommon" | "rare" | "basic" | "legendary";
export type Tag = "bulwark" | "drain" | "crush" | "haste" | "bloom";

export type PlayEffect =
  | { t: "healSelf"; n: number; bloomDraw?: number }
  | { t: "loseHp"; n: number }
  | { t: "draw"; n: number; lose: number }
  | { t: "hit"; n: number; selfLose?: number }
  | { t: "healUnit"; n: number }
  | { t: "buff"; a: number; h: number }
  | { t: "rally" }
  | { t: "charge"; n?: number; selfHit?: number }
  | { t: "freeze" }
  | { t: "overclock" }
  | { t: "twin" }
  | { t: "apex"; h?: number; plating?: number }
  | { t: "boom" }
  | { t: "grantHaste" };

/**
 * "Surge: X" — if you already played another card this turn, X happens too.
 * `self` buffs the unit itself (and can give it Haste); `target` adds to the spell's target.
 */
export type SurgeEffect =
  | { t: "self"; a: number; h: number; haste?: boolean }
  | { t: "target"; a: number; h: number }
  | { t: "ping"; n: number }
  | { t: "draw"; n: number };

/** "Requiem: X" — what happens when the unit dies. */
export type RequiemEffect =
  | { t: "heal"; n: number }
  | { t: "draw"; n: number }
  | { t: "ping"; n: number }
  | { t: "lose"; n: number }
  | { t: "healAlly"; n: number }
  | { t: "recall"; faction: Faction };

export type TrapKind = "pikes" | "snare" | "glade" | "firewall" | "soul" | "cross" | "horizon";

export type CardDef = {
  id: string;
  /** Frozen NFT token id inside `edition`. A literal, never derived from array order. */
  tokenId: number;
  /** Must equal `rarityOf[tokenId]` on the edition contract. Pack odds read it. */
  chainRarity: ChainRarity;
  name: string;
  faction: Faction;
  kind: "unit" | "spell" | "trap";
  cost: number;
  atk: number;
  hp: number;
  rarity: Rarity;
  set: CardSet;
  edition: Edition;
  /** 1 = Founding, 2 = Blazar, 3 = Kage, 4 = Ashen. 5-6 are reserved. */
  setNo: number;
  /** Balance revision. Starts at 1, bumped on every stat or text change. */
  version: number;
  formats: Format[];
  /** The NFT metadata name, when the card has been renamed in game. */
  printedName?: string;
  /** Rules text, generated from the data by `cardText()`. Never hand-written. */
  text: string;
  flavor?: string;
  art: string;
  tags: Tag[];
  play?: PlayEffect;
  trap?: TrapKind;
  /** Plating N: prevents the first N damage to this unit each turn. */
  plating?: number;
  requiem?: RequiemEffect;
  surge?: SurgeEffect;
  aura?: "goblinAtk" | "goblinSwift";
  noAttack?: boolean;
};

/** What a card file declares. Everything else is filled in by `finish()`. */
export type CardData = Omit<CardDef, "art" | "edition" | "text" | "setNo" | "formats" | "version" | "printedName"> & { version?: number };

export const FACTIONS: { id: Faction; name: string; seal: string; line: string }[] = [
  { id: "elf", name: "Aureth", seal: "Emerald", line: "Archers, mending, and a treant that demands a blocker." },
  { id: "human", name: "Veymar", seal: "Steel", line: "Even stats, shields, and shots that trade clean." },
  { id: "goblin", name: "Rixen", seal: "Ember", line: "Cheap fighters, haste, and traps that punish small attacks." },
  { id: "robot", name: "Quorin", seal: "Cyan", line: "Walls, repairs, and a firewall that soaks a swing." },
  { id: "demon", name: "Malrec", seal: "Violet", line: "Spend life for cards and power. Drain it back." },
  { id: "veil", name: "Unbound", seal: "Silver", line: "Not a deck. These cards can be played in any seal." },
];

export const SEALS = FACTIONS.filter((faction) => faction.id !== "veil");

import { BLAZAR_RAW, UNBOUND_RAW } from "./blazar";
import { KAGE_RAW } from "./kage";
import { ASHEN_RAW } from "./ashen";
import { cardText } from "./card-text";
import { printedOf } from "./printed";
import { EDITION_TOKENS, formatsOf, setInfo } from "./sets";

const A = "/assets/veil";

function finish(raw: CardData, edition: Edition): CardDef {
  const card: CardDef = {
    ...raw,
    edition,
    setNo: setInfo(raw.set).setNo,
    version: raw.version ?? 1,
    formats: formatsOf(raw.set),
    art: `${A}/cards/${raw.id}.jpg`,
    text: "",
  };
  card.text = cardText(card);
  const printed = printedOf(card);
  if (printed && printed.name !== card.name) card.printedName = printed.name;
  return card;
}

/** Core cards keep their old placeholder `art` keys in the source; the card face uses `/cards/<id>.jpg`. */
function c(partial: Omit<CardData, "set"> & { art?: string }): CardDef {
  const { art: _placeholder, ...rest } = partial;
  return finish({ ...rest, set: "founding" }, "core");
}

const CORE: CardDef[] = [
  c({ id: "moonpetal", tokenId: 1, chainRarity: 1, name: "Moonpetal Fox", faction: "elf", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "common", art: `${A}/treant.jpg`, tags: ["bloom"], version: 2 }),
  c({ id: "thorn-dryad", tokenId: 2, chainRarity: 1, name: "Thorn Dryad", faction: "elf", kind: "unit", cost: 2, atk: 2, hp: 3, rarity: "common", art: `${A}/treant.jpg`, tags: [], play: { t: "healSelf", n: 1 } }),
  c({ id: "starlit", tokenId: 3, chainRarity: 1, name: "Starlit Archer", faction: "elf", kind: "unit", cost: 2, atk: 2, hp: 1, rarity: "common", art: `${A}/elf.jpg`, tags: [], play: { t: "hit", n: 1 } }),
  c({ id: "briar", tokenId: 4, chainRarity: 1, name: "Briar Snare", faction: "elf", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "common", art: `${A}/treant.jpg`, tags: [], play: { t: "freeze" } }),
  c({ id: "dawnbow", tokenId: 5, chainRarity: 2, name: "Dawnbow Sentinel", faction: "elf", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "uncommon", art: `${A}/elf.jpg`, tags: ["haste"] }),
  c({ id: "mend", tokenId: 6, chainRarity: 2, name: "Verdant Mend", faction: "elf", kind: "spell", cost: 3, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/treant.jpg`, tags: [], play: { t: "healSelf", n: 4 } }),
  c({ id: "glade", tokenId: 7, chainRarity: 2, name: "Hidden Glade", faction: "elf", kind: "trap", cost: 1, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/treant.jpg`, tags: [], trap: "glade" }),
  c({ id: "lysara", tokenId: 8, chainRarity: 3, name: "Lysara, Grove Warden", faction: "elf", kind: "unit", cost: 4, atk: 3, hp: 4, rarity: "rare", art: `${A}/elf.jpg`, tags: [], play: { t: "healSelf", n: 2 }, flavor: "Blonde, fair, and fully in command of the grove." }),
  c({ id: "treant", tokenId: 9, chainRarity: 3, name: "Ancient Treant", faction: "elf", kind: "unit", cost: 6, atk: 4, hp: 7, rarity: "rare", art: `${A}/treant.jpg`, tags: ["bulwark", "bloom"], version: 2 }),

  c({ id: "scout", tokenId: 10, chainRarity: 1, name: "Scout Rider", faction: "human", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "common", art: `${A}/knight.jpg`, tags: [], flavor: "First steel on the road." }),
  c({ id: "shield-line", tokenId: 11, chainRarity: 1, name: "Shield Line", faction: "human", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "common", art: `${A}/knight.jpg`, tags: ["bulwark"] }),
  c({ id: "medic", tokenId: 12, chainRarity: 1, name: "Field Medic", faction: "human", kind: "unit", cost: 2, atk: 1, hp: 3, rarity: "common", art: `${A}/captain.jpg`, tags: [], play: { t: "healUnit", n: 2 } }),
  c({ id: "shot", tokenId: 13, chainRarity: 1, name: "Precise Shot", faction: "human", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "common", art: `${A}/captain.jpg`, tags: [], play: { t: "hit", n: 2 } }),
  c({ id: "oath-knight", tokenId: 14, chainRarity: 2, name: "Knight of the Oath", faction: "human", kind: "unit", cost: 3, atk: 3, hp: 3, rarity: "uncommon", art: `${A}/knight.jpg`, tags: [], flavor: "A fair fight on purpose." }),
  c({ id: "rally", tokenId: 15, chainRarity: 2, name: "Rally Banner", faction: "human", kind: "spell", cost: 3, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/captain.jpg`, tags: [], play: { t: "rally" } }),
  c({ id: "pikes", tokenId: 16, chainRarity: 2, name: "Ambush Pikes", faction: "human", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/knight.jpg`, tags: [], trap: "pikes" }),
  c({ id: "aldren", tokenId: 17, chainRarity: 3, name: "Captain Aldren", faction: "human", kind: "unit", cost: 4, atk: 3, hp: 4, rarity: "rare", art: `${A}/captain.jpg`, tags: [], play: { t: "buff", a: 1, h: 1 } }),
  c({ id: "marshal", tokenId: 18, chainRarity: 3, name: "Siege Marshal", faction: "human", kind: "unit", cost: 6, atk: 5, hp: 5, rarity: "rare", art: `${A}/captain.jpg`, tags: [], play: { t: "hit", n: 2 } }),

  c({ id: "scrap", tokenId: 19, chainRarity: 1, name: "Scrap Runner", faction: "goblin", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "common", art: `${A}/goblin.jpg`, tags: [], flavor: "Fast, thin, and already swinging." }),
  c({ id: "twins", tokenId: 20, chainRarity: 1, name: "Twin Knives", faction: "goblin", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "common", art: `${A}/goblin.jpg`, tags: [], surge: { t: "self", a: 1, h: 1 }, version: 2 }),
  c({ id: "raider", tokenId: 21, chainRarity: 1, name: "Cave Raider", faction: "goblin", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "common", art: `${A}/goblin.jpg`, tags: ["haste"] }),
  c({ id: "charge", tokenId: 22, chainRarity: 1, name: "Reckless Charge", faction: "goblin", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "common", art: `${A}/goblin.jpg`, tags: [], play: { t: "charge", n: 2, selfHit: 0 }, surge: { t: "target", a: 0, h: 2 }, version: 2 }),
  c({ id: "boom", tokenId: 23, chainRarity: 2, name: "Boomlobber", faction: "goblin", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "uncommon", art: `${A}/goblin.jpg`, tags: [], play: { t: "boom" } }),
  c({ id: "drummer", tokenId: 24, chainRarity: 2, name: "War Drummer", faction: "goblin", kind: "unit", cost: 3, atk: 2, hp: 3, rarity: "uncommon", art: `${A}/king.jpg`, tags: [], aura: "goblinSwift" }),
  c({ id: "pit", tokenId: 25, chainRarity: 2, name: "Pit Snare", faction: "goblin", kind: "trap", cost: 1, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/goblin.jpg`, tags: [], trap: "snare" }),
  c({ id: "skarn", tokenId: 26, chainRarity: 3, name: "King Skarn", faction: "goblin", kind: "unit", cost: 5, atk: 4, hp: 4, rarity: "rare", art: `${A}/king.jpg`, tags: [], aura: "goblinAtk" }),
  c({ id: "grenade", tokenId: 27, chainRarity: 3, name: "Horde Grenade", faction: "goblin", kind: "spell", cost: 3, atk: 0, hp: 0, rarity: "rare", art: `${A}/king.jpg`, tags: [], play: { t: "hit", n: 3 }, surge: { t: "ping", n: 1 }, version: 2 }),

  c({ id: "clock", tokenId: 28, chainRarity: 1, name: "Clockwork Scout", faction: "robot", kind: "unit", cost: 1, atk: 1, hp: 2, rarity: "common", art: `${A}/drone.jpg`, tags: [], flavor: "A lens and a thin wing." }),
  c({ id: "sentry", tokenId: 29, chainRarity: 1, name: "Sentry Drone", faction: "robot", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "common", art: `${A}/robot.jpg`, tags: ["bulwark"] }),
  c({ id: "wisp-bot", tokenId: 30, chainRarity: 1, name: "Repair Wisp", faction: "robot", kind: "unit", cost: 2, atk: 1, hp: 2, rarity: "common", art: `${A}/drone.jpg`, tags: [], play: { t: "healUnit", n: 3 } }),
  c({ id: "overclock", tokenId: 31, chainRarity: 1, name: "Overclock", faction: "robot", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "common", art: `${A}/robot.jpg`, tags: [], play: { t: "overclock" } }),
  c({ id: "welder", tokenId: 32, chainRarity: 2, name: "Arc Welder", faction: "robot", kind: "unit", cost: 3, atk: 2, hp: 4, rarity: "uncommon", art: `${A}/robot.jpg`, tags: [], play: { t: "healSelf", n: 2 } }),
  c({ id: "core", tokenId: 33, chainRarity: 2, name: "Shield Core", faction: "robot", kind: "unit", cost: 3, atk: 0, hp: 6, rarity: "uncommon", art: `${A}/robot.jpg`, tags: [], noAttack: true, plating: 1, version: 2 }),
  c({ id: "firewall", tokenId: 34, chainRarity: 2, name: "Firewall", faction: "robot", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/drone.jpg`, tags: [], trap: "firewall" }),
  c({ id: "lance", tokenId: 35, chainRarity: 3, name: "Null Lance", faction: "robot", kind: "unit", cost: 4, atk: 4, hp: 3, rarity: "rare", art: `${A}/robot.jpg`, tags: [], plating: 1, version: 2, flavor: "A clean hole through a plan." }),
  c({ id: "apex", tokenId: 36, chainRarity: 3, name: "Prime Unit APEX", faction: "robot", kind: "unit", cost: 6, atk: 3, hp: 7, rarity: "rare", art: `${A}/robot.jpg`, tags: [], play: { t: "apex", h: 0, plating: 1 }, version: 2 }),

  c({ id: "familiar", tokenId: 37, chainRarity: 1, name: "Imp Familiar", faction: "demon", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "common", art: `${A}/imp.jpg`, tags: [], play: { t: "loseHp", n: 1 } }),
  c({ id: "ash-imp", tokenId: 38, chainRarity: 1, name: "Ash Imp", faction: "demon", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "common", art: `${A}/imp.jpg`, tags: [], flavor: "Ember eyes. No bargain yet." }),
  c({ id: "spark", tokenId: 39, chainRarity: 1, name: "Hell Spark", faction: "demon", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "common", art: `${A}/demon.jpg`, tags: [], play: { t: "hit", n: 3, selfLose: 1 } }),
  c({ id: "pact", tokenId: 40, chainRarity: 1, name: "Blood Pact", faction: "demon", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "common", art: `${A}/demon.jpg`, tags: [], play: { t: "draw", n: 2, lose: 2 } }),
  c({ id: "blood-knight", tokenId: 41, chainRarity: 2, name: "Blood Knight", faction: "demon", kind: "unit", cost: 3, atk: 4, hp: 2, rarity: "uncommon", art: `${A}/demon.jpg`, tags: [], flavor: "Hits hard. Does not stay." }),
  c({ id: "hexbrand", tokenId: 42, chainRarity: 2, name: "Hexbrand", faction: "demon", kind: "unit", cost: 3, atk: 3, hp: 3, rarity: "uncommon", art: `${A}/demon.jpg`, tags: ["drain"] }),
  c({ id: "soul", tokenId: 43, chainRarity: 2, name: "Soul Snare", faction: "demon", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/imp.jpg`, tags: [], trap: "soul" }),
  c({ id: "vex", tokenId: 44, chainRarity: 3, name: "Duchess Vex", faction: "demon", kind: "unit", cost: 5, atk: 5, hp: 4, rarity: "rare", art: `${A}/demon.jpg`, tags: [], play: { t: "draw", n: 1, lose: 2 } }),
  c({ id: "tyrant", tokenId: 45, chainRarity: 3, name: "Pit Tyrant", faction: "demon", kind: "unit", cost: 7, atk: 6, hp: 6, rarity: "rare", art: `${A}/demon.jpg`, tags: ["crush"] }),
];

export const BLAZAR_COUNT = BLAZAR_RAW.length;
const BLAZAR = BLAZAR_RAW.map((raw) => finish(raw, "blazar"));
const UNBOUND = UNBOUND_RAW.map((raw) => finish(raw, "blazar"));
export const KAGE_COUNT = KAGE_RAW.length;
const KAGE = KAGE_RAW.map((raw) => finish(raw, "kage"));
export const ASHEN_COUNT = ASHEN_RAW.length;
const ASHEN = ASHEN_RAW.map((raw) => finish(raw, "ashen"));

export const CARDS: CardDef[] = [...CORE, ...UNBOUND, ...BLAZAR, ...KAGE, ...ASHEN];

export const CARD_MAP = new Map(CARDS.map((card) => [card.id, card]));

/** Fails loudly if two cards claim one NFT, or a card points past what was minted. */
function assertTokenIds(): void {
  const seen = new Set<string>();
  for (const card of CARDS) {
    const key = `${card.edition}:${card.tokenId}`;
    if (seen.has(key)) throw new Error(`duplicate token ${key}`);
    seen.add(key);
    if (!Number.isInteger(card.tokenId) || card.tokenId < 1 || card.tokenId > EDITION_TOKENS[card.edition]) throw new Error(`token out of range ${key}`);
  }
  if (CARD_MAP.size !== CARDS.length) throw new Error("duplicate card id");
}
assertTokenIds();

export function cardOf(id: string): CardDef {
  const card = CARD_MAP.get(id);
  if (!card) throw new Error(`missing card ${id}`);
  return card;
}

export function schoolOf(card: CardDef): string {
  if (card.kind === "unit") {
    if (card.tags.includes("bulwark") || card.noAttack || card.plating) return "Wall";
    if (card.tags.includes("haste")) return "Haste";
    if (card.tags.includes("drain")) return "Drain";
    if (card.tags.includes("crush")) return "Crush";
    return "Unit";
  }
  if (card.kind === "trap") return "Trap";
  switch (card.play?.t) {
    case "hit":
    case "boom":
      return "Bolt";
    case "healSelf":
    case "healUnit":
      return "Mend";
    case "freeze":
      return "Hex";
    case "rally":
    case "buff":
    case "charge":
    case "overclock":
    case "apex":
    case "grantHaste":
      return "Banner";
    case "draw":
    case "loseHp":
      return "Pact";
    default:
      return "Spell";
  }
}

export function needsTarget(card: CardDef): boolean {
  const t = card.play?.t;
  return t === "hit" || t === "healUnit" || t === "buff" || t === "freeze" || t === "charge" || t === "overclock" || t === "grantHaste";
}

export function starterIds(faction: Faction): string[] {
  const list = CARDS.filter((card) => card.faction === faction && card.set === "founding");
  const out: string[] = [];
  for (const card of list) {
    const copies = card.rarity === "rare" || card.rarity === "legendary" ? 1 : 2;
    for (let i = 0; i < copies; i++) out.push(card.id);
  }
  return out;
}

export function trapNeedsTarget(kind: TrapKind | undefined): boolean {
  return kind === "pikes" || kind === "snare" || kind === "glade" || kind === "cross" || kind === "horizon";
}
