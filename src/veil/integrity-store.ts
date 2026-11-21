/**
 * Database side of the server-integrity rules (daily win cap, voucher ledger,
 * room snapshots, idempotent match results). Every function takes the SQL client
 * so the rules can be unit-tested against an in-memory PGLite.
 *
 * Nothing here talks to the chain or signs anything.
 */
import type { Sql } from "@/lib/db";

export type PrizeRow = { room_id: string; match_id: string; wallet: string; utc_day: string; signed_at: unknown };

export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Atomically take one daily win for this wallet. Returns false once `cap` is reached.
 * A single upsert statement, so two requests at the same time cannot both slip past the cap.
 */
export async function takeDailyWin(sql: Sql, wallet: string, cap: number, day: string = utcDay()): Promise<boolean> {
  const id = wallet.toLowerCase();
  const rows = await sql<{ n: number }>`
    insert into veil_daily_wins (wallet, utc_day, n) values (${id}, ${day}, 1)
    on conflict (wallet, utc_day) do update set n = veil_daily_wins.n + 1
    where veil_daily_wins.n < ${cap}
    returning n`;
  return rows.length > 0 && Number(rows[0]!.n) <= cap;
}

export async function refundDailyWin(sql: Sql, wallet: string, day: string = utcDay()): Promise<void> {
  await sql`update veil_daily_wins set n = greatest(0, n - 1) where wallet = ${wallet.toLowerCase()} and utc_day = ${day}`;
}

export async function dailyWinsUsed(sql: Sql, wallet: string, day: string = utcDay()): Promise<number> {
  const rows = await sql<{ n: number }>`select n from veil_daily_wins where wallet = ${wallet.toLowerCase()} and utc_day = ${day}`;
  return Number(rows[0]?.n ?? 0);
}

export async function findPrize(sql: Sql, roomId: string): Promise<PrizeRow | null> {
  const rows = await sql<PrizeRow>`select room_id, match_id, wallet, utc_day, signed_at from veil_prizes where room_id = ${roomId}`;
  return rows[0] ?? null;
}

export type ReserveResult = { matchId: `0x${string}`; wallet: string; created: boolean } | { error: "cap" | "not-winner" };

/**
 * Reserve the one voucher for a room. If the room already has one it is returned
 * unchanged (so a reconnect or restart never mints a second matchId for the same
 * room). Otherwise one daily win is taken and a new row is inserted; if another
 * request inserted first, the daily win is handed back and that row is returned.
 */
const roomLocks = new Map<string, Promise<unknown>>();

/** Serialize work per key inside this process (the game server is one process). */
async function withLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prior = roomLocks.get(key) ?? Promise.resolve();
  const next = prior.then(run, run);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  roomLocks.set(key, settled);
  try {
    return await next;
  } finally {
    if (roomLocks.get(key) === settled) roomLocks.delete(key);
  }
}

export function reservePrize(
  sql: Sql,
  input: { roomId: string; wallet: string; cap: number; makeMatchId: () => `0x${string}`; day?: string },
): Promise<ReserveResult> {
  return withLock(`prize:${input.roomId}`, () => reservePrizeNow(sql, input));
}

async function reservePrizeNow(
  sql: Sql,
  input: { roomId: string; wallet: string; cap: number; makeMatchId: () => `0x${string}`; day?: string },
): Promise<ReserveResult> {
  const wallet = input.wallet.toLowerCase();
  const prior = await findPrize(sql, input.roomId);
  if (prior) return prior.wallet === wallet ? { matchId: prior.match_id as `0x${string}`, wallet, created: false } : { error: "not-winner" };
  const day = input.day ?? utcDay();
  if (!(await takeDailyWin(sql, wallet, input.cap, day))) return { error: "cap" };
  let inserted: { match_id: string }[] = [];
  try {
    inserted = await sql<{ match_id: string }>`
      insert into veil_prizes (room_id, match_id, wallet, utc_day) values (${input.roomId}, ${input.makeMatchId()}, ${wallet}, ${day})
      on conflict (room_id) do nothing
      returning match_id`;
  } catch (error) {
    await refundDailyWin(sql, wallet, day);
    throw error;
  }
  if (inserted.length) return { matchId: inserted[0]!.match_id as `0x${string}`, wallet, created: true };
  await refundDailyWin(sql, wallet, day);
  const winner = await findPrize(sql, input.roomId);
  if (!winner || winner.wallet !== wallet) return { error: "not-winner" };
  return { matchId: winner.match_id as `0x${string}`, wallet, created: false };
}

