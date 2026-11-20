import { randomBytes } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import { getSql } from "@/lib/db";
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
import { DAILY_WINS } from "./deployed";
import { MMR_START, mmrBand } from "./mmr";
import {
  findPrize,
  loadRoomSnapshot,
  markPrizeSigned,
  pruneRoomSnapshots,
  recentRoomSnapshots,
  releaseUnsignedPrize,
  reservePrize,
  saveRoomSnapshot,
  type RoomResult,
} from "./integrity-store";

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
  conceded: boolean;
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
  mmr: number;
  queuedAt: number;
  seen: number;
  epoch: number;
};

type Lobby = {
  code: string;
  hostId: string;
  at: number;
};

export type ScoreResult = RoomResult;

const pendingScores: ScoreResult[] = [];

function scoreRoom(room: Room): ScoreResult[] {
  if (room.match.winner === null || room.scored) return [];
  room.scored = true;
  markDirty(room);
  const out: ScoreResult[] = [];
  const vsBot = Boolean(room.seats[0].bot || room.seats[1].bot);
  const wallet = (seat: SeatInfo) => (!seat.bot && /^0x[0-9a-fA-F]{40}$/.test(seat.address) ? seat.address : "");
  for (const side of [0, 1] as const) {
    const seat = room.seats[side];
    if (!wallet(seat)) continue;
    const rival = wallet(room.seats[side === 0 ? 1 : 0]) || undefined;
    out.push({ roomId: room.id, address: seat.address, win: room.match.winner === side, turns: room.match.turnCount, conceded: room.conceded, vsBot, rival });
  }
  return out;
}

function concedeRoom(room: Room, loser: Side): void {
  if (room.match.winner !== null) return;
  room.match.winner = loser === 0 ? 1 : 0;
  room.conceded = true;
  room.match.phase = "over";
  room.match.seq += 1;
  const line = loser === 0 ? "You concede." : "The rival concedes.";
  room.match.log = [line, ...room.match.log].slice(0, 14);
  markDirty(room);
  pendingScores.push(...scoreRoom(room));
}

function dropLiveGame(id: string): void {
  const ticket = tickets.get(id);
  if (!ticket?.roomId) return;
  const room = rooms.get(ticket.roomId);
  ticket.roomId = null;
  if (!room) return;
  const seat: Side | null = room.seats[0].id === id ? 0 : room.seats[1].id === id ? 1 : null;
  if (seat === null) return;
  if (room.match.winner === null) concedeRoom(room, seat);
  else pendingScores.push(...scoreRoom(room));
  const other = room.seats[seat === 0 ? 1 : 0];
  const otherTicket = other.bot ? undefined : tickets.get(other.id);
  if (!otherTicket || otherTicket.roomId !== room.id) rooms.delete(room.id);
}

function nextEpoch(ticket: Ticket): number {
  ticket.epoch = (ticket.epoch || 0) + 1;
  return ticket.epoch;
}

export function drainScores(): ScoreResult[] {
  return pendingScores.splice(0);
}

/** Re-queue scores if the database write failed, so a later request can retry. */
export function deferScores(results: ScoreResult[]): void {
  if (results.length) pendingScores.push(...results);
}

const FRESH_MS = 8_000;

/**
 * The closest-rated fresh ticket inside the rating band. The band widens with the
 * longer wait of the two players, so nobody waits long in a small player base.
 */
function waitingRival(self: { id: string; mmr: number; queuedAt: number }): Ticket | undefined {
  const now = Date.now();
  let best: Ticket | undefined;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const ticket of tickets.values()) {
    if (ticket.roomId !== null || ticket.lobby !== null || ticket.id === self.id || now - ticket.at >= FRESH_MS) continue;
    const gap = Math.abs((ticket.mmr ?? MMR_START) - self.mmr);
    const waited = Math.max(now - (ticket.queuedAt ?? ticket.at), now - self.queuedAt);
    if (gap > mmrBand(waited) || gap >= bestGap) continue;
    best = ticket;
    bestGap = gap;
  }
  return best;
}
const LOBBY_MS = 15 * 60 * 1000;
const tickets = new Map<string, Ticket>();
const rooms = new Map<string, Room>();
const lobbies = new Map<string, Lobby>();

