/**
 * Free-mint gifting queue: the rules and the state machine, with the database and
 * the chain injected so every rule is unit-testable. No imports from the app.
 *
 * How it works (plan section 5, options 1+3, no contract changes):
 *   a separate, user-funded treasury wallet buys a normal pack through the existing
 *   pack contract, settles it (cards mint to the treasury), then transfers each card
 *   to the player. The player pays nothing, not even gas.
 *
 * Safety:
 *   - off unless FEATURE_FREE_MINT=1 AND a treasury key is configured;
 *   - a stop file / FREE_MINT_PAUSED=1 halts new claims and the worker at once;
 *   - time window, per-wallet cap, daily cap, BzB budget cap, per-IP cap, optional allowlist;
 *   - the player must be signed in and have finished a server-scored match in the window;
 *   - one row per (wallet, window, n) is the idempotency key; every tx hash is stored
 *     the moment it is broadcast, and retries decide from receipts, never balances.
 */
import type { Sql } from "@/lib/db";

export type Edition = "core" | "blazar" | "kage" | "ashen";
export const EDITIONS: readonly Edition[] = ["core", "blazar", "kage", "ashen"];

export type FreeMintConfig = {
  enabled: boolean;
  stopped: boolean;
  signerConfigured: boolean;
  start: number | null;
  end: number | null;
  windowId: string;
  perWallet: number;
  dailyCap: number;
  budgetWei: bigint;
  edition: Edition;
  factionMode: "fixed" | "player-choice";
  fixedFaction: number;
  allowlist: Set<string> | null;
  ipDailyCap: number;
  minTurns: number;
};

