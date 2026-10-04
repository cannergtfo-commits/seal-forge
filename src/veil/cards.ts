export type Faction = "elf" | "human" | "goblin" | "robot" | "demon" | "veil";
export type Rarity = "common" | "uncommon" | "rare" | "basic" | "legendary";
export type CardSet = "founding" | "blazar" | "kage" | "ashen";
export type Edition = "core" | "blazar" | "kage" | "ashen";
export type Tag = "swift" | "bulwark" | "drain" | "crush" | "haste";

export type PlayEffect =
  | { t: "healSelf"; n: number }
  | { t: "loseHp"; n: number }
  | { t: "draw"; n: number; lose: number }
  | { t: "hit"; n: number }
  | { t: "healUnit"; n: number }
  | { t: "buff"; a: number; h: number }
  | { t: "rally" }
  | { t: "charge" }
  | { t: "freeze" }
  | { t: "overclock" }
  | { t: "twin" }
  | { t: "apex" }
  | { t: "boom" }
  | { t: "grantHaste" };

export type TrapKind = "pikes" | "snare" | "glade" | "firewall" | "soul" | "cross" | "horizon";

export type CardDef = {
  id: string;
  name: string;
  faction: Faction;
  kind: "unit" | "spell" | "trap";
  cost: number;
  atk: number;
  hp: number;
  rarity: Rarity;
  set: CardSet;
  edition: Edition;
  tokenId: number;
  text: string;
  art: string;
  tags: Tag[];
  play?: PlayEffect;
  trap?: TrapKind;
  deathHeal?: number;
  aura?: "goblinAtk" | "goblinSwift";
};

export const FACTIONS: { id: Faction; name: string; seal: string; line: string }[] = [
  { id: "elf", name: "Aureth", seal: "Emerald", line: "Archers, mending, and a treant that demands a blocker." },
  { id: "human", name: "Veymar", seal: "Steel", line: "Even stats, shields, and shots that trade clean." },
  { id: "goblin", name: "Rixen", seal: "Ember", line: "Cheap fighters, haste, and traps that punish small attacks." },
  { id: "robot", name: "Quorin", seal: "Cyan", line: "Walls, repairs, and a firewall that soaks a swing." },
  { id: "demon", name: "Malrec", seal: "Violet", line: "Spend life for cards and power. Drain it back." },
  { id: "veil", name: "Unbound", seal: "Silver", line: "Not a deck. These cards can be played in any seal." },
];

export const SEALS = FACTIONS.filter((faction) => faction.id !== "veil");

import { BLAZAR_RAW, UNBOUND_RAW, type RawCard } from "./blazar";
import { KAGE_RAW } from "./kage";
import { ASHEN_RAW } from "./ashen";

const A = "/assets/veil";

function c(partial: Omit<CardDef, "art" | "set" | "edition" | "tokenId"> & { art?: string }): CardDef {
  return { ...partial, set: "founding", edition: "core", tokenId: 0, art: `${A}/cards/${partial.id}.jpg` };
}