/* ---------- persistence: room snapshots (Techno P0 #1) ---------- */

type Snapshot = {
  v: 1;
  id: string;
  match: Match;
  seats: [SeatInfo, SeatInfo];
  prize: Room["prize"];
  scored: boolean;
  conceded: boolean;
  epochs: [number, number];
};

const SNAPSHOT_REHYDRATE_MS = 30 * 60 * 1000;
const SNAPSHOT_KEEP_FINISHED_MS = 48 * 60 * 60 * 1000;
const SNAPSHOT_KEEP_LIVE_MS = 6 * 60 * 60 * 1000;
const dirty = new Map<string, Room>();
let loaded: Promise<void> | null = null;
let lastPrune = 0;

function markDirty(room: Room): void {
  dirty.set(room.id, room);
}

function snapshotOf(room: Room): Snapshot {
  const epochOf = (seat: SeatInfo) => (seat.bot ? 0 : tickets.get(seat.id)?.epoch ?? 0);
  return {
    v: 1,
    id: room.id,
    match: room.match,
    seats: room.seats,
    prize: room.prize,
    scored: room.scored,
    conceded: room.conceded,
    epochs: [epochOf(room.seats[0]), epochOf(room.seats[1])],
  };
}

function roomFrom(snap: Snapshot): Room {
  const room: Room = {
    id: snap.id,
    match: snap.match,
    seats: snap.seats,
    prize: snap.prize ?? null,
    scored: Boolean(snap.scored),
    conceded: Boolean(snap.conceded),
    deadline: Date.now() + clockMs(snap.match),
    botAt: Date.now() + 900,
    clockKey: clockKey(snap.match),
  };
  return room;
}

/** Load recent rooms back after a restart. Players keep their seat ids, so their next poll finds the table. */
export function roomsReady(): Promise<void> {
  loaded ??= (async () => {
    try {
      const sql = await getSql();
      const snaps = await recentRoomSnapshots<Snapshot>(sql, SNAPSHOT_REHYDRATE_MS);
      for (const snap of snaps) {
        if (snap?.v !== 1 || !snap.id || rooms.has(snap.id)) continue;
        const room = roomFrom(snap);
        rooms.set(room.id, room);
        room.seats.forEach((seat, index) => {
          if (seat.bot || tickets.has(seat.id)) return;
          tickets.set(seat.id, {
            id: seat.id,
            name: seat.name,
            faction: seat.faction,
            address: seat.address,
            at: Date.now(),
            roomId: room.id,
            deck: seat.deck,
            eligible: seat.eligible,
            lobby: null,
            stage: seat.stage,
            mmr: MMR_START,
            queuedAt: Date.now(),
            seen: Date.now(),
            epoch: snap.epochs?.[index] ?? 0,
          });
        });
        if (room.match.winner !== null && !room.scored) pendingScores.push(...scoreRoom(room));
      }
      if (snaps.length) console.log(`[rooms] restored ${snaps.length} table(s) from the last run`);
    } catch (error) {
      console.error("[rooms] could not restore tables; starting empty", error);
    }
  })();
  return loaded;
}

/** Write every room that changed since the last flush. Called at the end of each queue request. */
export async function flushRooms(): Promise<void> {
  if (!dirty.size && Date.now() - lastPrune < 10 * 60 * 1000) return;
  const batch = [...dirty.values()];
  dirty.clear();
  let sql;
  try {
    sql = await getSql();
  } catch (error) {
    for (const room of batch) if (!dirty.has(room.id)) dirty.set(room.id, room);
    console.error("[rooms] snapshot skipped, database not ready", error);
    return;
  }
  for (const room of batch) {
    try {
      await saveRoomSnapshot(sql, room.id, snapshotOf(room), room.match.winner !== null);
    } catch (error) {
      if (!dirty.has(room.id)) dirty.set(room.id, room);
      console.error(`[rooms] snapshot failed for ${room.id}`, error);
    }
  }
  if (Date.now() - lastPrune > 10 * 60 * 1000) {
    lastPrune = Date.now();
    await pruneRoomSnapshots(sql, SNAPSHOT_KEEP_FINISHED_MS, SNAPSHOT_KEEP_LIVE_MS).catch(() => undefined);
  }
}

