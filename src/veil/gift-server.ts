import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, decodeEventLog, fallback, getAddress, http, type Address, type Hex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { getSql } from "@/lib/db";
import { grantDueTitles } from "./titles";
import { BZB, CARDS_NFT, GIFT, KEEPER, PACKS } from "./deployed";
import { GIFT_WINS } from "./ranks";
import { profileByToken, snapshotProfiles, type Profile } from "./accounts";
import { clearGiftSteps, giftStep, giftTransfers, recordedGiftOrders, recordGiftStep, recordGiftTransfer, type GiftStep } from "./integrity-store";
import { GiftPending, GiftReverted, pickOrphanOrder, polygonRpcUrls, pollReceipt, type KeeperOrder } from "./gift-core";

const transport = fallback(polygonRpcUrls(process.env).map((url) => http(url, { timeout: 15_000, retryCount: 1 })));
const publicClient = createPublicClient({ chain: polygon, transport });

const giftAbi = [
  { type: "function", name: "begin", stateMutability: "nonpayable", inputs: [{ name: "player", type: "address" }], outputs: [] },
  { type: "function", name: "commit", stateMutability: "nonpayable", inputs: [{ name: "player", type: "address" }, { name: "orderId", type: "uint256" }], outputs: [] },
  { type: "function", name: "abort", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "sweepPol", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claimed", stateMutability: "view", inputs: [{ name: "player", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "pending", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "owed", stateMutability: "view", inputs: [{ name: "orderId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "price", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const packsAbi = [
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "faction", type: "uint8" }], outputs: [] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "orderId", type: "uint256" }], outputs: [] },
  { type: "function", name: "nextOrder", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "orders", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [
    { name: "buyer", type: "address" },
    { name: "faction", type: "uint8" },
    { name: "openedAt", type: "uint64" },
    { name: "price", type: "uint256" },
  ] },
  { type: "event", name: "Reserved", inputs: [
    { name: "orderId", type: "uint256", indexed: true },
    { name: "buyer", type: "address", indexed: true },
    { name: "faction", type: "uint8", indexed: false },
  ] },
  { type: "event", name: "Opened", inputs: [
    { name: "orderId", type: "uint256", indexed: true },
    { name: "buyer", type: "address", indexed: true },
    { name: "faction", type: "uint8", indexed: false },
    { name: "id0", type: "uint256", indexed: false },
    { name: "id1", type: "uint256", indexed: false },
    { name: "id2", type: "uint256", indexed: false },
    { name: "id3", type: "uint256", indexed: false },
    { name: "id4", type: "uint256", indexed: false },
  ] },
] as const;

const erc20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const cardsAbi = [
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable", inputs: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "id", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "data", type: "bytes" },
  ], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

let chain: Promise<unknown> = Promise.resolve();
const ZERO = "0x0000000000000000000000000000000000000000";
const RECEIPT_MS = 120_000;
const ORDER_LOOKBACK = 256n;

