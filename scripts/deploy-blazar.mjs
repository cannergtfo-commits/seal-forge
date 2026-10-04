import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const META = "https://raw.githubusercontent.com/cannergtfo-commits/veilforge-blazar/1ddaaab2d3639718f2651bebe19b1430fdd42952/meta";
const FACTION = { elf: 1, human: 2, goblin: 3, robot: 4, demon: 5, veil: 6 };
const RARITY = { basic: 1, common: 1, uncommon: 1, rare: 2, legendary: 3 };
const BZB = "0x462d8d82c2b2d2ddabf7f8a93928de09d47a5807";
const REWARDS = "0xc802dd850fc3ada4ebc6075300d73df0aec665cf";
const CARDS_NFT = "0x0b5f3665f030991324d43594b1e7a5ab37e5894c";
const PACKS = "0xa12253756d62aae065cb590dd29dbf7480a68b85";
const MARKET = "0x27caeb107e31b081e2efc94d311d845200c2c896";
const transport = http("https://polygon-bor-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: polygon, transport });
const { key } = JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8"));
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: polygon, transport });

function artifact(name) {
  return JSON.parse(readFileSync(`contracts/out/${name}.json`, "utf8"));
}

function parse(section) {
  const out = [];
  const re = /id: "([^"]+)"[\s\S]*?name: "([^"]+)"[\s\S]*?faction: "([^"]+)"[\s\S]*?kind: "([^"]+)"[\s\S]*?cost: (\d+)[\s\S]*?atk: (\d+)[\s\S]*?hp: (\d+)[\s\S]*?rarity: "([^"]+)"[\s\S]*?set: "([^"]+)"[\s\S]*?text: "([^"]*)"/g;
  for (const match of section.matchAll(re)) {
    out.push({ id: match[1], faction: match[3], rarity: match[8], set: match[9] });
  }
  return out;
}

const source = readFileSync("src/veil/blazar.ts", "utf8");
const [blazarSrc, unboundSrc] = source.split("export const UNBOUND_RAW");
const cards = [...parse(blazarSrc), ...parse(unboundSrc)];
if (cards.length !== 44 || cards.filter((card) => card.set === "blazar").length !== 36) {
  throw new Error(`card list mismatch ${cards.length}`);
}

const seals = cards.map((card, index) => {
  const id = index + 1;
  const file = `public/assets/veil/cards/${card.id}.jpg`;
  const bytes = readFileSync(file);
  const meta = JSON.parse(readFileSync(`public/meta/blazar/${id}.json`, "utf8"));
  if (!meta.image.startsWith("https://") || !meta.image.endsWith(`/${card.id}.jpg`)) throw new Error(`image not hosted for ${card.id}`);
  return {
    id,
    card,
    hash: `0x${createHash("sha256").update(bytes).digest("hex")}`,
    uri: `${META}/${id}.json`,
    bytes,
  };
});

const live = await fetch(seals[0].uri);
if (!live.ok) throw new Error(`metadata not live ${seals[0].uri}`);
const liveMeta = await live.json();
if (liveMeta.image !== JSON.parse(readFileSync("public/meta/blazar/1.json", "utf8")).image) throw new Error("hosted metadata drifted");
const liveImage = await fetch(liveMeta.image);
if (!liveImage.ok) throw new Error("hosted image missing");
const liveBytes = Buffer.from(await liveImage.arrayBuffer());
if (createHash("sha256").update(liveBytes).digest("hex") !== seals[0].hash.slice(2)) throw new Error("hosted image does not match the local file");
console.log("hosted image matches", seals[0].card.id);

async function read(args) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await publicClient.readContract(args);
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
  throw last;
}

async function send(request) {
  const fees = await publicClient.estimateFeesPerGas();
  const prepared = await wallet.prepareTransactionRequest({
    ...request,
    maxFeePerGas: fees.maxFeePerGas * 2n,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas * 2n,
  });
  const serialized = await wallet.signTransaction(prepared);
  let hash = "";
  for (const url of ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"]) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [serialized] }),
    });
    const body = await res.json();
    if (body.result) hash = body.result;
    else console.log(url, body.error?.message ?? "no hash");
  }
  if (!hash) throw new Error("broadcast failed");
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 2_000 });
  if (receipt.status !== "success") throw new Error(`reverted ${hash}`);
  return receipt;
}

