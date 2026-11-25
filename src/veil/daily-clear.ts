/**
 * Verify a player's VeilRewards.claim() transaction and, when it is the fourth
 * claimed voucher of that UTC day, grant the daily-clear XP bonus once.
 *
 * VeilRewards has no Claimed event, so verification uses the receipt plus the
 * transaction input and the BzB Transfer log (from the rewards contract to the
 * player, for exactly WIN wei). Nothing here signs or sends a transaction.
 */
import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";
import type { Sql } from "@/lib/db";
import { BZB, REWARDS, WIN_WEI } from "./deployed";
import { DAILY_CLEAR_WINS, DAILY_CLEAR_XP } from "./ranks";
import { grantDueTitles, type TitleDef } from "./titles";

export const CLAIM_ABI = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

export type ReceiptLog = { address: string; topics: readonly string[]; data: string };

export type ClaimTx = {
  hash: Hex;
  from: string;
  to: string | null;
  input: Hex;
};

export type ClaimReceipt = {
  status: "success" | "reverted";
  from: string;
  to: string | null;
  logs: ReceiptLog[];
};

export type VerifyOk = { matchId: Hex };
export type VerifyErr = { error: "bad-tx" | "not-claim" | "wrong-player" | "wrong-contract" | "reverted" | "no-payout" };

function padAddress(addr: string): string {
  return `0x${getAddress(addr).slice(2).toLowerCase().padStart(64, "0")}`;
}