function keeper() {
  const fromEnv = process.env.SEAL_FORGE_SIGNER;
  const key = (fromEnv && /^0x[0-9a-fA-F]{64}$/.test(fromEnv) ? fromEnv : (JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8")) as { key: Hex }).key) as Hex;
  const account = privateKeyToAccount(key);
  if (getAddress(account.address) !== getAddress(KEEPER)) throw new Error("keeper mismatch");
  const wallet = createWalletClient({ account, chain: polygon, transport });
  return { account, wallet };
}

function send<T>(run: () => Promise<T>): Promise<T> {
  const next = chain.then(run, run);
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/** The receipt, or null while the transaction is still unknown. RPC errors never count as failure. */
async function receiptOf(hash: Hex, timeoutMs = RECEIPT_MS): Promise<TransactionReceipt | null> {
  return pollReceipt(() => publicClient.getTransactionReceipt({ hash }), { timeoutMs });
}

/** Wait for a broadcast tx: success returns the receipt, a revert throws GiftReverted, unknown throws GiftPending. */
async function settled(hash: Hex): Promise<TransactionReceipt> {
  const receipt = await receiptOf(hash);
  if (!receipt) throw new GiftPending();
  if (receipt.status !== "success") throw new GiftReverted();
  return receipt;
}

type AnyAbi = typeof giftAbi | typeof packsAbi | typeof erc20 | typeof cardsAbi;

async function write(fn: string, args: readonly unknown[], abi: AnyAbi, to: Address, value?: bigint) {
  return send(async () => {
    const { account, wallet } = keeper();
    const hash = await wallet.writeContract({ address: to, abi: abi as never, functionName: fn, args: args as never, account, value });
    return settled(hash);
  });
}

/** Like write(), but stores the tx hash as soon as it is broadcast, before waiting for the receipt. */
async function writeRecorded(fn: string, args: readonly unknown[], abi: AnyAbi, to: Address, onHash: (hash: Hex) => Promise<void>) {
  return send(async () => {
    const { account, wallet } = keeper();
    const hash = await wallet.writeContract({ address: to, abi: abi as never, functionName: fn, args: args as never, account });
    await onHash(hash);
    return settled(hash);
  });
}

/** A gift step for one wallet, with its hash stored before the wait. */
async function writeStep(wallet: string, step: GiftStep, fn: string, args: readonly unknown[], abi: AnyAbi, to: Address) {
  const sql = await getSql();
  return writeRecorded(fn, args, abi, to, (hash) => recordGiftStep(sql, wallet, step, hash));
}

/** What became of the stored hash for a step: its receipt, "failed" (reverted), "pending" (unknown) or null (none stored). */
async function priorStep(wallet: string, step: GiftStep): Promise<TransactionReceipt | "failed" | "pending" | null> {
  const sql = await getSql();
  const hash = await giftStep(sql, wallet, step);
  if (!hash) return null;
  const receipt = await receiptOf(hash as Hex, 20_000);
  if (!receipt) return "pending";
  return receipt.status === "success" ? receipt : "failed";
}

/** "sent" when a recorded transfer landed, "failed" when it reverted, "pending" when it is still unknown. */
async function transferState(hash: string): Promise<"sent" | "failed" | "pending"> {
  const receipt = await receiptOf(hash as Hex, 30_000);
  if (!receipt) return "pending";
  return receipt.status === "success" ? "sent" : "failed";
}

async function ensureApprovals() {
  const owner = getAddress(KEEPER);
  const packAllowance = await publicClient.readContract({ address: BZB, abi: erc20, functionName: "allowance", args: [owner, PACKS] });
  if (packAllowance < 10n ** 21n) await write("approve", [PACKS, 2n ** 255n - 1n], erc20, BZB);
  if (GIFT) {
    const giftAllowance = await publicClient.readContract({ address: BZB, abi: erc20, functionName: "allowance", args: [owner, GIFT] });
    if (giftAllowance < 10n ** 21n) await write("approve", [GIFT, 2n ** 255n - 1n], erc20, BZB);
  }
}

async function gasFloat() {
  if (!GIFT) return;
  const { account } = keeper();
  const [keeperPol, poolPol] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.getBalance({ address: GIFT }),
  ]);
  if (keeperPol < 300_000_000_000_000_000n && poolPol > 0n) await write("sweepPol", [], giftAbi, GIFT);
}

function reservedId(receipt: { logs: { address: string; data: Hex; topics: [] | [Hex, ...Hex[]] }[] }): bigint | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== PACKS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: packsAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "Reserved" && getAddress(decoded.args.buyer) === getAddress(KEEPER)) return decoded.args.orderId;
    } catch {
      /* another contract log */
    }
  }
  return null;
}

function openedIds(receipt: { logs: { address: string; data: Hex; topics: [] | [Hex, ...Hex[]] }[] }, orderId: bigint) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== PACKS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: packsAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "Opened" || decoded.args.orderId !== orderId) continue;
      return [decoded.args.id0, decoded.args.id1, decoded.args.id2, decoded.args.id3, decoded.args.id4];
    } catch {
      /* another contract log */
    }
  }
  return null;
}

async function mark(address: string, order: string, cards: string, gifted: number) {
  const sql = await getSql();
  await sql`update veil_profiles set gift_order = ${order}, gift_cards = ${cards}, gifted = ${gifted} where address = ${address}`;
  if (gifted === 1) await grantDueTitles(sql, address).catch(() => []);
  await snapshotProfiles();
}

type GiftResult = { profile: Profile; status: "dealt" | "opening"; note: string } | { error: string };

let claiming: Promise<unknown> = Promise.resolve();

/** One claim at a time in this process: SealGift only holds one pending player, and a double click must not race itself. */
export function claimGift(token: string): Promise<GiftResult> {
  const next = claiming.then(
    () => claimNow(token),
    () => claimNow(token),
  );
  claiming = next.catch(() => undefined);
  return next;
}

