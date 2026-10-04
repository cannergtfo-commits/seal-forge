import { privateKeyToAccount } from "viem/accounts";
import { playerClient } from "./connect";
import { writeSession, type AccountSession } from "./session";
import { gameKeySigns } from "./signer";

async function signLogin(localKey: `0x${string}` | null, message: string): Promise<{ address: string; signature: `0x${string}` }> {
  if (localKey && gameKeySigns(localKey)) {
    const account = privateKeyToAccount(localKey);
    return { address: account.address, signature: await account.signMessage({ message }) };
  }
  const { wallet, address } = await playerClient(localKey);
  const signature = await wallet.signMessage({ account: address, message });
  return { address, signature };
}

let pending: Promise<AccountSession & { profile: unknown }> | null = null;

export async function openSession(localKey: `0x${string}` | null, address: string): Promise<AccountSession & { profile: unknown }> {
  if (pending) return pending;
  pending = openNow(localKey, address).finally(() => {
    pending = null;
  });
  return pending;
}

async function openNow(localKey: `0x${string}` | null, address: string): Promise<AccountSession & { profile: unknown }> {
  const challenge = await fetch("/api/veilforge/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "challenge", address }),
  });
  const prompt = (await challenge.json()) as { message?: string; error?: string };
  if (!prompt.message) throw new Error(prompt.error ?? "No prompt.");
  const signed = await signLogin(localKey, prompt.message);
  if (signed.address.toLowerCase() !== address.toLowerCase()) throw new Error("The wallet account changed. Sign in again.");
  const opened = await fetch("/api/veilforge/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "sign", address: signed.address, signature: signed.signature }),
  });
  const body = (await opened.json()) as { token?: string; profile?: unknown; error?: string };
  if (!body.token) throw new Error(body.error ?? "Sign-in failed.");
  const next = { token: body.token, address: signed.address };
  writeSession(next);
  return { ...next, profile: body.profile ?? null };
}
