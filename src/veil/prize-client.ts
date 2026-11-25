import type { Address, Hex } from "viem";
import { readSession } from "./session";

export type Prize = { matchId: Hex; signature: Hex };

function apiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const origin = window.__SEAL_API__;
  if (origin && window.location.protocol === "file:") return `${origin.replace(/\/$/, "")}${path}`;
  return path;
}

/** Asks the reward server to sign a win this server already scored. Local practice and friend-device tables have no room id and cannot be claimed. */
export async function askPrize(address: Address, roomId: string): Promise<{ prize: Prize } | { error: "needs-card" | "cap" | "down" | "unverified" }> {
  if (!roomId) return { error: "unverified" };
  const session = readSession();
  const token = session && session.token !== "device" && session.address.toLowerCase() === address.toLowerCase() ? session.token : "";
  if (!token) return { error: "unverified" };
  try {
    const res = await fetch(apiUrl("/api/veilforge/reward"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, roomId, token }),
    });
    const body = (await res.json()) as { matchId?: Hex; signature?: Hex; error?: string };
    if (body.matchId && body.signature) return { prize: { matchId: body.matchId, signature: body.signature } };
    if (body.error === "needs-card" || body.error === "cap") return { error: body.error };
    if (typeof body.error === "string" && body.error.includes("not recorded")) return { error: "unverified" };
    return { error: "down" };
  } catch {
    return { error: "down" };
  }
}

export type ClaimReport = {
  clear: boolean;
  xp: number;
  fresh: Array<{ id: string; name: string; rarity: string; flavor: string; badge: string }>;
};

/**
 * Tells the server about a claim() the player already sent. Fire-and-forget from
 * the client: retries on transient RPC failures and never throws.
 */
export async function reportClaimWithRetry(txHash: Hex): Promise<ClaimReport | null> {
  const session = readSession();
  const token = session && session.token !== "device" ? session.token : "";
  if (!token) return null;
  let delay = 1_000;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(apiUrl("/api/veilforge/reward"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, txHash }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        retry?: boolean;
        clear?: { granted?: boolean; xp?: number };
        xp?: number;
        fresh?: ClaimReport["fresh"];
        error?: string;
      };
      if (body.ok) {
        return {
          clear: Boolean(body.clear?.granted),
          xp: Number(body.clear?.xp ?? body.xp ?? 0) || 0,
          fresh: Array.isArray(body.fresh) ? body.fresh : [],
        };
      }
      if (body.retry === false) return null;
    } catch {
      /* try again */
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 8_000);
  }
  return null;
}