async function claimNow(token: string): Promise<GiftResult> {
  const profile = await profileByToken(token);
  if (!profile) return { error: "Sign in again." };
  if (profile.gifted) return { error: "This profile already took its pack." };
  // First server-scored win unlocks the pack (wins only grow from server-scored rooms or a game-signed backup).
  if (profile.wins < GIFT_WINS) return { error: "Win one match on a server table first (Auto start or Find a match)." };
  const player = getAddress(profile.address);
  const already = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "claimed", args: [player] });
  if (already && !profile.giftOrder) return { error: "This profile is already marked on the gift contract, so it cannot take a second pack." };
  try {
    await gasFloat();
    await ensureApprovals();
    const orderId = await reserve(profile, player);
    if (orderId === null) return { error: "Another gift is in the middle of being dealt. Try again shortly." };
    return await deliver(token, profile, player, orderId);
  } catch (error) {
    if (error instanceof GiftPending) {
      const next = await profileByToken(token);
      return { profile: next ?? profile, status: "opening", note: error.message };
    }
    throw error;
  }
}

/** Keeper-bought Founding orders that nobody holds yet, newest first (see pickOrphanOrder). */
async function orphanOrder(): Promise<bigint | null> {
  const [next, price] = await Promise.all([
    publicClient.readContract({ address: PACKS, abi: packsAbi, functionName: "nextOrder" }),
    publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "price" }),
  ]);
  const from = next > ORDER_LOOKBACK ? next - ORDER_LOOKBACK : 0n;
  const ids: bigint[] = [];
  for (let id = from; id < next; id++) ids.push(id);
  if (!ids.length) return null;
  const rows = await publicClient.multicall({
    allowFailure: true,
    contracts: ids.map((id) => ({ address: PACKS, abi: packsAbi, functionName: "orders" as const, args: [id] as const })),
  });
  const orders: KeeperOrder[] = [];
  rows.forEach((row, index) => {
    if (row.status !== "success") return;
    const [buyer, faction, , paid] = row.result;
    if (getAddress(buyer) === getAddress(KEEPER)) orders.push({ id: ids[index]!, buyer, faction: Number(faction), price: paid });
  });
  if (!orders.length) return null;
  const owedRows = await publicClient.multicall({
    allowFailure: false,
    contracts: orders.map((order) => ({ address: GIFT, abi: giftAbi, functionName: "owed" as const, args: [order.id] as const })),
  });
  const owed = new Map(orders.map((order, index) => [order.id, owedRows[index] as Address]));
  const sql = await getSql();
  return pickOrphanOrder(orders, owed, { keeper: getAddress(KEEPER), price, recorded: await recordedGiftOrders(sql) });
}

/** Commit an order to the player, unless a commit we already sent is still confirming. */
async function commitOrder(profile: Profile, player: Address, orderId: bigint) {
  await mark(profile.address, orderId.toString(), "", 0);
  const prior = await priorStep(profile.address, "commit");
  if (prior === "pending") throw new GiftPending();
  const owed = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "owed", args: [orderId] });
  if (owed !== ZERO) return;
  await writeStep(profile.address, "commit", "commit", [player, orderId], giftAbi, GIFT);
}

async function reserve(profile: Profile, player: Address): Promise<bigint | null> {
  if (profile.giftOrder) {
    const id = BigInt(profile.giftOrder);
    const owed = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "owed", args: [id] });
    if (getAddress(owed) === player) return id;
    if (owed !== ZERO) return null;
    await commitOrder(profile, player, id);
    return id;
  }
  const pending = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "pending" });
  if (pending !== ZERO && getAddress(pending) !== player) return null;
  if (pending === ZERO) {
    // A begin we already broadcast may still be in the mempool: never send a second one.
    if ((await priorStep(profile.address, "begin")) === "pending") throw new GiftPending();
    const sql = await getSql();
    await clearGiftSteps(sql, profile.address, ["buy", "commit", "settle"]);
    await writeStep(profile.address, "begin", "begin", [player], giftAbi, GIFT);
  }
  // pending == player from here. Resume a buy we already sent, then any unrecorded keeper pack, before buying.
  let orderId: bigint | null = null;
  const priorBuy = await priorStep(profile.address, "buy");
  if (priorBuy === "pending") throw new GiftPending();
  if (priorBuy && priorBuy !== "failed") {
    const id = reservedId(priorBuy);
    if (id !== null) {
      const owed = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "owed", args: [id] });
      if (owed === ZERO) orderId = id;
    }
  }
  if (orderId === null) orderId = await orphanOrder();
  if (orderId === null) {
    try {
      const receipt = await writeStep(profile.address, "buy", "buy", [0], packsAbi, PACKS);
      orderId = reservedId(receipt);
      if (orderId === null) throw new GiftReverted("The pack did not reserve.");
    } catch (error) {
      // Only a mined revert means the buy failed. Unknown stays pending and resumes on retry.
      if (error instanceof GiftReverted) {
        const still = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "pending" });
        if (getAddress(still) === player) await write("abort", [], giftAbi, GIFT).catch(() => undefined);
        const sql = await getSql();
        await clearGiftSteps(sql, profile.address, ["begin", "buy", "commit", "settle"]);
        throw new Error("The gift did not start.");
      }
      throw error;
    }
  }
  await commitOrder(profile, player, orderId);
  return orderId;
}

