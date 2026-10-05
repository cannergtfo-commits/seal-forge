import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, encodeDeployData, encodeFunctionData, getAddress, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

const TREASURY = getAddress("0x11489040837F585C067C60037eF17e9E1C4B7d81");
const KEEPER = getAddress("0x80f59AEa437654AA3F6AA449248311264e2Bf81d");
const URI = "https://play.blazarforce.net/meta/stage/1.json";
const transport = http("https://polygon-bor-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: polygon, transport });
const { key } = JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8"));
const account = privateKeyToAccount(key);
if (getAddress(account.address) !== KEEPER) throw new Error("deployer is not the keeper");
const wallet = createWalletClient({ account, chain: polygon, transport });

function compile() {
  const input = {
    language: "Solidity",
    sources: { "SealStages.sol": { content: readFileSync("contracts/SealStages.sol", "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const compiled = spawnSync("npx", ["--yes", "solc@0.8.24", "--standard-json"], { input: JSON.stringify(input), encoding: "utf8" });
  if (compiled.status !== 0) throw new Error(compiled.stderr || "solc failed");
  const text = compiled.stdout.slice(compiled.stdout.indexOf("{"));
  const output = JSON.parse(text);
  const errors = (output.errors ?? []).filter((error) => error.severity === "error");
  if (errors.length) {
    for (const error of errors) console.error(error.formattedMessage);
    throw new Error("compile failed");
  }
  const contract = output.contracts["SealStages.sol"].SealStages;
  const names = [...new Set(contract.abi.filter((item) => item.type === "function").map((item) => item.name))].sort();
  const allowed = ["addDrop", "approve", "balanceOf", "drop", "dropOf", "getApproved", "held", "isApprovedForAll", "mint", "name", "nextDrop", "nextId", "owner", "ownerOf", "owns", "safeTransferFrom", "setApprovalForAll", "supportsInterface", "symbol", "tokenURI", "transferFrom", "treasury"];
  if (names.join() !== allowed.join()) throw new Error(`unexpected functions ${names.join(",")}`);
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

const artifact = compile();
writeFileSync("contracts/out/SealStages.json", JSON.stringify({ abi: artifact.abi, bytecode: artifact.bytecode }));

const fees = await publicClient.estimateFeesPerGas();
const request = await wallet.prepareTransactionRequest({
  data: encodeDeployData({ abi: artifact.abi, bytecode: artifact.bytecode }),
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
const [owner, treasury, nextDrop, nextId, row, balance] = await Promise.all([
  publicClient.readContract({ address, abi, functionName: "owner" }),
  publicClient.readContract({ address, abi, functionName: "treasury" }),
  publicClient.readContract({ address, abi, functionName: "nextDrop" }),
  publicClient.readContract({ address, abi, functionName: "nextId" }),
  publicClient.readContract({ address, abi, functionName: "drop", args: [1n] }),
  publicClient.getBalance({ address }),
]);
const [price, cap, sold, payee, uri] = row;
if (getAddress(owner) !== TREASURY) throw new Error("owner is not the treasury");
if (getAddress(treasury) !== TREASURY) throw new Error("treasury mismatch");
if (nextDrop !== 2n || nextId !== 0n) throw new Error("supply cursor is wrong");
if (price !== 10_000_000_000_000_000_000n || cap !== 2_000n || sold !== 0n) throw new Error("drop terms are wrong");
if (getAddress(payee) !== TREASURY || uri !== URI) throw new Error("drop payee or metadata is wrong");
if (balance !== 0n) throw new Error("contract already holds POL");

const buyer = "0x000000000000000000000000000000000000bEEF";
const mint = encodeFunctionData({ abi, functionName: "mint", args: [1n] });
async function call(value, from = buyer) {
  const res = await fetch("https://polygon-bor-rpc.publicnode.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ from, to: address, data: mint, value }, "latest", { [buyer]: { balance: "0x8ac7230489e80000" } }],
    }),
  });
  return res.json();
}
const good = await call("0x8ac7230489e80000");
if (good.error) throw new Error(`honest mint reverted: ${good.error.message}`);
const cheap = await call("0x1");
if (!cheap.error) throw new Error("underpaid mint was accepted");
const stranger = encodeFunctionData({
  abi,
  functionName: "addDrop",
  args: [1n, 1n, TREASURY, URI],
});
const added = await fetch("https://polygon-bor-rpc.publicnode.com", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "eth_call",
    params: [{ from: KEEPER, to: address, data: stranger }, "latest"],
  }),
}).then((res) => res.json());
if (!added.error) throw new Error("keeper was allowed to add a drop");

const deployedPath = "src/veil/deployed.ts";
const source = readFileSync(deployedPath, "utf8");
const line = `export const STAGE = "${address}" as const;\n`;
if (source.includes("export const STAGE")) throw new Error("STAGE is already set");
writeFileSync(deployedPath, source.replace('export const BZB =', `${line}export const BZB =`));
console.log("SealStages", address, hash);
