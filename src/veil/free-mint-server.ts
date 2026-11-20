/**
 * Free-mint treasury worker: the real chain adapter for free-mint-core.ts.
 *
 * INERT BY DEFAULT. It does nothing unless FEATURE_FREE_MINT=1 AND FREE_MINT_SIGNER holds
 * the key of a dedicated, user-funded treasury wallet. That wallet must NOT be the
 * keeper / rewards signer; the worker refuses to start if it is.
 *
 * It only calls functions that already exist on the deployed contracts:
 *   BZB.approve(pack, budget)        (capped at the window budget, not infinite)
 *   PACK.buy(faction)                (treasury pays the normal BzB price; BzB goes to VeilRewards)
 *   PACK.settle(orderId)             (cards mint to the treasury)
 *   NFT.safeTransferFrom(treasury, player, id, amount, "0x")
 */
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createPublicClient, createWalletClient, decodeEventLog, getAddress, http, parseAbiItem, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { getSql } from "@/lib/db";
import {
  ASHEN_NFT,
  ASHEN_PACKS,
  ASHEN_WEI,
  BLAZAR_NFT,
  BLAZAR_PACKS,
  BLAZAR_WEI,
  BZB,
  CARDS_NFT,
  FORGE_WEI,
  KAGE_NFT,
  KAGE_PACKS,
  KAGE_WEI,
  KEEPER,
  PACKS,
  SEAL_WEI,
} from "./deployed";
import {
  REFUSAL_TEXT,
  readFreeMintConfig,
  requestFreeMint,
  runFreeMintWorker,
  type FreeMintConfig,
  type MintChain,
  type MintRow,
  type PackTargets,
  type Prices,
} from "./free-mint-core";

export const PRICES: Prices = { coreAny: FORGE_WEI, coreSeal: SEAL_WEI, blazar: BLAZAR_WEI, kage: KAGE_WEI, ashen: ASHEN_WEI };
export const TARGETS: PackTargets = {
  core: { pack: PACKS, nft: CARDS_NFT },
  blazar: { pack: BLAZAR_PACKS, nft: BLAZAR_NFT },
  kage: { pack: KAGE_PACKS, nft: KAGE_NFT },
  ashen: { pack: ASHEN_PACKS, nft: ASHEN_NFT },
};

const transport = http("https://polygon-bor-rpc.publicnode.com");
const publicClient = createPublicClient({ chain: polygon, transport });

const packsAbi = [
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "faction", type: "uint8" }], outputs: [] },
  { type: "function", name: "settle", stateMutability: "nonpayable", inputs: [{ name: "orderId", type: "uint256" }], outputs: [] },
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
] as const;

const cardsAbi = [
  { type: "function", name: "safeTransferFrom", stateMutability: "nonpayable", inputs: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "id", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "data", type: "bytes" },
  ], outputs: [] },
] as const;

export function freeMintConfig(): FreeMintConfig {
  return readFreeMintConfig(process.env, { stopFileExists: (path) => existsSync(path), readList: (path) => readFileSync(path, "utf8") });
}

/** The treasury account, or null when not configured / unsafe. The key is only read from the env. */
function treasury() {
  const key = process.env.FREE_MINT_SIGNER;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return null;
  const account = privateKeyToAccount(key as Hex);
  if (getAddress(account.address) === getAddress(KEEPER)) {
    console.error("[free-mint] FREE_MINT_SIGNER is the keeper key. Refusing: use a separate treasury wallet.");
    return null;
  }
  return { account, wallet: createWalletClient({ account, chain: polygon, transport }) };
}

let nonceChain: Promise<unknown> = Promise.resolve();

/** One transaction at a time from the treasury, so nonces never collide. */
function sendTx(run: () => Promise<Hex>): Promise<Hex> {
  const next = nonceChain.then(run, run);
  nonceChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function receipt(hash: Hex, timeout = 120_000) {
  const got = await publicClient.waitForTransactionReceipt({ hash, timeout });
  if (got.status !== "success") throw new Error("The transaction reverted.");
  return got;
}

function decode(logs: { address: string; data: Hex; topics: [] | [Hex, ...Hex[]] }[], pack: string) {
  const out: ReturnType<typeof decodeEventLog<typeof packsAbi>>[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== pack.toLowerCase()) continue;
    try {
      out.push(decodeEventLog({ abi: packsAbi, data: log.data, topics: log.topics }));
    } catch {
      /* another event */
    }
  }
  return out;
}

function openedIds(logs: Parameters<typeof decode>[0], pack: string, orderId: bigint): bigint[] | null {
  for (const event of decode(logs, pack)) {
    if (event.eventName === "Opened" && event.args.orderId === orderId) return [event.args.id0, event.args.id1, event.args.id2, event.args.id3, event.args.id4];
  }
  return null;
}

async function maybeReceipt(hash: Hex) {
  try {
    return await publicClient.waitForTransactionReceipt({ hash, timeout: 20_000 });
  } catch {
    return null;
  }
}

