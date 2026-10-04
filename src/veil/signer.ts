import { maxUint256, type Address, type Hash } from "viem";
import { useInjected } from "./connect";
import { BZB } from "./deployed";
import { polygonClient } from "./pol";
import { isApk } from "./shell";

const erc20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const spent = new Set<string>();
const nonceOf = new Map<string, number>();
let tail: Promise<unknown> = Promise.resolve();

/** True when the in-game key signs, not MetaMask or Phantom. */
export function gameKeySigns(localKey: `0x${string}` | null): boolean {
  if (!localKey) return false;
  if (isApk()) return true;
  return !useInjected.getState().address;
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = tail.then(job, job);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function takeNonce(owner: Address): Promise<number> {
  const id = owner.toLowerCase();
  const known = nonceOf.get(id);
  if (known != null) {
    nonceOf.set(id, known + 1);
    return known;
  }
  const next = await polygonClient.getTransactionCount({ address: owner, blockTag: "pending" });
  nonceOf.set(id, next + 1);
  return next;
}

/** One ordered signer for the in-game key. Extension wallets still ask on each transaction. */
export async function sendGame(localKey: `0x${string}` | null, owner: Address, write: (nonce?: number) => Promise<Hash>): Promise<Hash> {
  if (!gameKeySigns(localKey)) return write(undefined);
  return enqueue(async () => {
    const nonce = await takeNonce(owner);
    try {
      return await write(nonce);
    } catch (error) {
      nonceOf.delete(owner.toLowerCase());
      throw error;
    }
  });
}

/** The in-game key approves a spender once. An extension wallet approves only the amount of this action. */
export async function ensureBzb(
  localKey: `0x${string}` | null,
  owner: Address,
  spender: Address,
  need: bigint,
  write: (amount: bigint, nonce?: number) => Promise<Hash>,
  confirm: (hash: Hash) => Promise<unknown>,
): Promise<void> {
  const id = `${owner.toLowerCase()}:${spender.toLowerCase()}`;
  if (gameKeySigns(localKey) && spent.has(id)) return;
  const allowance = await polygonClient.readContract({ address: BZB, abi: erc20, functionName: "allowance", args: [owner, spender] });
  if (allowance >= need) {
    if (gameKeySigns(localKey)) spent.add(id);
    return;
  }
  const amount = gameKeySigns(localKey) ? maxUint256 : need;
  const hash = await sendGame(localKey, owner, (nonce) => write(amount, nonce));
  try {
    await confirm(hash);
  } catch (error) {
    spent.delete(id);
    throw error;
  }
  if (gameKeySigns(localKey)) spent.add(id);
}