const CORE: CardDef[] = [
  c({ id: "moonpetal", name: "Moonpetal Fox", faction: "elf", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "common", art: `${A}/treant.jpg`, tags: [], deathHeal: 1, text: "When this dies, you heal 1." }),
  c({ id: "thorn-dryad", name: "Thorn Dryad", faction: "elf", kind: "unit", cost: 2, atk: 2, hp: 3, rarity: "common", art: `${A}/treant.jpg`, tags: [], play: { t: "healSelf", n: 1 }, text: "Play: heal 1." }),
  c({ id: "starlit", name: "Starlit Archer", faction: "elf", kind: "unit", cost: 2, atk: 2, hp: 1, rarity: "common", art: `${A}/elf.jpg`, tags: [], play: { t: "hit", n: 1 }, text: "Play: deal 1 to a unit or a player." }),
  c({ id: "briar", name: "Briar Snare", faction: "elf", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "common", art: `${A}/treant.jpg`, tags: [], play: { t: "freeze" }, text: "Freeze a unit. It cannot attack on its next turn." }),
  c({ id: "dawnbow", name: "Dawnbow Sentinel", faction: "elf", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "uncommon", art: `${A}/elf.jpg`, tags: ["swift"], text: "Swift. Can attack the turn it enters." }),
  c({ id: "mend", name: "Verdant Mend", faction: "elf", kind: "spell", cost: 3, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/treant.jpg`, tags: [], play: { t: "healSelf", n: 4 }, text: "Heal 4." }),
  c({ id: "glade", name: "Hidden Glade", faction: "elf", kind: "trap", cost: 1, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/treant.jpg`, tags: [], trap: "glade", text: "Trap. When they attack: heal 2 and deal 1 to an attacker." }),
  c({ id: "lysara", name: "Lysara, Grove Warden", faction: "elf", kind: "unit", cost: 4, atk: 3, hp: 4, rarity: "rare", art: `${A}/elf.jpg`, tags: [], play: { t: "healSelf", n: 2 }, text: "Play: heal 2. Blonde, fair, and fully in command of the grove." }),
  c({ id: "treant", name: "Ancient Treant", faction: "elf", kind: "unit", cost: 6, atk: 5, hp: 7, rarity: "rare", art: `${A}/treant.jpg`, tags: ["bulwark"], text: "Bulwark. If they block anything, they must block this." }),

  c({ id: "scout", name: "Scout Rider", faction: "human", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "common", art: `${A}/knight.jpg`, tags: [], text: "First steel on the road." }),
  c({ id: "shield-line", name: "Shield Line", faction: "human", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "common", art: `${A}/knight.jpg`, tags: ["bulwark"], text: "Bulwark. If they block anything, they must block this." }),
  c({ id: "medic", name: "Field Medic", faction: "human", kind: "unit", cost: 2, atk: 1, hp: 3, rarity: "common", art: `${A}/captain.jpg`, tags: [], play: { t: "healUnit", n: 2 }, text: "Play: heal an ally unit 2." }),
  c({ id: "shot", name: "Precise Shot", faction: "human", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "common", art: `${A}/captain.jpg`, tags: [], play: { t: "hit", n: 2 }, text: "Deal 2 to a unit or a player." }),
  c({ id: "oath-knight", name: "Knight of the Oath", faction: "human", kind: "unit", cost: 3, atk: 3, hp: 3, rarity: "uncommon", art: `${A}/knight.jpg`, tags: [], text: "A fair fight on purpose." }),
  c({ id: "rally", name: "Rally Banner", faction: "human", kind: "spell", cost: 3, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/captain.jpg`, tags: [], play: { t: "rally" }, text: "Your units get +1 attack this turn." }),
  c({ id: "pikes", name: "Ambush Pikes", faction: "human", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/knight.jpg`, tags: [], trap: "pikes", text: "Trap. When they attack: deal 3 to an attacker." }),
  c({ id: "aldren", name: "Captain Aldren", faction: "human", kind: "unit", cost: 4, atk: 3, hp: 4, rarity: "rare", art: `${A}/captain.jpg`, tags: [], play: { t: "buff", a: 1, h: 1 }, text: "Play: an ally unit gets +1/+1." }),
  c({ id: "marshal", name: "Siege Marshal", faction: "human", kind: "unit", cost: 6, atk: 5, hp: 5, rarity: "rare", art: `${A}/captain.jpg`, tags: [], play: { t: "hit", n: 2 }, text: "Play: deal 2 to a unit or a player." }),

  c({ id: "scrap", name: "Scrap Runner", faction: "goblin", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "common", art: `${A}/goblin.jpg`, tags: [], text: "Fast, thin, and already swinging." }),
  c({ id: "twins", name: "Twin Knives", faction: "goblin", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "common", art: `${A}/goblin.jpg`, tags: [], play: { t: "twin" }, text: "Play: if you control another Rixen, this gets +1/+1." }),
  c({ id: "raider", name: "Cave Raider", faction: "goblin", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "common", art: `${A}/goblin.jpg`, tags: ["swift"], text: "Swift." }),
  c({ id: "charge", name: "Reckless Charge", faction: "goblin", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "common", art: `${A}/goblin.jpg`, tags: [], play: { t: "charge" }, text: "An ally unit gets +2 attack this turn and takes 1." }),
  c({ id: "boom", name: "Boomlobber", faction: "goblin", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "uncommon", art: `${A}/goblin.jpg`, tags: [], play: { t: "boom" }, text: "Play: deal 1 to the opponent." }),
  c({ id: "drummer", name: "War Drummer", faction: "goblin", kind: "unit", cost: 3, atk: 2, hp: 3, rarity: "uncommon", art: `${A}/king.jpg`, tags: [], aura: "goblinSwift", text: "Your Rixen can attack the turn they enter." }),
  c({ id: "pit", name: "Pit Snare", faction: "goblin", kind: "trap", cost: 1, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/goblin.jpg`, tags: [], trap: "snare", text: "Trap. When they attack: destroy an attacker with attack 2 or less." }),
  c({ id: "skarn", name: "King Skarn", faction: "goblin", kind: "unit", cost: 5, atk: 4, hp: 4, rarity: "rare", art: `${A}/king.jpg`, tags: [], aura: "goblinAtk", text: "Your other Rixen have +1 attack." }),
  c({ id: "grenade", name: "Horde Grenade", faction: "goblin", kind: "spell", cost: 4, atk: 0, hp: 0, rarity: "rare", art: `${A}/king.jpg`, tags: [], play: { t: "hit", n: 4 }, text: "Deal 4 to a unit or a player." }),

  c({ id: "clock", name: "Clockwork Scout", faction: "robot", kind: "unit", cost: 1, atk: 1, hp: 2, rarity: "common", art: `${A}/drone.jpg`, tags: [], text: "A lens and a thin wing." }),
  c({ id: "sentry", name: "Sentry Drone", faction: "robot", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "common", art: `${A}/robot.jpg`, tags: ["bulwark"], text: "Bulwark." }),
  c({ id: "wisp-bot", name: "Repair Wisp", faction: "robot", kind: "unit", cost: 2, atk: 1, hp: 2, rarity: "common", art: `${A}/drone.jpg`, tags: [], play: { t: "healUnit", n: 3 }, text: "Play: heal an ally unit 3." }),
  c({ id: "overclock", name: "Overclock", faction: "robot", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "common", art: `${A}/robot.jpg`, tags: [], play: { t: "overclock" }, text: "A Quorin ally gets +2/+1 and can attack this turn." }),
  c({ id: "welder", name: "Arc Welder", faction: "robot", kind: "unit", cost: 3, atk: 2, hp: 4, rarity: "uncommon", art: `${A}/robot.jpg`, tags: [], play: { t: "healSelf", n: 2 }, text: "Play: heal 2." }),
  c({ id: "core", name: "Shield Core", faction: "robot", kind: "unit", cost: 3, atk: 0, hp: 6, rarity: "uncommon", art: `${A}/robot.jpg`, tags: ["bulwark"], text: "Bulwark. Cannot attack." }),
  c({ id: "firewall", name: "Firewall", faction: "robot", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/drone.jpg`, tags: [], trap: "firewall", text: "Trap. When they attack: prevent the next 4 damage to you." }),
  c({ id: "lance", name: "Null Lance", faction: "robot", kind: "unit", cost: 4, atk: 4, hp: 3, rarity: "rare", art: `${A}/robot.jpg`, tags: [], text: "A clean hole through a plan." }),
  c({ id: "apex", name: "Prime Unit APEX", faction: "robot", kind: "unit", cost: 6, atk: 4, hp: 7, rarity: "rare", art: `${A}/robot.jpg`, tags: [], play: { t: "apex" }, text: "Play: your other Quorin get +0/+1." }),

  c({ id: "familiar", name: "Imp Familiar", faction: "demon", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "common", art: `${A}/imp.jpg`, tags: [], play: { t: "loseHp", n: 1 }, text: "Play: lose 1 life." }),
  c({ id: "ash-imp", name: "Ash Imp", faction: "demon", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "common", art: `${A}/imp.jpg`, tags: [], text: "Ember eyes. No bargain yet." }),
  c({ id: "spark", name: "Hell Spark", faction: "demon", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "common", art: `${A}/demon.jpg`, tags: [], play: { t: "hit", n: 3 }, text: "Deal 3 to a unit or a player. Then lose 1 life." }),
  c({ id: "pact", name: "Blood Pact", faction: "demon", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "common", art: `${A}/demon.jpg`, tags: [], play: { t: "draw", n: 2, lose: 2 }, text: "Draw 2. Lose 2 life. You cannot drop below 1 this way." }),
  c({ id: "blood-knight", name: "Blood Knight", faction: "demon", kind: "unit", cost: 3, atk: 4, hp: 2, rarity: "uncommon", art: `${A}/demon.jpg`, tags: [], text: "Hits hard. Does not stay." }),
  c({ id: "hexbrand", name: "Hexbrand", faction: "demon", kind: "unit", cost: 3, atk: 3, hp: 3, rarity: "uncommon", art: `${A}/demon.jpg`, tags: ["drain"], text: "Drain. Damage this deals to a player heals you." }),
  c({ id: "soul", name: "Soul Snare", faction: "demon", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "uncommon", art: `${A}/imp.jpg`, tags: [], trap: "soul", text: "Trap. When any unit dies: heal 3 and this banishes." }),
  c({ id: "vex", name: "Duchess Vex", faction: "demon", kind: "unit", cost: 5, atk: 5, hp: 4, rarity: "rare", art: `${A}/demon.jpg`, tags: [], play: { t: "draw", n: 1, lose: 2 }, text: "Play: lose 2 life and draw 1. You cannot drop below 1 this way." }),
  c({ id: "tyrant", name: "Pit Tyrant", faction: "demon", kind: "unit", cost: 7, atk: 6, hp: 6, rarity: "rare", art: `${A}/demon.jpg`, tags: ["crush"], text: "Crush. Extra damage past a blocker hits the player." }),
];

