import { BZB } from "./deployed";
import { polLabel, polygonClient } from "./pol";

const PAIR = "0x6ccd623a2002f5198f7acd94011af1be0a193307" as const;
const USDC_PAIR = "0x6e7a5FAFcec6BB1e78bAE2A1F0B612012BF14827" as const;

const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const pairAbi = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

export type BzbQuote = { amount: string; usd: string; price: string };

function usd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(value < 0.0001 ? 6 : 4)}`;
  return `$${value.toFixed(2)}`;
}

export async function readBzb(address: `0x${string}` | null): Promise<BzbQuote> {
  const [reserves, usdReserves, raw] = await Promise.all([
    polygonClient.readContract({ address: PAIR, abi: pairAbi, functionName: "getReserves" }),
    polygonClient.readContract({ address: USDC_PAIR, abi: pairAbi, functionName: "getReserves" }),
    address
      ? polygonClient.readContract({ address: BZB, abi: erc20, functionName: "balanceOf", args: [address] })
      : Promise.resolve(0n),
  ]);
  const pol = Number(reserves[0]) / 1e18;
  const bzb = Number(reserves[1]) / 1e18;
  const polPool = Number(usdReserves[0]) / 1e18;
  const usdc = Number(usdReserves[1]) / 1e6;
  const unit = pol > 0 && bzb > 0 && polPool > 0 ? (pol / bzb) * (usdc / polPool) : 0;
  const held = Number(raw) / 1e18;
  return {
    amount: polLabel(raw),
    usd: usd(held * unit),
    price: unit > 0 ? `$${unit.toFixed(6)}` : "—",
  };
}
