import type { CardDef } from "./cards";

export type RawCard = Omit<CardDef, "art" | "edition" | "tokenId">;

/** Set 1. Dark space fantasy. Four basic, one rare, one legendary per seal. */
export const BLAZAR_RAW: RawCard[] = [
  { id: "bz-comet-fox", name: "Comet Fox", faction: "elf", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "basic", set: "blazar", tags: [], deathHeal: 1, text: "When this dies, you heal 1." },
  { id: "bz-void-archer", name: "Void Archer", faction: "elf", kind: "unit", cost: 2, atk: 2, hp: 1, rarity: "basic", set: "blazar", tags: ["haste"], text: "Haste. Can attack the turn it enters." },
  { id: "bz-moon-well", name: "Moon Well", faction: "elf", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "healSelf", n: 2 }, text: "Heal 2." },
  { id: "bz-orbit-dryad", name: "Orbit Dryad", faction: "elf", kind: "unit", cost: 3, atk: 2, hp: 4, rarity: "basic", set: "blazar", tags: [], text: "A ring of pale wood around a dead star." },
  { id: "bz-eclipse-sentinel", name: "Eclipse Sentinel", faction: "elf", kind: "unit", cost: 4, atk: 3, hp: 3, rarity: "rare", set: "blazar", tags: ["haste"], text: "Haste. The bow fires before the light returns." },
  { id: "bz-lysara-blazar", name: "Lysara of the Blazar", faction: "elf", kind: "unit", cost: 6, atk: 4, hp: 5, rarity: "legendary", set: "blazar", tags: ["haste"], play: { t: "healSelf", n: 2 }, text: "Haste. Play: heal 2. Blonde, fair, and crowned in comet-fire." },

  { id: "bz-hull-scout", name: "Hull Scout", faction: "human", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "blazar", tags: [], text: "First boot on the dark hull." },
  { id: "bz-bulkhead", name: "Bulkhead", faction: "human", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "basic", set: "blazar", tags: ["bulwark"], text: "Bulwark." },
  { id: "bz-lance-shot", name: "Lance Shot", faction: "human", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "hit", n: 2 }, text: "Deal 2 to a unit or a player." },
  { id: "bz-oath-pilot", name: "Oath Pilot", faction: "human", kind: "unit", cost: 3, atk: 3, hp: 3, rarity: "basic", set: "blazar", tags: [], text: "Same oath. No sky." },
  { id: "bz-captain-kel", name: "Captain Kestrel", faction: "human", kind: "unit", cost: 4, atk: 3, hp: 4, rarity: "rare", set: "blazar", tags: [], play: { t: "buff", a: 1, h: 1 }, text: "Play: an ally unit gets +1/+1." },
  { id: "bz-admiral-voss", name: "Admiral Voss", faction: "human", kind: "unit", cost: 6, atk: 5, hp: 5, rarity: "legendary", set: "blazar", tags: [], play: { t: "hit", n: 2 }, text: "Play: deal 2 to a unit or a player." },

  { id: "bz-spark-rat", name: "Spark Rat", faction: "goblin", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "basic", set: "blazar", tags: ["haste"], text: "Haste." },
  { id: "bz-twin-jets", name: "Twin Jets", faction: "goblin", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "basic", set: "blazar", tags: [], play: { t: "twin" }, text: "Play: if you control another Rixen, this gets +1/+1." },
  { id: "bz-scrap-comet", name: "Scrap Comet", faction: "goblin", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "charge" }, text: "An ally unit gets +2 attack this turn and takes 1." },
  { id: "bz-boom-drone", name: "Boom Drone", faction: "goblin", kind: "unit", cost: 3, atk: 2, hp: 2, rarity: "basic", set: "blazar", tags: [], play: { t: "boom" }, text: "Play: deal 1 to the opponent." },
  { id: "bz-void-raider", name: "Void Raider", faction: "goblin", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "rare", set: "blazar", tags: ["haste"], text: "Haste." },
  { id: "bz-skarn-rift", name: "Skarn the Rift", faction: "goblin", kind: "unit", cost: 6, atk: 4, hp: 4, rarity: "legendary", set: "blazar", tags: ["haste"], aura: "goblinAtk", text: "Haste. Your other Rixen have +1 attack." },

  { id: "bz-ion-wisp", name: "Ion Wisp", faction: "robot", kind: "unit", cost: 2, atk: 1, hp: 2, rarity: "basic", set: "blazar", tags: [], play: { t: "healUnit", n: 2 }, text: "Play: heal an ally unit 2." },
  { id: "bz-hull-drone", name: "Hull Drone", faction: "robot", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "basic", set: "blazar", tags: ["bulwark"], text: "Bulwark." },
  { id: "bz-cold-weld", name: "Cold Weld", faction: "robot", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "healSelf", n: 2 }, text: "Heal 2." },
  { id: "bz-sentry-prism", name: "Sentry Prism", faction: "robot", kind: "unit", cost: 3, atk: 2, hp: 4, rarity: "basic", set: "blazar", tags: [], text: "A lens that does not blink." },
  { id: "bz-null-array", name: "Null Array", faction: "robot", kind: "unit", cost: 4, atk: 2, hp: 6, rarity: "rare", set: "blazar", tags: ["bulwark"], text: "Bulwark." },
  { id: "bz-apex-blazar", name: "APEX Blazar", faction: "robot", kind: "unit", cost: 7, atk: 4, hp: 7, rarity: "legendary", set: "blazar", tags: [], play: { t: "apex" }, text: "Play: your other Quorin get +0/+1." },

  { id: "bz-cinder-imp", name: "Cinder Imp", faction: "demon", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "blazar", tags: [], play: { t: "loseHp", n: 1 }, text: "Play: lose 1 life." },
  { id: "bz-pact-ember", name: "Pact Ember", faction: "demon", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "hit", n: 2 }, text: "Deal 2 to a unit or a player." },
  { id: "bz-brand-knight", name: "Brand Knight", faction: "demon", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "basic", set: "blazar", tags: [], text: "Hits, then the dark takes the rest." },
  { id: "bz-ash-moth", name: "Ash Moth", faction: "demon", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "basic", set: "blazar", tags: [], text: "Wings the color of a spent star." },
  { id: "bz-hex-moth", name: "Hex Moth", faction: "demon", kind: "unit", cost: 3, atk: 3, hp: 3, rarity: "rare", set: "blazar", tags: ["drain"], text: "Drain. Damage this deals to a player heals you." },
  { id: "bz-tyrant-blazar", name: "Tyrant of the Blazar", faction: "demon", kind: "unit", cost: 7, atk: 6, hp: 6, rarity: "legendary", set: "blazar", tags: ["crush"], text: "Crush. Extra damage past a blocker hits the player." },

  { id: "bz-drift-wisp", name: "Drift Wisp", faction: "veil", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "basic", set: "blazar", tags: [], deathHeal: 1, text: "When this dies, you heal 1. No seal claims it." },
  { id: "bz-eclipse-blade", name: "Eclipse Blade", faction: "veil", kind: "unit", cost: 2, atk: 2, hp: 1, rarity: "basic", set: "blazar", tags: ["haste"], text: "Haste." },
  { id: "bz-slip", name: "Blazar Slip", faction: "veil", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "blazar", tags: [], play: { t: "grantHaste" }, text: "An ally unit gains haste this turn and can attack immediately." },
  { id: "bz-quiet-star", name: "Quiet Star", faction: "veil", kind: "unit", cost: 3, atk: 2, hp: 4, rarity: "basic", set: "blazar", tags: [], text: "It does not take a side." },
  { id: "bz-horizon", name: "Event Horizon", faction: "veil", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "rare", set: "blazar", tags: [], trap: "horizon", text: "Trap. When they attack: deal 2 to an attacker and freeze it." },
  { id: "bz-the-veil", name: "The Veil Itself", faction: "veil", kind: "unit", cost: 7, atk: 5, hp: 6, rarity: "legendary", set: "blazar", tags: ["haste"], play: { t: "healSelf", n: 2 }, text: "Haste. Play: heal 2. The sixth seal, wearing a dead star." },
];

