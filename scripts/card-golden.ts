// Regenerates src/veil/__snapshots__/card-text.txt after a reviewed card change.
import { writeFileSync } from "node:fs";
import { CARDS } from "../src/veil/cards.ts";
import { goldenLine } from "../src/veil/card-text.ts";

const rows = CARDS.map(goldenLine);
writeFileSync(
  new URL("../src/veil/__snapshots__/card-text.txt", import.meta.url),
  rows.join("\n") + "\n",
);
console.log(`wrote ${rows.length} cards`);
