import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, encodeDeployData, formatEther, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import solc from "solc";

const BZB = "0x462d8d82c2b2d2ddabf7f8a93928de09d47a5807";
const KEEPER = "0x80f59AEa437654AA3F6AA449248311264e2Bf81d";
const CARDS = "0x7a8adc62073798df9d7e7fd856cbb30ee3ca5e8a";
const BLAZAR = "0x6759b66ed009e655c25369bb2a23d3337b6f7dce";
const KAGE = "0xfd0da17ec51b3f364e71f7aaa54e570368d03053";
const RIVEN = "0x0fd14e4b3ed44230456299b53f1f879a58c3299a";
const progressPath = "contracts/out/bazaar-ashen-progress.json";
const transport = http("https://polygon-bor-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: polygon, transport });
const { key } = JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8"));
const account = privateKeyToAccount(key);
if (getAddress(account.address) !== getAddress(KEEPER)) throw new Error("deployer is not the keeper");
const wallet = createWalletClient({ account, chain: polygon, transport });

function compile() {
  const input = {
    language: "Solidity",
    sources: { "VeilBazaar.sol": { content: readFileSync("contracts/VeilBazaar.sol", "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((error) => error.severity === "error");
  if (errors.length) {
    for (const error of errors) console.error(error.formattedMessage);
    throw new Error("compile VeilBazaar failed");
  }
  const contract = output.contracts["VeilBazaar.sol"].VeilBazaar;
  const artifact = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
  writeFileSync("contracts/out/VeilBazaar.json", JSON.stringify(artifact));
  console.log("compiled VeilBazaar", artifact.bytecode.length);
  return artifact;
}

const artifact = compile();
const progress = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : {};

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

async function deploy() {
  const fees = await publicClient.estimateFeesPerGas();
  const request = await wallet.prepareTransactionRequest({
    data: encodeDeployData({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
      args: [BLAZAR, KAGE, RIVEN, BZB],
    }),
    maxFeePerGas: fees.maxFeePerGas * 2n,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas * 2n,
  });
  const serialized = await wallet.signTransaction(request);
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
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed ${hash}`);
  return receipt.contractAddress;
}

const pol = await publicClient.getBalance({ address: account.address });
console.log("keeper", account.address, formatEther(pol), "POL");
if (pol < 20_000_000_000_000_000n) throw new Error("keeper POL is too low to deploy");

if (!progress.bazaar) {
  progress.bazaar = await deploy();
  writeFileSync(progressPath, JSON.stringify(progress, null, 2));
  console.log("VeilBazaar", progress.bazaar);
}

const address = getAddress(progress.bazaar);
const abi = artifact.abi;
const [blazar, kage, riven, bzb, length, allowBlazar, allowKage, allowRiven, allowFounding, allowZero] = await Promise.all([
  read({ address, abi, functionName: "blazar" }),
  read({ address, abi, functionName: "kage" }),
  read({ address, abi, functionName: "riven" }),
  read({ address, abi, functionName: "bzb" }),
  read({ address, abi, functionName: "length" }),
  read({ address, abi, functionName: "allowed", args: [BLAZAR] }),
  read({ address, abi, functionName: "allowed", args: [KAGE] }),
  read({ address, abi, functionName: "allowed", args: [RIVEN] }),
  read({ address, abi, functionName: "allowed", args: [CARDS] }),
  read({ address, abi, functionName: "allowed", args: [BZB] }),
]);
if (getAddress(blazar) !== getAddress(BLAZAR)) throw new Error("blazar collection mismatch");
if (getAddress(kage) !== getAddress(KAGE)) throw new Error("kage collection mismatch");
if (getAddress(riven) !== getAddress(RIVEN)) throw new Error("riven collection mismatch");
if (getAddress(bzb) !== getAddress(BZB)) throw new Error("bzb mismatch");
if (length !== 0n) throw new Error("bazaar is not empty");
if (!allowBlazar || !allowKage || !allowRiven) throw new Error("a set was not allowed");
if (allowFounding || allowZero) throw new Error("a foreign collection was allowed");

try {
  await publicClient.simulateContract({
    address,
    abi,
    functionName: "list",
    args: [CARDS, 1n, 10n ** 18n],
    account: account.address,
  });
  throw new Error("founding list should have reverted");
} catch (error) {
  if (error instanceof Error && error.message === "founding list should have reverted") throw error;
  console.log("founding list rejected");
}

const deployedPath = "src/veil/deployed.ts";
const source = readFileSync(deployedPath, "utf8");
const line = `export const BAZAAR = "${address}" as const;`;
const next = source.includes("export const BAZAAR")
  ? source.replace(/export const BAZAAR = "0x[0-9a-fA-F]+" as const;/, line)
  : source.replace('export const MARKET = "0x1399edefbe48ada0b9ed596b4391b8a51254a99e" as const;\n', `export const MARKET = "0x1399edefbe48ada0b9ed596b4391b8a51254a99e" as const;\n${line}\n`);
if (!next.includes(line)) throw new Error("could not write BAZAAR into deployed.ts");
writeFileSync(deployedPath, next);
console.log("recorded", address);
