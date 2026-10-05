import type { Address, Hex } from "viem";

export type Prize = { matchId: Hex; signature: Hex };

function apiUrl(path: string): string {
  if (typeof window === "undefined") return path;
  const origin = window.__SEAL_API__;
  if (origin && window.location.protocol === "file:") return `${origin.replace(/\/$/, "")}${path}`;
  return path;
}

/** Asks the same reward server the website uses. A card NFT and the daily cap still apply. */
export async function askPrize(address: Address): Promise<{ prize: Prize } | { error: "needs-card" | "cap" | "down" }> {
  try {
    const res = await fetch(apiUrl("/api/veilforge/reward"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address }),
    });
    const body = (await res.json()) as { matchId?: Hex; signature?: Hex; error?: string };
    if (body.matchId && body.signature) return { prize: { matchId: body.matchId, signature: body.signature } };
    if (body.error === "needs-card" || body.error === "cap") return { error: body.error };
    return { error: "down" };
  } catch {
    return { error: "down" };
  }
}
