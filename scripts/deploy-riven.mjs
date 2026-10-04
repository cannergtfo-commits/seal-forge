import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData, formatEther, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import solc from "solc";

const META = "https://raw.githubusercontent.com/cannergtfo-commits/veilforge-riven/48c6f2913930d4c0a58e109561136f3594d6b4a9/meta";
const FACTION = { elf: 1, human: 2, goblin: 3, robot: 4, demon: 5, veil: 6 };
const RARITY = { basic: 1, rare: 2, legendary: 3 };
const BZB = "0x462d8d82c2b2d2ddabf7f8a93928de09d47a5807";
const REWARDS = "0xc802dd850fc3ada4ebc6075300d73df0aec665cf";
const KEEPER = "0x80f59AEa437654AA3F6AA449248311264e2Bf81d";
const transport = http("https://polygon-bor-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: polygon, transport });
const { key } = JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8"));
const account = privateKeyToAccount(key);
if (getAddress(account.address) !== getAddress(KEEPER)) throw new Error("deployer is not the keeper");
const wallet = createWalletClient({ account, chain: polygon, transport });

function compile(name) {
  const input = {
    language: "Solidity",
    sources: { [`${name}.sol`]: { content: readFileSync(`contracts/${name}.sol`, "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((error) => error.severity === "error");
  if (errors.length) {
    for (const error of errors) console.error(error.formattedMessage);
    throw new Error(`compile ${name} failed`);
  }
  const contract = output.contracts[`${name}.sol`][name];
  const artifact = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
  writeFileSync(`contracts/out/${name}.json`, JSON.stringify(artifact));
  console.log("compiled", name, artifact.bytecode.length);
  return artifact;
}

const editionArt = compile("VeilEdition");
const packsArt = compile("VeilRivenPacks");
const blazarArt = JSON.parse(readFileSync("contracts/out/VeilBlazarPacks.json", "utf8"));
if (packsArt.bytecode === blazarArt.bytecode) throw new Error("riven pack bytecode matches blazar; constants were not changed");
if (!packsArt.bytecode.includes("d02ab486cedc0000")) throw new Error("15 BzB constant missing from pack bytecode");

const manifest = JSON.parse(readFileSync("public/meta/riven/manifest.json", "utf8"));
if (manifest.cards.length !== 90) throw new Error(`card list mismatch ${manifest.cards.length}`);
const tally = {};
for (const card of manifest.cards) {
  tally[card.faction] ??= { basic: 0, rare: 0, legendary: 0 };
  tally[card.faction][card.rarity] += 1;
}
for (const [faction, counts] of Object.entries(tally)) {
  if (counts.basic !== 10 || counts.rare !== 4 || counts.legendary !== 1) throw new Error(`${faction} rarity ${JSON.stringify(counts)}`);
}

const seals = manifest.cards.map((card) => {
  const bytes = readFileSync(`public/assets/veil/cards/${card.id}.jpg`);
  const hash = `0x${createHash("sha256").update(bytes).digest("hex")}`;
  if (hash !== card.imageHash) throw new Error(`local hash drift ${card.id}`);
  const meta = JSON.parse(readFileSync(`public/meta/riven/${card.tokenId}.json`, "utf8"));
  if (!meta.image.startsWith("https://") || !meta.image.endsWith(`/cards/${card.id}.jpg`)) throw new Error(`image not hosted for ${card.id}`);
  return { id: card.tokenId, card, hash, uri: `${META}/${card.tokenId}.json`, meta };
});

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

await pool(seals, 6, async (seal) => {
  let live;
  for (let attempt = 0; attempt < 4; attempt++) {
    live = await fetch(seal.uri);
    if (live.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  if (!live?.ok) throw new Error(`metadata not live ${seal.uri}`);
  const liveMeta = await live.json();
  if (liveMeta.image !== seal.meta.image || liveMeta.name !== seal.meta.name) throw new Error(`hosted metadata drifted ${seal.id}`);
  let image;
  for (let attempt = 0; attempt < 4; attempt++) {
    image = await fetch(liveMeta.image);
    if (image.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  if (!image?.ok) throw new Error(`hosted image missing ${seal.card.id}`);
  const liveBytes = Buffer.from(await image.arrayBuffer());
  const liveHash = createHash("sha256").update(liveBytes).digest("hex");
  if (liveHash !== seal.hash.slice(2)) throw new Error(`hosted image does not match ${seal.card.id}`);
});
console.log("hosted images match", seals.length);

function saved(name) {
  const path = `/tmp/${name}.txt`;
  return existsSync(path) ? readFileSync(path, "utf8").trim() : "";
}

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

async function fees() {
  const block = await publicClient.getBlock();
  const base = block.baseFeePerGas ?? 30_000_000_000n;
  const tip = 40_000_000_000n;
  return { maxFeePerGas: (base * 13n) / 10n + tip, maxPriorityFeePerGas: tip };
}

async function send(request) {
  const priced = await fees();
  const prepared = await wallet.prepareTransactionRequest({ ...request, ...priced });
  const floor = 450_000n;
  const gas = prepared.gas > floor ? (prepared.gas * 12n) / 10n : floor;
  const signed = await wallet.prepareTransactionRequest({ ...request, ...priced, gas });
  const serialized = await wallet.signTransaction(signed);
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
  if (receipt.status !== "success") throw new Error(`reverted ${hash} gas ${receipt.gasUsed}`);
  return receipt;
}

async function guard() {
  const balance = await publicClient.getBalance({ address: account.address });
  console.log("keeper", formatEther(balance), "POL");
  if (balance < 400_000_000_000_000_000n) throw new Error(`keeper low ${formatEther(balance)} POL`);
}

const editionAddress = process.env.EDITION || saved("riven-edition");
const edition = editionAddress
  ? { abi: editionArt.abi, address: getAddress(editionAddress) }
  : await (async () => {
      await guard();
      const priced = await fees();
      const hash = await wallet.deployContract({ abi: editionArt.abi, bytecode: editionArt.bytecode, args: [90n], account, ...priced });
      console.log("edition tx", hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("edition deploy failed");
      console.log("VeilEdition", receipt.contractAddress);
      writeFileSync("/tmp/riven-edition.txt", receipt.contractAddress);
      return { abi: editionArt.abi, address: receipt.contractAddress };
    })();
console.log("using edition", edition.address);

for (const seal of seals) {
  const bound = await read({ address: edition.address, abi: editionArt.abi, functionName: "bound", args: [BigInt(seal.id)] });
  if (bound) continue;
  await guard();
  console.log("sealing", seal.id, seal.card.id);
  const data = encodeFunctionData({
    abi: editionArt.abi,
    functionName: "seal",
    args: [BigInt(seal.id), FACTION[seal.card.faction], RARITY[seal.card.rarity], seal.hash, seal.uri],
  });
  await send({ to: edition.address, data });
}

const packsAddress = process.env.RIVEN_PACKS || saved("riven-packs");
const packs = packsAddress
  ? { abi: packsArt.abi, address: getAddress(packsAddress) }
  : await (async () => {
      await guard();
      const priced = await fees();
      const hash = await wallet.deployContract({
        abi: packsArt.abi,
        bytecode: packsArt.bytecode,
        args: [edition.address, BZB, REWARDS, 90n],
        account,
        ...priced,
      });
      console.log("packs tx", hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
      if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("pack deploy failed");
      console.log("Riven packs", receipt.contractAddress);
      writeFileSync("/tmp/riven-packs.txt", receipt.contractAddress);
      return { abi: packsArt.abi, address: receipt.contractAddress };
    })();
console.log("using packs", packs.address);

const minter = await read({ address: edition.address, abi: editionArt.abi, functionName: "minter" });
if (minter === "0x0000000000000000000000000000000000000000") {
  await guard();
  const data = encodeFunctionData({ abi: editionArt.abi, functionName: "setMinter", args: [packs.address] });
  await send({ to: edition.address, data });
}
const frozen = await read({ address: edition.address, abi: editionArt.abi, functionName: "frozen" });
if (!frozen) {
  await guard();
  const data = encodeFunctionData({ abi: editionArt.abi, functionName: "freeze", args: [] });
  await send({ to: edition.address, data });
}

const image = await read({ address: edition.address, abi: editionArt.abi, functionName: "imageOf", args: [1n] });
const uri = await read({ address: edition.address, abi: editionArt.abi, functionName: "uri", args: [1n] });
const price = await read({ address: packs.address, abi: packsArt.abi, functionName: "PRICE" });
const cap = await read({ address: packs.address, abi: packsArt.abi, functionName: "MAX_PACKS" });
const owner = await read({ address: edition.address, abi: editionArt.abi, functionName: "owner" });
const sealedMinter = await read({ address: edition.address, abi: editionArt.abi, functionName: "minter" });
const count = await read({ address: packs.address, abi: packsArt.abi, functionName: "cardCount" });
const lastBound = await read({ address: edition.address, abi: editionArt.abi, functionName: "bound", args: [90n] });
if (image.toLowerCase() !== seals[0].hash.toLowerCase()) throw new Error("sealed hash mismatch");
if (uri !== seals[0].uri) throw new Error(`uri not hosted ${uri}`);
if (price !== 15_000_000_000_000_000_000n) throw new Error("price is not 15 BzB");
if (cap !== 2000n) throw new Error("cap is not 2000");
if (count !== 90n) throw new Error("card count is not 90");
if (!lastBound) throw new Error("card 90 was not sealed");
if (owner !== "0x0000000000000000000000000000000000000000") throw new Error("edition was not frozen");
if (sealedMinter.toLowerCase() !== packs.address.toLowerCase()) throw new Error("minter was not the pack contract");
console.log("RIVEN_NFT", edition.address);
console.log("RIVEN_PACKS", packs.address);
