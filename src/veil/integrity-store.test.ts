import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyRoomResult,
  clearGiftSteps,
  giftStep,
  recordGiftStep,
  recordedGiftOrders,
  dailyWinsUsed,
  findPrize,
  giftTransfers,
  loadRoomSnapshot,
  markPrizeSigned,
  recentRoomSnapshots,
  recordGiftTransfer,
  releaseUnsignedPrize,
  reservePrize,
  saveRoomSnapshot,
  takeDailyWin,
} from "./integrity-store.ts";
import { memoryDb } from "./test-db.ts";
import type { Sql } from "@/lib/db";

const A = "0x00000000000000000000000000000000000000aa";
const B = "0x00000000000000000000000000000000000000bb";
const DAY = "2026-11-19";
let n = 0;
const ids = () => `0x${(++n).toString(16).padStart(64, "0")}` as `0x${string}`;

describe("integrity store", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  before(async () => {
    ({ sql, close } = await memoryDb());
  });
  after(async () => close());

  it("caps daily wins per wallet and UTC day, even under concurrent requests", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => takeDailyWin(sql, A, 4, DAY)));
    assert.equal(results.filter(Boolean).length, 4);
    assert.equal(await dailyWinsUsed(sql, A, DAY), 4);
    assert.equal(await takeDailyWin(sql, A, 4, "2026-11-20"), true, "a new UTC day starts fresh");
    assert.equal(await takeDailyWin(sql, B, 4, DAY), true, "each wallet has its own cap");
  });

  it("re-serves the same voucher for a room and never takes a second daily win", async () => {
    const first = await reservePrize(sql, { roomId: "r1", wallet: B, cap: 4, makeMatchId: ids, day: DAY });
    assert.ok(!("error" in first));
    assert.equal(first.created, true);
    const used = await dailyWinsUsed(sql, B, DAY);
    for (let i = 0; i < 3; i++) {
      const again = await reservePrize(sql, { roomId: "r1", wallet: B.toUpperCase().replace("0X", "0x"), cap: 4, makeMatchId: ids, day: DAY });
      assert.ok(!("error" in again));
      assert.equal(again.matchId, first.matchId);
      assert.equal(again.created, false);
    }
    assert.equal(await dailyWinsUsed(sql, B, DAY), used);
  });

  it("refuses the voucher to anyone but the winner", async () => {
    const other = await reservePrize(sql, { roomId: "r1", wallet: A, cap: 4, makeMatchId: ids, day: DAY });
    assert.deepEqual(other, { error: "not-winner" });
  });

  it("concurrent reservations for one room produce one matchId and refund the loser's daily win", async () => {
    const W = "0x00000000000000000000000000000000000000cc";
    const out = await Promise.all(Array.from({ length: 5 }, () => reservePrize(sql, { roomId: "r-race", wallet: W, cap: 4, makeMatchId: ids, day: DAY })));
    const matchIds = new Set(out.map((row) => ("error" in row ? row.error : row.matchId)));
    assert.equal(matchIds.size, 1);
    assert.equal(out.filter((row) => !("error" in row) && row.created).length, 1);
    assert.equal(await dailyWinsUsed(sql, W, DAY), 1);
  });

  it("returns cap once the wallet used its four wins", async () => {
    const capped = await reservePrize(sql, { roomId: "r-cap", wallet: A, cap: 4, makeMatchId: ids, day: DAY });
    assert.deepEqual(capped, { error: "cap" });
    assert.equal(await findPrize(sql, "r-cap"), null);
  });

  it("releases an unsigned voucher and refunds the day, but never a signed one", async () => {
    const W = "0x00000000000000000000000000000000000000dd";
    await reservePrize(sql, { roomId: "r-unsigned", wallet: W, cap: 4, makeMatchId: ids, day: DAY });
    assert.equal(await dailyWinsUsed(sql, W, DAY), 1);
    assert.equal(await releaseUnsignedPrize(sql, "r-unsigned", W), true);
    assert.equal(await dailyWinsUsed(sql, W, DAY), 0);
    await reservePrize(sql, { roomId: "r-signed", wallet: W, cap: 4, makeMatchId: ids, day: DAY });
    await markPrizeSigned(sql, "r-signed");
    assert.equal(await releaseUnsignedPrize(sql, "r-signed", W), false);
    assert.ok(await findPrize(sql, "r-signed"));
  });

  it("applies XP once per room and wallet", async () => {
    await sql`insert into veil_profiles (address, name, portrait) values (${A}, ${"A"}, ${"lysara"})`;
    const result = { roomId: "room-xp", address: A, win: true, turns: 9, conceded: false, vsBot: true };
    assert.equal(await applyRoomResult(sql, result, { win: 20, loss: 10 }), "applied");
    assert.equal(await applyRoomResult(sql, result, { win: 20, loss: 10 }), "duplicate");
    assert.equal(await applyRoomResult(sql, { ...result, win: false }, { win: 20, loss: 10 }), "duplicate");
    const [row] = await sql<{ xp: number; wins: number; losses: number }>`select xp, wins, losses from veil_profiles where address = ${A}`;
    assert.deepEqual({ xp: Number(row!.xp), wins: Number(row!.wins), losses: Number(row!.losses) }, { xp: 20, wins: 1, losses: 0 });
    assert.equal(await applyRoomResult(sql, { ...result, roomId: "room-xp-2", win: false }, { win: 20, loss: 10 }), "applied");
    assert.equal(await applyRoomResult(sql, { ...result, roomId: "room-xp-3", win: false }, { win: 20, loss: 10 }), "applied");
    const [floor] = await sql<{ xp: number }>`select xp from veil_profiles where address = ${A}`;
    assert.equal(Number(floor!.xp), 0, "XP never goes below zero");
    assert.equal(await applyRoomResult(sql, { ...result, roomId: "room-xp-4", address: B }, { win: 20, loss: 10 }), "no-profile");
  });

  it("stores and reloads room snapshots", async () => {
    await saveRoomSnapshot(sql, "m1", { v: 1, id: "m1", hello: "world" }, false);
    await saveRoomSnapshot(sql, "m1", { v: 1, id: "m1", hello: "again" }, true);
    assert.deepEqual(await loadRoomSnapshot(sql, "m1"), { v: 1, id: "m1", hello: "again" });
    const recent = await recentRoomSnapshots<{ id: string }>(sql, 60_000);
    assert.deepEqual(recent.map((row) => row.id), ["m1"]);
  });

  it("records one gift transfer per card id and replaces a failed hash", async () => {
    await recordGiftTransfer(sql, { wallet: A, orderId: "7", tokenId: "3", amount: 2, txHash: "0xaaa" });
    await recordGiftTransfer(sql, { wallet: A, orderId: "7", tokenId: "3", amount: 2, txHash: "0xbbb" });
    await recordGiftTransfer(sql, { wallet: A, orderId: "7", tokenId: "9", amount: 1, txHash: "0xccc" });
    const sent = await giftTransfers(sql, A, "7");
    assert.deepEqual([...sent.entries()].sort(), [["3", "0xbbb"], ["9", "0xccc"]]);
  });
  it("stores gift step hashes before the wait, overwrites on resend, and clears them", async () => {
    assert.equal(await giftStep(sql, A, "buy"), null);
    await recordGiftStep(sql, A.toUpperCase().replace("0X", "0x"), "buy", "0xaaa");
    assert.equal(await giftStep(sql, A, "buy"), "0xaaa", "wallet is case-insensitive");
    await recordGiftStep(sql, A, "buy", "0xbbb");
    await recordGiftStep(sql, A, "begin", "0xccc");
    assert.equal(await giftStep(sql, A, "buy"), "0xbbb");
    await clearGiftSteps(sql, A, ["buy"]);
    assert.equal(await giftStep(sql, A, "buy"), null);
    assert.equal(await giftStep(sql, A, "begin"), "0xccc");
  });

  it("lists every order id already held by a profile", async () => {
    await sql`insert into veil_profiles (address, name, portrait, gift_order) values (${"0x00000000000000000000000000000000000000c1"}, ${"c1"}, ${"lysara"}, ${"59"}) on conflict (address) do update set gift_order = excluded.gift_order`;
    const held = await recordedGiftOrders(sql);
    assert.ok(held.has("59"));
    assert.ok(!held.has(""));
  });
});
