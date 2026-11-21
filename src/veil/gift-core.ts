/**
 * Pure helpers for the first-win gift (gift-server.ts is the chain adapter).
 * Nothing here signs or sends anything, so every rule can be unit-tested.
 */
import type { Address } from "viem";

/**
 * Polygon RPCs for the gift worker, in order. viem's fallback() moves to the next one
 * when a node errors. publicnode stays last: it answers "Archive requests require a
 * personal token" (HTTP 403, -32602) for the receipt of a transaction it has not
 * indexed yet, which broke every gift claim. polygon-rpc.com is gone (tenant disabled).
 */
export function polygonRpcUrls(env: Record<string, string | undefined> = {}): string[] {
  const own = (env.SEAL_FORGE_RPC ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => /^https:\/\//i.test(url));
  const urls = [...own, "https://polygon.drpc.org", "https://1rpc.io/matic", "https://polygon-bor-rpc.publicnode.com"];
  return [...new Set(urls)];
}

export type MinedReceipt = { status: "success" | "reverted" };

/**
 * Poll for a receipt until it exists or the time runs out. Any RPC error (receipt not
 * found yet, rate limit, "archive" 403, timeout) means "ask again", never "failed".
 * Returns null when the transaction is still unknown at the deadline.
 */
export async function pollReceipt<R extends MinedReceipt>(
  get: () => Promise<R | null>,
  opts: { timeoutMs: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number },
): Promise<R | null> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const interval = opts.intervalMs ?? 2_000;
  const deadline = now() + opts.timeoutMs;
  for (;;) {
    try {
      const receipt = await get();
      if (receipt) return receipt;
    } catch {
      /* not mined yet, or the node hiccuped: ask again */
    }
    if (now() >= deadline) return null;
    await sleep(interval);
  }
}

/** The transaction is broadcast but its receipt is not known yet. Retrying later resumes it. */
export class GiftPending extends Error {
  constructor(message = "The gift is still confirming on Polygon. Claim again in a minute.") {
    super(message);
    this.name = "GiftPending";
  }
}

/** The transaction was mined and reverted. */
export class GiftReverted extends Error {
  constructor(message = "The gift transaction failed.") {
    super(message);
    this.name = "GiftReverted";
  }
}

export type KeeperOrder = { id: bigint; buyer: Address; faction: number; price: bigint };

/**
 * A pack the keeper already paid for that can still be committed to the waiting player:
 * bought by the keeper, Founding forge (faction 0), at the gift price, not owed to anyone,
 * and not recorded on any profile. Newest first. This recovers a buy whose receipt was
 * lost, instead of buying a second pack.
 */
export function pickOrphanOrder(
  orders: KeeperOrder[],
  owed: Map<bigint, Address>,
  input: { keeper: Address; price: bigint; recorded: Set<string> },
): bigint | null {
  const zero = "0x0000000000000000000000000000000000000000";
  const keeper = input.keeper.toLowerCase();
  const hits = orders
    .filter((order) => order.buyer.toLowerCase() === keeper && order.faction === 0 && order.price === input.price)
    .filter((order) => (owed.get(order.id) ?? zero).toLowerCase() === zero)
    .filter((order) => !input.recorded.has(order.id.toString()))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return hits[0]?.id ?? null;
}

/** Turn a raw server error into something a player can act on. RPC dumps stay in the server log. */
export function giftErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (error instanceof GiftPending) return error.message;
  if (/rpc|request body|http request|fetch failed|timed? ?out|archive requests|rate limit|429|403|502|503|socket|network/i.test(message)) {
    return "Polygon did not answer in time. Your claim is saved. Claim again in a minute.";
  }
  if (/Empty\(\)|0x3db2a12a|insufficient funds|exceeds balance/i.test(message)) {
    return "The gift pool is empty right now. Your claim is saved for when it is refilled.";
  }
  return message || "The gift did not finish. Claim again in a minute.";
}
