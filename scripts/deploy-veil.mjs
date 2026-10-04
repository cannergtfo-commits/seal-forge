import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { CARDS } from "../src/veil/cards.ts";

const FACTION = { elf: 1, human: 2, goblin: 3, robot: 4, demon: 5 };
const RARITY = { common: 1, uncommon: 2, rare: 3 };
const BZB = "0x462d8d82c2b2d2ddabf7f8a93928de09d47a5807";
const transport = http("https://polygon-bor-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: polygon, transport });
const { key } = JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8"));
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain: polygon, transport });

function artifact(name) {
  return JSON.parse(readFileSync(`contracts/out/${name}.json`, "utf8"));
}

async function send(request) {
  const hash = await wallet.sendTransaction(request);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`reverted ${hash}`);
  return receipt;
}

async function deploy(name, args) {
  const { abi, bytecode } = artifact(name);
  const hash = await wallet.deployContract({ abi, bytecode, args, account });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy ${name} failed`);
  console.log(name, receipt.contractAddress);
  return { abi, address: receipt.contractAddress };
}

const core = CARDS.filter((card) => card.edition === "core");
if (core.length !== 45) throw new Error(`expected 45 core cards, got ${core.length}`);
const cardsArt = artifact("VeilCards");
const cards = process.env.CARDS
  ? { abi: cardsArt.abi, address: process.env.CARDS }
  : await deploy("VeilCards", []);
console.log("using cards", cards.address);

for (let index = 0; index < core.length; index++) {
  const card = core[index];
  const id = index + 1;
  const file = `public/assets/veil/cards/${card.id}.jpg`;
  const bytes = readFileSync(file);
  const hash = `0x${createHash("sha256").update(bytes).digest("hex")}`;
  const meta = {
    name: card.name,
    description: card.text,
    image_sha256: hash.slice(2),
    file: `cards/${card.id}.jpg`,
  };
  const tokenUri = `data:application/json;base64,${Buffer.from(JSON.stringify(meta)).toString("base64")}`;
  const data = encodeFunctionData({
    abi: cardsArt.abi,
    functionName: "seal",
    args: [BigInt(id), FACTION[card.faction], RARITY[card.rarity], hash, tokenUri],
  });
  await send({ to: cards.address, data });
  if (id % 9 === 0) console.log("sealed", id);
}

const rewards = await deploy("VeilRewards", [BZB, account.address]);
const packs = await deploy("VeilPacks", [cards.address, BZB, rewards.address]);
const market = await deploy("VeilMarket", [cards.address, BZB]);

const minterData = encodeFunctionData({ abi: cardsArt.abi, functionName: "setMinter", args: [packs.address] });
await send({ to: cards.address, data: minterData });
const freezeData = encodeFunctionData({ abi: cardsArt.abi, functionName: "freeze", args: [] });
await send({ to: cards.address, data: freezeData });

const frozen = await publicClient.readContract({ address: cards.address, abi: cardsArt.abi, functionName: "frozen" });
const owner = await publicClient.readContract({ address: cards.address, abi: cardsArt.abi, functionName: "owner" });
const minter = await publicClient.readContract({ address: cards.address, abi: cardsArt.abi, functionName: "minter" });
const image = await publicClient.readContract({ address: cards.address, abi: cardsArt.abi, functionName: "imageOf", args: [1n] });
if (frozen !== true || owner !== "0x0000000000000000000000000000000000000000" || minter.toLowerCase() !== packs.address.toLowerCase()) {
  throw new Error("freeze check failed");
}
console.log("image1", image);

const deployed = `export const BZB = "${BZB}" as const;
export const CARDS_NFT = "${cards.address}" as const;
export const REWARDS = "${rewards.address}" as const;
export const PACKS = "${packs.address}" as const;
export const MARKET = "${market.address}" as const;
export const KEEPER = "${account.address}" as const;
export const WIN_WEI = 250_000_000_000_000_000n;
export const FORGE_WEI = 1_000_000_000_000_000_000n;
export const SEAL_WEI = 1_250_000_000_000_000_000n;
export const DAILY_WINS = 4;
`;
writeFileSync("src/veil/deployed.ts", deployed);
console.log("wrote deployed.ts");
