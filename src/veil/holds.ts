import { createPublicClient, http, isAddress } from "viem";
import { polygon } from "viem/chains";
import { CARDS } from "./cards";
import { ASHEN_NFT, BLAZAR_NFT, CARDS_NFT, KAGE_NFT } from "./deployed";
import { deckFits } from "./ranks";

const client = createPublicClient({ chain: polygon, transport: http("https://polygon-bor-rpc.publicnode.com") });

const balanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "id", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
] as const;

function nftOf(edition: string): `0x${string}` | "" {
  if (edition === "ashen") return ASHEN_NFT;
  if (edition === "kage") return KAGE_NFT;
  if (edition === "blazar") return BLAZAR_NFT;
  return CARDS_NFT;
}

export async function veilBalances(address: `0x${string}`): Promise<number[]> {
  const contracts = CARDS.flatMap((card) => {
    const token = nftOf(card.edition);
    if (!token || !isAddress(token)) return [];
    return [
      {
        address: token,
        abi: balanceAbi,
        functionName: "balanceOf" as const,
        args: [address, BigInt(card.tokenId)] as const,
      },
    ];
  });
  if (!contracts.length) return CARDS.map(() => 0);
  const rows = await client.multicall({ contracts, allowFailure: true });
  const balances = CARDS.map(() => 0);
  let cursor = 0;
  CARDS.forEach((card, index) => {
    const token = nftOf(card.edition);
    if (!token || !isAddress(token)) return;
    const row = rows[cursor];
    cursor += 1;
    balances[index] = row?.status === "success" ? Number(row.result) : 0;
  });
  return balances;
}

export async function holdsVeilCard(address: string): Promise<boolean> {
  if (!isAddress(address)) return false;
  const balances = await veilBalances(address);
  return balances.some((count) => count > 0);
}

export async function deckOwned(address: string, deck: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isAddress(address)) return { ok: false, error: "Connect the wallet that holds the cards." };
  let balances: number[];
  try {
    balances = await veilBalances(address);
  } catch {
    return { ok: false, error: "Could not read this wallet's card NFTs." };
  }
  const owned = new Map(CARDS.map((card, index) => [card.id, balances[index] ?? 0]));
  if (!deckFits(deck, owned)) return { ok: false, error: "That deck uses cards this wallet does not hold as NFTs." };
  return { ok: true };
}
