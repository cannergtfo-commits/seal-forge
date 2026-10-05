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
  stage: number;
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
  lobby: string | null;
  stage: number;
};

type Lobby = {
  code: string;
  hostId: string;
  at: number;
};

const WAIT_MS = 20_000;
const LOBBY_MS = 15 * 60 * 1000;
const tickets = new Map<string, Ticket>();
const rooms = new Map<string, Room>();
const lobbies = new Map<string, Lobby>();
const wins = new Map<string, { day: string; n: number }>();

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One shared daily cap for website matches and phone claims. */
export function takeDailyWin(address: string): boolean {
  const id = address.toLowerCase();
  const day = dayKey();
  const prior = wins.get(id);
  const count = prior && prior.day === day ? prior.n : 0;
  if (count >= 4) return false;
  wins.set(id, { day, n: count + 1 });
  return true;
}

export function refundDailyWin(address: string): void {
  const id = address.toLowerCase();
  const prior = wins.get(id);
  if (!prior || prior.n <= 0) return;
  wins.set(id, { day: prior.day, n: prior.n - 1 });
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
    stage: room.seats[0].stage && !room.seats[0].bot ? room.seats[0].stage : room.seats[1].stage && !room.seats[1].bot ? room.seats[1].stage : 0,
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

function stageOf(value: number | undefined): number {
  if (!value || !Number.isInteger(value) || value < 1 || value > 64) return 0;
  return value;
}

export function joinQueue(input: { id: string; name: string; faction: Faction; address: string; deck?: string[] | null; eligible?: boolean; stage?: number }): {
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
  if (existing?.lobby) {
    lobbies.delete(existing.lobby);
    existing.lobby = null;
  }
  if (existing) existing.at = Date.now();
  const waiting = [...tickets.values()].find((ticket) => ticket.roomId === null && ticket.lobby === null && ticket.id !== input.id && Date.now() - ticket.at < WAIT_MS);
  const self: Ticket = existing ?? {
    id: input.id,
    name: input.name.slice(0, 24) || "Duelist",
    faction: input.faction,
    address: input.address,
    at: Date.now(),
    roomId: null,
    deck: input.deck ?? null,
    eligible: Boolean(input.eligible),
    lobby: null,
    stage: stageOf(input.stage),
  };
  self.name = input.name.slice(0, 24) || "Duelist";
  self.faction = input.faction;
  self.address = input.address;
  self.deck = input.deck ?? null;
  self.eligible = Boolean(input.eligible);
  self.lobby = null;
  self.stage = stageOf(input.stage);
  tickets.set(self.id, self);
  if (waiting) {
    const room = openRoom(
      { id: waiting.id, name: waiting.name, faction: waiting.faction, address: waiting.address, bot: null, deck: waiting.deck, eligible: waiting.eligible, stage: waiting.stage },
      { id: self.id, name: self.name, faction: self.faction, address: self.address, bot: null, deck: self.deck, eligible: self.eligible, stage: self.stage },
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
    { id: ticket.id, name: ticket.name, faction: ticket.faction, address: ticket.address, bot: null, deck: ticket.deck, eligible: ticket.eligible, stage: ticket.stage },
    { id: bot.id, name: bot.name, faction: bot.faction, address: "", bot, deck: null, eligible: false, stage: 0 },
  );
  ticket.roomId = room.id;
  return room;
}

export function pollQueue(id: string): { status: "wait" | "play" | "missing" | "lobby"; waitMs: number; view: ReturnType<typeof publicMatch> | null; code?: string } {
  const ticket = tickets.get(id);
  if (!ticket) return { status: "missing", waitMs: 0, view: null };
  if (ticket.roomId) {
    const room = rooms.get(ticket.roomId);
    if (!room) return { status: "missing", waitMs: 0, view: null };
    const seat = room.seats[0].id === id ? 0 : 1;
    advance(room, true);
    return { status: "play", waitMs: 0, view: publicMatch(room, seat) };
  }
  if (ticket.lobby) {
    pruneLobbies();
    if (lobbies.has(ticket.lobby)) return { status: "lobby", waitMs: 0, view: null, code: ticket.lobby };
    ticket.lobby = null;
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
  if (ticket.lobby) {
    lobbies.delete(ticket.lobby);
    ticket.lobby = null;
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
  if (!takeDailyWin(address)) return null;
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

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function freshCode(): string {
  for (let attempt = 0; attempt < 8; attempt++) {
    let code = "";
    for (let index = 0; index < 4; index++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!lobbies.has(code)) return code;
  }
  return `T${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

function pruneLobbies(): void {
  const now = Date.now();
  for (const [code, lobby] of lobbies) {
    if (now - lobby.at <= LOBBY_MS) continue;
    const host = tickets.get(lobby.hostId);
    if (host && host.lobby === code && !host.roomId) host.lobby = null;
    lobbies.delete(code);
  }
}

function seatTicket(input: { id: string; name: string; faction: Faction; address: string; deck?: string[] | null; eligible?: boolean; stage?: number }): Ticket {
  const existing = tickets.get(input.id);
  const self: Ticket = existing ?? {
    id: input.id,
    name: input.name.slice(0, 24) || "Duelist",
    faction: input.faction,
    address: input.address,
    at: Date.now(),
    roomId: null,
    deck: input.deck ?? null,
    eligible: Boolean(input.eligible),
    lobby: null,
    stage: stageOf(input.stage),
  };
  self.name = input.name.slice(0, 24) || "Duelist";
  self.faction = input.faction;
  self.address = input.address;
  self.deck = input.deck ?? null;
  self.eligible = Boolean(input.eligible);
  self.stage = stageOf(input.stage);
  tickets.set(self.id, self);
  return self;
}

export type LobbyRow = { code: string; name: string; faction: Faction };

export function listLobbies(): LobbyRow[] {
  pruneLobbies();
  const rows: LobbyRow[] = [];
  for (const lobby of lobbies.values()) {
    const host = tickets.get(lobby.hostId);
    if (!host || host.roomId) {
      lobbies.delete(lobby.code);
      continue;
    }
    rows.push({ code: lobby.code, name: host.name, faction: host.faction });
  }
  return rows;
}

export function hostLobby(input: { id: string; name: string; faction: Faction; address: string; deck?: string[] | null; eligible?: boolean; stage?: number }): {
  status: "lobby" | "play";
  code: string | null;
  waitMs: number;
  view: ReturnType<typeof publicMatch> | null;
} {
  const existing = tickets.get(input.id);
  const playing = existing ? liveRoom(existing) : null;
  if (existing && playing) {
    const seat = playing.seats[0].id === input.id ? 0 : 1;
    return { status: "play", code: null, waitMs: 0, view: publicMatch(playing, seat) };
  }
  const self = seatTicket(input);
  if (self.lobby && lobbies.has(self.lobby)) {
    const lobby = lobbies.get(self.lobby)!;
    lobby.at = Date.now();
    return { status: "lobby", code: self.lobby, waitMs: 0, view: null };
  }
  const code = freshCode();
  self.lobby = code;
  self.roomId = null;
  self.at = Date.now();
  lobbies.set(code, { code, hostId: self.id, at: Date.now() });
  return { status: "lobby", code, waitMs: 0, view: null };
}

export function joinLobby(
  code: string,
  input: { id: string; name: string; faction: Faction; address: string; deck?: string[] | null; eligible?: boolean; stage?: number },
): { error?: string; status: "play" | "missing"; view: ReturnType<typeof publicMatch> | null } {
  pruneLobbies();
  const key = code.trim().toUpperCase();
  const lobby = lobbies.get(key);
  if (!lobby) return { error: "That table is gone.", status: "missing", view: null };
  if (lobby.hostId === input.id) return { error: "That is your table.", status: "missing", view: null };
  const host = tickets.get(lobby.hostId);
  if (!host || host.roomId) {
    lobbies.delete(key);
    return { error: "That table is gone.", status: "missing", view: null };
  }
  const guestExisting = tickets.get(input.id);
  const guestPlaying = guestExisting ? liveRoom(guestExisting) : null;
  if (guestExisting && guestPlaying) {
    const seat = guestPlaying.seats[0].id === input.id ? 0 : 1;
    return { error: "You are already in a match.", status: "play", view: publicMatch(guestPlaying, seat) };
  }
  if (guestExisting?.lobby) {
    lobbies.delete(guestExisting.lobby);
    guestExisting.lobby = null;
  }
  lobbies.delete(key);
  host.lobby = null;
  const guest = seatTicket(input);
  const room = openRoom(
    { id: host.id, name: host.name, faction: host.faction, address: host.address, bot: null, deck: host.deck, eligible: host.eligible, stage: host.stage },
    { id: guest.id, name: guest.name, faction: guest.faction, address: guest.address, bot: null, deck: guest.deck, eligible: guest.eligible, stage: guest.stage },
  );
  host.roomId = room.id;
  guest.roomId = room.id;
  return { status: "play", view: publicMatch(room, 1) };
}

export function leaveSeat(id: string): void {
  const ticket = tickets.get(id);
  if (!ticket || ticket.roomId) return;
  if (ticket.lobby) lobbies.delete(ticket.lobby);
  tickets.delete(id);
}