async function deliver(token: string, profile: Profile, player: Address, orderId: bigint): Promise<{ profile: Profile; status: "dealt" | "opening"; note: string } | { error: string }> {
  const owed = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "owed", args: [orderId] });
  if (getAddress(owed) !== player) return { error: "This pack is not reserved for this profile." };
  const order = await publicClient.readContract({ address: PACKS, abi: packsAbi, functionName: "orders", args: [orderId] });
  let ids: bigint[] = [];
  const stored = await storedCards(profile.address);
  if (order[0] !== ZERO) {
    if (BigInt(order[2]) >= (await publicClient.getBlockNumber())) {
      const next = await profileByToken(token);
      return { profile: next ?? profile, status: "opening", note: "The pack is sealed for one more block. Claim again in a moment." };
    }
    const prior = await priorStep(profile.address, "settle");
    if (prior === "pending") throw new GiftPending();
    const receipt = await writeStep(profile.address, "settle", "settle", [orderId], packsAbi, PACKS);
    const opened = openedIds(receipt, orderId);
    if (!opened) return { error: "The pack opened without a card list." };
    ids = opened;
    await mark(profile.address, orderId.toString(), ids.join(","), 0);
  } else if (stored.length) {
    ids = stored;
  } else {
    // Settled, but the card list was never saved (its receipt was lost): read it from the stored settle tx.
    const prior = await priorStep(profile.address, "settle");
    if (prior === "pending") throw new GiftPending();
    const opened = prior && prior !== "failed" ? openedIds(prior, orderId) : null;
    if (opened) {
      ids = opened;
      await mark(profile.address, orderId.toString(), ids.join(","), 0);
    }
  }
  if (!ids.length) return { error: "The cards are missing from this gift. Try the claim again." };
  // Each distinct card id is sent once (amount = copies in the pack) and its tx hash is stored
  // the moment it is broadcast. A retry decides from those receipts, never from the keeper's
  // balance, which can hold copies from other packs.
  const counts = new Map<string, bigint>();
  for (const id of ids) counts.set(id.toString(), (counts.get(id.toString()) ?? 0n) + 1n);
  const sql = await getSql();
  const orderKey = orderId.toString();
  const sent = await giftTransfers(sql, profile.address, orderKey);
  for (const [id, amount] of counts) {
    const prior = sent.get(id);
    if (prior) {
      const state = await transferState(prior);
      if (state === "sent") continue;
      if (state === "pending") return { profile, status: "opening", note: "A card transfer is still confirming. Claim again in a minute." };
    }
    await writeRecorded("safeTransferFrom", [getAddress(KEEPER), player, BigInt(id), amount, "0x"], cardsAbi, CARDS_NFT, (hash) =>
      recordGiftTransfer(sql, { wallet: profile.address, orderId: orderKey, tokenId: id, amount: Number(amount), txHash: hash }),
    );
  }
  await mark(profile.address, orderId.toString(), ids.join(","), 1);
  const done = await profileByToken(token);
  return { profile: done ?? profile, status: "dealt", note: "Your first-win Founding Forge pack is in your wallet. Five cards, once per profile." };
}

async function storedCards(address: string): Promise<bigint[]> {
  const sql = await getSql();
  const rows = await sql<{ gift_cards: string }>`select gift_cards from veil_profiles where address = ${address}`;
  return (rows[0]?.gift_cards ?? "").split(",").filter(Boolean).map((id) => BigInt(id));
}
