import type { CardData } from "./cards";

export type RawCard = CardData;

/** Set 1. Dark space fantasy. Four basic, one rare, one legendary per seal. */
export const BLAZAR_RAW: RawCard[] = [
  { id: "bz-comet-fox", tokenId: 1, chainRarity: 1, name: "Comet Fox", faction: "elf", kind: "unit", cost: 1, atk: 1, hp: 2, rarity: "basic", set: "blazar", tags: [], requiem: { t: "heal", n: 2 }, version: 2 },
  { id: "bz-void-archer", tokenId: 2, chainRarity: 1, name: "Void Archer", faction: "elf", kind: "unit", cost: 2, atk: 2, hp: 1, rarity: "basic", set: "blazar", tags: ["haste"] },
  { id: "bz-moon-well", tokenId: 3, chainRarity: 1, name: "Moon Well", faction: "elf", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "healSelf", n: 2, bloomDraw: 1 }, version: 2 },
  { id: "bz-orbit-dryad", tokenId: 4, chainRarity: 1, name: "Orbit Dryad", faction: "elf", kind: "unit", cost: 3, atk: 2, hp: 3, rarity: "basic", set: "blazar", tags: ["bloom"], version: 2, flavor: "A ring of pale wood around a dead star." },
  { id: "bz-eclipse-sentinel", tokenId: 5, chainRarity: 2, name: "Eclipse Sentinel", faction: "elf", kind: "unit", cost: 4, atk: 3, hp: 3, rarity: "rare", set: "blazar", tags: ["haste"], flavor: "The bow fires before the light returns." },
  { id: "bz-lysara-blazar", tokenId: 6, chainRarity: 3, name: "Lysara of the Blazar", faction: "elf", kind: "unit", cost: 6, atk: 4, hp: 5, rarity: "legendary", set: "blazar", tags: ["bloom"], play: { t: "healSelf", n: 2 }, version: 2, flavor: "Blonde, fair, and crowned in comet-fire." },

  { id: "bz-hull-scout", tokenId: 7, chainRarity: 1, name: "Hull Scout", faction: "human", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "blazar", tags: [], flavor: "First boot on the dark hull." },
  { id: "bz-bulkhead", tokenId: 8, chainRarity: 1, name: "Bulkhead", faction: "human", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "basic", set: "blazar", tags: ["bulwark"] },
  { id: "bz-lance-shot", tokenId: 9, chainRarity: 1, name: "Lance Shot", faction: "human", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "hit", n: 2 } },
  { id: "bz-oath-pilot", tokenId: 10, chainRarity: 1, name: "Oath Pilot", faction: "human", kind: "unit", cost: 3, atk: 3, hp: 3, rarity: "basic", set: "blazar", tags: [], flavor: "Same oath. No sky." },
  { id: "bz-captain-kel", tokenId: 11, chainRarity: 2, name: "Captain Kestrel", faction: "human", kind: "unit", cost: 4, atk: 3, hp: 4, rarity: "rare", set: "blazar", tags: [], play: { t: "buff", a: 1, h: 1 } },
  { id: "bz-admiral-voss", tokenId: 12, chainRarity: 3, name: "Admiral Voss", faction: "human", kind: "unit", cost: 6, atk: 5, hp: 5, rarity: "legendary", set: "blazar", tags: [], play: { t: "hit", n: 2 } },

  { id: "bz-spark-rat", tokenId: 13, chainRarity: 1, name: "Spark Rat", faction: "goblin", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "basic", set: "blazar", tags: ["haste"] },
  { id: "bz-twin-jets", tokenId: 14, chainRarity: 1, name: "Twin Jets", faction: "goblin", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "blazar", tags: [], surge: { t: "self", a: 0, h: 0, haste: true }, version: 2 },
  { id: "bz-scrap-comet", tokenId: 15, chainRarity: 1, name: "Scrap Comet", faction: "goblin", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "charge", n: 2, selfHit: 0 }, surge: { t: "target", a: 0, h: 2 }, version: 2 },
  { id: "bz-boom-drone", tokenId: 16, chainRarity: 1, name: "Boom Drone", faction: "goblin", kind: "unit", cost: 3, atk: 2, hp: 2, rarity: "basic", set: "blazar", tags: [], play: { t: "boom" } },
  { id: "bz-void-raider", tokenId: 17, chainRarity: 2, name: "Void Raider", faction: "goblin", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "rare", set: "blazar", tags: ["haste"] },
  { id: "bz-skarn-rift", tokenId: 18, chainRarity: 3, name: "Skarn the Rift", faction: "goblin", kind: "unit", cost: 6, atk: 4, hp: 4, rarity: "legendary", set: "blazar", tags: ["haste"], aura: "goblinAtk" },

  { id: "bz-ion-wisp", tokenId: 19, chainRarity: 1, name: "Ion Wisp", faction: "robot", kind: "unit", cost: 2, atk: 1, hp: 2, rarity: "basic", set: "blazar", tags: [], play: { t: "healUnit", n: 2 } },
  { id: "bz-hull-drone", tokenId: 20, chainRarity: 1, name: "Hull Drone", faction: "robot", kind: "unit", cost: 2, atk: 1, hp: 3, rarity: "basic", set: "blazar", tags: [], plating: 1, version: 2 },
  { id: "bz-cold-weld", tokenId: 21, chainRarity: 1, name: "Cold Weld", faction: "robot", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "healSelf", n: 2 } },
  { id: "bz-sentry-prism", tokenId: 22, chainRarity: 1, name: "Sentry Prism", faction: "robot", kind: "unit", cost: 3, atk: 2, hp: 4, rarity: "basic", set: "blazar", tags: [], flavor: "A lens that does not blink." },
  { id: "bz-null-array", tokenId: 23, chainRarity: 2, name: "Null Array", faction: "robot", kind: "unit", cost: 4, atk: 2, hp: 6, rarity: "rare", set: "blazar", tags: ["bulwark"] },
  { id: "bz-apex-blazar", tokenId: 24, chainRarity: 3, name: "APEX Blazar", faction: "robot", kind: "unit", cost: 7, atk: 4, hp: 7, rarity: "legendary", set: "blazar", tags: [], play: { t: "apex", h: 1, plating: 1 }, version: 2 },

  { id: "bz-cinder-imp", tokenId: 25, chainRarity: 1, name: "Cinder Imp", faction: "demon", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "blazar", tags: [], play: { t: "loseHp", n: 1 } },
  { id: "bz-pact-ember", tokenId: 26, chainRarity: 1, name: "Pact Ember", faction: "demon", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "hit", n: 2 } },
  { id: "bz-brand-knight", tokenId: 27, chainRarity: 1, name: "Brand Knight", faction: "demon", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "basic", set: "blazar", tags: [], flavor: "Hits, then the dark takes the rest." },
  { id: "bz-ash-moth", tokenId: 28, chainRarity: 1, name: "Ash Moth", faction: "demon", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "basic", set: "blazar", tags: [], flavor: "Wings the color of a spent star." },
  { id: "bz-hex-moth", tokenId: 29, chainRarity: 2, name: "Hex Moth", faction: "demon", kind: "unit", cost: 3, atk: 3, hp: 3, rarity: "rare", set: "blazar", tags: ["drain"] },
  { id: "bz-tyrant-blazar", tokenId: 30, chainRarity: 3, name: "Tyrant of the Blazar", faction: "demon", kind: "unit", cost: 7, atk: 6, hp: 6, rarity: "legendary", set: "blazar", tags: ["crush"] },

  { id: "bz-drift-wisp", tokenId: 31, chainRarity: 1, name: "Drift Wisp", faction: "veil", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "basic", set: "blazar", tags: ["bloom"], version: 2, flavor: "No seal claims it." },
  { id: "bz-eclipse-blade", tokenId: 32, chainRarity: 1, name: "Eclipse Blade", faction: "veil", kind: "unit", cost: 2, atk: 1, hp: 1, rarity: "basic", set: "blazar", tags: [], surge: { t: "self", a: 1, h: 1, haste: true }, version: 2 },
  { id: "bz-slip", tokenId: 33, chainRarity: 1, name: "Blazar Slip", faction: "veil", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "grantHaste" } },
  { id: "bz-quiet-star", tokenId: 34, chainRarity: 1, name: "Quiet Star", faction: "veil", kind: "unit", cost: 3, atk: 1, hp: 4, rarity: "basic", set: "blazar", tags: [], plating: 1, version: 2, flavor: "It does not take a side." },
  { id: "bz-horizon", tokenId: 35, chainRarity: 2, name: "Event Horizon", faction: "veil", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "rare", set: "blazar", tags: [], trap: "horizon" },
  { id: "bz-the-veil", tokenId: 36, chainRarity: 3, name: "The Veil Itself", faction: "veil", kind: "unit", cost: 7, atk: 5, hp: 5, rarity: "legendary", set: "blazar", tags: [], requiem: { t: "recall", faction: "veil" }, version: 2, flavor: "The sixth seal, wearing a dead star." },
];

