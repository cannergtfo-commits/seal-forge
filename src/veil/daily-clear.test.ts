import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { memoryDb } from "./test-db.ts";
import type { Sql } from "@/lib/db";
import { BZB, REWARDS, WIN_WEI } from "./deployed.ts";
import { DAILY_CLEAR_XP } from "./ranks.ts";
import {
  CLAIM_ABI,
  TRANSFER_TOPIC,
  applyVerifiedClaim,
  claimedOnDay,
  grantDailyClear,
  recordClaimedTx,
  verifyClaimReceipt,
  type ClaimReceipt,
  type ClaimTx,
  type ReceiptLog,
} from "./daily-clear.ts";

const PLAYER = "0x82C7eb3CA2271F2813B2eC0372EA3f9F5e11EDD1" as Address;
const OTHER = "0x1111111111111111111111111111111111111111" as Address;
const SIG = ("0x" + "ab".repeat(65)) as Hex;

function pad(addr: string): Hex {
  return `0x${getAddress(addr).slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

function matchId(n: number): Hex {
  return `0x${n.toString(16).padStart(64, "0")}` as Hex;
}

function txHash(n: number): Hex {
  return `0x${(1000 + n).toString(16).padStart(64, "0")}` as Hex;
}

function claimInput(id: Hex): Hex {
  return encodeFunctionData({ abi: CLAIM_ABI, functionName: "claim", args: [id, SIG] });
}

function transferLog(from: string, to: string, amount: bigint, token = BZB): ReceiptLog {
  return {
    address: token,
    topics: [TRANSFER_TOPIC, pad(from), pad(to)],
    data: `0x${amount.toString(16).padStart(64, "0")}`,
  };
}

function bundle(id: Hex, player: Address = PLAYER): { tx: ClaimTx; receipt: ClaimReceipt } {
  const input = claimInput(id);
  return {
    tx: { hash: txHash(1), from: player, to: REWARDS, input },
    receipt: {
      status: "success",
      from: player,
      to: REWARDS,
      logs: [transferLog(REWARDS, player, WIN_WEI)],
    },
  };
}

describe("claim receipt verification", () => {
  it("accepts a successful claim with the BzB payout log", () => {
    const id = matchId(1);
    const found = verifyClaimReceipt({ ...bundle(id), player: PLAYER });
    assert.deepEqual(found, { matchId: id });
  });

  it("rejects a revert, a wrong contract, a wrong signer, a bad selector, and a missing payout", () => {
    const id = matchId(2);
    const base = bundle(id);
    assert.equal(verifyClaimReceipt({ ...base, receipt: { ...base.receipt, status: "reverted" }, player: PLAYER }).error, "reverted");
    assert.equal(verifyClaimReceipt({ ...base, receipt: { ...base.receipt, to: OTHER }, tx: { ...base.tx, to: OTHER }, player: PLAYER }).error, "wrong-contract");
    assert.equal(verifyClaimReceipt({ ...base, player: OTHER }).error, "wrong-player");
    assert.equal(verifyClaimReceipt({ ...base, tx: { ...base.tx, input: "0xdeadbeef" as Hex }, player: PLAYER }).error, "not-claim");
    assert.equal(verifyClaimReceipt({ ...base, receipt: { ...base.receipt, logs: [] }, player: PLAYER }).error, "no-payout");
    assert.equal(
      verifyClaimReceipt({ ...base, receipt: { ...base.receipt, logs: [transferLog(REWARDS, PLAYER, WIN_WEI / 2n)] }, player: PLAYER }).error,
      "no-payout",
    );
  });
});

describe("claim recording and daily-clear grant", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  before(async () => {
    ({ sql, close } = await memoryDb());
    await sql`
      insert into veil_profiles (address, name, portrait, xp, wins, losses)
      values (${PLAYER.toLowerCase()}, 'Forge', 'lysara', 80, 4, 0)`;
  });
  after(async () => close());

  async function seedPrize(n: number, day = "2026-11-24") {
    await sql`
      insert into veil_prizes (room_id, match_id, wallet, utc_day)
      values (${`room-${n}`}, ${matchId(n)}, ${PLAYER.toLowerCase()}, ${day})`;
  }

  it("records a verified tx once and refuses a second hash for the same match", async () => {
    await seedPrize(1);
    const first = await recordClaimedTx(sql, { matchId: matchId(1), wallet: PLAYER, txHash: txHash(1) });
    assert.ok(!("error" in first));
    assert.equal(first.created, true);
    const again = await recordClaimedTx(sql, { matchId: matchId(1), wallet: PLAYER, txHash: txHash(1) });
    assert.ok(!("error" in again));
    assert.equal(again.created, false);
    const other = await recordClaimedTx(sql, { matchId: matchId(1), wallet: PLAYER, txHash: txHash(99) });
    assert.deepEqual(other, { error: "other-tx" });
    const stolen = await recordClaimedTx(sql, { matchId: matchId(1), wallet: OTHER, txHash: txHash(1) });
    assert.deepEqual(stolen, { error: "not-winner" });
    assert.deepEqual(await recordClaimedTx(sql, { matchId: matchId(99), wallet: PLAYER, txHash: txHash(1) }), { error: "unknown-voucher" });
  });

  it("grants the daily-clear bonus only on the fourth claim of that UTC day, once", async () => {
    for (const n of [2, 3, 4]) await seedPrize(n);
    await recordClaimedTx(sql, { matchId: matchId(2), wallet: PLAYER, txHash: txHash(2) });
    await recordClaimedTx(sql, { matchId: matchId(3), wallet: PLAYER, txHash: txHash(3) });
    assert.equal(await claimedOnDay(sql, PLAYER, "2026-11-24"), 3);
    const early = await grantDailyClear(sql, { wallet: PLAYER, day: "2026-11-24", txHash: txHash(3) });
    assert.deepEqual(early, { granted: false, xp: 0, day: "2026-11-24" });

    const applied = await applyVerifiedClaim(sql, { player: PLAYER, matchId: matchId(4), txHash: txHash(4) });
    assert.equal(applied.ok, true);
    if (applied.ok) {
      assert.equal(applied.clear.granted, true);
      assert.equal(applied.clear.xp, DAILY_CLEAR_XP);
      assert.ok(applied.fresh.some((row) => row.id === "the-sealed"), "80 + 40 XP reaches Seal");
    }
    const xp = await sql<{ xp: number }>`select xp from veil_profiles where address = ${PLAYER.toLowerCase()}`;
    assert.equal(Number(xp[0]!.xp), 80 + DAILY_CLEAR_XP);

    const replay = await applyVerifiedClaim(sql, { player: PLAYER, matchId: matchId(4), txHash: txHash(4) });
    assert.equal(replay.ok, true);
    if (replay.ok) assert.equal(replay.clear.granted, false);
    const xp2 = await sql<{ xp: number }>`select xp from veil_profiles where address = ${PLAYER.toLowerCase()}`;
    assert.equal(Number(xp2[0]!.xp), 80 + DAILY_CLEAR_XP, "replay does not pay XP twice");
  });

  it("does not let two concurrent grants both add XP", async () => {
    const day = "2026-11-25";
    const startXp = Number((await sql<{ xp: number }>`select xp from veil_profiles where address = ${PLAYER.toLowerCase()}`)[0]!.xp);
    for (const n of [11, 12, 13, 14]) await seedPrize(n, day);
    for (const n of [11, 12, 13, 14]) {
      await recordClaimedTx(sql, { matchId: matchId(n), wallet: PLAYER, txHash: txHash(n) });
    }
    const raced = await Promise.all([
      grantDailyClear(sql, { wallet: PLAYER, day, txHash: txHash(14) }),
      grantDailyClear(sql, { wallet: PLAYER, day, txHash: txHash(14) }),
      grantDailyClear(sql, { wallet: PLAYER, day, txHash: txHash(14) }),
    ]);
    assert.equal(raced.filter((row) => row.granted).length, 1);
    const endXp = Number((await sql<{ xp: number }>`select xp from veil_profiles where address = ${PLAYER.toLowerCase()}`)[0]!.xp);
    assert.equal(endXp, startXp + DAILY_CLEAR_XP);
  });
});
