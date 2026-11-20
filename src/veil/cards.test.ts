import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARDS, cardOf } from "./cards.ts";
import { cardText, goldenLine, keywordsOf } from "./card-text.ts";
import { KEYWORDS } from "./keywords.ts";
import { PRINTED, printedDiff } from "./printed.ts";
import { EDITION_TOKENS, RESERVED_SETS, SETS, formatsOf } from "./sets.ts";
import { checkRules } from "./logic.ts";

const FACTION_CODE = { elf: 1, human: 2, goblin: 3, robot: 4, demon: 5, veil: 6 } as const;

/** Serializes the id-to-NFT mapping exactly like the frozen snapshot file. */
function tokenMap(): string {
  const lines = CARDS.map((card, index) =>
    JSON.stringify({
      index,
      id: card.id,
      edition: card.edition,
      tokenId: card.tokenId,
      chainFaction: FACTION_CODE[card.faction],
      chainRarity: card.chainRarity,
    }),
  );
  return `[\n${lines.join(",\n")}\n]\n`;
}

describe("NFT token ids", () => {
  it("map every card to the same token as origin/main f1fb618 and the chain, byte for byte", () => {
    const frozen = readFileSync(new URL("./__snapshots__/token-map.json", import.meta.url), "utf8");
    assert.equal(CARDS.length, 215);
    assert.equal(tokenMap(), frozen);
  });

  it("cover each edition's minted ids exactly once", () => {
    for (const [edition, count] of Object.entries(EDITION_TOKENS)) {
      const ids = CARDS.filter((card) => card.edition === edition)
        .map((card) => card.tokenId)
        .sort((a, b) => a - b);
      assert.deepEqual(
        ids,
        Array.from({ length: count }, (_, i) => i + 1),
        edition,
      );
    }
  });

  it("are literals in the card files, not derived from array order", () => {
    for (const file of ["cards.ts", "blazar.ts", "kage.ts", "ashen.ts"]) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      for (const line of source.split("\n")) {
        const id = line.match(/\{ id: "([^"]+)", /)?.[1];
        if (!id || !line.includes(' kind: "')) continue;
        const card = cardOf(id);
        assert.ok(line.includes(`tokenId: ${card.tokenId}, chainRarity: ${card.chainRarity},`), id);
      }
    }
  });

  it("keep a printed-metadata entry for every token", () => {
    assert.equal(Object.keys(PRINTED).length, 215);
    for (const card of CARDS) assert.ok(PRINTED[`${card.edition}:${card.tokenId}`], card.id);
  });
});

describe("sets and formats", () => {
  it("number sets 1-4 and reserve 5-6", () => {
    assert.deepEqual(
      SETS.map((set) => set.setNo),
      [1, 2, 3, 4],
    );
    assert.deepEqual(
      RESERVED_SETS.map((set) => set.setNo),
      [5, 6],
    );
    for (const card of CARDS) {
      assert.ok(
        !RESERVED_SETS.some((set) => card.id.startsWith(set.prefix)),
        `${card.id} uses a reserved prefix`,
      );
      assert.equal(card.setNo, SETS.find((set) => set.key === card.set)!.setNo);
      assert.ok(card.version >= 1);
    }
  });

  it("put every released card in Standard and Eternal until a fifth set exists", () => {
    for (const card of CARDS) assert.deepEqual(card.formats, ["standard", "eternal"]);
    assert.deepEqual(formatsOf("founding"), ["standard", "eternal"]);
  });
});

describe("card text", () => {
  it("is generated from the data", () => {
    for (const card of CARDS) assert.equal(card.text, cardText(card), card.id);
  });

  it("matches the reviewed golden file", () => {
    const golden = readFileSync(new URL("./__snapshots__/card-text.txt", import.meta.url), "utf8");
    const now = CARDS.map(goldenLine).join("\n") + "\n";
    assert.equal(
      now,
      golden,
      "card text or stats changed: run `npm run cards:golden` and review the diff",
    );
  });

  it("names only registered keywords", () => {
    for (const card of CARDS) for (const word of keywordsOf(card)) assert.ok(KEYWORDS[word.id]);
  });

  it("notes where the NFT metadata differs, and bumps the version on every rebalance", () => {
    const shield = cardOf("moonpetal");
    assert.deepEqual(
      printedDiff(shield).map((item) => item.field),
      ["text"],
    );
    for (const card of CARDS) {
      const stats = printedDiff(card).filter((item) => item.field !== "text");
      if (stats.length)
        assert.ok(
          card.version >= 2,
          `${card.id} changed ${stats.map((item) => item.field).join("/")} but is still version 1`,
        );
    }
  });
});

describe("rules", () => {
  it("pass checkRules()", () => {
    assert.equal(checkRules(), "ok");
  });
});
