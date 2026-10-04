import { createPublicClient, createWalletClient, formatEther, http, isAddress, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { POLYGON_PARAMS } from "./chain";

const transport = http(POLYGON_PARAMS.rpcUrls[0]);

export const polygonClient = createPublicClient({ chain: polygon, transport });

export function addressOf(key: `0x${string}`): `0x${string}` {
  return privateKeyToAccount(key).address;
}

export function polLabel(wei: bigint): string {
  const [whole, frac = ""] = formatEther(wei).split(".");
  return `${whole}.${(frac + "0000").slice(0, 4)}`;
}

export function isPolAddress(value: string): value is `0x${string}` {
  return isAddress(value);
}

export async function spendableAmount(address: `0x${string}`): Promise<string> {
  const [balance, fees] = await Promise.all([
    polygonClient.getBalance({ address }),
    polygonClient.estimateFeesPerGas(),
  ]);
  const price = fees.maxFeePerGas ?? 0n;
  const reserve = 21_000n * price;
  const wei = balance > reserve ? balance - reserve : 0n;
  const [whole, frac = ""] = formatEther(wei).split(".");
  const trimmed = frac.slice(0, 6).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole || "0";
}

export async function sendPol(key: `0x${string}`, to: `0x${string}`, amount: string): Promise<`0x${string}`> {
  const account = privateKeyToAccount(key);
  const wallet = createWalletClient({ account, chain: polygon, transport });
  return wallet.sendTransaction({ to, value: parseEther(amount) });
}
