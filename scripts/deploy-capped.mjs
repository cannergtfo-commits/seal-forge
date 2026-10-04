import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import solc from "solc";

const OLD_CARDS = "0x0b5f3665f030991324d43594b1e7a5ab37e5894c";
const OLD_EDITION = "0x052ba2eb088edaf27570d4255d39a6e2ea91bb96";
const BZB = "0x462d8d82c2b2d2ddabf7f8a93928de09d47a5807";
const REWARDS = "0xc802dd850fc3ada4ebc6075300d73df0aec665cf";
const KEEPER = "0x80f59AEa437654AA3F6AA449248311264e2Bf81d";
const progressPath = "contracts/out/capped-progress.json";
const transport = http("https://polygon-bor-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: polygon, transport });
const { key } = JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8"));
const account = privateKeyToAccount(key);
if (account.address.toLowerCase() !== KEEPER.toLowerCase()) throw new Error("deployer is not the keeper");
const wallet = createWalletClient({ account, chain: polygon, transport });

function compile(name) {
  const input = {
    language: "Solidity",
    sources: { [`${name}.sol`]: { content: readFileSync(`contracts/${name}.sol`, "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
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

const viewAbi = [
  { type: "function", name: "uri", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "string" }] },
  { type: "function", name: "imageOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "factionOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "rarityOf", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "bound", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "frozen", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "minter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];

async function read(args) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await publicClient.readContract(args);
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 1200));
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

async function deploy(artifact, args) {
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, args, account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("deploy failed");
  return receipt.contractAddress;
}

async function loadSeals(address, count) {
  const seals = [];
  for (let id = 1; id <= count; id++) {
    const [uri, image, faction, rarity, bound] = await Promise.all([
      read({ address, abi: viewAbi, functionName: "uri", args: [BigInt(id)] }),
      read({ address, abi: viewAbi, functionName: "imageOf", args: [BigInt(id)] }),
      read({ address, abi: viewAbi, functionName: "factionOf", args: [BigInt(id)] }),
      read({ address, abi: viewAbi, functionName: "rarityOf", args: [BigInt(id)] }),
      read({ address, abi: viewAbi, functionName: "bound", args: [BigInt(id)] }),
    ]);
    if (!bound || image === `0x${"0".repeat(64)}` || faction === 0 || rarity === 0) throw new Error(`old seal ${id} on ${address} is incomplete`);
    seals.push({ id, uri, image, faction: Number(faction), rarity: Number(rarity) });
  }
  return seals;
}

function assertPools(seals, label) {
  for (const faction of [1, 2, 3, 4, 5]) {
    const basics = seals.filter((seal) => (seal.faction === faction || seal.faction === 6) && seal.rarity === 1);
    if (!basics.length) throw new Error(`${label} faction ${faction} has no basic card`);
  }
}

const cardsArt = compile("VeilCards");
const editionArt = compile("VeilEdition");
const packsArt = compile("VeilPacks");
const blazarArt = compile("VeilBlazarPacks");
const marketArt = compile("VeilMarket");

const progress = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : {};
function save() {
  writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

console.log("reading old seals");
const founding = await loadSeals(OLD_CARDS, 45);
const blazar = await loadSeals(OLD_EDITION, 44);
if (founding.some((seal) => seal.faction > 5 || !seal.uri.startsWith("data:application/json"))) throw new Error("founding metadata drifted");
if (blazar.some((seal) => !seal.uri.startsWith("https://raw.githubusercontent.com/cannergtfo-commits/veilforge-blazar/"))) throw new Error("blazar metadata is not the hosted set");
assertPools(founding, "founding");
assertPools(blazar, "blazar");
const sample = await fetch(blazar[0].uri);
if (!sample.ok) throw new Error("hosted blazar metadata is down");
const sampleMeta = await sample.json();
const imageRes = await fetch(sampleMeta.image);
if (!imageRes.ok) throw new Error("hosted blazar image is down");
console.log("old seals match", founding.length, blazar.length);

if (!progress.cards) {
  progress.cards = await deploy(cardsArt, []);
  console.log("VeilCards", progress.cards);
  save();
}
for (const seal of founding) {
  const bound = await read({ address: progress.cards, abi: viewAbi, functionName: "bound", args: [BigInt(seal.id)] });
  if (bound) continue;
  const data = encodeFunctionData({
    abi: cardsArt.abi,
    functionName: "seal",
    args: [BigInt(seal.id), seal.faction, seal.rarity, seal.image, seal.uri],
  });
  await send({ to: progress.cards, data });
  if (seal.id % 9 === 0) console.log("sealed founding", seal.id);
}
for (const seal of founding) {
  const [uri, image] = await Promise.all([
    read({ address: progress.cards, abi: viewAbi, functionName: "uri", args: [BigInt(seal.id)] }),
    read({ address: progress.cards, abi: viewAbi, functionName: "imageOf", args: [BigInt(seal.id)] }),
  ]);
  if (uri !== seal.uri || image.toLowerCase() !== seal.image.toLowerCase()) throw new Error(`founding seal mismatch ${seal.id}`);
}

if (!progress.packs) {
  progress.packs = await deploy(packsArt, [progress.cards, BZB, REWARDS]);
  console.log("VeilPacks", progress.packs);
  save();
}
const foundingMinter = await read({ address: progress.cards, abi: viewAbi, functionName: "minter" });
if (foundingMinter === "0x0000000000000000000000000000000000000000") {
  await send({ to: progress.cards, data: encodeFunctionData({ abi: cardsArt.abi, functionName: "setMinter", args: [progress.packs] }) });
}
if (!(await read({ address: progress.cards, abi: viewAbi, functionName: "frozen" }))) {
  await send({ to: progress.cards, data: encodeFunctionData({ abi: cardsArt.abi, functionName: "freeze", args: [] }) });
}

if (!progress.edition) {
  progress.edition = await deploy(editionArt, [44n]);
  console.log("VeilEdition", progress.edition);
  save();
}
for (const seal of blazar) {
  const bound = await read({ address: progress.edition, abi: viewAbi, functionName: "bound", args: [BigInt(seal.id)] });
  if (bound) continue;
  const data = encodeFunctionData({
    abi: editionArt.abi,
    functionName: "seal",
    args: [BigInt(seal.id), seal.faction, seal.rarity, seal.image, seal.uri],
  });
  await send({ to: progress.edition, data });
  if (seal.id % 11 === 0) console.log("sealed blazar", seal.id);
}
for (const seal of blazar) {
  const [uri, image] = await Promise.all([
    read({ address: progress.edition, abi: viewAbi, functionName: "uri", args: [BigInt(seal.id)] }),
    read({ address: progress.edition, abi: viewAbi, functionName: "imageOf", args: [BigInt(seal.id)] }),
  ]);
  if (uri !== seal.uri || image.toLowerCase() !== seal.image.toLowerCase()) throw new Error(`blazar seal mismatch ${seal.id}`);
}

if (!progress.blazarPacks) {
  progress.blazarPacks = await deploy(blazarArt, [progress.edition, BZB, REWARDS, 44n]);
  console.log("VeilBlazarPacks", progress.blazarPacks);
  save();
}
const blazarMinter = await read({ address: progress.edition, abi: viewAbi, functionName: "minter" });
if (blazarMinter === "0x0000000000000000000000000000000000000000") {
  await send({ to: progress.edition, data: encodeFunctionData({ abi: editionArt.abi, functionName: "setMinter", args: [progress.blazarPacks] }) });
}
if (!(await read({ address: progress.edition, abi: viewAbi, functionName: "frozen" }))) {
  await send({ to: progress.edition, data: encodeFunctionData({ abi: editionArt.abi, functionName: "freeze", args: [] }) });
}

if (!progress.market) {
  progress.market = await deploy(marketArt, [progress.cards, BZB]);
  console.log("VeilMarket", progress.market);
  save();
}

const capAbi = [
  { type: "function", name: "MAX_PACKS", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "remaining", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "sold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "cardCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewards", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
];
const foundingCap = await read({ address: progress.packs, abi: capAbi, functionName: "MAX_PACKS" });
const blazarCap = await read({ address: progress.blazarPacks, abi: capAbi, functionName: "MAX_PACKS" });
const foundingLeft = await read({ address: progress.packs, abi: capAbi, functionName: "remaining" });
const blazarLeft = await read({ address: progress.blazarPacks, abi: capAbi, functionName: "remaining" });
const cardCount = await read({ address: progress.blazarPacks, abi: capAbi, functionName: "cardCount" });
const rewards = await read({ address: progress.packs, abi: capAbi, functionName: "rewards" });
const frozenCards = await read({ address: progress.cards, abi: viewAbi, functionName: "frozen" });
const frozenEdition = await read({ address: progress.edition, abi: viewAbi, functionName: "frozen" });
const ownerCards = await read({ address: progress.cards, abi: viewAbi, functionName: "owner" });
const ownerEdition = await read({ address: progress.edition, abi: viewAbi, functionName: "owner" });
const minterCards = await read({ address: progress.cards, abi: viewAbi, functionName: "minter" });
const minterEdition = await read({ address: progress.edition, abi: viewAbi, functionName: "minter" });
if (foundingCap !== 10_000n || foundingLeft !== 10_000n) throw new Error("founding cap is not 10000");
if (blazarCap !== 1_000n || blazarLeft !== 1_000n) throw new Error("blazar cap is not 1000");
if (cardCount !== 44n) throw new Error("blazar draw range is not 44");
if (rewards.toLowerCase() !== REWARDS.toLowerCase()) throw new Error("rewards pool was not kept");
if (!frozenCards || !frozenEdition) throw new Error("a card contract is not frozen");
if (ownerCards !== "0x0000000000000000000000000000000000000000" || ownerEdition !== "0x0000000000000000000000000000000000000000") throw new Error("owner was not renounced");
if (minterCards.toLowerCase() !== progress.packs.toLowerCase()) throw new Error("founding minter is not the pack contract");
if (minterEdition.toLowerCase() !== progress.blazarPacks.toLowerCase()) throw new Error("blazar minter is not the pack contract");

const deployed = `export const BZB = "${BZB}" as const;
export const CARDS_NFT = "${progress.cards}" as const;
export const REWARDS = "${REWARDS}" as const;
export const PACKS = "${progress.packs}" as const;
export const MARKET = "${progress.market}" as const;
export const KEEPER = "${KEEPER}" as const;
export const BLAZAR_NFT = "${progress.edition}" as const;
export const BLAZAR_PACKS = "${progress.blazarPacks}" as const;
export const WIN_WEI = 250_000_000_000_000_000n;
export const FORGE_WEI = 1_000_000_000_000_000_000n;
export const SEAL_WEI = 1_250_000_000_000_000_000n;
export const BLAZAR_WEI = 10_000_000_000_000_000_000n;
export const DAILY_WINS = 4;
export const FOUNDING_PACK_CAP = 10_000;
export const BLAZAR_PACK_CAP = 1_000;
`;
writeFileSync("src/veil/deployed.ts", deployed);
console.log("verified and wrote deployed.ts");
console.log(JSON.stringify(progress, null, 2));
