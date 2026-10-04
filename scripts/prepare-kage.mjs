import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const SEAL = { elf: "Aureth", human: "Veymar", goblin: "Rixen", robot: "Quorin", demon: "Malrec", veil: "Unbound" };
const origin = (process.env.VEIL_ORIGIN ?? "").replace(/\/$/, "");

const source = readFileSync("src/veil/kage.ts", "utf8");
const re = /id: "([^"]+)"[\s\S]*?name: "([^"]+)"[\s\S]*?faction: "([^"]+)"[\s\S]*?kind: "([^"]+)"[\s\S]*?cost: (\d+)[\s\S]*?atk: (\d+)[\s\S]*?hp: (\d+)[\s\S]*?rarity: "([^"]+)"[\s\S]*?text: "([^"]*)"/g;
const cards = [...source.matchAll(re)].map((match) => ({
  id: match[1],
  name: match[2],
  faction: match[3],
  kind: match[4],
  cost: Number(match[5]),
  atk: Number(match[6]),
  hp: Number(match[7]),
  rarity: match[8],
  text: match[9],
}));
if (cards.length !== 90) throw new Error(`expected 90 Kage cards, got ${cards.length}`);

mkdirSync("public/meta/kage", { recursive: true });
const manifest = [];
cards.forEach((card, index) => {
  const tokenId = index + 1;
  const file = `public/assets/veil/cards/${card.id}.jpg`;
  const bytes = readFileSync(file);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(`${card.id} is not a jpeg`);
  const size = jpegSize(bytes);
  if (size.width !== 700 || size.height !== 980) throw new Error(`${card.id} is ${size.width}x${size.height}`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const image = origin ? `${origin}/cards/${card.id}.jpg` : `/assets/veil/cards/${card.id}.jpg`;
  const meta = {
    name: card.name,
    description: card.text,
    image,
    attributes: [
      { trait_type: "Seal", value: SEAL[card.faction] },
      { trait_type: "Set", value: "Kage Veil" },
      { trait_type: "Rarity", value: card.rarity },
      { trait_type: "Kind", value: card.kind },
      { trait_type: "Cost", value: card.cost },
      { trait_type: "Attack", value: card.atk },
      { trait_type: "Health", value: card.hp },
    ],
  };
  writeFileSync(`public/meta/kage/${tokenId}.json`, JSON.stringify(meta));
  manifest.push({ tokenId, id: card.id, faction: card.faction, rarity: card.rarity, imageHash: `0x${hash}` });
});
writeFileSync("public/meta/kage/manifest.json", JSON.stringify({ origin, cards: manifest }, null, 2));
console.log(`prepared ${cards.length} kage metadata files${origin ? ` for ${origin}` : " locally"}`);

function jpegSize(bytes) {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("jpeg size missing");
}