function chainFor(t: NonNullable<ReturnType<typeof treasury>>): MintChain {
  const me = getAddress(t.account.address);
  const write = (address: string, abi: readonly unknown[], functionName: string, args: readonly unknown[]) =>
    sendTx(() => t.wallet.writeContract({ address: address as Address, abi: abi as never, functionName: functionName as never, args: args as never, account: t.account, chain: polygon }));
  return {
    async ensureAllowance(pack, need, cap) {
      const have = await publicClient.readContract({ address: BZB, abi: erc20, functionName: "allowance", args: [me, pack as Address] });
      if (have >= need) return;
      // Approve the window budget only, never an infinite amount.
      await receipt(await write(BZB, erc20, "approve", [pack, cap > need ? cap : need]));
    },
    async buy(pack, faction, onHash) {
      const hash = await write(pack, packsAbi, "buy", [faction]);
      await onHash(hash);
      const got = await receipt(hash);
      for (const event of decode(got.logs, pack)) if (event.eventName === "Reserved") return { orderId: event.args.orderId, block: got.blockNumber };
      throw new Error("The pack did not reserve.");
    },
    async reservedFrom(pack, hash) {
      const got = await maybeReceipt(hash as Hex);
      if (!got) return { state: "pending" };
      if (got.status !== "success") return { state: "reverted" };
      for (const event of decode(got.logs, pack)) if (event.eventName === "Reserved") return { state: "ok", orderId: event.args.orderId, block: got.blockNumber };
      return { state: "reverted" };
    },
    async order(pack, orderId) {
      const order = await publicClient.readContract({ address: pack as Address, abi: packsAbi, functionName: "orders", args: [orderId] });
      return { buyer: order[0], openedAt: BigInt(order[2]) };
    },
    blockNumber: () => publicClient.getBlockNumber(),
    async settle(pack, orderId, onHash) {
      const hash = await write(pack, packsAbi, "settle", [orderId]);
      await onHash(hash);
      const got = await receipt(hash);
      const ids = openedIds(got.logs, pack, orderId);
      if (!ids) throw new Error("The pack opened without a card list.");
      return ids;
    },
    async openedFrom(pack, hash, orderId) {
      const got = await maybeReceipt(hash as Hex);
      if (!got) return { state: "pending" };
      if (got.status !== "success") return { state: "reverted" };
      const ids = openedIds(got.logs, pack, orderId);
      return ids ? { state: "ok", ids } : { state: "reverted" };
    },
    async findOpened(pack, orderId, fromBlock) {
      const logs = await publicClient.getLogs({
        address: pack as Address,
        event: parseAbiItem("event Opened(uint256 indexed orderId, address indexed buyer, uint8 faction, uint256 id0, uint256 id1, uint256 id2, uint256 id3, uint256 id4)"),
        args: { orderId },
        fromBlock,
        toBlock: "latest",
      });
      const hit = logs[0];
      return hit ? [hit.args.id0!, hit.args.id1!, hit.args.id2!, hit.args.id3!, hit.args.id4!] : null;
    },
    async transfer(nft, to, id, amount, onHash) {
      const hash = await write(nft, cardsAbi, "safeTransferFrom", [me, getAddress(to), id, amount, "0x"]);
      await onHash(hash);
      await receipt(hash);
    },
    async txState(hash) {
      const got = await maybeReceipt(hash as Hex);
      if (!got) return "pending";
      return got.status === "success" ? "success" : "reverted";
    },
  };
}

/** Run one worker pass if the feature is on and the treasury is configured. Never throws. */
export async function kickFreeMint(): Promise<void> {
  const cfg = freeMintConfig();
  if (!cfg.enabled || cfg.stopped || !cfg.signerConfigured) return;
  const t = treasury();
  if (!t) return;
  try {
    await runFreeMintWorker(await getSql(), chainFor(t), cfg, TARGETS);
  } catch (error) {
    console.error("[free-mint] worker pass failed", error);
  }
}

let ticking = false;

/** Start a 30 s background pass, only when the feature is on. Safe to call many times. */
export function ensureFreeMintTicker(): void {
  if (ticking) return;
  const cfg = freeMintConfig();
  if (!cfg.enabled || !cfg.signerConfigured) return;
  ticking = true;
  setInterval(() => void kickFreeMint(), 30_000).unref?.();
}

export type PublicClaim = { id: string; status: MintRow["status"]; edition: string; cards: string[]; error: string | null };

export function publicClaim(row: MintRow): PublicClaim {
  return { id: row.id, status: row.status, edition: row.edition, cards: (row.card_ids ?? "").split(",").filter(Boolean), error: row.status === "failed" ? row.error : null };
}

export async function claimFreeMint(wallet: string, input: { faction?: number; ip: string }) {
  const cfg = freeMintConfig();
  const sql = await getSql();
  const result = await requestFreeMint(sql, cfg, { wallet, faction: input.faction, ip: input.ip, now: Date.now(), prices: PRICES, newId: randomUUID });
  if ("refused" in result) return { error: REFUSAL_TEXT[result.refused], code: result.refused };
  ensureFreeMintTicker();
  void kickFreeMint();
  return { claim: publicClaim(result.row), created: result.created };
}

export async function freeMintStatus(wallet: string | null) {
  const cfg = freeMintConfig();
  const live = cfg.enabled && cfg.signerConfigured && !cfg.stopped && cfg.start !== null && cfg.end !== null && Date.now() >= cfg.start && Date.now() < cfg.end;
  const base = { live, start: cfg.start ? new Date(cfg.start).toISOString() : null, end: cfg.end ? new Date(cfg.end).toISOString() : null, edition: cfg.edition, choice: cfg.factionMode === "player-choice" };
  if (!live || !wallet) return { ...base, claims: [] as PublicClaim[] };
  const sql = await getSql();
  const rows = await sql<MintRow>`select * from veil_free_mints where wallet = ${wallet.toLowerCase()} and window_id = ${cfg.windowId} order by n`;
  return { ...base, claims: rows.map(publicClaim) };
}