/** Founding cards for the sixth seal. Dark fantasy, not the space set. Starter decks use these. */
export const UNBOUND_RAW: RawCard[] = [
  { id: "un-lantern", tokenId: 37, chainRarity: 1, name: "Pale Lantern", faction: "veil", kind: "unit", cost: 1, atk: 1, hp: 2, rarity: "common", set: "founding", tags: [], flavor: "A light that belongs to no grove." },
  { id: "un-squire", tokenId: 38, chainRarity: 1, name: "Oathless Squire", faction: "veil", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "common", set: "founding", tags: [], flavor: "Steel with the crest filed off." },
  { id: "un-toll", tokenId: 39, chainRarity: 1, name: "Silver Toll", faction: "veil", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "common", set: "founding", tags: [], play: { t: "hit", n: 2 } },
  { id: "un-choir", tokenId: 40, chainRarity: 1, name: "Ash Choir", faction: "veil", kind: "unit", cost: 3, atk: 2, hp: 3, rarity: "common", set: "founding", tags: [], requiem: { t: "draw", n: 1 }, version: 2, flavor: "They sing for whoever paid." },
  { id: "un-ward", tokenId: 41, chainRarity: 1, name: "Way Ward", faction: "veil", kind: "unit", cost: 3, atk: 1, hp: 4, rarity: "common", set: "founding", tags: ["bulwark"] },
  { id: "un-pilgrim", tokenId: 42, chainRarity: 1, name: "Road Pilgrim", faction: "veil", kind: "unit", cost: 2, atk: 2, hp: 1, rarity: "uncommon", set: "founding", tags: ["haste"] },
  { id: "un-cross", tokenId: 43, chainRarity: 1, name: "Crossroad Trap", faction: "veil", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "uncommon", set: "founding", tags: [], trap: "cross" },
  { id: "un-nameless", tokenId: 44, chainRarity: 2, name: "The Nameless", faction: "veil", kind: "unit", cost: 5, atk: 4, hp: 4, rarity: "rare", set: "founding", tags: [], flavor: "No seal. Just the road." },
];