async function roomById(roomId: string): Promise<Room | null> {
  const live = rooms.get(roomId);
  if (live) return live;
  try {
    const snap = await loadRoomSnapshot<Snapshot>(await getSql(), roomId);
    return snap?.v === 1 && snap.match.winner !== null ? roomFrom(snap) : null;
  } catch {
    return null;
  }
}

/** A matchId nobody can guess or reuse: keccak of the room id plus 16 random bytes. Stored, never recomputed. */
function freshMatchId(roomId: string): `0x${string}` {
  return keccak256(stringToHex(`seal-forge:${roomId}:${randomBytes(16).toString("hex")}:${Date.now()}`));
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
  const before = room.match;
  advanceClock(room, stepBot);
  if (room.match !== before) markDirty(room);
}

function advanceClock(room: Room, stepBot: boolean): void {
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
  let id = `m${randomBytes(8).toString("hex")}`;
  while (rooms.has(id)) id = `m${randomBytes(8).toString("hex")}`;
  const room: Room = {
    id,
    match: startMatch(a.faction, b.faction, seed, [a.deck, b.deck]),
    seats: [a, b],
    prize: null,
    scored: false,
    conceded: false,
    deadline: Date.now() + MAIN_CLOCK_MS,
    botAt: Date.now() + 900,
    clockKey: "",
  };
  touchClock(room);
  rooms.set(room.id, room);
  markDirty(room);
  return room;
}

function liveRoom(ticket: Ticket): Room | null {
  if (!ticket.roomId) return null;
  const room = rooms.get(ticket.roomId);
  if (room && room.match.winner === null) return room;
  if (room) pendingScores.push(...scoreRoom(room));
  ticket.roomId = null;
  return null;
}

function stageOf(value: number | undefined): number {
  if (!value || !Number.isInteger(value) || value < 1 || value > 64) return 0;
  return value;
}

export function joinQueue(input: { id: string; name: string; faction: Faction; address: string; deck?: string[] | null; eligible?: boolean; stage?: number; mmr?: number }): {
  status: "wait" | "play";
  waitMs: number;
  epoch: number;
  view: ReturnType<typeof publicMatch> | null;
} {
  const existing = tickets.get(input.id);
  dropLiveGame(input.id);
  if (existing?.lobby) {
    lobbies.delete(existing.lobby);
    existing.lobby = null;
  }
  if (existing) existing.at = Date.now();
  const mmr = Number.isFinite(input.mmr) ? Number(input.mmr) : MMR_START;
  const queuedAt = existing && existing.roomId === null && existing.lobby === null && Date.now() - existing.at < FRESH_MS ? existing.queuedAt ?? Date.now() : Date.now();
  const waiting = waitingRival({ id: input.id, mmr, queuedAt });
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
    mmr: Number.isFinite(input.mmr) ? Number(input.mmr) : MMR_START,
    queuedAt: Date.now(),
    seen: Date.now(),
    epoch: 0,
  };
  self.name = input.name.slice(0, 24) || "Duelist";
  self.faction = input.faction;
  self.address = input.address;
  self.deck = input.deck ?? null;
  self.eligible = Boolean(input.eligible);
  self.lobby = null;
  self.stage = stageOf(input.stage);
  self.mmr = mmr;
  self.queuedAt = queuedAt;
  self.seen = Date.now();
  const epoch = nextEpoch(self);
  tickets.set(self.id, self);
  if (waiting) {
    const room = openRoom(
      { id: waiting.id, name: waiting.name, faction: waiting.faction, address: waiting.address, bot: null, deck: waiting.deck, eligible: waiting.eligible, stage: waiting.stage },
      { id: self.id, name: self.name, faction: self.faction, address: self.address, bot: null, deck: self.deck, eligible: self.eligible, stage: self.stage },
    );
    waiting.roomId = room.id;
    self.roomId = room.id;
    waiting.seen = Date.now();
    self.seen = Date.now();
    return { status: "play", waitMs: 0, epoch, view: publicMatch(room, 1) };
  }
  return { status: "wait", waitMs: 0, epoch, view: null };
}

