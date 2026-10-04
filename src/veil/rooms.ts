import { stepRival } from "./ai";
import { liveBot, type Bot } from "./bots";
import type { Faction } from "./cards";
import {
  assignDefenders,
  declareAttack,
  endTurn,
  playCard,
  skipTrap,
  springTrap,
  startMatch,
  type Match,
  type Side,
  type Target,
} from "./logic";

export type Act =
  | { t: "play"; uid: string; target: Target | null }
  | { t: "attack"; ids: string[] }
  | { t: "block"; blocks: Record<string, string | null> }
  | { t: "trap"; uid: string; target: string | null }
  | { t: "skip" }
  | { t: "end" };

type SeatInfo = {
  id: string;
  name: string;
  faction: Faction;
  address: string;
  bot: Bot | null;
  deck: string[] | null;
  eligible: boolean;
};

type Room = {
  id: string;
  match: Match;
  seats: [SeatInfo, SeatInfo];
  prize: { matchId: `0x${string}`; player: `0x${string}` } | null;
  scored: boolean;
  deadline: number;
  botAt: number;
  clockKey: string;
};

type Ticket = {
  id: string;
  name: string;
  faction: Faction;
  address: string;
  at: number;
  roomId: string | null;
  deck: string[] | null;
  eligible: boolean;
};

const WAIT_MS = 20_000;
const tickets = new Map<string, Ticket>();
const rooms = new Map<string, Room>();
const wins = new Map<string, { day: string; n: number }>();

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function publicMatch(room: Room, seat: Side) {
  const match = room.match;
  const show = (side: Side) => {
    const player = match.players[side];
    const mine = side === seat;
    return {
      name: room.seats[side].name,
      faction: room.seats[side].faction,
      bot: Boolean(room.seats[side].bot),
      hp: player.hp,
      ward: player.ward,
      mana: player.mana,
      manaMax: player.manaMax,
      deck: player.deck.length,
      grave: [...player.grave],
      hand: mine ? player.hand : [],
      handCount: player.hand.length,
      units: player.units.map((unit) => ({
        uid: unit.uid,
        defId: unit.defId,
        hp: unit.hp,
        maxHp: unit.maxHp,
        atk: unit.atk,
        sick: unit.sick,
        ready: unit.ready,
        frozen: unit.frozen,
        swing: unit.swing,
        owner: unit.owner,
      })),
      traps: player.traps.map((trap, index) => ({ uid: mine ? trap.uid : `down-${index}`, defId: mine ? trap.defId : "" })),
    };
  };
  return {
    roomId: room.id,
    you: seat,
    turn: match.turn,
    phase: match.phase,
    turnCount: match.turnCount,
    winner: match.winner,
    log: match.log,
    attackers: match.attackers,
    attacked: match.attacked,
    seq: match.seq,
    leftMs: Math.max(0, room.deadline - Date.now()),
    seats: [show(0), show(1)] as const,
  };
}

function clockKey(match: Match): string {
  return `${match.turn}:${match.phase}:${match.turnCount}:${match.winner ?? "play"}`;
}

const MAIN_CLOCK_MS = 60_000;
const REACT_CLOCK_MS = 6_000;

function clockMs(match: Match): number {
  return match.phase === "trap" || match.phase === "defend" ? REACT_CLOCK_MS : MAIN_CLOCK_MS;
}

function touchClock(room: Room): void {
  const key = clockKey(room.match);
  if (key === room.clockKey) return;
  room.clockKey = key;
  room.deadline = Date.now() + clockMs(room.match);
  room.botAt = Date.now() + 900;
}

function expire(room: Room): boolean {
  const before = room.match;
  if (before.phase === "main") {
    const ended = endTurn(before);
    if (!ended.error) room.match = ended.state;
  } else if (before.phase === "trap") {
    const skipped = skipTrap(before);
    if (!skipped.error) room.match = skipped.state;
  } else if (before.phase === "defend") {
    const open = Object.fromEntries(before.attackers.map((id) => [id, null]));
    const blocked = assignDefenders(before, open);
    if (!blocked.error) room.match = blocked.state;
  }
  return room.match !== before;
}

