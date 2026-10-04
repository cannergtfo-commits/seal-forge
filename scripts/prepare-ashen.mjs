import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SEAL = { elf: "Aureth", human: "Veymar", goblin: "Rixen", robot: "Quorin", demon: "Malrec", veil: "Unbound" };
const art = (process.env.ASHEN_ART ?? "").replace(/\/$/, "");
const source = readFileSync("src/veil/ashen.ts", "utf8");
const cards = [];
for (const line of source.split("\n")) {
  const id = line.match(/id: "([^"]+)"/)?.[1];
  if (!id?.startsWith("as-")) continue;
  const pick = (key) => line.match(new RegExp(`${key}: "([^"]*)"`))?.[1];
  const num = (key) => Number(line.match(new RegExp(`${key}: (\\d+)`))?.[1]);
  cards.push({
    id,
    name: pick("name"),
    faction: pick("faction"),
    kind: pick("kind"),
    cost: num("cost"),
    atk: num("atk"),
    hp: num("hp"),
    rarity: pick("rarity"),
    text: pick("text"),
  });
}
if (cards.length !== 36) throw new Error(`expected 36 cards, got ${cards.length}`);
const tally = {};
for (const card of cards) {
  tally[card.faction] ??= { basic: 0, rare: 0, legendary: 0 };
  tally[card.faction][card.rarity] += 1;
}
for (const [faction, counts] of Object.entries(tally)) {
  if (counts.basic !== 4 || counts.rare !== 1 || counts.legendary !== 1) throw new Error(`${faction} ${JSON.stringify(counts)}`);
}
const bytes = cards.map((card) => readFileSync(`public/assets/veil/cards/${card.id}.jpg`));
for (const file of bytes) {
  if (file[0] !== 0xff || file[1] !== 0xd8) throw new Error("not a jpeg");
}
if (!art) {
  console.log(`parsed ${cards.length} ashen cards, art host not set`);
  process.exit(0);
}
mkdirSync("public/meta/ashen", { recursive: true });
const manifest = [];
cards.forEach((card, index) => {
  const tokenId = index + 1;
  const hash = createHash("sha256").update(bytes[index]).digest("hex");
  const image = `${art}/cards/${card.id}.jpg`;
  const meta = {
    name: card.name,
    description: card.text,
    image,
    attributes: [
      { trait_type: "Seal", value: SEAL[card.faction] },
      { trait_type: "Set", value: "Ashen Veil" },
      { trait_type: "Rarity", value: card.rarity },
      { trait_type: "Kind", value: card.kind },
      { trait_type: "Cost", value: card.cost },
      { trait_type: "Attack", value: card.atk },
      { trait_type: "Health", value: card.hp },
    ],
  };
  writeFileSync(`public/meta/ashen/${tokenId}.json`, JSON.stringify(meta));
  manifest.push({ tokenId, id: card.id, faction: card.faction, rarity: card.rarity, imageHash: `0x${hash}` });
});
writeFileSync("public/meta/ashen/manifest.json", JSON.stringify({ art, cards: manifest }, null, 2));
console.log(`prepared ${cards.length} ashen metadata files`);
