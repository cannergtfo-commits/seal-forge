import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const META = "https://raw.githubusercontent.com/cannergtfo-commits/veilforge-kage/7b2562134b7dfb2dce745f89e13233d8adb3c0b9/meta";
const FACTION = { elf: 1, human: 2, goblin: 3, robot: 4, demon: 5, veil: 6 };
const RARITY = { basic: 1, rare: 2, legendary: 3 };
const BZB = "0x462d8d82c2b2d2ddabf7f8a93928de09d47a5807";
const REWARDS = "0xc802dd850fc3ada4ebc6075300d73df0aec665cf";
const transport = http("https://polygon-bor-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: polygon, transport });
const { key } = JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8"));
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: polygon, transport });

function artifact(name) {
  return JSON.parse(readFileSync(`contracts/out/${name}.json`, "utf8"));
}

const source = readFileSync("src/veil/kage.ts", "utf8");
const re = /id: "([^"]+)"[\s\S]*?faction: "([^"]+)"[\s\S]*?rarity: "([^"]+)"/g;
const cards = [...source.matchAll(re)].map((match) => ({ id: match[1], faction: match[2], rarity: match[3] }));
if (cards.length !== 90) throw new Error(`card list mismatch ${cards.length}`);

const seals = cards.map((card, index) => {
  const id = index + 1;
  const bytes = readFileSync(`public/assets/veil/cards/${card.id}.jpg`);
  const meta = JSON.parse(readFileSync(`public/meta/kage/${id}.json`, "utf8"));
  if (!meta.image.startsWith("https://") || !meta.image.endsWith(`/cards/${card.id}.jpg`)) throw new Error(`image not hosted for ${card.id}`);
  return { id, card, hash: `0x${createHash("sha256").update(bytes).digest("hex")}`, uri: `${META}/${id}.json` };
});

const live = await fetch(seals[0].uri);
if (!live.ok) throw new Error(`metadata not live ${seals[0].uri}`);
const liveMeta = await live.json();
if (liveMeta.image !== JSON.parse(readFileSync("public/meta/kage/1.json", "utf8")).image) throw new Error("hosted metadata drifted");
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
  const block = await publicClient.getBlock();
  const base = block.baseFeePerGas ?? 30_000_000_000n;
  const tip = 30_000_000_000n;
  const prepared = await wallet.prepareTransactionRequest({
    ...request,
    maxFeePerGas: base * 2n + tip,
    maxPriorityFeePerGas: tip,
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
      const hash = await wallet.deployContract({ abi: editionArt.abi, bytecode: editionArt.bytecode, args: [90n], account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("edition deploy failed");
      console.log("VeilEdition", receipt.contractAddress);
      writeFileSync("/tmp/kage-edition.txt", receipt.contractAddress);
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
}

const packsArt = artifact("VeilBlazarPacks");
const packs = process.env.KAGE_PACKS
  ? { abi: packsArt.abi, address: process.env.KAGE_PACKS }
  : await (async () => {
      const hash = await wallet.deployContract({
        abi: packsArt.abi,
        bytecode: packsArt.bytecode,
        args: [edition.address, BZB, REWARDS, 90n],
        account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("pack deploy failed");
      console.log("Kage packs", receipt.contractAddress);
      writeFileSync("/tmp/kage-packs.txt", receipt.contractAddress);
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
const cap = await read({ address: packs.address, abi: packsArt.abi, functionName: "MAX_PACKS" });
const owner = await read({ address: edition.address, abi: editionArt.abi, functionName: "owner" });
const sealedMinter = await read({ address: edition.address, abi: editionArt.abi, functionName: "minter" });
if (image.toLowerCase() !== seals[0].hash.toLowerCase()) throw new Error("sealed hash mismatch");
if (uri !== seals[0].uri) throw new Error(`uri not hosted ${uri}`);
if (price !== 10_000_000_000_000_000_000n) throw new Error("price is not 10 BzB");
if (cap !== 1000n) throw new Error("cap is not 1000");
if (owner !== "0x0000000000000000000000000000000000000000") throw new Error("edition was not frozen");
if (sealedMinter.toLowerCase() !== packs.address.toLowerCase()) throw new Error("minter was not the pack contract");
console.log("KAGE_NFT", edition.address);
console.log("KAGE_PACKS", packs.address);
