import type { RawCard } from "./blazar";

/** Set 3. Ashen Veil. Six cards a seal. Every line below is a rule the duel actually resolves. */
export const ASHEN_RAW: RawCard[] = [
  { id: "as-briar-vanguard", name: "Briar Vanguard", faction: "elf", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "ashen", tags: [], text: "Black braid, leaf mail, and a short spear." },
  { id: "as-oak-sentinel", name: "Oak Sentinel", faction: "elf", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "basic", set: "ashen", tags: ["bulwark"], text: "Bulwark. Auburn braid, green plate, a kite shield." },
  { id: "as-grove-mend", name: "Grove Mend", faction: "elf", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "healSelf", n: 3 }, text: "Heal 3." },
  { id: "as-hidden-bough", name: "Hidden Bough", faction: "elf", kind: "trap", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "glade", text: "Trap. When they attack: heal 2 and deal 1 to an attacker." },
  { id: "as-selene-bow", name: "Selene the Moon Bow", faction: "elf", kind: "unit", cost: 4, atk: 3, hp: 3, rarity: "rare", set: "ashen", tags: ["haste"], text: "Haste. White hair, silver mail, one shot before the grove answers." },
  { id: "as-lysara-ash", name: "Lysara Ashcrown", faction: "elf", kind: "unit", cost: 6, atk: 4, hp: 6, rarity: "legendary", set: "ashen", tags: [], play: { t: "healSelf", n: 2 }, text: "Play: heal 2. Blonde, emerald plate, the grove's last crown." },

  { id: "as-oath-squire", name: "Oath Squire", faction: "human", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "ashen", tags: [], text: "Freckles, chestnut hair, and a sword too honest." },
  { id: "as-banner-dame", name: "Banner Dame", faction: "human", kind: "unit", cost: 2, atk: 2, hp: 3, rarity: "basic", set: "ashen", tags: [], text: "She holds the torn banner and does not yield." },
  { id: "as-precise-oath", name: "Precise Oath", faction: "human", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "hit", n: 2 }, text: "Deal 2 to a unit or a player." },
  { id: "as-pike-wall", name: "Pike Wall", faction: "human", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "pikes", text: "Trap. When they attack: deal 3 to an attacker." },
  { id: "as-captain-ysara", name: "Captain Ysara", faction: "human", kind: "unit", cost: 4, atk: 3, hp: 4, rarity: "rare", set: "ashen", tags: [], play: { t: "buff", a: 1, h: 1 }, text: "Play: an ally unit gets +1/+1. Dark hair, red cloak, gold-trim steel." },
  { id: "as-marshal-hala", name: "Marshal Hala", faction: "human", kind: "unit", cost: 6, atk: 5, hp: 5, rarity: "legendary", set: "ashen", tags: [], play: { t: "rally" }, text: "Play: your units get +1 attack this turn. Silver war-braid, lion plate." },

  { id: "as-cinder-lass", name: "Cinder Lass", faction: "goblin", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "ashen", tags: ["haste"], text: "Haste. Copper hair, ember eyes, two clean knives." },
  { id: "as-scrap-vixen", name: "Scrap Vixen", faction: "goblin", kind: "unit", cost: 1, atk: 1, hp: 1, rarity: "basic", set: "ashen", tags: [], play: { t: "twin" }, text: "Play: if you control another Rixen, this gets +1/+1." },
  { id: "as-reckless-spark", name: "Reckless Spark", faction: "goblin", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "charge" }, text: "An ally unit gets +2 attack this turn and takes 1." },
  { id: "as-pit-wire", name: "Pit Wire", faction: "goblin", kind: "trap", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "snare", text: "Trap. When they attack: destroy an attacker with attack 2 or less." },
  { id: "as-nima-knives", name: "Nima of the Knives", faction: "goblin", kind: "unit", cost: 3, atk: 3, hp: 2, rarity: "rare", set: "ashen", tags: ["haste"], text: "Haste. Black hair with a red streak, and too many knives." },
  { id: "as-sable-crown", name: "Sable of the Tin Crown", faction: "goblin", kind: "unit", cost: 5, atk: 4, hp: 4, rarity: "legendary", set: "ashen", tags: ["haste"], aura: "goblinAtk", text: "Haste. Your other Rixen have +1 attack." },

  { id: "as-ion-duelist", name: "Ion Duelist", faction: "robot", kind: "unit", cost: 1, atk: 1, hp: 2, rarity: "basic", set: "ashen", tags: [], text: "A cyan bob, chrome joints, and a thin rapier." },
  { id: "as-hull-maiden", name: "Hull Maiden", faction: "robot", kind: "unit", cost: 2, atk: 1, hp: 4, rarity: "basic", set: "ashen", tags: ["bulwark"], text: "Bulwark. Broad white-cyan plate and a tower shield." },
  { id: "as-cold-weld", name: "Cold Weld", faction: "robot", kind: "spell", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "healUnit", n: 2 }, text: "Play: heal an ally unit 2." },
  { id: "as-veil-firewall", name: "Veil Firewall", faction: "robot", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "firewall", text: "Trap. When they attack: prevent the next 4 damage to you." },
  { id: "as-vesper-null", name: "Vesper Null", faction: "robot", kind: "unit", cost: 4, atk: 4, hp: 3, rarity: "rare", set: "ashen", tags: [], text: "Cable-black hair, one cyan eye, and a lance that does not miss." },
  { id: "as-apex-crown", name: "APEX Crown", faction: "robot", kind: "unit", cost: 6, atk: 4, hp: 7, rarity: "legendary", set: "ashen", tags: [], play: { t: "apex" }, text: "Play: your other Quorin get +0/+1." },

  { id: "as-cinder-imp", name: "Cinder Imp", faction: "demon", kind: "unit", cost: 1, atk: 2, hp: 1, rarity: "basic", set: "ashen", tags: [], play: { t: "loseHp", n: 1 }, text: "Play: lose 1 life. Small horns, cropped black hair, a wicked grin." },
  { id: "as-ash-temptress", name: "Ash Temptress", faction: "demon", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "basic", set: "ashen", tags: [], text: "Long white hair, small horns, a smile that costs." },
  { id: "as-blood-pact", name: "Blood Pact", faction: "demon", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "draw", n: 1, lose: 1 }, text: "Draw 1. Lose 1 life. You cannot drop below 1 this way." },
  { id: "as-soul-kiss", name: "Soul Kiss", faction: "demon", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "soul", text: "Trap. When any unit dies: heal 3 and this banishes." },
  { id: "as-duchess-vex", name: "Duchess Vex", faction: "demon", kind: "unit", cost: 4, atk: 3, hp: 3, rarity: "rare", set: "ashen", tags: ["drain"], text: "Drain. Burgundy hair, curved horns, a gown edged in plate." },
  { id: "as-tyrant-lilu", name: "Tyrant Lilu", faction: "demon", kind: "unit", cost: 7, atk: 6, hp: 6, rarity: "legendary", set: "ashen", tags: ["crush"], text: "Crush. Extra damage past a blocker hits the player." },

  { id: "as-road-sister", name: "Road Sister", faction: "veil", kind: "unit", cost: 1, atk: 1, hp: 2, rarity: "basic", set: "ashen", tags: [], deathHeal: 1, text: "When this dies, you heal 1. A pale girl, a linen hood, a walking staff." },
  { id: "as-ash-miller", name: "Ash Miller", faction: "veil", kind: "unit", cost: 2, atk: 2, hp: 2, rarity: "basic", set: "ashen", tags: [], text: "Flour on her hands. A sickle at her belt." },
  { id: "as-silver-toll", name: "Silver Toll", faction: "veil", kind: "spell", cost: 1, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], play: { t: "hit", n: 2 }, text: "Deal 2 to a unit or a player." },
  { id: "as-cross-path", name: "Cross Path", faction: "veil", kind: "trap", cost: 2, atk: 0, hp: 0, rarity: "basic", set: "ashen", tags: [], trap: "cross", text: "Trap. When they attack: deal 2 to an attacker." },
  { id: "as-widow-lane", name: "Widow Lane", faction: "veil", kind: "unit", cost: 3, atk: 1, hp: 4, rarity: "rare", set: "ashen", tags: ["bulwark"], text: "Bulwark. Grey hair, a black shawl, and a lantern." },
  { id: "as-the-nameless", name: "The Nameless", faction: "veil", kind: "unit", cost: 5, atk: 4, hp: 4, rarity: "legendary", set: "ashen", tags: ["haste"], play: { t: "healSelf", n: 2 }, text: "Haste. Play: heal 2. A pale woman, a stolen crown, no seal." },
];
