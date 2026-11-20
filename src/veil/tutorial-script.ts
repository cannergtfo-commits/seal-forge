/**
 * Guided first match (S3). A short scripted duel against the Easy bot.
 *
 * - Local only: plain `startMatch` with a fixed seed, then both hands and decks
 *   are stacked so every new player sees the same cards in the same order.
 * - It uses only the public rules API (`logic.ts`), so the lesson can never
 *   teach a rule the engine doesn't have.
 * - Coach steps watch the Match and advance by themselves. A player who goes off
 *   script still finishes: every step either completes or is skipped once its
 *   moment has passed.
 * - Copy rule: teach the game only. No accounts, tokens, packs or prizes.
 */
import type { Bot } from "./bots";
import { cardOf, type Faction } from "./cards";
import { startMatch, type Match } from "./logic";

export const TUTORIAL_SEED = 0x5ea1f0;
export const TUTORIAL_YOU: Faction = "goblin";
export const TUTORIAL_RIVAL: Faction = "robot";
export const TUTORIAL_RIVAL_HP = 12;

export const TUTOR_BOT: Bot = {
  id: "forge-tutor",
  name: "Training Golem",
  faction: TUTORIAL_RIVAL,
  style: "easy",
  line: "A patient sparring partner for your first duel.",
};

/** Opening hand, then the draws in order (turn 2, turn 3, ...). */
export const YOUR_HAND = ["scrap", "kg-quiet-hand", "pit", "familiar"] as const;
export const YOUR_DRAWS = ["twins", "as-road-sister", "grenade", "raider", "oath-knight", "scrap", "boom", "skarn"] as const;
export const RIVAL_HAND = ["scout", "scout", "ash-imp", "oath-knight", "welder"] as const;
export const RIVAL_DRAWS = ["clock", "sentry", "lance", "welder", "clock", "oath-knight"] as const;

/** Builds the stacked tutorial match. Pure and deterministic. */
export function tutorialMatch(): Match {
  const m = startMatch(TUTORIAL_YOU, TUTORIAL_RIVAL, TUTORIAL_SEED);
  const [you, rival] = m.players;
  you.hand = YOUR_HAND.map((defId, i) => ({ uid: `t${i + 1}`, defId }));
  // Decks draw from the end of the array.
  you.deck = [...YOUR_DRAWS].reverse();
  rival.hand = RIVAL_HAND.map((defId, i) => ({ uid: `r${i + 1}`, defId }));
  rival.deck = [...RIVAL_DRAWS].reverse();
  rival.hp = TUTORIAL_RIVAL_HP;
  m.log = ["Guided duel. Bring the Training Golem to 0 life."];
  return m;
}

/** Where a coach mark points. `index` picks the nth match of `sel` in the table. */
export type CoachTarget = { sel: string; index?: number };

export type CoachStep = {
  id: string;
  title: string;
  body: string;
  target?: CoachTarget;
  /** Info steps wait for a "Next" tap. */
  next?: boolean;
  /** The step can be acted on now. When false the coach shows a short wait note. */
  show?: (m: Match) => boolean;
  /** The lesson is learned. */
  done?: (m: Match) => boolean;
  /** Its moment has passed (the player went off script). Treated as done. */
  skip?: (m: Match) => boolean;
  /** Keyword this step teaches, from the keyword registry. */
  keyword?: "surge" | "plating" | "requiem" | "trap";
};

const yourMain = (m: Match) => m.winner === null && m.turn === 0 && m.phase === "main";
const inHand = (m: Match, defId: string) => m.players[0].hand.some((card) => card.defId === defId);
/** Your turn number (1, 2, 3...). Seat 0 plays the odd global turns. */
export const yourTurnNo = (m: Match) => Math.ceil(m.turnCount / 2);

export const LANE_RIVAL: CoachTarget = { sel: ".arena-lane", index: 0 };
export const LANE_YOU: CoachTarget = { sel: ".arena-lane", index: 1 };

