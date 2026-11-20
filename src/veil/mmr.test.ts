import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { eloDelta, mmrBand } from "./mmr.ts";
import { featureOn } from "./features.ts";
import { applyMmr, mmrOf } from "./integrity-store.ts";
import { memoryDb } from "./test-db.ts";
import type { Sql } from "@/lib/db";

describe("mmr math", () => {
  it("gives 16 for an even game and less for beating a weaker player", () => {
    assert.deepEqual(eloDelta(1000, 1000), [16, -16]);
    const [favourite] = eloDelta(1400, 1000);
    const [upset] = eloDelta(1000, 1400);
    assert.ok(favourite < 16 && favourite >= 1);
    assert.ok(upset > 16 && upset <= 32);
  });
  it("widens the band with wait time and opens fully at 10 s", () => {
    assert.equal(mmrBand(0), 150);
    assert.ok(mmrBand(4_000) > mmrBand(1_000));
    assert.equal(mmrBand(10_000), Number.POSITIVE_INFINITY);
  });
});

describe("feature flags", () => {
  it("are off unless set to 1 or true", () => {
    assert.equal(featureOn("FEATURE_QUESTS", {}), false);
    assert.equal(featureOn("FEATURE_QUESTS", { FEATURE_QUESTS: "0" }), false);
    assert.equal(featureOn("FEATURE_SEASONS", { FEATURE_SEASONS: "1" }), true);
    assert.equal(featureOn("FEATURE_FREE_MINT", { FEATURE_FREE_MINT: "true" }), true);
  });
});

describe("mmr store", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  const W = "0x00000000000000000000000000000000000000a1";
  const L = "0x00000000000000000000000000000000000000b2";
  before(async () => {
    ({ sql, close } = await memoryDb());
    await sql`insert into veil_profiles (address, name, portrait) values (${W}, ${"W"}, ${"lysara"}), (${L}, ${"L"}, ${"lysara"})`;
  });
  after(async () => close());

  it("moves both ratings once per room", async () => {
    assert.equal(await applyMmr(sql, { roomId: "pvp1", winner: W, loser: L }, eloDelta), "applied");
    assert.equal(await applyMmr(sql, { roomId: "pvp1", winner: W, loser: L }, eloDelta), "duplicate");
    assert.equal(await mmrOf(sql, W), 1016);
    assert.equal(await mmrOf(sql, L), 984);
  });
  it("skips wallets without a profile", async () => {
    assert.equal(await applyMmr(sql, { roomId: "pvp2", winner: W, loser: "0x00000000000000000000000000000000000000c3" }, eloDelta), "no-profile");
  });
});
