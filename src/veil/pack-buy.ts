import { decodeEventLog, type Address } from "viem";
import { playerClient } from "./connect";
import { CARDS, type CardDef, type CardSet } from "./cards";
import { ASHEN_PACKS, ASHEN_WEI, BLAZAR_PACKS, BLAZAR_WEI, BZB, FORGE_WEI, KAGE_PACKS, KAGE_WEI, PACKS, SEAL_WEI } from "./deployed";
import { polygonClient } from "./pol";
import { redactKey } from "./keys";
import { ensureBzb, gameKeySigns, sendGame } from "./signer";

const WAIT_MS = 15_000;
const SETTLE_WAIT_MS = 30_000;
const SETTLE_TRIES = 4;
const ORDER_LOOKBACK = 256;
const TIMEOUT = "Timed out. The pack did not confirm. You can try again.";
const SETTLE_RETRY = "The pack was paid, but the cards have not minted yet. Click Mint your cards again to finish.";
const EDITIONS: CardSet[] = ["ashen", "kage", "blazar", "founding"];

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

export type PackReservation = {
  edition: CardSet;
  pack: `0x${string}`;
  orderId: bigint;
  openedAt: bigint;
  resumed: boolean;
};

function packOf(edition: CardSet): `0x${string}` {
  return edition === "ashen" ? ASHEN_PACKS : edition === "kage" ? KAGE_PACKS : edition === "blazar" ? BLAZAR_PACKS : PACKS;
}

function costOf(edition: CardSet, faction: number): bigint {
  return edition === "ashen" ? ASHEN_WEI : edition === "kage" ? KAGE_WEI : edition === "blazar" ? BLAZAR_WEI : faction === 0 ? FORGE_WEI : SEAL_WEI;
}

function editionOf(pack: `0x${string}`): CardSet {
  const id = pack.toLowerCase();
  if (id === ASHEN_PACKS.toLowerCase()) return "ashen";
  if (id === KAGE_PACKS.toLowerCase()) return "kage";
  if (id === BLAZAR_PACKS.toLowerCase()) return "blazar";
  return "founding";
}

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
      return ids.map((id) => cardFor(editionOf(pack), Number(id)));
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

/** Prefer the wallet's own node, because settle reverts Early() if that node is still on the buy block. */
async function walletHead(key: `0x${string}` | null): Promise<bigint> {
  try {
    const { wallet } = await playerClient(key);
    const hex = await wallet.request({ method: "eth_blockNumber" });
    if (typeof hex === "string" && /^0x[0-9a-fA-F]+$/.test(hex)) return BigInt(hex);
  } catch {
    /* use the public client */
  }
  return polygonClient.getBlockNumber();
}

async function waitPast(key: `0x${string}` | null, block: bigint, ahead = 2n) {
  const deadline = Date.now() + SETTLE_WAIT_MS;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(TIMEOUT);
    const head = await within(walletHead(key), left);
    if (head >= block + ahead) return;
    const pause = Math.min(1_000, deadline - Date.now());
    if (pause <= 0) throw new Error(TIMEOUT);
    await new Promise((resolve) => setTimeout(resolve, pause));
  }
}

function rejected(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? Number((error as { code: unknown }).code) : 0;
  if (code === 4001 || code === 5000) return true;
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "shortMessage" in error && typeof error.shortMessage === "string" ? error.shortMessage : String(error);
  return /user rejected|denied the request|request rejected|cancelled|canceled/i.test(message);
}

async function openOrder(pack: `0x${string}`, buyer: Address): Promise<{ id: bigint; openedAt: bigint } | null> {
  const next = await within(polygonClient.readContract({ address: pack, abi: packsAbi, functionName: "nextOrder" }));
  const total = Number(next);
  if (total <= 0) return null;
  const from = Math.max(0, total - ORDER_LOOKBACK);
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

async function pendingOn(key: `0x${string}` | null, edition: CardSet): Promise<PackReservation | null> {
  const pack = packOf(edition);
  if (!pack) return null;
  const { address } = await playerClient(key);
  const pending = await openOrder(pack, address);
  if (!pending) return null;
  return { edition, pack, orderId: pending.id, openedAt: pending.openedAt, resumed: true };
}

/** A paid pack that has not been minted yet, if one exists in the last 256 orders. */
export async function findAnyPendingPack(key: `0x${string}` | null): Promise<PackReservation | null> {
  try {
    for (const edition of EDITIONS) {
      const pending = await pendingOn(key, edition);
      if (pending) return pending;
    }
    return null;
  } catch (error) {
    throw new Error(redactKey(explain(error), key));
  }
}

/** Pay for a pack, or resume a reservation that was already paid. Does not mint. */
export async function reserveSealedPack(key: `0x${string}` | null, edition: CardSet, faction: number): Promise<PackReservation> {
  const { address, wallet } = await playerClient(key);
  const pack = packOf(edition);
  const cost = costOf(edition, faction);
  if (!pack) throw new Error("That set is not on chain yet.");
  try {
    const existing = await openOrder(pack, address);
    if (existing) return { edition, pack, orderId: existing.id, openedAt: existing.openedAt, resumed: true };

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
    let orderId: bigint | null = null;
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
    return { edition, pack, orderId, openedAt: receipt.blockNumber, resumed: false };
  } catch (error) {
    throw new Error(redactKey(explain(error), key));
  }
}

/** Wait until the wallet's node (falling back to the public client) is at least two blocks past the purchase. */
export async function waitForPackMint(key: `0x${string}` | null, openedAt: bigint, ahead = 2n): Promise<void> {
  try {
    await waitPast(key, openedAt, ahead);
  } catch (error) {
    throw new Error(redactKey(explain(error), key));
  }
}

/** Mint a paid pack. Retries settle if the node is still early; never retries a user rejection. */
export async function settleSealedPack(key: `0x${string}` | null, reservation: PackReservation): Promise<CardDef[]> {
  const { address, wallet } = await playerClient(key);
  const { pack, orderId, openedAt } = reservation;
  try {
    let settled: `0x${string}` | null = null;
    let lastSettle: unknown;
    for (let attempt = 0; attempt < SETTLE_TRIES; attempt++) {
      await waitPast(key, openedAt, 2n + BigInt(attempt));
      try {
        settled = await sendGame(key, address, (nonce) => wallet.writeContract({ address: pack, abi: packsAbi, functionName: "settle", args: [orderId], nonce }));
        lastSettle = null;
        break;
      } catch (error) {
        if (rejected(error)) throw error;
        lastSettle = error;
      }
    }
    if (!settled) throw new Error(lastSettle ? `${SETTLE_RETRY} ${explain(lastSettle)}` : SETTLE_RETRY);
    const opened = await confirm(settled, address);
    const cards = openedFrom(pack, opened.logs, address);
    if (!cards) throw new Error("The pack opened, but the cards were not in the receipt.");
    return cards;
  } catch (error) {
    throw new Error(redactKey(explain(error), key));
  }
}
