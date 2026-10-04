import { decodeEventLog, type Address } from "viem";
import { playerClient } from "./connect";
import { CARDS, type CardDef, type CardSet } from "./cards";
import { ASHEN_PACKS, ASHEN_WEI, BLAZAR_PACKS, BLAZAR_WEI, BZB, FORGE_WEI, KAGE_PACKS, KAGE_WEI, PACKS, SEAL_WEI } from "./deployed";
import { polygonClient } from "./pol";
import { redactKey } from "./keys";
import { ensureBzb, gameKeySigns, sendGame } from "./signer";

const WAIT_MS = 15_000;
const TIMEOUT = "Timed out. The pack did not confirm. You can try again.";

const erc20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const packsAbi = [
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "faction", type: "uint8" }], outputs: [] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "orderId", type: "uint256" }], outputs: [] },
  { type: "function", name: "nextOrder", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "orders",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "buyer", type: "address" },
      { name: "faction", type: "uint8" },
      { name: "openedAt", type: "uint64" },
      { name: "price", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Reserved",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "faction", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Opened",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "faction", type: "uint8", indexed: false },
      { name: "id0", type: "uint256", indexed: false },
      { name: "id1", type: "uint256", indexed: false },
      { name: "id2", type: "uint256", indexed: false },
      { name: "id3", type: "uint256", indexed: false },
      { name: "id4", type: "uint256", indexed: false },
    ],
  },
] as const;

function within<T>(work: Promise<T>, ms = WAIT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(TIMEOUT)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function timedOut(error: unknown) {
  if (error instanceof Error && /timed out/i.test(error.message)) return true;
  return typeof error === "object" && error !== null && "name" in error && String(error.name).toLowerCase().includes("timeout");
}

function cardFor(edition: CardSet, tokenId: number): CardDef {
  const want = edition === "kage" ? "kage" : edition === "blazar" ? "blazar" : edition === "ashen" ? "ashen" : "core";
  const card = CARDS.find((item) => item.tokenId === tokenId && item.edition === want);
  if (!card) throw new Error(`Missing sealed card ${tokenId}.`);
  return card;
}

function explain(error: unknown): string {
  if (timedOut(error)) return TIMEOUT;
  if (typeof error === "object" && error && "shortMessage" in error && typeof error.shortMessage === "string") return error.shortMessage;
  if (error instanceof Error) return error.message;
  return "The pack did not open.";
}

function openedFrom(pack: `0x${string}`, logs: { address: string; data: `0x${string}`; topics: [] | [`0x${string}`, ...`0x${string}`[]] }[], buyer: string): CardDef[] | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== pack.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: packsAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Opened" || decoded.args.buyer.toLowerCase() !== buyer.toLowerCase()) continue;
      const ids = [decoded.args.id0, decoded.args.id1, decoded.args.id2, decoded.args.id3, decoded.args.id4];
      const edition = pack.toLowerCase() === ASHEN_PACKS.toLowerCase() ? "ashen" : pack.toLowerCase() === KAGE_PACKS.toLowerCase() ? "kage" : pack.toLowerCase() === BLAZAR_PACKS.toLowerCase() ? "blazar" : "founding";
      return ids.map((id) => cardFor(edition, Number(id)));
    } catch {
      continue;
    }
  }
  return null;
}

async function confirm(hash: `0x${string}`, buyer: Address) {
  let receipt;
  try {
    receipt = await within(polygonClient.waitForTransactionReceipt({ hash, timeout: WAIT_MS, pollingInterval: 1_000 }));
  } catch (error) {
    if (timedOut(error)) throw new Error(TIMEOUT);
    throw error;
  }
  if (receipt.status !== "success" || receipt.from.toLowerCase() !== buyer.toLowerCase()) {
    throw new Error("That transaction was not confirmed from this wallet.");
  }
  return receipt;
}