function openBot(ticket: Ticket): Room {
  const bot = liveBot();
  const room = openRoom(
    { id: ticket.id, name: ticket.name, faction: ticket.faction, address: ticket.address, bot: null, deck: ticket.deck, eligible: ticket.eligible, stage: ticket.stage },
    { id: bot.id, name: bot.name, faction: bot.faction, address: "", bot, deck: null, eligible: false, stage: 0 },
  );
  ticket.roomId = room.id;
  ticket.seen = Date.now();
  return room;
}

export function pollQueue(id: string): { status: "wait" | "play" | "missing" | "lobby"; waitMs: number; view: ReturnType<typeof publicMatch> | null; code?: string; epoch?: number } {
  const ticket = tickets.get(id);
  if (!ticket) return { status: "missing", waitMs: 0, view: null };
  if (ticket.roomId) {
    const room = rooms.get(ticket.roomId);
    if (!room) return { status: "missing", waitMs: 0, view: null };
    const seat: Side = room.seats[0].id === id ? 0 : 1;
    ticket.seen = Date.now();
    if (room.match.winner === null) {
      const otherSide: Side = seat === 0 ? 1 : 0;
      const other = room.seats[otherSide];
      if (!other.bot) {
        const otherTicket = tickets.get(other.id);
        const last = otherTicket?.seen ?? otherTicket?.at ?? 0;
        const gone = !otherTicket || otherTicket.roomId !== room.id || Date.now() - last > 20_000;
        if (gone) concedeRoom(room, otherSide);
      }
    }
    advance(room, true);
    return { status: "play", waitMs: 0, epoch: ticket.epoch, view: publicMatch(room, seat) };
  }
  if (ticket.lobby) {
    pruneLobbies();
    if (lobbies.has(ticket.lobby)) return { status: "lobby", waitMs: 0, view: null, code: ticket.lobby, epoch: ticket.epoch };
    ticket.lobby = null;
  }
  ticket.at = Date.now();
  ticket.seen = Date.now();
  return { status: "wait", waitMs: 0, epoch: ticket.epoch, view: null };
}

export function seatBot(id: string): { status: "wait" | "play" | "missing"; waitMs: number; epoch?: number; view: ReturnType<typeof publicMatch> | null; error?: string } {
  const ticket = tickets.get(id);
  if (!ticket) return { status: "missing", waitMs: 0, view: null, error: "Join the queue first." };
  const playing = liveRoom(ticket);
  if (playing) {
    const seat = playing.seats[0].id === id ? 0 : 1;
    return { status: "play", waitMs: 0, epoch: ticket.epoch, view: publicMatch(playing, seat) };
  }
  if (ticket.lobby) {
    lobbies.delete(ticket.lobby);
    ticket.lobby = null;
  }
  const room = openBot(ticket);
  return { status: "play", waitMs: 0, epoch: ticket.epoch, view: publicMatch(room, 0) };
}

function sideToAct(match: Match): Side {
  if (match.phase === "main") return match.turn;
  return match.turn === 0 ? 1 : 0;
}