export type Prices = { coreAny: bigint; coreSeal: bigint; blazar: bigint; kage: bigint; ashen: bigint };

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function time(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function bzbToWei(value: string | undefined): bigint {
  if (!value || !/^\d+(\.\d{1,18})?$/.test(value.trim())) return 0n;
  const [whole, frac = ""] = value.trim().split(".");
  return BigInt(whole!) * 10n ** 18n + BigInt((frac + "0".repeat(18)).slice(0, 18));
}

/**
 * Read the config from env. Everything defaults to the safest value: off, no window,
 * zero budget. `readList` loads FREE_MINT_ALLOWLIST (a file of addresses) when set.
 */
export function readFreeMintConfig(
  env: Record<string, string | undefined>,
  hooks: { stopFileExists?: (path: string) => boolean; readList?: (path: string) => string } = {},
): FreeMintConfig {
  const flag = env.FEATURE_FREE_MINT === "1" || env.FEATURE_FREE_MINT?.toLowerCase() === "true";
  const stopFile = env.FREE_MINT_STOP_FILE || "data/free-mint.stop";
  const stopped = env.FREE_MINT_PAUSED === "1" || Boolean(hooks.stopFileExists?.(stopFile));
  const start = time(env.FREE_MINT_START);
  const end = time(env.FREE_MINT_END);
  const edition = (EDITIONS as readonly string[]).includes(env.FREE_MINT_EDITION ?? "") ? (env.FREE_MINT_EDITION as Edition) : "core";
  const factionRaw = env.FREE_MINT_FACTION ?? "0";
  let allowlist: Set<string> | null = null;
  if (env.FREE_MINT_ALLOWLIST && hooks.readList) {
    try {
      allowlist = new Set(
        hooks
          .readList(env.FREE_MINT_ALLOWLIST)
          .split(/[\s,]+/)
          .map((line) => line.trim().toLowerCase())
          .filter((line) => /^0x[0-9a-f]{40}$/.test(line)),
      );
    } catch {
      allowlist = new Set(); // a missing allowlist file fails closed
    }
  }
  return {
    enabled: flag,
    stopped,
    signerConfigured: /^0x[0-9a-fA-F]{64}$/.test(env.FREE_MINT_SIGNER ?? ""),
    start,
    end,
    windowId: env.FREE_MINT_WINDOW_ID || (start ? new Date(start).toISOString() : "none"),
    perWallet: int(env.FREE_MINT_PER_WALLET, 1, 1, 2),
    dailyCap: int(env.FREE_MINT_DAILY_CAP, 0, 0, 10_000),
    budgetWei: bzbToWei(env.FREE_MINT_BUDGET_BZB),
    edition,
    factionMode: factionRaw === "player-choice" ? "player-choice" : "fixed",
    fixedFaction: int(factionRaw, 0, 0, 5),
    allowlist,
    ipDailyCap: int(env.FREE_MINT_IP_DAILY, 3, 1, 1000),
    minTurns: int(env.FREE_MINT_MIN_TURNS, 6, 1, 100),
  };
}

export function priceFor(edition: Edition, faction: number, prices: Prices): bigint {
  if (edition === "core") return faction === 0 ? prices.coreAny : prices.coreSeal;
  return prices[edition];
}

export type MintRow = {
  id: string;
  wallet: string;
  window_id: string;
  n: number;
  edition: Edition;
  faction: number;
  price_wei: string;
  status: "queued" | "buying" | "bought" | "settling" | "settled" | "delivering" | "delivered" | "failed";
  order_id: string | null;
  buy_tx: string | null;
  buy_block: string | null;
  card_ids: string | null;
  settle_tx: string | null;
  transfer_txs: string;
  error: string | null;
};

export type Refusal =
  | "off"
  | "paused"
  | "closed"
  | "not-allowed"
  | "play-first"
  | "claimed"
  | "daily-cap"
  | "budget"
  | "ip-cap"
  | "bad-faction";

export const REFUSAL_TEXT: Record<Refusal, string> = {
  off: "Free packs are not running right now.",
  paused: "Free packs are paused for a moment. Try again later.",
  closed: "The free pack window is closed.",
  "not-allowed": "This wallet is not on the free pack list.",
  "play-first": "Finish one full match on a server table (Auto start or Find a match) while signed in, then claim.",
  claimed: "This wallet already took its free pack for this window.",
  "daily-cap": "Today's free packs are gone. Come back tomorrow (UTC).",
  budget: "All the free packs for this window have been given out.",
  "ip-cap": "Too many free packs from this connection today.",
  "bad-faction": "Pick a seal for your pack.",
};

function utcDayStart(now: number): string {
  return new Date(now).toISOString().slice(0, 10) + "T00:00:00.000Z";
}

/** Everything except caps: is this wallet allowed to claim at `now`? */
export async function eligibility(sql: Sql, cfg: FreeMintConfig, wallet: string, now: number): Promise<Refusal | null> {
  if (!cfg.enabled || !cfg.signerConfigured) return "off";
  if (cfg.stopped) return "paused";
  if (cfg.start === null || cfg.end === null || now < cfg.start || now >= cfg.end) return "closed";
  const id = wallet.toLowerCase();
  if (cfg.allowlist && !cfg.allowlist.has(id)) return "not-allowed";
  const played = await sql<{ one: number }>`
    select 1 as one from veil_room_results
     where wallet = ${id} and created_at >= ${new Date(cfg.start).toISOString()}::timestamptz
       and turns >= ${cfg.minTurns} and not (conceded and turns < 4)
     limit 1`;
  if (!played.length) return "play-first";
  return null;
}

let claimChain: Promise<unknown> = Promise.resolve();

/** Serialize claim creation in this process so caps cannot be raced. */
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const next = claimChain.then(run, run);
  claimChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Create (or return) this wallet's claim. Idempotent: while a claim is in flight the
 * same row comes back; failed rows free their slot; delivered rows count against
 * the per-wallet cap.
 */
export function requestFreeMint(
  sql: Sql,
  cfg: FreeMintConfig,
  input: { wallet: string; faction?: number; ip: string; now: number; prices: Prices; newId: () => string },
): Promise<{ row: MintRow; created: boolean } | { refused: Refusal }> {
  return serialized(async () => {
    const wallet = input.wallet.toLowerCase();
    const refusal = await eligibility(sql, cfg, wallet, input.now);
    if (refusal) return { refused: refusal };
    const mine = await sql<MintRow>`select * from veil_free_mints where wallet = ${wallet} and window_id = ${cfg.windowId} order by n`;
    const open = mine.find((row) => row.status !== "delivered" && row.status !== "failed");
    if (open) return { row: open, created: false };
    if (mine.filter((row) => row.status === "delivered").length >= cfg.perWallet) return { refused: "claimed" };
    const faction = cfg.factionMode === "player-choice" ? input.faction : cfg.fixedFaction;
    if (faction === undefined || !Number.isInteger(faction) || faction < 0 || faction > 5) return { refused: "bad-faction" };
    const dayStart = utcDayStart(input.now);
    const [ipRow] = await sql<{ n: number }>`select count(*)::int as n from veil_free_mints where ip = ${input.ip} and status <> 'failed' and created_at >= ${dayStart}::timestamptz`;
    if (input.ip && Number(ipRow?.n ?? 0) >= cfg.ipDailyCap) return { refused: "ip-cap" };
    const [dayRow] = await sql<{ n: number }>`select count(*)::int as n from veil_free_mints where status <> 'failed' and created_at >= ${dayStart}::timestamptz`;
    if (Number(dayRow?.n ?? 0) >= cfg.dailyCap) return { refused: "daily-cap" };
    const price = priceFor(cfg.edition, faction, input.prices);
    const [spent] = await sql<{ wei: string }>`select coalesce(sum(price_wei::numeric), 0)::text as wei from veil_free_mints where window_id = ${cfg.windowId} and status <> 'failed'`;
    if (BigInt(String(spent?.wei ?? "0").split(".")[0]!) + price > cfg.budgetWei) return { refused: "budget" };
    const n = mine.reduce((max, row) => Math.max(max, Number(row.n)), 0) + 1;
    const inserted = await sql<MintRow>`
      insert into veil_free_mints (id, wallet, window_id, n, edition, faction, price_wei, ip, created_at)
      values (${input.newId()}, ${wallet}, ${cfg.windowId}, ${n}, ${cfg.edition}, ${faction}, ${price.toString()}, ${input.ip}, ${new Date(input.now).toISOString()}::timestamptz)
      on conflict (wallet, window_id, n) do nothing
      returning *`;
    if (inserted[0]) return { row: inserted[0], created: true };
    const again = await sql<MintRow>`select * from veil_free_mints where wallet = ${wallet} and window_id = ${cfg.windowId} and n = ${n}`;
    return { row: again[0]!, created: false };
  });
}

/* ---------------- worker ---------------- */

type Hash = string;
export type TxState = "success" | "reverted" | "pending";

/** The chain calls the worker needs. The real one is in free-mint-server.ts. */
export interface MintChain {
  ensureAllowance(pack: string, need: bigint, cap: bigint): Promise<void>;
  buy(pack: string, faction: number, onHash: (hash: Hash) => Promise<void>): Promise<{ orderId: bigint; block: bigint }>;
  reservedFrom(pack: string, hash: Hash): Promise<{ state: "ok"; orderId: bigint; block: bigint } | { state: "reverted" } | { state: "pending" }>;
  order(pack: string, orderId: bigint): Promise<{ buyer: string; openedAt: bigint }>;
  blockNumber(): Promise<bigint>;
  settle(pack: string, orderId: bigint, onHash: (hash: Hash) => Promise<void>): Promise<bigint[]>;
  openedFrom(pack: string, hash: Hash, orderId: bigint): Promise<{ state: "ok"; ids: bigint[] } | { state: "reverted" } | { state: "pending" }>;
  findOpened(pack: string, orderId: bigint, fromBlock: bigint): Promise<bigint[] | null>;
  transfer(nft: string, to: string, id: bigint, amount: bigint, onHash: (hash: Hash) => Promise<void>): Promise<void>;
  txState(hash: Hash): Promise<TxState>;
}

export type PackTargets = Record<Edition, { pack: string; nft: string }>;

const ZERO = "0x0000000000000000000000000000000000000000";

async function save(sql: Sql, id: string, patch: Partial<Pick<MintRow, "status" | "order_id" | "buy_tx" | "buy_block" | "card_ids" | "settle_tx" | "transfer_txs" | "error">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((key, index) => `${key} = $${index + 2}`).join(", ");
  await sql.query(`update veil_free_mints set ${sets}, updated_at = now() where id = $1`, [id, ...keys.map((key) => patch[key] ?? null)]);
}

/** Revert reasons that will not fix themselves: the slot is freed for the wallet. */
export function isFatal(message: string): boolean {
  return /SoldOut|insufficient|exceeds balance|transfer amount exceeds|allowance/i.test(message);
}

/**
 * Move one claim forward as far as it can go right now. Safe to call repeatedly and
 * after a crash at any point: each step first checks what the chain already did.
 */
export async function advanceClaim(sql: Sql, chain: MintChain, cfg: FreeMintConfig, targets: PackTargets, start: MintRow): Promise<MintRow> {
  let row = { ...start };
  const { pack, nft } = targets[row.edition];
  const set = async (patch: Parameters<typeof save>[2]) => {
    await save(sql, row.id, patch);
    row = { ...row, ...patch } as MintRow;
  };
  try {
    if (row.status === "queued") {
      await chain.ensureAllowance(pack, BigInt(row.price_wei), cfg.budgetWei);
      const bought = await chain.buy(pack, row.faction, (hash) => set({ status: "buying", buy_tx: hash }));
      await set({ status: "bought", order_id: bought.orderId.toString(), buy_block: bought.block.toString(), error: null });
    }
    if (row.status === "buying") {
      const found = await chain.reservedFrom(pack, row.buy_tx!);
      if (found.state === "pending") return row;
      if (found.state === "reverted") {
        await set({ status: "failed", error: "The pack purchase reverted." });
        return row;
      }
      await set({ status: "bought", order_id: found.orderId.toString(), buy_block: found.block.toString(), error: null });
    }
    if (row.status === "settling") {
      const found = await chain.openedFrom(pack, row.settle_tx!, BigInt(row.order_id!));
      if (found.state === "pending") return row;
      if (found.state === "reverted") await set({ status: "bought", settle_tx: null });
      else await set({ status: "settled", card_ids: found.ids.join(","), error: null });
    }
    if (row.status === "bought") {
      const orderId = BigInt(row.order_id!);
      const order = await chain.order(pack, orderId);
      let ids: bigint[] | null;
      if (order.buyer.toLowerCase() === ZERO) {
        // Already settled (settle is callable by anyone): recover the ids from the Opened log.
        ids = await chain.findOpened(pack, orderId, BigInt(row.buy_block ?? "0"));
        if (!ids) return row;
      } else {
        if ((await chain.blockNumber()) <= order.openedAt + 1n) return row;
        ids = await chain.settle(pack, orderId, (hash) => set({ status: "settling", settle_tx: hash }));
      }
      await set({ status: "settled", card_ids: ids.join(","), error: null });
    }
    if (row.status === "settled" || row.status === "delivering") {
      const counts = new Map<string, bigint>();
      for (const id of (row.card_ids ?? "").split(",").filter(Boolean)) counts.set(id, (counts.get(id) ?? 0n) + 1n);
      if (!counts.size) {
        await set({ error: "The pack opened without a card list." });
        return row;
      }
      const sent = JSON.parse(row.transfer_txs || "{}") as Record<string, string>;
      for (const [id, amount] of counts) {
        if (sent[id]) {
          const state = await chain.txState(sent[id]!);
          if (state === "success") continue;
          if (state === "pending") return row;
        }
        await chain.transfer(nft, row.wallet, BigInt(id), amount, async (hash) => {
          sent[id] = hash;
          await set({ status: "delivering", transfer_txs: JSON.stringify(sent) });
        });
      }
      await set({ status: "delivered", error: null });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "unknown error";
    if (row.status === "queued" && isFatal(message)) await set({ status: "failed", error: message });
    else await set({ error: message });
  }
  return row;
}

let running: Promise<void> | null = null;

/** Single-flight worker pass over every open claim, oldest first. */
export function runFreeMintWorker(sql: Sql, chain: MintChain, cfg: FreeMintConfig, targets: PackTargets): Promise<void> {
  if (!cfg.enabled || !cfg.signerConfigured || cfg.stopped) return Promise.resolve();
  running ??= (async () => {
    try {
      const open = await sql<MintRow>`select * from veil_free_mints where status not in ('delivered', 'failed') order by created_at limit 20`;
      for (const row of open) await advanceClaim(sql, chain, cfg, targets, row);
    } finally {
      running = null;
    }
  })();
  return running;
}
