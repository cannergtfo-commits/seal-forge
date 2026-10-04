import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SEAL = { elf: "Aureth", human: "Veymar", goblin: "Rixen", robot: "Quorin", demon: "Malrec", veil: "Unbound" };
const FACTION = { Aureth: "elf", Veymar: "human", Rixen: "goblin", Quorin: "robot", Malrec: "demon", Unbound: "veil" };
const art = (process.env.RIVEN_ART ?? "").replace(/\/$/, "");
const md = readFileSync("src/veil/riven.md", "utf8");
const cards = [];
let faction = "";
for (const line of md.split("\n")) {
  const head = line.match(/^## (Aureth|Veymar|Rixen|Quorin|Malrec|Unbound)\s*$/);
  if (head) {
    faction = FACTION[head[1]];
    continue;
  }
  if (!line.startsWith("| rv-")) continue;
  const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
  if (cells.length !== 8) throw new Error(`bad row ${line}`);
  const [id, name, , kind, cost, stats, rarity, text] = cells;
  const [atk, hp] = stats === "—" ? [0, 0] : stats.split("/").map(Number);
  if (!faction || !["unit", "spell", "trap"].includes(kind)) throw new Error(`bad card ${id}`);
  if (!["basic", "rare", "legendary"].includes(rarity)) throw new Error(`bad rarity ${id}`);
  cards.push({ id, name, faction, kind, cost: Number(cost), atk, hp, rarity, text });
}
if (cards.length !== 90) throw new Error(`expected 90 cards, got ${cards.length}`);
for (const factionId of Object.keys(SEAL)) {
  const list = cards.filter((card) => card.faction === factionId);
  const tally = { basic: 0, rare: 0, legendary: 0 };
  for (const card of list) tally[card.rarity] += 1;
  if (list.length !== 15 || tally.basic !== 10 || tally.rare !== 4 || tally.legendary !== 1) {
    throw new Error(`${factionId} tally ${list.length} ${JSON.stringify(tally)}`);
  }
}
const bytes = cards.map((card) => readFileSync(`public/assets/veil/cards/${card.id}.jpg`));
for (const file of bytes) {
  if (file[0] !== 0xff || file[1] !== 0xd8) throw new Error("not a jpeg");
}
if (!art) {
  console.log(`parsed ${cards.length} riven cards, art host not set`);
  process.exit(0);
}
mkdirSync("public/meta/riven", { recursive: true });
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
      { trait_type: "Set", value: "Riven Veil" },
      { trait_type: "Rarity", value: card.rarity },
      { trait_type: "Kind", value: card.kind },
      { trait_type: "Cost", value: card.cost },
      { trait_type: "Attack", value: card.atk },
      { trait_type: "Health", value: card.hp },
    ],
  };
  writeFileSync(`public/meta/riven/${tokenId}.json`, JSON.stringify(meta));
  manifest.push({ tokenId, id: card.id, faction: card.faction, rarity: card.rarity, imageHash: `0x${hash}` });
});
writeFileSync("public/meta/riven/manifest.json", JSON.stringify({ art, cards: manifest }, null, 2));
console.log(`prepared ${cards.length} riven metadata files`);
