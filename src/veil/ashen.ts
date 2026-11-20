import type { RawCard } from "./blazar";

/** Set 3. Ashen Veil. Six cards a seal. Every line below is a rule the duel actually resolves. */
export const ASHEN_RAW: RawCard[] = [
  { id: "as-briar-vanguard", tokenId: 1, chainRarity: 1, name: "Briar Vanguard", faction: "elf", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "ashen", tags: [], flavor: "Black braid, leaf mail, and a short spear." },
  { id: "as-oak-sentinel", tokenId: 2, chainRarity: 1, name: "Oak Sentinel", faction: "elf", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "basic", set: "ashen", tags: ["bulwark"], flavor: "Auburn braid, green plate, a kite shield." },
  { id: "as-grove-mend", tokenId: 3, chainRarity: 1, name: "Grove Mend", faction: "elf", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "healSelf", n: 3 } },
  { id: "as-hidden-bough", tokenId: 4, chainRarity: 1, name: "Hidden Bough", faction: "elf", kind: "trap", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "glade" },
  { id: "as-selene-bow", tokenId: 5, chainRarity: 2, name: "Selene the Moon Bow", faction: "elf", kind: "unit", cost: 4, atk: 3, hp: 3, rarity: "rare", set: "ashen", tags: ["haste"], flavor: "White hair, silver mail, one shot before the grove answers." },
  { id: "as-lysara-ash", tokenId: 6, chainRarity: 3, name: "Lysara Ashcrown", faction: "elf", kind: "unit", cost: 6, atk: 4, hp: 5, rarity: "legendary", set: "ashen", tags: [], play: { t: "healSelf", n: 2 }, version: 2, flavor: "Blonde, emerald plate, the grove's last crown." },

  { id: "as-oath-squire", tokenId: 7, chainRarity: 1, name: "Oath Squire", faction: "human", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "ashen", tags: [], flavor: "Freckles, chestnut hair, and a sword too honest." },
  { id: "as-banner-dame", tokenId: 8, chainRarity: 1, name: "Banner Dame", faction: "human", kind: "unit", cost: 2, atk: 2, hp: 3, rarity: "basic", set: "ashen", tags: [], flavor: "She holds the torn banner and does not yield." },
  { id: "as-precise-oath", tokenId: 9, chainRarity: 1, name: "Precise Oath", faction: "human", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "hit", n: 2 }, version: 2 },
  { id: "as-pike-wall", tokenId: 10, chainRarity: 1, name: "Pike Wall", faction: "human", kind: "trap", cost: 3, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "pikes", version: 2 },
  { id: "as-captain-ysara", tokenId: 11, chainRarity: 2, name: "Captain Ysara", faction: "human", kind: "unit", cost: 4, atk: 3, hp: 3, rarity: "rare", set: "ashen", tags: ["formation"], version: 2, flavor: "Dark hair, red cloak, gold-trim steel." },
  { id: "as-marshal-hala", tokenId: 12, chainRarity: 3, name: "Marshal Hala", faction: "human", kind: "unit", cost: 6, atk: 4, hp: 5, rarity: "legendary", set: "ashen", tags: [], play: { t: "rally" }, version: 2, flavor: "Silver war-braid, lion plate." },

  { id: "as-cinder-lass", tokenId: 13, chainRarity: 1, name: "Cinder Lass", faction: "goblin", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "ashen", tags: ["haste"], flavor: "Copper hair, ember eyes, two clean knives." },
  { id: "as-scrap-vixen", tokenId: 14, chainRarity: 1, name: "Scrap Vixen", faction: "goblin", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "basic", set: "ashen", tags: [], surge: { t: "ping", n: 1 }, version: 2 },
  { id: "as-reckless-spark", tokenId: 15, chainRarity: 1, name: "Reckless Spark", faction: "goblin", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "charge", n: 2, selfHit: 0 }, surge: { t: "target", a: 0, h: 2 }, version: 2 },
  { id: "as-pit-wire", tokenId: 16, chainRarity: 1, name: "Pit Wire", faction: "goblin", kind: "trap", cost: 0, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "snare", version: 2 },
  { id: "as-nima-knives", tokenId: 17, chainRarity: 2, name: "Nima of the Knives", faction: "goblin", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "rare", set: "ashen", tags: ["haste"], flavor: "Black hair with a red streak, and too many knives." },
  { id: "as-sable-crown", tokenId: 18, chainRarity: 3, name: "Sable of the Tin Crown", faction: "goblin", kind: "unit", cost: 5, atk: 4, hp: 4, rarity: "legendary", set: "ashen", tags: ["haste"], aura: "goblinAtk" },

  { id: "as-ion-duelist", tokenId: 19, chainRarity: 1, name: "Ion Duelist", faction: "robot", kind: "unit", cost: 1, atk: 1, hp: 2, rarity: "basic", set: "ashen", tags: [], flavor: "A cyan bob, chrome joints, and a thin rapier." },
  { id: "as-hull-maiden", tokenId: 20, chainRarity: 1, name: "Hull Maiden", faction: "robot", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "basic", set: "ashen", tags: ["veilstep"], version: 2, flavor: "Broad white-cyan plate and a tower shield." },
  { id: "as-cold-weld", tokenId: 21, chainRarity: 1, name: "Ashen Weld", faction: "robot", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "healUnit", n: 2 }, version: 2 },
  { id: "as-veil-firewall", tokenId: 22, chainRarity: 1, name: "Veil Firewall", faction: "robot", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "firewall" },
  { id: "as-vesper-null", tokenId: 23, chainRarity: 2, name: "Vesper Null", faction: "robot", kind: "unit", cost: 4, atk: 4, hp: 3, rarity: "rare", set: "ashen", tags: [], flavor: "Cable-black hair, one cyan eye, and a lance that does not miss." },
  { id: "as-apex-crown", tokenId: 24, chainRarity: 3, name: "APEX Crown", faction: "robot", kind: "unit", cost: 6, atk: 3, hp: 7, rarity: "legendary", set: "ashen", tags: [], play: { t: "apex", h: 0, plating: 1 }, version: 2 },

  { id: "as-cinder-imp", tokenId: 25, chainRarity: 1, name: "Ember Imp", faction: "demon", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "ashen", tags: [], play: { t: "loseHp", n: 1 }, version: 2, flavor: "Small horns, cropped black hair, a wicked grin." },
  { id: "as-ash-temptress", tokenId: 26, chainRarity: 1, name: "Ash Temptress", faction: "demon", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "basic", set: "ashen", tags: [], flavor: "Long white hair, small horns, a smile that costs." },
  { id: "as-blood-pact", tokenId: 27, chainRarity: 1, name: "Ash Covenant", faction: "demon", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "draw", n: 1, lose: 1 }, version: 2 },
  { id: "as-soul-kiss", tokenId: 28, chainRarity: 1, name: "Ashen Kiss", faction: "demon", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "soul", version: 2 },
  { id: "as-duchess-vex", tokenId: 29, chainRarity: 2, name: "Vex, Ashen Duchess", faction: "demon", kind: "unit", cost: 4, atk: 3, hp: 3, rarity: "rare", set: "ashen", tags: ["drain"], version: 2, flavor: "Burgundy hair, curved horns, a gown edged in plate." },
  { id: "as-tyrant-lilu", tokenId: 30, chainRarity: 3, name: "Tyrant Lilu", faction: "demon", kind: "unit", cost: 7, atk: 6, hp: 6, rarity: "legendary", set: "ashen", tags: ["crush"], requiem: { t: "lose", n: 3 }, version: 2 },

  { id: "as-road-sister", tokenId: 31, chainRarity: 1, name: "Road Sister", faction: "veil", kind: "unit", cost: 1, atk: 1, hp: 2, rarity: "basic", set: "ashen", tags: [], requiem: { t: "heal", n: 1 }, flavor: "A pale girl, a linen hood, a walking staff." },
  { id: "as-ash-miller", tokenId: 32, chainRarity: 1, name: "Ash Miller", faction: "veil", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "basic", set: "ashen", tags: [], flavor: "Flour on her hands. A sickle at her belt." },
  { id: "as-silver-toll", tokenId: 33, chainRarity: 1, name: "Silver Unbinding", faction: "veil", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "unseal" }, version: 2 },
  { id: "as-cross-path", tokenId: 34, chainRarity: 1, name: "Cross Path", faction: "veil", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "cross" },
  { id: "as-widow-lane", tokenId: 35, chainRarity: 2, name: "Widow Lane", faction: "veil", kind: "unit", cost: 3, atk: 1, hp: 4, rarity: "rare", set: "ashen", tags: ["bulwark"], flavor: "Grey hair, a black shawl, and a lantern." },
  { id: "as-the-nameless", tokenId: 36, chainRarity: 3, name: "The Crownless", faction: "veil", kind: "unit", cost: 5, atk: 4, hp: 3, rarity: "legendary", set: "ashen", tags: ["haste"], version: 2, flavor: "A pale woman, a stolen crown, no seal." },
];