async function waitPast(block: bigint) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(TIMEOUT);
    const head = await within(polygonClient.getBlockNumber(), left);
    if (head > block) return;
    const pause = Math.min(1_000, deadline - Date.now());
    if (pause <= 0) throw new Error(TIMEOUT);
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
}

async function openOrder(pack: `0x${string}`, buyer: Address): Promise<{ id: bigint; openedAt: bigint } | null> {
  const next = await within(polygonClient.readContract({ address: pack, abi: packsAbi, functionName: "nextOrder" }));
  const total = Number(next);
  if (total <= 0) return null;
  const from = Math.max(0, total - 25);
  const ids = Array.from({ length: total - from }, (_, index) => from + index).reverse();
  const rows = await within(
    polygonClient.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({
        address: pack,
        abi: packsAbi,
        functionName: "orders" as const,
        args: [BigInt(id)] as const,
      })),
    }),
  );
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row.status !== "success") continue;
    const [who, , openedAt] = row.result;
    if (who.toLowerCase() === buyer.toLowerCase()) return { id: BigInt(ids[index]!), openedAt };
  }
  return null;
}

export async function buySealedPack(key: `0x${string}` | null, edition: CardSet, faction: number): Promise<CardDef[]> {
  const { address, wallet } = await playerClient(key);
  const pack = edition === "ashen" ? ASHEN_PACKS : edition === "kage" ? KAGE_PACKS : edition === "blazar" ? BLAZAR_PACKS : PACKS;
  const cost = edition === "ashen" ? ASHEN_WEI : edition === "kage" ? KAGE_WEI : edition === "blazar" ? BLAZAR_WEI : faction === 0 ? FORGE_WEI : SEAL_WEI;
  if (!pack) throw new Error("That set is not on chain yet.");
  try {
    const pending = await openOrder(pack, address);
    let orderId = pending?.id ?? null;
    let openedAt = pending?.openedAt ?? null;
    if (orderId === null || openedAt === null) {
      const allowance = await within(polygonClient.readContract({ address: BZB, abi: erc20, functionName: "allowance", args: [address, pack] }));
      if (allowance < cost) {
        if (gameKeySigns(key)) {
          await ensureBzb(
            key,
            address,
            pack,
            cost,
            (amount, nonce) => wallet.writeContract({ address: BZB, abi: erc20, functionName: "approve", args: [pack, amount], nonce }),
            (hash) => confirm(hash, address),
          );
        } else {
          const approved = await within(wallet.writeContract({ address: BZB, abi: erc20, functionName: "approve", args: [pack, cost * 8n] }));
          await confirm(approved, address);
        }
      }
      const hash = gameKeySigns(key)
        ? await sendGame(key, address, (nonce) => wallet.writeContract({ address: pack, abi: packsAbi, functionName: "buy", args: [faction], nonce }))
        : await within(wallet.writeContract({ address: pack, abi: packsAbi, functionName: "buy", args: [faction] }));
      const receipt = await confirm(hash, address);
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== pack.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: packsAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === "Reserved") {
            if (decoded.args.buyer.toLowerCase() !== address.toLowerCase()) throw new Error("That pack was reserved for a different wallet.");
            orderId = decoded.args.orderId;
          }
        } catch (error) {
          if (error instanceof Error && error.message === "That pack was reserved for a different wallet.") throw error;
          continue;
        }
      }
      if (orderId === null) throw new Error("The pack was paid, but the order was not found.");
      openedAt = receipt.blockNumber;
    }
    await waitPast(openedAt);
    const settled = await sendGame(key, address, (nonce) => wallet.writeContract({ address: pack, abi: packsAbi, functionName: "settle", args: [orderId], nonce }));
    const opened = await confirm(settled, address);
    const cards = openedFrom(pack, opened.logs, address);
    if (!cards) throw new Error("The pack opened, but the cards were not in the receipt.");
    return cards;
  } catch (error) {
    throw new Error(redactKey(explain(error), key));
  }
}