export async function markPrizeSigned(sql: Sql, roomId: string): Promise<void> {
  await sql`update veil_prizes set signed_at = coalesce(signed_at, now()) where room_id = ${roomId}`;
}

/** Undo a reservation whose signature never went out (the signer was down). */
export async function releaseUnsignedPrize(sql: Sql, roomId: string, wallet: string): Promise<boolean> {
  const rows = await sql<{ utc_day: string }>`
    delete from veil_prizes where room_id = ${roomId} and wallet = ${wallet.toLowerCase()} and signed_at is null
    returning utc_day`;
  if (!rows.length) return false;
  await refundDailyWin(sql, wallet, rows[0]!.utc_day);
  return true;
}

export type RoomResult = {
  roomId: string;
  address: string;
  win: boolean;
  turns: number;
  conceded: boolean;
  vsBot: boolean;
  /** The other seat's wallet when both seats were signed-in humans (drives MMR). */
  rival?: string;
  /** Seal this seat played (profile stats only; never affects XP or rewards). */
  faction?: string;
  /** Card ids this seat played, when it brought a deck (profile stats only). */
  deck?: string[] | null;
};

const STAT_FACTIONS = new Set(["elf", "human", "goblin", "robot", "demon", "veil"]);

function statFaction(value: unknown): string {
  return typeof value === "string" && STAT_FACTIONS.has(value) ? value : "";
}

function statDeck(value: unknown): string {
  if (!Array.isArray(value)) return "";
  const ids = value.filter((id): id is string => typeof id === "string" && /^[a-z0-9-]{1,40}$/.test(id)).slice(0, 40);
  return ids.join(",");
}

/**
 * Record one match result and apply XP in the same statement. The XP update only
 * runs when the (room, wallet) row is new, so retries and replays are no-ops.
 */
export async function applyRoomResult(
  sql: Sql,
  result: RoomResult,
  xp: { win: number; loss: number },
): Promise<"applied" | "duplicate" | "no-profile"> {
  const wallet = result.address.toLowerCase();
  const rows = await sql.query<{ inserted: number; updated: number }>(
    `with ins as (
       insert into veil_room_results (room_id, wallet, win, turns, conceded, vs_bot, faction, deck)
       values ($1, $2, $3, $4, $5, $6, $9, $10)
       on conflict (room_id, wallet) do nothing
       returning wallet
     ), upd as (
       update veil_profiles
          set xp = case when $3 then xp + $7 else greatest(0, xp - $8) end,
              wins = wins + case when $3 then 1 else 0 end,
              losses = losses + case when $3 then 0 else 1 end
        where address = $2 and exists (select 1 from ins)
        returning address
     )
     select (select count(*) from ins)::int as inserted, (select count(*) from upd)::int as updated`,
    [
      result.roomId,
      wallet,
      result.win,
      Math.max(0, Math.floor(result.turns)),
      result.conceded,
      result.vsBot,
      xp.win,
      xp.loss,
      statFaction(result.faction),
      statDeck(result.deck),
    ],
  );
  const row = rows[0];
  if (!row || Number(row.inserted) === 0) return "duplicate";
  return Number(row.updated) > 0 ? "applied" : "no-profile";
}

export async function saveRoomSnapshot(sql: Sql, id: string, state: unknown, finished: boolean): Promise<void> {
  const body = JSON.stringify(state);
  await sql`
    insert into veil_rooms (id, state, finished, updated_at) values (${id}, ${body}, ${finished}, now())
    on conflict (id) do update set state = excluded.state, finished = excluded.finished, updated_at = now()`;
}

export async function loadRoomSnapshot<T>(sql: Sql, id: string): Promise<T | null> {
  const rows = await sql<{ state: string }>`select state from veil_rooms where id = ${id}`;
  if (!rows[0]) return null;
  try {
    return JSON.parse(rows[0].state) as T;
  } catch {
    return null;
  }
}

/** Rooms touched in the last `withinMs`, oldest first. */
export async function recentRoomSnapshots<T>(sql: Sql, withinMs: number): Promise<T[]> {
  const since = new Date(Date.now() - withinMs).toISOString();
  const rows = await sql<{ state: string }>`select state from veil_rooms where updated_at >= ${since}::timestamptz order by updated_at asc`;
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.state) as T);
    } catch {
      /* skip a corrupt snapshot */
    }
  }
  return out;
}