export const STEPS: CoachStep[] = [
  {
    id: "welcome",
    title: "Your first duel",
    body: "You sit at the bottom. The Training Golem sits at the top. Bring its life to 0 to win.",
    target: { sel: ".arena-life", index: 0 },
    next: true,
  },
  {
    id: "mana",
    title: "Mana",
    body: "This is your mana. You get one more each turn, up to 10. The number in a card's top-left corner is what it costs.",
    target: { sel: ".arena-mana", index: 1 },
    next: true,
  },
  {
    id: "play-unit",
    title: "Play a unit",
    body: "Tap Scrap Runner in your hand to play it. Units fight for you on the board.",
    target: { sel: ".arena-hand" },
    show: yourMain,
    done: (m) => m.players[0].units.length > 0,
    skip: (m) => m.turnCount > 1,
  },
  {
    id: "end-1",
    title: "End your turn",
    body: "Units can't attack on the turn they arrive, and nobody attacks on turn 1. Tap End turn.",
    target: { sel: ".arena-end-turn" },
    show: yourMain,
    done: (m) => m.turnCount > 1,
  },
  {
    id: "rival-1",
    title: "The rival's turn",
    body: "The Golem plays a unit of its own. Your turn comes right back.",
    target: LANE_RIVAL,
    done: (m) => yourMain(m) && yourTurnNo(m) >= 2,
  },
  {
    id: "attack",
    title: "Attack",
    body: "Your unit is ready (it glows). Tap it, then tap Attack. Any attacker the rival doesn't block hits its life.",
    target: LANE_YOU,
    show: (m) => yourMain(m) && !m.attacked,
    done: (m) => m.turn === 0 && m.attacked,
    skip: (m) => yourTurnNo(m) > 2 || (yourMain(m) && !m.players[0].units.some((unit) => unit.ready && !unit.sick)),
  },
  {
    id: "surge",
    title: "Surge",
    keyword: "surge",
    body: "Surge: if you already played a card this turn, it does more. Play any 1-mana card first, then Twin Knives. It gets +1/+1.",
    target: { sel: ".arena-hand" },
    show: yourMain,
    done: (m) => !inHand(m, "twins"),
    skip: (m) => yourTurnNo(m) > 2 && m.turn === 0,
  },
  {
    id: "plating",
    title: "Plating",
    keyword: "plating",
    body: "Quiet Hand has Plating 1: the first 1 damage it takes each turn is ignored. The ▣ mark shows how much is left this turn.",
    target: { sel: ".mech-plating" },
    next: true,
    skip: (m) => !m.players[0].units.some((unit) => (unit.plating ?? 0) > 0),
  },
  {
    id: "end-2",
    title: "End your turn",
    body: "Tap End turn. The Golem will attack you next, so watch for the block.",
    target: { sel: ".arena-end-turn" },
    show: yourMain,
    done: (m) => yourTurnNo(m) >= 2 && m.turn === 1,
    skip: (m) => yourTurnNo(m) >= 3,
  },
  {
    id: "rival-2",
    title: "Get ready to block",
    body: "When the Golem attacks, you choose who blocks. Units that attacked on your turn are rested and can't block.",
    target: LANE_RIVAL,
    done: (m) => yourMain(m) && yourTurnNo(m) >= 3,
  },
  {
    id: "trap-set",
    title: "Traps",
    keyword: "trap",
    body: "Pit Snare is a trap. Tap it to set it face down. When the rival attacks, you can spring it to destroy an attacker with 3 or less attack.",
    target: { sel: ".arena-hand" },
    show: yourMain,
    done: (m) => m.players[0].traps.length > 0 || !inHand(m, "pit"),
    skip: (m) => yourTurnNo(m) > 3 && m.turn === 0,
  },
  {
    id: "requiem",
    title: "Requiem",
    keyword: "requiem",
    body: "Road Sister has Requiem: when it dies, you heal 1. Losing it still pays you back. Play it.",
    target: { sel: ".arena-hand" },
    show: yourMain,
    done: (m) => !inHand(m, "as-road-sister"),
    skip: (m) => yourTurnNo(m) > 3 && m.turn === 0,
  },
  {
    id: "attack-2",
    title: "Go wide",
    body: "Tap every ready unit, then Attack. The Golem only blocks when it's about to lose.",
    target: LANE_YOU,
    show: (m) => yourMain(m) && !m.attacked,
    done: (m) => m.turn === 0 && m.attacked,
    skip: (m) => yourTurnNo(m) > 3 || (yourMain(m) && !m.players[0].units.some((unit) => unit.ready && !unit.sick)),
  },
  {
    id: "end-3",
    title: "End your turn",
    body: "Tap End turn. If the Golem attacks, spring your trap.",
    target: { sel: ".arena-end-turn" },
    show: yourMain,
    done: (m) => yourTurnNo(m) >= 3 && m.turn === 1,
    skip: (m) => yourTurnNo(m) >= 4,
  },
  {
    id: "finish",
    title: "Finish it",
    body: "Horde Grenade deals 3 to a unit or a player. Aim it at the Golem's life, then attack with everything to win.",
    target: { sel: ".arena-hand" },
    show: yourMain,
    done: (m) => m.winner !== null,
  },
];

