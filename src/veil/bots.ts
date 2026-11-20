import type { Faction } from "./cards";

/**
 * How a bot plays. The three original styles keep their old behaviour:
 * - `easy` is the Easy level.
 * - `guard` and `aggro` are the Normal level with a defensive or aggressive lean.
 * - `hard` is the Hard level: lethal search (including burn to the face),
 *   simulated trades and blocks, and trap play. It picks its own lean each turn.
 */
export type BotStyle = "easy" | "aggro" | "guard" | "hard";

export type Difficulty = "easy" | "normal" | "hard";

export const DIFFICULTIES: { id: Difficulty; name: string; line: string }[] = [
  { id: "easy", name: "Easy", line: "Plays the cheapest card and rarely blocks." },
  { id: "normal", name: "Normal", line: "Trades sensibly and swings when it is safe." },
  { id: "hard", name: "Hard", line: "Counts lethal, plans trades, and plays its traps well." },
];

export function levelOf(style: BotStyle): Difficulty {
  if (style === "easy") return "easy";
  if (style === "hard") return "hard";
  return "normal";
}

export type Bot = {
  id: string;
  name: string;
  faction: Faction;
  style: BotStyle;
  line: string;
};

export const PRACTICE: Bot[] = [
  {
    id: "glen-spar",
    name: "Glen Spar",
    faction: "elf",
    style: "easy",
    line: "Aureth. A loose practice partner.",
  },
  {
    id: "squire-venn",
    name: "Squire Venn",
    faction: "human",
    style: "easy",
    line: "Veymar. A loose practice partner.",
  },
  {
    id: "pebble",
    name: "Pebble",
    faction: "goblin",
    style: "easy",
    line: "Rixen. A loose practice partner.",
  },
  {
    id: "drill-1",
    name: "Drill-1",
    faction: "robot",
    style: "easy",
    line: "Quorin. A loose practice partner.",
  },
  {
    id: "ember-page",
    name: "Ember Page",
    faction: "demon",
    style: "easy",
    line: "Malrec. A loose practice partner.",
  },
];

export const BOTS: Bot[] = [
  {
    id: "lys-glen",
    name: "Lys of the Glen",
    faction: "elf",
    style: "guard",
    line: "Mends, then the treant.",
  },
  {
    id: "sira",
    name: "Sira Dawnbow",
    faction: "elf",
    style: "aggro",
    line: "Archers before the grove.",
  },
  {
    id: "venn",
    name: "Marshal Venn",
    faction: "human",
    style: "guard",
    line: "Shields first, shots second.",
  },
  {
    id: "ilya",
    name: "Scout Ilya",
    faction: "human",
    style: "aggro",
    line: "Trades early and often.",
  },
  {
    id: "rattle",
    name: "Rattle",
    faction: "goblin",
    style: "aggro",
    line: "Cheap knives, then the bomb.",
  },
  {
    id: "nox",
    name: "Drummer Nox",
    faction: "goblin",
    style: "guard",
    line: "Sets a pit, then the horde.",
  },
  {
    id: "kite",
    name: "Unit Kite",
    faction: "robot",
    style: "guard",
    line: "Walls, repairs, firewall.",
  },
  {
    id: "lance4",
    name: "Lance-4",
    faction: "robot",
    style: "aggro",
    line: "Overclocks and swings.",
  },
  {
    id: "ash-pact",
    name: "Ash Pact",
    faction: "demon",
    style: "aggro",
    line: "Spends life for cards.",
  },
  {
    id: "cinder",
    name: "Sister Cinder",
    faction: "demon",
    style: "guard",
    line: "Drain, then the soul snare.",
  },
];

/** Hard bots, one per seal. Not in the live pool until the team picks where Hard shows up. */
export const CHALLENGERS: Bot[] = [
  {
    id: "hard-elf",
    name: "Warden Aelis",
    faction: "elf",
    style: "hard",
    line: "Aureth. Counts every heal and every block.",
  },
  {
    id: "hard-human",
    name: "Lord-Captain Brann",
    faction: "human",
    style: "hard",
    line: "Veymar. Never swings into a bad trade.",
  },
  {
    id: "hard-goblin",
    name: "Skarn's Shadow",
    faction: "goblin",
    style: "hard",
    line: "Rixen. Finds lethal you did not see.",
  },
  {
    id: "hard-robot",
    name: "Array Prime",
    faction: "robot",
    style: "hard",
    line: "Quorin. Plays its traps on the right swing.",
  },
  {
    id: "hard-demon",
    name: "The Ninth Debt",
    faction: "demon",
    style: "hard",
    line: "Malrec. Burns your face when it adds up.",
  },
];

export function botOf(id: string): Bot {
  return (
    PRACTICE.find((bot) => bot.id === id) ??
    BOTS.find((bot) => bot.id === id) ??
    CHALLENGERS.find((bot) => bot.id === id) ??
    PRACTICE[0]!
  );
}

export function liveBot(): Bot {
  return BOTS[Math.floor(Math.random() * BOTS.length)] ?? BOTS[0]!;
}