export function verifyClaimReceipt(input: {
  tx: ClaimTx;
  receipt: ClaimReceipt;
  player: Address;
  rewards?: Address;
  bzb?: Address;
  winWei?: bigint;
}): VerifyOk | VerifyErr {
  const rewards = getAddress(input.rewards ?? REWARDS);
  const bzb = getAddress(input.bzb ?? BZB);
  const win = input.winWei ?? WIN_WEI;
  const player = getAddress(input.player);
  if (input.receipt.status !== "success") return { error: "reverted" };
  const to = input.receipt.to ?? input.tx.to;
  if (!to) return { error: "wrong-contract" };
  try {
    if (getAddress(to) !== rewards) return { error: "wrong-contract" };
    if (getAddress(input.receipt.from) !== player || getAddress(input.tx.from) !== player) return { error: "wrong-player" };
  } catch {
    return { error: "bad-tx" };
  }
  let matchId: Hex;
  try {
    const decoded = decodeFunctionData({ abi: CLAIM_ABI, data: input.tx.input });
    if (decoded.functionName !== "claim") return { error: "not-claim" };
    matchId = decoded.args[0] as Hex;
  } catch {
    return { error: "not-claim" };
  }
  const fromTopic = padAddress(rewards);
  const toTopic = padAddress(player);
  const paid = input.receipt.logs.some((log) => {
    try {
      if (getAddress(log.address) !== bzb) return false;
    } catch {
      return false;
    }
    if ((log.topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) return false;
    if ((log.topics[1] ?? "").toLowerCase() !== fromTopic) return false;
    if ((log.topics[2] ?? "").toLowerCase() !== toTopic) return false;
    try {
      return BigInt(log.data || "0x0") === win;
    } catch {
      return false;
    }
  });
  if (!paid) return { error: "no-payout" };
  return { matchId };
}

export type RecordedClaim = { matchId: Hex; wallet: string; utcDay: string; created: boolean };

/**
 * Bind a verified claim tx to its prize row. Idempotent on the same hash.
 * Rejects a second, different hash for the same match, or a hash that belongs
 * to another wallet.
 */
export async function recordClaimedTx(
  sql: Sql,
  input: { matchId: Hex; wallet: string; txHash: Hex },
): Promise<RecordedClaim | { error: "unknown-voucher" | "not-winner" | "other-tx" }> {
  const wallet = input.wallet.toLowerCase();
  const rows = await sql<{ match_id: string; wallet: string; utc_day: string; claimed_tx: string | null }>`
    select match_id, wallet, utc_day, claimed_tx from veil_prizes where match_id = ${input.matchId}`;
  const row = rows[0];
  if (!row) return { error: "unknown-voucher" };
  if (row.wallet !== wallet) return { error: "not-winner" };
  if (row.claimed_tx && row.claimed_tx.toLowerCase() !== input.txHash.toLowerCase()) return { error: "other-tx" };
  if (row.claimed_tx) return { matchId: row.match_id as Hex, wallet, utcDay: row.utc_day, created: false };
  const updated = await sql<{ match_id: string; utc_day: string }>`
    update veil_prizes
       set claimed_tx = ${input.txHash}, claimed_at = coalesce(claimed_at, now())
     where match_id = ${input.matchId} and wallet = ${wallet} and (claimed_tx is null or claimed_tx = ${input.txHash})
     returning match_id, utc_day`;
  if (!updated[0]) return { error: "other-tx" };
  return { matchId: updated[0].match_id as Hex, wallet, utcDay: updated[0].utc_day, created: true };
}

export async function claimedOnDay(sql: Sql, wallet: string, day: string): Promise<number> {
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from veil_prizes
     where wallet = ${wallet.toLowerCase()} and utc_day = ${day} and claimed_tx is not null`;
  return Number(rows[0]?.n ?? 0);
}

export type ClearGrant = { granted: boolean; xp: number; day: string };

/**
 * If this wallet has now claimed all four vouchers issued on `day`, grant
 * DAILY_CLEAR_XP once. The unique (wallet, utc_day) key makes concurrent
 * confirms safe.
 */
export async function grantDailyClear(
  sql: Sql,
  input: { wallet: string; day: string; txHash: Hex; xp?: number; cap?: number },
): Promise<ClearGrant> {
  const wallet = input.wallet.toLowerCase();
  const xp = input.xp ?? DAILY_CLEAR_XP;
  const cap = input.cap ?? DAILY_CLEAR_WINS;
  const n = await claimedOnDay(sql, wallet, input.day);
  if (n < cap) return { granted: false, xp: 0, day: input.day };
  const inserted = await sql<{ utc_day: string }>`
    insert into veil_daily_clears (wallet, utc_day, xp, tx_hash)
    values (${wallet}, ${input.day}, ${xp}, ${input.txHash})
    on conflict (wallet, utc_day) do nothing
    returning utc_day`;
  if (!inserted.length) return { granted: false, xp: 0, day: input.day };
  await sql`update veil_profiles set xp = xp + ${xp} where address = ${wallet}`;
  return { granted: true, xp, day: input.day };
}

export type ConfirmResult = {
  ok: true;
  matchId: Hex;
  clear: ClearGrant;
  fresh: TitleDef[];
};

export type ConfirmError = { ok: false; error: string };

/**
 * Record a verified claim and maybe grant the daily-clear bonus plus any
 * newly unlocked titles. Pure SQL after verification; the caller supplies
 * the already-checked receipt.
 */
export async function applyVerifiedClaim(
  sql: Sql,
  input: { player: Address; matchId: Hex; txHash: Hex },
): Promise<ConfirmResult | ConfirmError> {
  const recorded = await recordClaimedTx(sql, { matchId: input.matchId, wallet: input.player, txHash: input.txHash });
  if ("error" in recorded) {
    const text =
      recorded.error === "unknown-voucher"
        ? "That claim does not match a signed win."
        : recorded.error === "not-winner"
          ? "Sign in with the wallet that won."
          : "This win was already claimed with a different transaction.";
    return { ok: false, error: text };
  }
  const clear = await grantDailyClear(sql, { wallet: recorded.wallet, day: recorded.utcDay, txHash: input.txHash });
  const fresh = await grantDueTitles(sql, recorded.wallet);
  return { ok: true, matchId: recorded.matchId, clear, fresh };
}