/** One shared clock. Bots take a single action per poll so the table can show it. */
function advance(room: Room, stepBot: boolean): void {
  if (room.match.winner !== null) return;
  touchClock(room);
  for (let guard = 0; guard < 8 && room.match.winner === null; guard++) {
    const actor = sideToAct(room.match);
    const bot = room.seats[actor].bot;
    const timedOut = Date.now() >= room.deadline;
    if (bot) {
      if (timedOut) {
        for (let i = 0; i < 12 && room.match.winner === null; i++) {
          const seatBot = room.seats[sideToAct(room.match)].bot;
          if (!seatBot) break;
          const next = stepRival(room.match, seatBot.style);
          if (!next) break;
          room.match = next;
        }
        touchClock(room);
        return;
      }
      if (!stepBot || Date.now() < room.botAt) return;
      const next = stepRival(room.match, bot.style);
      if (!next) return;
      room.match = next;
      touchClock(room);
      room.botAt = Date.now() + 900;
      return;
    }
    if (!timedOut) return;
    if (!expire(room)) return;
    touchClock(room);
  }
}

function finishBots(room: Room): void {
  advance(room, false);
}

function openRoom(a: SeatInfo, b: SeatInfo): Room {
  const seed = Math.floor(Math.random() * 0xffffffff) || 1;
  const room: Room = {
    id: `m${seed.toString(16)}`,
    match: startMatch(a.faction, b.faction, seed, [a.deck, b.deck]),
    seats: [a, b],
    prize: null,
    scored: false,
    deadline: Date.now() + MAIN_CLOCK_MS,
    botAt: Date.now() + 900,
    clockKey: "",
  };
  touchClock(room);
  rooms.set(room.id, room);
  return room;
}

function liveRoom(ticket: Ticket): Room | null {
  if (!ticket.roomId) return null;
  const room = rooms.get(ticket.roomId);
  if (room && room.match.winner === null) return room;
  ticket.roomId = null;
  return null;
}

export function joinQueue(input: { id: string; name: string; faction: Faction; address: string; deck?: string[] | null; eligible?: boolean }): {
  status: "wait" | "play";
  waitMs: number;
  view: ReturnType<typeof publicMatch> | null;
} {
  const existing = tickets.get(input.id);
  const playing = existing ? liveRoom(existing) : null;
  if (existing && playing) {
    const seat = playing.seats[0].id === input.id ? 0 : 1;
    return { status: "play", waitMs: 0, view: publicMatch(playing, seat) };
  }
  if (existing) existing.at = Date.now();
  const waiting = [...tickets.values()].find((ticket) => ticket.roomId === null && ticket.id !== input.id && Date.now() - ticket.at < WAIT_MS);
  const self: Ticket = existing ?? {
    id: input.id,
    name: input.name.slice(0, 24) || "Duelist",
    faction: input.faction,
    address: input.address,
    at: Date.now(),
    roomId: null,
    deck: input.deck ?? null,
    eligible: Boolean(input.eligible),
  };
  self.name = input.name.slice(0, 24) || "Duelist";
  self.faction = input.faction;
  self.address = input.address;
  self.deck = input.deck ?? null;
  self.eligible = Boolean(input.eligible);
  tickets.set(self.id, self);
  if (waiting) {
    const room = openRoom(
      { id: waiting.id, name: waiting.name, faction: waiting.faction, address: waiting.address, bot: null, deck: waiting.deck, eligible: waiting.eligible },
      { id: self.id, name: self.name, faction: self.faction, address: self.address, bot: null, deck: self.deck, eligible: self.eligible },
    );
    waiting.roomId = room.id;
    self.roomId = room.id;
    return { status: "play", waitMs: 0, view: publicMatch(room, 1) };
  }
  return { status: "wait", waitMs: Math.max(0, WAIT_MS - (Date.now() - self.at)), view: null };
}

function openBot(ticket: Ticket): Room {
  const bot = liveBot();
  const room = openRoom(
    { id: ticket.id, name: ticket.name, faction: ticket.faction, address: ticket.address, bot: null, deck: ticket.deck, eligible: ticket.eligible },
    { id: bot.id, name: bot.name, faction: bot.faction, address: "", bot, deck: null, eligible: false },
  );
  ticket.roomId = room.id;
  return room;
}

export function pollQueue(id: string): { status: "wait" | "play" | "missing"; waitMs: number; view: ReturnType<typeof publicMatch> | null } {
  const ticket = tickets.get(id);
  if (!ticket) return { status: "missing", waitMs: 0, view: null };
  if (ticket.roomId) {
    const room = rooms.get(ticket.roomId);
    if (!room) return { status: "missing", waitMs: 0, view: null };
    const seat = room.seats[0].id === id ? 0 : 1;
    advance(room, true);
    return { status: "play", waitMs: 0, view: publicMatch(room, seat) };
  }
  const left = WAIT_MS - (Date.now() - ticket.at);
  if (left > 0) return { status: "wait", waitMs: left, view: null };
  const room = openBot(ticket);
  return { status: "play", waitMs: 0, view: publicMatch(room, 0) };
}

