/**
 * Chain adapter for daily-clear confirms. Reads a claim receipt over the same
 * RPC fallback list as the gift server. Never signs, never sends a transaction.
 */
import { getAddress, isAddress, type Hex } from "viem";
import { createPublicClient, fallback, http } from "viem";
import { polygon } from "viem/chains";
import { getSql } from "@/lib/db";
import { profileByToken } from "./accounts";
import { applyVerifiedClaim, verifyClaimReceipt, type ConfirmResult } from "./daily-clear";
import { pollReceipt, polygonRpcUrls } from "./gift-core";

let client: ReturnType<typeof createPublicClient> | null = null;

function reader() {
  client ??= createPublicClient({
    chain: polygon,
    transport: fallback(polygonRpcUrls(process.env).map((url) => http(url, { timeout: 15_000, retryCount: 1 }))),
  });
  return client;
}

export type ConfirmReply =
  | (ConfirmResult & { xp: number })
  | { ok: false; error: string; retry: boolean };

export async function confirmClaimTx(token: string, rawHash: string): Promise<ConfirmReply> {
  const profile = typeof token === "string" && token ? await profileByToken(token).catch(() => null) : null;
  if (!profile || !isAddress(profile.address)) return { ok: false, error: "Sign in to record that claim.", retry: false };
  if (!/^0x[0-9a-fA-F]{64}$/.test(rawHash)) return { ok: false, error: "That claim is missing a transaction hash.", retry: false };
  const hash = rawHash as Hex;
  const chain = reader();
  let tx: { from: string; to: string | null; input: Hex } | null = null;
  let receipt: { status: "success" | "reverted"; from: string; to: string | null; logs: { address: string; topics: readonly string[]; data: string }[] } | null = null;
  try {
    const foundTx = await pollReceipt(() => chain.getTransaction({ hash }).then((row) => row ?? null).catch(() => null), {
      timeoutMs: 20_000,
      intervalMs: 2_000,
    });
    const foundReceipt = await pollReceipt(
      () => chain.getTransactionReceipt({ hash }).then((row) => row ?? null).catch(() => null),
      { timeoutMs: 20_000, intervalMs: 2_000 },
    );
    if (foundTx) tx = { from: foundTx.from, to: foundTx.to, input: foundTx.input };
    if (foundReceipt) {
      receipt = {
        status: foundReceipt.status,
        from: foundReceipt.from,
        to: foundReceipt.to,
        logs: foundReceipt.logs.map((log) => ({ address: log.address, topics: log.topics, data: log.data })),
      };
    }
  } catch {
    return { ok: false, error: "Polygon did not answer. We'll try that claim again.", retry: true };
  }
  if (!tx || !receipt) return { ok: false, error: "Polygon has not confirmed that claim yet.", retry: true };
  const verified = verifyClaimReceipt({ tx: { ...tx, hash }, receipt, player: getAddress(profile.address) });
  if ("error" in verified) {
    const text =
      verified.error === "reverted"
        ? "That claim transaction did not succeed."
        : verified.error === "wrong-player"
          ? "Sign in with the wallet that claimed."
          : verified.error === "wrong-contract" || verified.error === "not-claim" || verified.error === "no-payout"
            ? "That transaction is not a Seal Forge win claim."
            : "That claim could not be read.";
    return { ok: false, error: text, retry: false };
  }
  const sql = await getSql();
  const applied = await applyVerifiedClaim(sql, { player: getAddress(profile.address), matchId: verified.matchId, txHash: hash });
  if (!applied.ok) return { ok: false, error: applied.error, retry: false };
  const next = await profileByToken(token);
  return { ...applied, xp: next?.xp ?? profile.xp };
}
