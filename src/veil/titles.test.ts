import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { memoryDb } from "./test-db.ts";
import type { Sql } from "@/lib/db";
import {
  TITLES,
  clearStreak,
  catalog,
  equipTitle,
  grantDueTitles,
  loadTitleStats,
  prevUtcDay,
  progressOf,
  titlesFor,
  unlockedIds,
  type PlayerTitleStats,
} from "./titles.ts";

const W = "0x00000000000000000000000000000000000000aa";

function stats(partial: Partial<PlayerTitleStats> = {}): PlayerTitleStats {
  return {
    xp: 0,
    wins: 0,
    gifted: false,
    decks: 0,
    sealWins: {},
    clearDays: [],
    today: "2026-11-24",
    seasonPlace: null,
    ...partial,
  };
}

async function seedProfile(sql: Sql, input: { xp?: number; wins?: number; gifted?: number } = {}) {
  await sql`
    insert into veil_profiles (address, name, portrait, xp, wins, losses, gifted)
    values (${W}, 'Test', 'lysara', ${input.xp ?? 0}, ${input.wins ?? 0}, 0, ${input.gifted ?? 0})
    on conflict (address) do update set xp = excluded.xp, wins = excluded.wins, gifted = excluded.gifted`;
}

describe("title unlock rules", () => {
  it("keeps the catalog ids unique and aligned with rarity/rule fields", () => {
    const ids = TITLES.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const row of TITLES) {
      assert.ok(["common", "rare", "epic", "legendary"].includes(row.rarity), row.id);
      assert.ok(row.threshold >= 1, row.id);
      assert.ok(row.name.length > 0 && row.flavor.length > 0, row.id);
    }
  });

  it("unlocks win, xp, gift, and deck titles from the raw counts", () => {
    const empty = unlockedIds(TITLES, stats());
    assert.deepEqual(empty, []);
    const first = unlockedIds(TITLES, stats({ wins: 1 }));
    assert.ok(first.includes("first-oath"));
    assert.ok(!first.includes("proven"));
    const climb = unlockedIds(TITLES, stats({ xp: 120, wins: 10 }));
    assert.ok(climb.includes("ashborne"));
    assert.ok(climb.includes("the-sealed"));
    assert.ok(climb.includes("proven"));
    assert.ok(!climb.includes("wardens-oath"));
    const gift = unlockedIds(TITLES, stats({ gifted: true, wins: 1 }));
    assert.ok(gift.includes("founding-bearer"));
    const decks = unlockedIds(TITLES, stats({ decks: 2 }));
    assert.ok(decks.includes("two-oaths"));
    assert.ok(!decks.includes("hex-of-oaths"));
  });

  it("counts a daily-clear streak that may still be live from yesterday", () => {
    assert.equal(prevUtcDay("2026-11-24"), "2026-11-23");
    assert.equal(clearStreak(["2026-11-22", "2026-11-23", "2026-11-24"], "2026-11-24"), 3);
    assert.equal(clearStreak(["2026-11-22", "2026-11-23"], "2026-11-24"), 2, "yesterday still counts today");
    assert.equal(clearStreak(["2026-11-20", "2026-11-22"], "2026-11-24"), 0);
    assert.ok(unlockedIds(TITLES, stats({ clearDays: ["2026-11-22", "2026-11-23", "2026-11-24"], today: "2026-11-24" })).includes("ember-path"));
    assert.ok(!unlockedIds(TITLES, stats({ clearDays: ["2026-11-23", "2026-11-24"], today: "2026-11-24" })).includes("ember-path"));
  });

  it("tracks per-seal mastery and the five-seal walk", () => {
    const one = unlockedIds(TITLES, stats({ sealWins: { elf: 10 } }));
    assert.ok(one.includes("aureth-adept"));
    assert.ok(!one.includes("veymar-adept"));
    assert.ok(!one.includes("five-walks"));
    const all = unlockedIds(
      TITLES,
      stats({ sealWins: { elf: 1, human: 1, goblin: 1, robot: 1, demon: 1 } }),
    );
    assert.ok(all.includes("five-walks"));
    const progress = progressOf(
      TITLES.find((row) => row.id === "five-walks")!,
      stats({ sealWins: { elf: 1, human: 4 } }),
    );
    assert.deepEqual(progress, { current: 2, target: 5, unlocked: false });
  });

  it("leaves the season title locked until a placement exists", () => {
    const locked = progressOf(TITLES.find((row) => row.id === "season-contender")!, stats());
    assert.equal(locked.unlocked, false);
    const open = progressOf(TITLES.find((row) => row.id === "season-contender")!, stats({ seasonPlace: 12 }));
    assert.equal(open.unlocked, true);
  });
});

describe("title grants and equip", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  before(async () => {
    ({ sql, close } = await memoryDb());
  });
  after(async () => close());

  it("seeds the catalog from the migration", async () => {
    const rows = await catalog(sql);
    assert.equal(rows.length, TITLES.length);
    assert.deepEqual(
      rows.map((row) => row.id).sort(),
      [...TITLES].map((row) => row.id).sort(),
    );
  });

  it("grants due titles once and lets the player equip a held one", async () => {
    await seedProfile(sql, { xp: 40, wins: 2 });
    const first = await grantDueTitles(sql, W, "2026-11-24");
    assert.ok(first.some((row) => row.id === "first-oath"));
    assert.ok(first.some((row) => row.id === "ashborne"));
    const again = await grantDueTitles(sql, W, "2026-11-24");
    assert.deepEqual(again, [], "idempotent: already granted titles are not returned again");
    const blocked = await equipTitle(sql, W, "sovereign-crown");
    assert.deepEqual(blocked, { error: "That title is still locked." });
    const ok = await equipTitle(sql, W, "ashborne");
    assert.ok(!("error" in ok));
    assert.equal(ok.equipped?.id, "ashborne");
    const cleared = await equipTitle(sql, W, null);
    assert.ok(!("error" in cleared));
    assert.equal(cleared.equipped, null);
  });

  it("loads seal wins and deck counts from the ledgers", async () => {
    await sql`
      insert into veil_room_results (room_id, wallet, win, turns, conceded, vs_bot, faction)
      values
        ('r-elf', ${W}, true, 10, false, true, 'elf'),
        ('r-hum', ${W}, true, 8, false, true, 'human'),
        ('r-loss', ${W}, false, 6, false, true, 'goblin')`;
    await sql`
      insert into veil_decks (id, wallet, name, cards) values
        ('dk1', ${W}, 'One', 'a,b'),
        ('dk2', ${W}, 'Two', 'c,d')`;
    const loaded = await loadTitleStats(sql, W, "2026-11-24");
    assert.equal(loaded.sealWins.elf, 1);
    assert.equal(loaded.sealWins.human, 1);
    assert.equal(loaded.sealWins.goblin, undefined);
    assert.equal(loaded.decks, 2);
    const view = await titlesFor(sql, W, "2026-11-24");
    assert.ok(view.fresh.some((row) => row.id === "two-oaths"));
    const two = view.titles.find((row) => row.id === "two-oaths");
    assert.equal(two?.held, true);
    assert.equal(two?.unlocked, true);
  });
});