export function seatBot(id: string): { status: "wait" | "play" | "missing"; waitMs: number; view: ReturnType<typeof publicMatch> | null; error?: string } {
  const ticket = tickets.get(id);
  if (!ticket) return { status: "missing", waitMs: 0, view: null, error: "Join the queue first." };
  const playing = liveRoom(ticket);
  if (playing) {
    const seat = playing.seats[0].id === id ? 0 : 1;
    return { status: "play", waitMs: 0, view: publicMatch(playing, seat) };
  }
  const room = openBot(ticket);
  return { status: "play", waitMs: 0, view: publicMatch(room, 0) };
}

function sideToAct(match: Match): Side {
  if (match.phase === "main") return match.turn;
  return match.turn === 0 ? 1 : 0;
}

export function act(id: string, action: Act): { error?: string; view: ReturnType<typeof publicMatch> | null; claim: { matchId: `0x${string}`; player: `0x${string}` } | null } {
  const ticket = tickets.get(id);
  const room = ticket?.roomId ? rooms.get(ticket.roomId) : undefined;
  if (!ticket || !room) return { error: "No match.", view: null, claim: null };
  const seat: Side = room.seats[0].id === id ? 0 : 1;
  if (room.match.winner !== null) return { view: publicMatch(room, seat), claim: room.prize };
  if (sideToAct(room.match) !== seat) return { error: "Not your step.", view: publicMatch(room, seat), claim: null };
  let result: { state: Match; error?: string };
  if (action.t === "play") result = playCard(room.match, action.uid, action.target);
  else if (action.t === "attack") result = declareAttack(room.match, action.ids);
  else if (action.t === "block") result = assignDefenders(room.match, action.blocks);
  else if (action.t === "trap") result = springTrap(room.match, action.uid, action.target);
  else if (action.t === "skip") result = skipTrap(room.match);
  else result = endTurn(room.match);
  if (result.error) return { error: result.error, view: publicMatch(room, seat), claim: null };
  room.match = result.state;
  finishBots(room);
  return { view: publicMatch(room, seat), claim: claimFor(room, seat) };
}

function claimFor(room: Room, seat: Side): { matchId: `0x${string}`; player: `0x${string}` } | null {
  if (room.prize) return room.prize.player.toLowerCase() === room.seats[seat].address.toLowerCase() ? room.prize : null;
  if (room.match.winner !== seat) return null;
  if (!room.seats[seat].eligible) return null;
  const address = room.seats[seat].address;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const day = dayKey();
  const prior = wins.get(address.toLowerCase());
  const count = prior && prior.day === day ? prior.n : 0;
  if (count >= 4) return null;
  wins.set(address.toLowerCase(), { day, n: count + 1 });
  const hex = Buffer.from(room.id).toString("hex").padEnd(64, "0").slice(0, 64);
  room.prize = { matchId: `0x${hex}`, player: address as `0x${string}` };
  return room.prize;
}

export function prizeFor(id: string): { matchId: `0x${string}`; player: `0x${string}` } | null {
  const ticket = tickets.get(id);
  const room = ticket?.roomId ? rooms.get(ticket.roomId) : undefined;
  if (!ticket || !room || room.match.winner === null) return null;
  const seat: Side = room.seats[0].id === id ? 0 : 1;
  return claimFor(room, seat);
}

export function rewardGate(id: string): "none" | "needs-card" | "ready" {
  const ticket = tickets.get(id);
  const room = ticket?.roomId ? rooms.get(ticket.roomId) : undefined;
  if (!ticket || !room || room.match.winner === null) return "none";
  const seat: Side = room.seats[0].id === id ? 0 : 1;
  if (room.match.winner !== seat) return "none";
  if (!room.seats[seat].eligible) return "needs-card";
  return "ready";
}

export function scoreboard(id: string): { address: string; win: boolean }[] {
  const ticket = tickets.get(id);
  const room = ticket?.roomId ? rooms.get(ticket.roomId) : undefined;
  if (!ticket || !room || room.match.winner === null || room.scored) return [];
  room.scored = true;
  const out: { address: string; win: boolean }[] = [];
  for (const side of [0, 1] as const) {
    const seat = room.seats[side];
    if (seat.bot || !/^0x[0-9a-fA-F]{40}$/.test(seat.address)) continue;
    out.push({ address: seat.address, win: room.match.winner === side });
  }
  return out;
}

export const QUEUE_MS = WAIT_MS;
