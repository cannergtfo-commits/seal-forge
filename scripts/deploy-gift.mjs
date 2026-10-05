import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeDeployData, encodeFunctionData, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const BZB = getAddress("0x462d8d82c2b2d2ddabf7f8a93928de09d47a5807");
const PACKS = getAddress("0xa5f3b73e9c06b62a92b267320ecf85de46567407");
const KEEPER = getAddress("0x80f59AEa437654AA3F6AA449248311264e2Bf81d");
const transport = http("https://polygon-bor-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: polygon, transport });
const { key } = JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8"));
const account = privateKeyToAccount(key);
if (getAddress(account.address) !== KEEPER) throw new Error("deployer is not the keeper");
const wallet = createWalletClient({ account, chain: polygon, transport });

function compile() {
  const input = {
    language: "Solidity",
    sources: { "SealGift.sol": { content: readFileSync("contracts/SealGift.sol", "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const compiled = spawnSync("npx", ["--yes", "solc@0.8.24", "--standard-json"], { input: JSON.stringify(input), encoding: "utf8" });
  if (compiled.status !== 0) throw new Error(compiled.stderr || "solc failed");
  const output = JSON.parse(compiled.stdout.slice(compiled.stdout.indexOf("{")));
  const errors = (output.errors ?? []).filter((error) => error.severity === "error");
  if (errors.length) throw new Error(errors.map((error) => error.formattedMessage).join("\n"));
  const contract = output.contracts["SealGift.sol"].SealGift;
  const names = [...new Set(contract.abi.filter((item) => item.type === "function").map((item) => item.name))].sort();
  const allowed = ["abort", "begin", "bzb", "claimed", "commit", "keeper", "owed", "packs", "pending", "price", "sweepPol"];
  if (names.join() !== allowed.join()) throw new Error(`unexpected functions ${names.join(",")}`);
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

const artifact = compile();
writeFileSync("contracts/out/SealGift.json", JSON.stringify({ abi: artifact.abi, bytecode: artifact.bytecode }));
const fees = await publicClient.estimateFeesPerGas();
const request = await wallet.prepareTransactionRequest({
  data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode, args: [BZB, PACKS, KEEPER] }),
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
const address = getAddress(receipt.contractAddress);
const abi = artifact.abi;
const [bzb, packs, keeper, price, forge, balance] = await Promise.all([
  publicClient.readContract({ address, abi, functionName: "bzb" }),
  publicClient.readContract({ address, abi, functionName: "packs" }),
  publicClient.readContract({ address, abi, functionName: "keeper" }),
  publicClient.readContract({ address, abi, functionName: "price" }),
  publicClient.readContract({ address: PACKS, abi: [{ type: "function", name: "FORGE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "FORGE" }),
  publicClient.getBalance({ address }),
]);
if (getAddress(bzb) !== BZB || getAddress(packs) !== PACKS || getAddress(keeper) !== KEEPER) throw new Error("gift wiring is wrong");
if (price !== forge || price !== 1_000_000_000_000_000_000n) throw new Error("pack price is not one BzB");
if (balance !== 0n) throw new Error("contract should start with no POL");
const stranger = encodeFunctionData({ abi, functionName: "begin", args: [KEEPER] });
const blocked = await fetch("https://polygon-bor-rpc.publicnode.com", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ from: "0x000000000000000000000000000000000000bEEF", to: address, data: stranger }, "latest"] }),
}).then((res) => res.json());
if (!blocked.error) throw new Error("a stranger was allowed to reserve a pack");
const deployedPath = "src/veil/deployed.ts";
const source = readFileSync(deployedPath, "utf8");
const next = source.replace(
  'export const GIFT = "0x0000000000000000000000000000000000000000" as const;',
  `export const GIFT = "${address}" as const;`,
);
if (next === source) throw new Error("could not write GIFT");
writeFileSync(deployedPath, next);
console.log("SealGift", address, hash);