/** Founding cards for the sixth seal. Dark fantasy, not the space set. Starter decks use these. */
export const UNBOUND_RAW: RawCard[] = [
  { id: "un-lantern", name: "Pale Lantern", faction: "veil", kind: "unit", cost: 1, atk: 1, hp: 2, rarity: "common", set: "founding", tags: [], text: "A light that belongs to no grove." },
  { id: "un-squire", name: "Oathless Squire", faction: "veil", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "common", set: "founding", tags: [], text: "Steel with the crest filed off." },
  { id: "un-toll", name: "Silver Toll", faction: "veil", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "common", set: "founding", tags: [], play: { t: "hit", n: 2 }, text: "Deal 2 to a unit or a player." },
  { id: "un-choir", name: "Ash Choir", faction: "veil", kind: "unit", cost: 3, atk: 2, hp: 3, rarity: "common", set: "founding", tags: [], text: "They sing for whoever paid." },
  { id: "un-ward", name: "Way Ward", faction: "veil", kind: "unit", cost: 3, atk: 1, hp: 4, rarity: "common", set: "founding", tags: ["bulwark"], text: "Bulwark." },
  { id: "un-pilgrim", name: "Road Pilgrim", faction: "veil", kind: "unit", cost: 2, atk: 2, hp: 1, rarity: "uncommon", set: "founding", tags: ["haste"], text: "Haste. Can attack the turn it enters." },
  { id: "un-cross", name: "Crossroad Trap", faction: "veil", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "uncommon", set: "founding", tags: [], trap: "cross", text: "Trap. When they attack: deal 2 to an attacker." },
  { id: "un-nameless", name: "The Nameless", faction: "veil", kind: "unit", cost: 5, atk: 4, hp: 4, rarity: "rare", set: "founding", tags: [], text: "No seal. Just the road." },
];