export function act(id: string, action: Act): { error?: string; view: ReturnType<typeof publicMatch> | null } {
  const ticket = tickets.get(id);
  const room = ticket?.roomId ? rooms.get(ticket.roomId) : undefined;
  if (!ticket || !room) return { error: "No match.", view: null };
  ticket.seen = Date.now();
  const seat: Side = room.seats[0].id === id ? 0 : 1;
  if (room.match.winner !== null) return { view: publicMatch(room, seat) };
  if (sideToAct(room.match) !== seat) return { error: "Not your step.", view: publicMatch(room, seat) };
  let result: { state: Match; error?: string };
  if (action.t === "play") result = playCard(room.match, action.uid, action.target);
  else if (action.t === "attack") result = declareAttack(room.match, action.ids);
  else if (action.t === "block") result = assignDefenders(room.match, action.blocks);
  else if (action.t === "trap") result = springTrap(room.match, action.uid, action.target);
  else if (action.t === "skip") result = skipTrap(room.match);
  else result = endTurn(room.match);
  if (result.error) return { error: result.error, view: publicMatch(room, seat) };
  room.match = result.state;
  markDirty(room);
  finishBots(room);
  return { view: publicMatch(room, seat) };
}

type Prize = { matchId: `0x${string}`; player: `0x${string}` };

/**
 * The single voucher for this room, if this seat won it. Persisted in veil_prizes,
 * so the same matchId comes back after a reconnect or a restart.
 */
async function claimFor(room: Room, seat: Side): Promise<Prize | null> {
  const address = room.seats[seat].address;
  if (room.prize) return room.prize.player.toLowerCase() === address.toLowerCase() ? room.prize : null;
  if (room.match.winner !== seat) return null;
  if (!room.scored) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  const sql = await getSql();
  const prior = await findPrize(sql, room.id);
  if (!prior && !room.seats[seat].eligible) return null;
  const reserved = await reservePrize(sql, { roomId: room.id, wallet: address, cap: DAILY_WINS, makeMatchId: () => freshMatchId(room.id) });
  if ("error" in reserved) return null;
  room.prize = { matchId: reserved.matchId, player: address as `0x${string}` };
  markDirty(room);
  return room.prize;
}

export type ScoredPrize = Prize;
export type ScoredPrizeError = "missing" | "not-winner" | "needs-card" | "cap";

/** Prize for a win this server already scored. Used by POST /api/veilforge/reward. */
export async function scoredPrizeFor(address: string, roomId: string): Promise<{ prize: ScoredPrize; created: boolean } | { error: ScoredPrizeError }> {
  const room = await roomById(roomId);
  if (!room || room.match.winner === null) return { error: "missing" };
  if (!room.scored) pendingScores.push(...scoreRoom(room));
  if (!room.scored) return { error: "missing" };
  const seat = room.match.winner;
  const winner = room.seats[seat];
  if (winner.bot || !/^0x[0-9a-fA-F]{40}$/.test(address) || winner.address.toLowerCase() !== address.toLowerCase()) {
    return { error: "not-winner" };
  }
  const sql = await getSql();
  const prior = await findPrize(sql, roomId);
  if (prior && prior.wallet !== address.toLowerCase()) return { error: "not-winner" };
  if (!prior && !winner.eligible) return { error: "needs-card" };
  const prize = await claimFor(room, seat);
  if (!prize) return { error: winner.eligible ? "cap" : "needs-card" };
  if (!rooms.has(roomId)) await saveRoomSnapshot(sql, roomId, snapshotOf(room), true).catch(() => undefined);
  return { prize, created: !prior };
}

/** Record that the voucher signature went out, so it is never released. */
export async function notePrizeSigned(roomId: string): Promise<void> {
  await markPrizeSigned(await getSql(), roomId).catch(() => undefined);
}

/** Undo a prize reservation if the signature never went out. */
export async function releaseUnsentPrize(roomId: string, address: string): Promise<void> {
  const released = await releaseUnsignedPrize(await getSql(), roomId, address).catch(() => false);
  if (!released) return;
  const room = rooms.get(roomId);
  if (room?.prize && room.prize.player.toLowerCase() === address.toLowerCase()) {
    room.prize = null;
    markDirty(room);
  }
}

