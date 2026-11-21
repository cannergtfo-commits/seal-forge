import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyRoomResult } from "./integrity-store.ts";
import { profileStats, summarize } from "./profile-stats.ts";
import { cleanMotto, mmrTier, MOTTO_MAX } from "./ranks.ts";
import { memoryDb } from "./test-db.ts";
import type { Sql } from "@/lib/db";

const A = "0x00000000000000000000000000000000000000a1";

describe("profile stats", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  before(async () => {
    ({ sql, close } = await memoryDb());
    await sql`insert into veil_profiles (address, name, portrait) values (${A}, ${"Tester"}, ${"lysara"})`;
  });
  after(async () => close());

  it("records the seal and deck with each scored result, without changing XP rules", async () => {
    const deck = ["scout", "scout", "medic"];
    assert.equal(
      await applyRoomResult(
        sql,
        {
          roomId: "s1",
          address: A,
          win: true,
          turns: 9,
          conceded: false,
          vsBot: true,
          faction: "human",
          deck,
        },
        { win: 20, loss: 10 },
      ),
      "applied",
    );
    assert.equal(
      await applyRoomResult(
        sql,
        {
          roomId: "s2",
          address: A,
          win: true,
          turns: 11,
          conceded: false,
          vsBot: false,
          faction: "human",
          deck,
        },
        { win: 20, loss: 10 },
      ),
      "applied",
    );
    assert.equal(
      await applyRoomResult(
        sql,
        {
          roomId: "s3",
          address: A,
          win: false,
          turns: 7,
          conceded: true,
          vsBot: true,
          faction: "demon",
        },
        { win: 20, loss: 10 },
      ),
      "applied",
    );
    // junk faction / deck values are dropped, not stored
    assert.equal(
      await applyRoomResult(
        sql,
        {
          roomId: "s4",
          address: A,
          win: false,
          turns: 5,
          conceded: false,
          vsBot: true,
          faction: "<script>",
          deck: ["x'; drop table", "ok-id"],
        },
        { win: 20, loss: 10 },
      ),
      "applied",
    );
    const rows = await sql<{
      room_id: string;
      faction: string;
      deck: string;
    }>`select room_id, faction, deck from veil_room_results where wallet = ${A} order by room_id`;
    assert.deepEqual(
      rows.map((r) => [r.room_id, r.faction, r.deck]),
      [
        ["s1", "human", "scout,scout,medic"],
        ["s2", "human", "scout,scout,medic"],
        ["s3", "demon", ""],
        ["s4", "", "ok-id"],
      ],
    );
    const xp = await sql<{
      xp: number;
      wins: number;
      losses: number;
    }>`select xp, wins, losses from veil_profiles where address = ${A}`;
    assert.deepEqual([Number(xp[0]!.xp), Number(xp[0]!.wins), Number(xp[0]!.losses)], [20, 2, 2]);
  });

  it("aggregates seals, streaks, favourite cards and signed vouchers from the ledger", async () => {
    await sql`insert into veil_prizes (room_id, match_id, wallet, utc_day, signed_at) values (${"s1"}, ${`0x${"1".repeat(64)}`}, ${A}, ${"2026-11-20"}, now())`;
    await sql`insert into veil_prizes (room_id, match_id, wallet, utc_day) values (${"s2"}, ${`0x${"2".repeat(64)}`}, ${A}, ${"2026-11-20"})`;
    const stats = await profileStats(sql, A.toUpperCase().replace("0X", "0x"));
    assert.equal(stats.scored, 4);
    assert.equal(stats.mostPlayedSeal, "human");
    assert.deepEqual(stats.seals[0], { faction: "human", games: 2, wins: 2 });
    assert.equal(stats.streak.best, 2);
    assert.equal(stats.streak.currentWin, false);
    assert.equal(stats.streak.current, 2);
    assert.equal(stats.favoriteCards[0]!.games, 2);
    assert.equal(stats.vsHuman.games, 1);
    assert.equal(stats.vouchers.signed, 1, "unsigned reservations are not counted");
  });

  it("summarize handles an empty ledger honestly", () => {
    const empty = summarize([]);
    assert.equal(empty.scored, 0);
    assert.equal(empty.mostPlayedSeal, null);
    assert.equal(empty.avgTurns, null);
    assert.equal(empty.streak.currentWin, null);
  });

  it("never picks the untracked bucket as the most played seal", () => {
    const rows = [0, 1, 2].map(() => ({
      win: true,
      vs_bot: true,
      turns: 5,
      faction: "",
      deck: "",
      created_at: new Date(),
    }));
    rows.push({
      win: false,
      vs_bot: true,
      turns: 5,
      faction: "elf",
      deck: "",
      created_at: new Date(),
    });
    assert.equal(summarize(rows).mostPlayedSeal, "elf");
  });
});

describe("motto", () => {
  it("trims, collapses whitespace and strips control / bidi characters", () => {
    assert.equal(cleanMotto("  Hold   the\nline  "), "Hold the line");
    assert.equal(cleanMotto("a\u202Eb\u0000c"), "abc");
    assert.equal(cleanMotto(""), "");
  });
  it("caps length and rejects links and slurs", () => {
    assert.equal(cleanMotto("x".repeat(MOTTO_MAX)), "x".repeat(MOTTO_MAX));
    assert.equal(cleanMotto("x".repeat(MOTTO_MAX + 1)), null);
    assert.equal(cleanMotto("visit https://scam.example"), null);
    assert.equal(cleanMotto("free mint at scam.xyz"), null);
    assert.equal(cleanMotto("what the fuck"), null);
    assert.equal(cleanMotto("b.i.t.c.h"), null);
    assert.equal(cleanMotto("A classic Scunthorpe assassin"), "A classic Scunthorpe assassin");
    assert.equal(cleanMotto(42), null);
  });
  it("keeps HTML as plain text (React escapes it)", () => {
    assert.equal(cleanMotto("<b>bold</b>"), "<b>bold</b>");
  });
});

describe("mmr tier", () => {
  it("is unrated until a human match moves it", () => {
    assert.equal(mmrTier(1000, 0).name, "Unrated");
    assert.equal(mmrTier(1062, 6).name, "Forged");
    assert.equal(mmrTier(1400, 30).name, "Mythforged");
  });
});