const editionArt = artifact("VeilEdition");
const edition = process.env.EDITION
  ? { abi: editionArt.abi, address: process.env.EDITION }
  : await (async () => {
      const hash = await wallet.deployContract({ abi: editionArt.abi, bytecode: editionArt.bytecode, args: [44n], account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("edition deploy failed");
      console.log("VeilEdition", receipt.contractAddress);
      return { abi: editionArt.abi, address: receipt.contractAddress };
    })();

for (const seal of seals) {
  const bound = await read({ address: edition.address, abi: editionArt.abi, functionName: "bound", args: [BigInt(seal.id)] });
  if (bound) continue;
  console.log("sealing", seal.id, seal.card.id);
  const data = encodeFunctionData({
    abi: editionArt.abi,
    functionName: "seal",
    args: [BigInt(seal.id), FACTION[seal.card.faction], RARITY[seal.card.rarity], seal.hash, seal.uri],
  });
  await send({ to: edition.address, data });
  if (seal.id % 11 === 0) console.log("sealed", seal.id);
}

const packsArt = artifact("VeilBlazarPacks");
const packs = process.env.BLAZAR_PACKS
  ? { abi: packsArt.abi, address: process.env.BLAZAR_PACKS }
  : await (async () => {
      const hash = await wallet.deployContract({
        abi: packsArt.abi,
        bytecode: packsArt.bytecode,
        args: [edition.address, BZB, REWARDS, 36n],
        account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("pack deploy failed");
      console.log("VeilBlazarPacks", receipt.contractAddress);
      return { abi: packsArt.abi, address: receipt.contractAddress };
    })();

const minter = await read({ address: edition.address, abi: editionArt.abi, functionName: "minter" });
if (minter === "0x0000000000000000000000000000000000000000") {
  const data = encodeFunctionData({ abi: editionArt.abi, functionName: "setMinter", args: [packs.address] });
  await send({ to: edition.address, data });
}
const frozen = await read({ address: edition.address, abi: editionArt.abi, functionName: "frozen" });
if (!frozen) {
  const data = encodeFunctionData({ abi: editionArt.abi, functionName: "freeze", args: [] });
  await send({ to: edition.address, data });
}

const image = await read({ address: edition.address, abi: editionArt.abi, functionName: "imageOf", args: [1n] });
const uri = await read({ address: edition.address, abi: editionArt.abi, functionName: "uri", args: [1n] });
const price = await read({ address: packs.address, abi: packsArt.abi, functionName: "PRICE" });
const owner = await read({ address: edition.address, abi: editionArt.abi, functionName: "owner" });
const sealedMinter = await read({ address: edition.address, abi: editionArt.abi, functionName: "minter" });
if (image.toLowerCase() !== seals[0].hash.toLowerCase()) throw new Error("sealed hash mismatch");
if (!uri.startsWith("https://") || !uri.includes("/meta/1.json")) throw new Error(`uri not hosted ${uri}`);
if (price !== 10_000_000_000_000_000_000n) throw new Error("price is not 10 BzB");
if (owner !== "0x0000000000000000000000000000000000000000") throw new Error("edition was not frozen");
if (sealedMinter.toLowerCase() !== packs.address.toLowerCase()) throw new Error("minter was not the pack contract");

const deployed = `export const BZB = "${BZB}" as const;
export const CARDS_NFT = "${CARDS_NFT}" as const;
export const REWARDS = "${REWARDS}" as const;
export const PACKS = "${PACKS}" as const;
export const MARKET = "${MARKET}" as const;
export const KEEPER = "${account.address}" as const;
export const BLAZAR_NFT = "${edition.address}" as const;
export const BLAZAR_PACKS = "${packs.address}" as const;
export const WIN_WEI = 250_000_000_000_000_000n;
export const FORGE_WEI = 1_000_000_000_000_000_000n;
export const SEAL_WEI = 1_250_000_000_000_000_000n;
export const BLAZAR_WEI = 10_000_000_000_000_000_000n;
export const DAILY_WINS = 4;
`;
writeFileSync("src/veil/deployed.ts", deployed);
console.log("sealed", edition.address, "packs", packs.address);
