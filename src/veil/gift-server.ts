import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, decodeEventLog, getAddress, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { getSql } from "@/lib/db";
import { BZB, CARDS_NFT, GIFT, KEEPER, PACKS } from "./deployed";
import { GIFT_LEVEL, rankFor } from "./ranks";
import { profileByToken, snapshotProfiles, type Profile } from "./accounts";

const transport = http("https://polygon-bor-rpc.publicnode.com");
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
  { type: "function", name: "orders", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [
    { name: "buyer", type: "address" },
    { name: "faction", type: "uint8" },
    { name: "openedAt", type: "uint64" },
    { name: "price", type: "uint256" },
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

async function write(fn: string, args: readonly unknown[], abi: typeof giftAbi | typeof packsAbi | typeof erc20 | typeof cardsAbi, to: Address, value?: bigint) {
  return send(async () => {
    const { account, wallet } = keeper();
    const hash = await wallet.writeContract({ address: to, abi: abi as never, functionName: fn, args: args as never, account, value });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("The gift transaction failed.");
    return receipt;
  });
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
  await snapshotProfiles();
}

export async function claimGift(token: string): Promise<{ profile: Profile; status: "dealt" | "opening"; note: string } | { error: string }> {
  const profile = await profileByToken(token);
  if (!profile) return { error: "Sign in again." };
  if (profile.gifted) return { error: "This profile already took its pack." };
  if (rankFor(profile.xp).level < GIFT_LEVEL) return { error: "Reach level 2 first." };
  const player = getAddress(profile.address);
  const already = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "claimed", args: [player] });
  if (already && !profile.giftOrder) return { error: "This profile is already marked on the gift contract, so it cannot take a second pack." };
  await gasFloat();
  await ensureApprovals();
  const orderId = await reserve(profile, player);
  if (orderId === null) return { error: "Another gift is in the middle of being dealt. Try again shortly." };
  return deliver(token, profile, player, orderId);
}

async function reserve(profile: Profile, player: Address): Promise<bigint | null> {
  if (profile.giftOrder) {
    const id = BigInt(profile.giftOrder);
    const owed = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "owed", args: [id] });
    if (getAddress(owed) === player) return id;
    if (owed !== "0x0000000000000000000000000000000000000000") return null;
    await write("commit", [player, id], giftAbi, GIFT);
    return id;
  }
  const pending = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "pending" });
  if (pending !== "0x0000000000000000000000000000000000000000" && getAddress(pending) !== player) return null;
  if (getAddress(pending) !== player) await write("begin", [player], giftAbi, GIFT);
  let orderId = 0n;
  try {
    const receipt = await write("buy", [0], packsAbi, PACKS);
    const reserved = receipt.logs
      .map((log) => {
        try {
          return decodeEventLog({
            abi: [{ type: "event", name: "Reserved", inputs: [
              { name: "orderId", type: "uint256", indexed: true },
              { name: "buyer", type: "address", indexed: true },
              { name: "faction", type: "uint8", indexed: false },
            ] }] as const,
            data: log.data,
            topics: log.topics,
          });
        } catch {
          return null;
        }
      })
      .find((item) => item?.eventName === "Reserved");
    if (!reserved || reserved.eventName !== "Reserved") throw new Error("The pack did not reserve.");
    orderId = reserved.args.orderId;
    await mark(profile.address, orderId.toString(), "", 0);
    await write("commit", [player, orderId], giftAbi, GIFT);
    return orderId;
  } catch (error) {
    if (orderId !== 0n) {
      await mark(profile.address, orderId.toString(), "", 0);
      throw error instanceof Error ? error : new Error("The gift did not lock.");
    }
    const still = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "pending" });
    if (getAddress(still) === player) await write("abort", [], giftAbi, GIFT).catch(() => undefined);
    throw error instanceof Error ? error : new Error("The gift did not start.");
  }
}

async function deliver(token: string, profile: Profile, player: Address, orderId: bigint): Promise<{ profile: Profile; status: "dealt" | "opening"; note: string } | { error: string }> {
  const owed = await publicClient.readContract({ address: GIFT, abi: giftAbi, functionName: "owed", args: [orderId] });
  if (getAddress(owed) !== player) return { error: "This pack is not reserved for this profile." };
  const order = await publicClient.readContract({ address: PACKS, abi: packsAbi, functionName: "orders", args: [orderId] });
  let ids: bigint[] = [];
  const stored = await storedCards(profile.address);
  if (order[0] !== "0x0000000000000000000000000000000000000000") {
    if (BigInt(order[2]) >= (await publicClient.getBlockNumber())) {
      const next = await profileByToken(token);
      return { profile: next ?? profile, status: "opening", note: "The pack is sealed for one more block. Claim again in a moment." };
    }
    const receipt = await write("settle", [orderId], packsAbi, PACKS);
    const opened = openedIds(receipt, orderId);
    if (!opened) return { error: "The pack opened without a card list." };
    ids = opened;
    await mark(profile.address, orderId.toString(), ids.join(","), 0);
  } else {
    ids = stored;
  }
  if (!ids.length) return { error: "The cards are missing from this gift. Try the claim again." };
  for (const id of ids) {
    const holding = await publicClient.readContract({ address: CARDS_NFT, abi: cardsAbi, functionName: "balanceOf", args: [getAddress(KEEPER), id] });
    if (holding < 1n) continue;
    await write("safeTransferFrom", [getAddress(KEEPER), player, id, 1n, "0x"], cardsAbi, CARDS_NFT);
  }
  await mark(profile.address, orderId.toString(), ids.join(","), 1);
  const done = await profileByToken(token);
  return { profile: done ?? profile, status: "dealt", note: "A Founding Forge pack is in your wallet. Five cards, once per profile." };
}

async function storedCards(address: string): Promise<bigint[]> {
  const sql = await getSql();
  const rows = await sql<{ gift_cards: string }>`select gift_cards from veil_profiles where address = ${address}`;
  return (rows[0]?.gift_cards ?? "").split(",").filter(Boolean).map((id) => BigInt(id));
}