/**
 * Lessons that cut in whenever the rival attacks, on top of the step list.
 * `first` is the full lesson, `again` a short reminder for later attacks.
 */
export type Interrupt = { id: "trap" | "block"; title: string; first: string; again: string; target: CoachTarget; show: (m: Match) => boolean };

export const INTERRUPTS: Interrupt[] = [
  {
    id: "trap",
    title: "Spring a trap",
    first: "The Golem is attacking and your trap is set. Tap Pit Snare, then tap the attacker to destroy it. Or tap Pass to save it.",
    again: "Spring a trap on an attacker, or Pass.",
    target: { sel: ".arena-react-frame" },
    show: (m) => m.winner === null && m.turn === 1 && m.phase === "trap",
  },
  {
    id: "block",
    title: "Block",
    first: "The Golem is attacking. Tap the attacker, then tap one of your ready units to block it, then Confirm blocks. Blocked units deal damage to each other. Or Confirm with no blocks to take the hit.",
    again: "Tap an attacker, then a ready unit to block. Then Confirm blocks.",
    target: { sel: ".arena-dock-actions" },
    show: (m) => m.winner === null && m.turn === 1 && m.phase === "defend",
  },
];

/** Index of the first step that isn't finished, given the info steps already tapped through. */
export function currentStep(m: Match, from: number, acked: ReadonlySet<string>): number {
  let i = from;
  while (i < STEPS.length) {
    const step = STEPS[i]!;
    if (step.skip?.(m)) {
      i += 1;
      continue;
    }
    if (step.next ? acked.has(step.id) : step.done?.(m)) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

/** All player-facing tutorial copy, for the no-wallet-talk test. */
export function tutorialCopy(): string[] {
  return [
    TUTOR_BOT.name,
    TUTOR_BOT.line,
    ...STEPS.flatMap((step) => [step.title, step.body]),
    ...INTERRUPTS.flatMap((item) => [item.title, item.first, item.again]),
    ...TUTORIAL_UI_COPY,
  ];
}

/** Strings the tutorial components show (offer, finish, skip). Kept here so the copy test sees them. */
export const TUTORIAL_UI_COPY = [
  "New to Seal Forge?",
  "Learn the basics in a short guided duel: playing units, mana, attacking, blocking, traps, and three keywords. About three minutes.",
  "Start guided duel",
  "Not now",
  "Skip tutorial",
  "Replay guided duel",
  "Guided duel",
  "Duel complete",
  "You know the basics. Practice against bots of every seal, or build a deck from the cards you own.",
  "Try again",
  "The Golem won this one. Replay the guided duel, or head to the hall.",
  "Back to the hall",
  "Practice duel",
  "Next",
  "Got it",
  "Hide tips",
  "Show tips",
];

export const BANNED_COPY = /\b(wallets?|bzb|rewards?|tokens?|nfts?|mint(ing)?|crypto|polygon|claims?|prizes?|earn(ings)?)\b/i;

/** Every card the tutorial uses, so tests can check they still exist. */
export function tutorialCards(): string[] {
  return [...new Set([...YOUR_HAND, ...YOUR_DRAWS, ...RIVAL_HAND, ...RIVAL_DRAWS])];
}

/** True when the stacked cards still carry the keywords the lessons name. */
export function lessonCardsValid(): boolean {
  const twins = cardOf("twins");
  const quiet = cardOf("kg-quiet-hand");
  const sister = cardOf("as-road-sister");
  const pit = cardOf("pit");
  return Boolean(twins.surge && (quiet.plating ?? 0) > 0 && sister.requiem && pit.kind === "trap" && pit.trap === "snare");
}

// ---- Completion, stored on this device only -------------------------------------

export const TUTORIAL_KEY = "sf.tutorial.v1";
export type TutorialState = "done" | "skipped" | "dismissed";

type Store = Pick<Storage, "getItem" | "setItem">;

function store(): Store | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function tutorialState(s: Store | null = store()): TutorialState | null {
  try {
    const v = s?.getItem(TUTORIAL_KEY);
    return v === "done" || v === "skipped" || v === "dismissed" ? v : null;
  } catch {
    return null;
  }
}

export function setTutorialState(state: TutorialState, s: Store | null = store()): void {
  try {
    // "done" always wins over a later "dismissed".
    if (state !== "done" && tutorialState(s) === "done") return;
    s?.setItem(TUTORIAL_KEY, state);
  } catch {
    /* private mode: the offer just shows again next visit */
  }
}

/** New players get the offer until they finish, skip, or turn it down once. */
export function shouldOfferTutorial(s: Store | null = store()): boolean {
  return tutorialState(s) === null;
}
