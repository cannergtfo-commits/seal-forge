/**
 * Read-only lookups for the profile page: which of a wallet's signed win vouchers
 * were actually paid by VeilRewards. Uses the public `paid(bytes32)` view only.
 * No keys, no writes, no signing. Same RPC fallback list as the gift server (#28).
 */
import { createPublicClient, fallback, http, type Hex } from "viem";
import { polygon } from "viem/chains";
import { REWARDS, WIN_WEI } from "./deployed";
import { polygonRpcUrls } from "./gift-core";

const paidAbi = [
  {
    type: "function",
    name: "paid",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

let client: ReturnType<typeof createPublicClient> | null = null;

function reader() {
  client ??= createPublicClient({
    chain: polygon,
    transport: fallback(
      polygonRpcUrls(process.env).map((url) => http(url, { timeout: 10_000, retryCount: 1 })),
    ),
  });
  return client;
}

const cache = new Map<string, { at: number; paid: number }>();
const TTL_MS = 2 * 60 * 1000;

/**
 * How many of these vouchers VeilRewards has paid. Returns null when Polygon could
 * not be read, so the page can say "unknown" instead of showing a made-up 0.
 */
export async function paidVoucherCount(wallet: string, matchIds: string[]): Promise<number | null> {
  const ids = matchIds.filter((id): id is Hex => /^0x[0-9a-fA-F]{64}$/.test(id));
  if (!ids.length) return 0;
  const key = `${wallet.toLowerCase()}:${ids.length}:${ids[ids.length - 1]}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.paid;
  try {
    const results = await reader().multicall({
      contracts: ids.map((id) => ({
        address: REWARDS,
        abi: paidAbi,
        functionName: "paid" as const,
        args: [id] as const,
      })),
      allowFailure: true,
    });
    if (results.some((r) => r.status !== "success")) return null;
    const paid = results.filter((r) => r.result === true).length;
    cache.set(key, { at: Date.now(), paid });
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return paid;
  } catch {
    return null;
  }
}

/** BzB (as a decimal string) for a number of paid wins at the contract's fixed WIN amount. */
export function winsToBzb(paid: number): string {
  const wei = WIN_WEI * BigInt(Math.max(0, Math.floor(paid)));
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 2).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}