export async function prizeFor(id: string): Promise<{ prize: Prize; roomId: string } | null> {
  const ticket = tickets.get(id);
  const room = ticket?.roomId ? rooms.get(ticket.roomId) : undefined;
  if (!ticket || !room || room.match.winner === null) return null;
  const seat: Side = room.seats[0].id === id ? 0 : 1;
  const prize = await claimFor(room, seat);
  return prize ? { prize, roomId: room.id } : null;
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

export function scoreboard(id: string): ScoreResult[] {
  const ticket = tickets.get(id);
  const room = ticket?.roomId ? rooms.get(ticket.roomId) : undefined;
  if (!ticket || !room) return [];
  return scoreRoom(room);
}

export const QUEUE_MS = 20_000;

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

function seatTicket(input: { id: string; name: string; faction: Faction; address: string; deck?: string[] | null; eligible?: boolean; stage?: number; mmr?: number }): Ticket {
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
    mmr: Number.isFinite(input.mmr) ? Number(input.mmr) : MMR_START,
    queuedAt: Date.now(),
    seen: Date.now(),
    epoch: 0,
  };
  self.name = input.name.slice(0, 24) || "Duelist";
  self.faction = input.faction;
  self.address = input.address;
  self.deck = input.deck ?? null;
  self.eligible = Boolean(input.eligible);
  self.stage = stageOf(input.stage);
  self.seen = Date.now();
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

export function hostLobby(input: { id: string; name: string; faction: Faction; address: string; deck?: string[] | null; eligible?: boolean; stage?: number; mmr?: number }): {
  status: "lobby" | "play";
  code: string | null;
  waitMs: number;
  epoch: number;
  view: ReturnType<typeof publicMatch> | null;
} {
  dropLiveGame(input.id);
  const self = seatTicket(input);
  const epoch = nextEpoch(self);
  if (self.lobby && lobbies.has(self.lobby)) {
    const lobby = lobbies.get(self.lobby)!;
    lobby.at = Date.now();
    return { status: "lobby", code: self.lobby, waitMs: 0, epoch, view: null };
  }
  const code = freshCode();
  self.lobby = code;
  self.roomId = null;
  self.at = Date.now();
  lobbies.set(code, { code, hostId: self.id, at: Date.now() });
  return { status: "lobby", code, waitMs: 0, epoch, view: null };
}

export function joinLobby(
  code: string,
  input: { id: string; name: string; faction: Faction; address: string; deck?: string[] | null; eligible?: boolean; stage?: number; mmr?: number },
): { error?: string; status: "play" | "missing"; epoch?: number; view: ReturnType<typeof publicMatch> | null } {
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
  dropLiveGame(input.id);
  const guestExisting = tickets.get(input.id);
  if (guestExisting?.lobby) {
    lobbies.delete(guestExisting.lobby);
    guestExisting.lobby = null;
  }
  lobbies.delete(key);
  host.lobby = null;
  const guest = seatTicket(input);
  const epoch = nextEpoch(guest);
  const room = openRoom(
    { id: host.id, name: host.name, faction: host.faction, address: host.address, bot: null, deck: host.deck, eligible: host.eligible, stage: host.stage },
    { id: guest.id, name: guest.name, faction: guest.faction, address: guest.address, bot: null, deck: guest.deck, eligible: guest.eligible, stage: guest.stage },
  );
  host.roomId = room.id;
  guest.roomId = room.id;
  host.seen = Date.now();
  guest.seen = Date.now();
  return { status: "play", epoch, view: publicMatch(room, 1) };
}

export function leaveSeat(id: string, epoch?: number): void {
  const ticket = tickets.get(id);
  if (!ticket) return;
  if (typeof epoch === "number" && epoch > 0 && ticket.epoch !== epoch) return;
  dropLiveGame(id);
  if (ticket.lobby) lobbies.delete(ticket.lobby);
  tickets.delete(id);
}
