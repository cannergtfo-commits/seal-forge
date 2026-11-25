import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARDS, type Faction } from "./cards.ts";
import {
  MAX_DECKS,
  activateDeck,
  deckKey,
  listDecks,
  reconcileDecks,
  renameDeck,
  sealDeck,
  unsealDeck,
  type Owns,
} from "./decks.ts";
import { applyRoomResult } from "./integrity-store.ts";
import { memoryDb } from "./test-db.ts";
import type { Sql } from "@/lib/db";

const W = "0x00000000000000000000000000000000000000d1";
const yes: Owns = async () => ({ ok: true });
const no: Owns = async () => ({
  ok: false,
  error: "That deck uses cards this wallet does not hold as NFTs.",
});

/** A legal 20-card deck: ten cards of one seal, two copies each, starting at `skip`. */
function deckOf(faction: Faction, skip = 0): string[] {
  const pool = CARDS.filter((card) => card.faction === faction).slice(skip, skip + 10);
  assert.equal(pool.length, 10, `need 10 ${faction} cards`);
  return pool.flatMap((card) => [card.id, card.id]);
}

describe("sealed decks", () => {
  let sql: Sql;
  let close: () => Promise<void>;
  before(async () => {
    ({ sql, close } = await memoryDb());
    await sql`insert into veil_profiles (address, name, portrait) values (${W}, ${"Decks"}, ${"lysara"})`;
  });
  after(async () => close());

  it("migration 0018 carries an existing single deck over as the first, active deck", async () => {
    // Fresh in-memory DB: simulate a pre-0018 profile by writing the old columns, then re-run the migration body.
    const legacy = "0x00000000000000000000000000000000000000e1";
    const cards = deckOf("elf").join(",");
    await sql`insert into veil_profiles (address, name, portrait, deck, deck_name) values (${legacy}, ${"Old"}, ${"lysara"}, ${cards}, ${"Grove"})`;
    const { readFileSync } = await import("node:fs");
    const body = readFileSync(
      new URL("../../migrations/0018_sealed_decks.sql", import.meta.url),
      "utf8",
    );
    // The extended protocol runs one statement per call; the migration is idempotent, so replay all of it.
    for (const statement of body
      .replace(/--.*$/gm, "")
      .split(";")
      .filter((part) => part.trim()))
      await sql.query(statement);
    const decks = await listDecks(sql, legacy);
    assert.equal(decks.length, 1);
    assert.equal(decks[0]!.name, "Grove");
    assert.equal(decks[0]!.cards.join(","), cards);
    assert.equal(decks[0]!.active, true);
    assert.equal(decks[0]!.seal, "elf");
  });

  it("seals several decks, the first becomes active, and the profile mirror follows the active one", async () => {
    let r = await sealDeck(sql, W, { name: "Iron Oath", cards: deckOf("human") }, yes);
    assert.ok("decks" in r);
    r = await sealDeck(sql, W, { name: "Ember Rush", cards: deckOf("goblin") }, yes);
    assert.ok("decks" in r);
    assert.equal(r.decks.length, 2);
    assert.deepEqual(
      r.decks.map((d) => [d.name, d.active]),
      [
        ["Iron Oath", true],
        ["Ember Rush", false],
      ],
    );
    const p = await sql<{
      deck: string;
      deck_name: string;
    }>`select deck, deck_name from veil_profiles where address = ${W}`;
    assert.equal(p[0]!.deck_name, "Iron Oath");
    assert.equal(p[0]!.deck, deckOf("human").join(","));
  });

  it("keeps the same rules sealing always had: legality, ownership, names", async () => {
    assert.deepEqual(
      await sealDeck(sql, W, { name: "Short", cards: deckOf("human").slice(0, 19) }, yes),
      { error: "A deck is 20 cards." },
    );
    assert.ok(
      "error" in
        (await sealDeck(
          sql,
          W,
          {
            name: "Mixed",
            cards: [...deckOf("human").slice(0, 10), ...deckOf("elf").slice(0, 10)],
          },
          yes,
        )),
    );
    assert.deepEqual(await sealDeck(sql, W, { name: "Robo", cards: deckOf("robot") }, no), {
      error: "That deck uses cards this wallet does not hold as NFTs.",
    });
    assert.deepEqual(await sealDeck(sql, W, { name: "<b>x</b>", cards: deckOf("robot") }, yes), {
      error: "Deck names are 2 to 18 letters or numbers.",
    });
    const twin = await sealDeck(
      sql,
      W,
      { name: "Copy", cards: [...deckOf("human")].reverse() },
      yes,
    );
    assert.ok("error" in twin && twin.error.includes("Iron Oath"));
  });

  it("switches the active deck, renames, and reseals in place", async () => {
    const list = await listDecks(sql, W);
    const ember = list.find((d) => d.name === "Ember Rush")!;
    let r = await activateDeck(sql, W, ember.id);
    assert.ok("decks" in r);
    assert.equal(r.decks.find((d) => d.active)!.id, ember.id);
    r = await renameDeck(sql, W, ember.id, "Ember Storm");
    assert.ok("decks" in r);
    const p = await sql<{
      deck: string;
      deck_name: string;
      active_deck: string;
    }>`select deck, deck_name, active_deck from veil_profiles where address = ${W}`;
    assert.deepEqual(
      [p[0]!.deck_name, p[0]!.active_deck, p[0]!.deck],
      ["Ember Storm", ember.id, deckOf("goblin").join(",")],
    );
    r = await sealDeck(
      sql,
      W,
      { id: ember.id, name: "Ember Storm", cards: deckOf("goblin", 2) },
      yes,
    );
    assert.ok("decks" in r);
    assert.equal(r.decks.length, 2, "resealing does not add a deck");
    const p2 = await sql<{ deck: string }>`select deck from veil_profiles where address = ${W}`;
    assert.equal(p2[0]!.deck, deckOf("goblin", 2).join(","));
  });

  it("caps decks per wallet", async () => {
    const seals: Faction[] = ["elf", "robot", "demon", "veil", "elf", "robot"];
    let last;
    for (let i = 0; i < seals.length; i++)
      last = await sealDeck(
        sql,
        W,
        { name: `Deck ${i}`, cards: deckOf(seals[i]!, i >= 4 ? 3 : 0) },
        yes,
      );
    assert.ok(last && "error" in last && last.error.includes(String(MAX_DECKS)));
    assert.equal((await listDecks(sql, W)).length, MAX_DECKS);
  });

  it("unsealing the active deck promotes the oldest remaining one; other wallets cannot touch it", async () => {
    const list = await listDecks(sql, W);
    const active = list.find((d) => d.active)!;
    assert.deepEqual(
      await unsealDeck(sql, "0x00000000000000000000000000000000000000ff", active.id),
      { error: "Unknown deck." },
    );
    assert.deepEqual(await activateDeck(sql, W, "dk'; drop table veil_decks; --"), {
      error: "Unknown deck.",
    });
    const r = await unsealDeck(sql, W, active.id);
    assert.ok("decks" in r);
    assert.equal(r.decks.length, MAX_DECKS - 1);
    assert.equal(r.decks.find((d) => d.active)!.id, r.decks[0]!.id);
  });

  it("an older client saving straight into veil_profiles.deck is adopted, not lost", async () => {
    const cards = deckOf("demon", 4).join(",");
    await sql`update veil_profiles set deck = ${cards}, deck_name = ${"Legacy Save"} where address = ${W}`;
    await reconcileDecks(sql, W);
    const active = (await listDecks(sql, W)).find((d) => d.active)!;
    assert.equal(active.name, "Legacy Save");
    assert.equal(active.cards.join(","), cards);
  });

  it("per-deck record counts server results played with exactly those cards", async () => {
    const active = (await listDecks(sql, W)).find((d) => d.active)!;
    const shuffled = [...active.cards].reverse();
    await applyRoomResult(
      sql,
      {
        roomId: "dk-r1",
        address: W,
        win: true,
        turns: 9,
        conceded: false,
        vsBot: true,
        faction: "demon",
        deck: shuffled,
      },
      { win: 20, loss: 10 },
    );
    await applyRoomResult(
      sql,
      {
        roomId: "dk-r2",
        address: W,
        win: false,
        turns: 9,
        conceded: false,
        vsBot: true,
        faction: "demon",
        deck: active.cards,
      },
      { win: 20, loss: 10 },
    );
    await applyRoomResult(
      sql,
      {
        roomId: "dk-r3",
        address: W,
        win: true,
        turns: 9,
        conceded: false,
        vsBot: true,
        faction: "human",
        deck: null,
      },
      { win: 20, loss: 10 },
    );
    const again = (await listDecks(sql, W)).find((d) => d.id === active.id)!;
    assert.deepEqual(again.record, { games: 2, wins: 1 });
    assert.equal(deckKey(["b", "a"]), deckKey("a,b"));
  });
});