/** Drop finished snapshots after `finishedMs` and abandoned live ones after `liveMs`. */
export async function pruneRoomSnapshots(sql: Sql, finishedMs: number, liveMs: number): Promise<void> {
  const doneBefore = new Date(Date.now() - finishedMs).toISOString();
  const liveBefore = new Date(Date.now() - liveMs).toISOString();
  await sql`delete from veil_rooms where (finished and updated_at < ${doneBefore}::timestamptz) or (not finished and updated_at < ${liveBefore}::timestamptz)`;
}

export async function giftTransfers(sql: Sql, wallet: string, orderId: string): Promise<Map<string, string>> {
  const rows = await sql<{ token_id: string; tx_hash: string }>`select token_id, tx_hash from veil_gift_transfers where wallet = ${wallet.toLowerCase()} and order_id = ${orderId}`;
  return new Map(rows.map((row) => [row.token_id, row.tx_hash]));
}

export async function recordGiftTransfer(sql: Sql, input: { wallet: string; orderId: string; tokenId: string; amount: number; txHash: string }): Promise<void> {
  await sql`
    insert into veil_gift_transfers (wallet, order_id, token_id, amount, tx_hash) values (${input.wallet.toLowerCase()}, ${input.orderId}, ${input.tokenId}, ${input.amount}, ${input.txHash})
    on conflict (wallet, order_id, token_id) do update set tx_hash = excluded.tx_hash, amount = excluded.amount, created_at = now()`;
}

export async function mmrOf(sql: Sql, wallet: string): Promise<number | null> {
  const rows = await sql<{ mmr: number }>`select mmr from veil_profiles where address = ${wallet.toLowerCase()}`;
  return rows[0] ? Number(rows[0].mmr) : null;
}

/**
 * Move both players' MMR for one human-vs-human room. The room row is the
 * idempotency key: a second call for the same room changes nothing.
 */
export async function applyMmr(
  sql: Sql,
  input: { roomId: string; winner: string; loser: string },
  delta: (winner: number, loser: number) => [number, number],
): Promise<"applied" | "duplicate" | "no-profile"> {
  const winner = input.winner.toLowerCase();
  const loser = input.loser.toLowerCase();
  if (winner === loser) return "duplicate";
  const [w, l] = await Promise.all([mmrOf(sql, winner), mmrOf(sql, loser)]);
  if (w === null || l === null) return "no-profile";
  const [up, down] = delta(w, l);
  const rows = await sql.query<{ updated: number }>(
    `with ins as (
       insert into veil_mmr_matches (room_id, winner, loser, winner_delta, loser_delta)
       values ($1, $2, $3, $4, $5)
       on conflict (room_id) do nothing
       returning room_id
     ), upd as (
       update veil_profiles
          set mmr = greatest(0, mmr + case when address = $2 then $4 else $5 end),
              mmr_games = mmr_games + 1
        where address in ($2, $3) and exists (select 1 from ins)
        returning address
     )
     select (select count(*) from upd)::int as updated`,
    [input.roomId, winner, loser, up, down],
  );
  return Number(rows[0]?.updated ?? 0) > 0 ? "applied" : "duplicate";
}

export type GiftStep = "begin" | "buy" | "commit" | "settle";

/** The keeper tx hash for one gift step, stored the moment it is broadcast. */
export async function giftStep(sql: Sql, wallet: string, step: GiftStep): Promise<string | null> {
  const rows = await sql<{ tx_hash: string }>`select tx_hash from veil_gift_steps where wallet = ${wallet.toLowerCase()} and step = ${step}`;
  return rows[0]?.tx_hash ?? null;
}

export async function recordGiftStep(sql: Sql, wallet: string, step: GiftStep, txHash: string): Promise<void> {
  await sql`
    insert into veil_gift_steps (wallet, step, tx_hash) values (${wallet.toLowerCase()}, ${step}, ${txHash})
    on conflict (wallet, step) do update set tx_hash = excluded.tx_hash, created_at = now()`;
}

export async function clearGiftSteps(sql: Sql, wallet: string, steps: GiftStep[]): Promise<void> {
  for (const step of steps) await sql`delete from veil_gift_steps where wallet = ${wallet.toLowerCase()} and step = ${step}`;
}

/** Every order id some profile already holds, so a recovered order is never someone else's. */
export async function recordedGiftOrders(sql: Sql): Promise<Set<string>> {
  const rows = await sql<{ gift_order: string }>`select gift_order from veil_profiles where gift_order is not null and gift_order <> ''`;
  return new Set(rows.map((row) => String(row.gift_order)));
}
