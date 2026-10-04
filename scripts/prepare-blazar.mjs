import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const FACTION = { elf: 1, human: 2, goblin: 3, robot: 4, demon: 5, veil: 6 };
const RARITY = { basic: 1, common: 1, uncommon: 1, rare: 2, legendary: 3 };
const origin = (process.env.VEIL_ORIGIN ?? "").replace(/\/$/, "");

function parse(section) {
  const out = [];
  const re = /id: "([^"]+)"[\s\S]*?name: "([^"]+)"[\s\S]*?faction: "([^"]+)"[\s\S]*?kind: "([^"]+)"[\s\S]*?cost: (\d+)[\s\S]*?atk: (\d+)[\s\S]*?hp: (\d+)[\s\S]*?rarity: "([^"]+)"[\s\S]*?set: "([^"]+)"[\s\S]*?text: "([^"]+)"/g;
  for (const match of section.matchAll(re)) {
    out.push({
      id: match[1],
      name: match[2],
      faction: match[3],
      kind: match[4],
      cost: Number(match[5]),
      atk: Number(match[6]),
      hp: Number(match[7]),
      rarity: match[8],
      set: match[9],
      text: match[10],
    });
  }
  return out;
}

const source = readFileSync("src/veil/blazar.ts", "utf8");
const [blazarSrc, unboundSrc] = source.split("export const UNBOUND_RAW");
const blazar = parse(blazarSrc);
const unbound = parse(unboundSrc);
if (blazar.length !== 36) throw new Error(`expected 36 Blazar cards, got ${blazar.length}`);
if (unbound.length !== 8) throw new Error(`expected 8 founding unbound cards, got ${unbound.length}`);
const edition = [...blazar, ...unbound].map((card, index) => ({ ...card, tokenId: index + 1 }));
const BLAZAR_COUNT = blazar.length;

if (edition.length === 0 || edition[0].tokenId !== 1) throw new Error("blazar token ids must start at 1");
if (edition[BLAZAR_COUNT - 1]?.set !== "blazar") throw new Error("pack range must be Blazar Veil only");
for (let i = 0; i < edition.length; i++) {
  if (edition[i].tokenId !== i + 1) throw new Error(`token id gap at ${i + 1}`);
}

mkdirSync("public/meta/blazar", { recursive: true });
const manifest = [];

for (const card of edition) {
  const file = `public/assets/veil/cards/${card.id}.jpg`;
  const bytes = readFileSync(file);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(`${card.id} is not a jpeg`);
  const size = jpegSize(bytes);
  if (size.width !== 700 || size.height !== 980) throw new Error(`${card.id} is ${size.width}x${size.height}, want 700x980`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const image = `${origin || ""}/assets/veil/cards/${card.id}.jpg`;
  const meta = {
    name: card.name,
    description: card.text,
    image,
    attributes: [
      { trait_type: "Faction", value: card.faction },
      { trait_type: "Set", value: card.set === "blazar" ? "Blazar Veil" : "Founding" },
      { trait_type: "Rarity", value: card.rarity },
      { trait_type: "Kind", value: card.kind },
      { trait_type: "Cost", value: card.cost },
      { trait_type: "Attack", value: card.atk },
      { trait_type: "Health", value: card.hp },
    ],
  };
  writeFileSync(`public/meta/blazar/${card.tokenId}.json`, JSON.stringify(meta));
  manifest.push({
    tokenId: card.tokenId,
    id: card.id,
    faction: FACTION[card.faction],
    rarity: RARITY[card.rarity],
    imageHash: `0x${hash}`,
    file,
  });
}

writeFileSync("public/meta/blazar/manifest.json", JSON.stringify({ origin, blazarCount: BLAZAR_COUNT, cards: manifest }, null, 2));
if (!origin.startsWith("https://")) {
  console.log(`hosted ${edition.length} images and metadata locally. Set VEIL_ORIGIN to an https host before sealing the contract.`);
  process.exit(0);
}
console.log(`ready to seal ${edition.length} tokens against ${origin}. Pack range is 1..${BLAZAR_COUNT}.`);

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