CORE.forEach((card, index) => {
  card.tokenId = index + 1;
});

function paint(raw: RawCard, tokenId: number, edition: "blazar" | "kage" | "ashen"): CardDef {
  return { ...raw, edition, tokenId, art: `${A}/cards/${raw.id}.jpg` };
}

export const BLAZAR_COUNT = BLAZAR_RAW.length;
const BLAZAR = BLAZAR_RAW.map((raw, index) => paint(raw, index + 1, "blazar"));
const UNBOUND = UNBOUND_RAW.map((raw, index) => paint(raw, BLAZAR_COUNT + index + 1, "blazar"));
export const KAGE_COUNT = KAGE_RAW.length;
const KAGE = KAGE_RAW.map((raw, index) => paint(raw, index + 1, "kage"));
export const ASHEN_COUNT = ASHEN_RAW.length;
const ASHEN = ASHEN_RAW.map((raw, index) => paint(raw, index + 1, "ashen"));

export const CARDS: CardDef[] = [...CORE, ...UNBOUND, ...BLAZAR, ...KAGE, ...ASHEN];

export const CARD_MAP = new Map(CARDS.map((card) => [card.id, card]));

export function cardOf(id: string): CardDef {
  const card = CARD_MAP.get(id);
  if (!card) throw new Error(`missing card ${id}`);
  return card;
}

export function schoolOf(card: CardDef): string {
  if (card.kind === "unit") {
    if (card.tags.includes("bulwark")) return "Wall";
    if (card.tags.includes("haste")) return "Haste";
    if (card.tags.includes("swift")) return "Swift";
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
