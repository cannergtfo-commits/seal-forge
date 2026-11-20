// Regenerates src/veil/__snapshots__/card-text.txt after a reviewed card change.
import { writeFileSync } from "node:fs";
import { CARDS } from "../src/veil/cards.ts";

const rows = CARDS.map(
  (card) =>
    `${card.id}\t${card.cost}\t${card.kind === "unit" ? `${card.atk}/${card.hp}` : "-"}\t${card.text}`,
);
writeFileSync(
  new URL("../src/veil/__snapshots__/card-text.txt", import.meta.url),
  rows.join("\n") + "\n",
);
console.log(`wrote ${rows.length} cards`);
