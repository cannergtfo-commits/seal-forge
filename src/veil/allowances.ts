import { maxUint256, type Address } from "viem";
import { playerClient, sentBy } from "./connect";
import { ASHEN_NFT, ASHEN_PACKS, BAZAAR, BLAZAR_NFT, BLAZAR_PACKS, BZB, CARDS_NFT, KAGE_NFT, KAGE_PACKS, MARKET, PACKS } from "./deployed";
import { polygonClient } from "./pol";
import { sendGame } from "./signer";

const erc20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const cardsAbi = [
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const FULL = maxUint256 / 2n;

type Grant =
  | { id: string; label: string; kind: "bzb"; spender: Address }
  | { id: string; label: string; kind: "cards"; collection: Address; operator: Address };

/** BzB spenders for packs and buys, and card operators for listings. Nothing else. */
const GRANTS: Grant[] = [
  { id: "packs", label: "Founding packs", kind: "bzb", spender: PACKS },
  { id: "blazar-packs", label: "Blazar packs", kind: "bzb", spender: BLAZAR_PACKS },
  { id: "kage-packs", label: "Kage packs", kind: "bzb", spender: KAGE_PACKS },
  { id: "ashen-packs", label: "Ashen packs", kind: "bzb", spender: ASHEN_PACKS },
  { id: "market-bzb", label: "Market buys", kind: "bzb", spender: MARKET },
  { id: "bazaar-bzb", label: "Bazaar buys", kind: "bzb", spender: BAZAAR },
  { id: "core-cards", label: "List founding cards", kind: "cards", collection: CARDS_NFT, operator: MARKET },
  { id: "blazar-cards", label: "List Blazar cards", kind: "cards", collection: BLAZAR_NFT, operator: BAZAAR },
  { id: "kage-cards", label: "List Kage cards", kind: "cards", collection: KAGE_NFT, operator: BAZAAR },
  { id: "ashen-cards", label: "List Ashen cards", kind: "cards", collection: ASHEN_NFT, operator: BAZAAR },
];

export type AllowanceRow = { id: string; label: string; ready: boolean };

export async function readAllowances(owner: Address): Promise<AllowanceRow[]> {
  const rows = await polygonClient.multicall({
    allowFailure: true,
    contracts: GRANTS.map((grant) =>
      grant.kind === "bzb"
        ? { address: BZB, abi: erc20, functionName: "allowance" as const, args: [owner, grant.spender] as const }
        : { address: grant.collection, abi: cardsAbi, functionName: "isApprovedForAll" as const, args: [owner, grant.operator] as const },
    ),
  });
  return GRANTS.map((grant, index) => {
    const row = rows[index];
    const ready = row?.status === "success" && (grant.kind === "bzb" ? (row.result as bigint) >= FULL : row.result === true);
    return { id: grant.id, label: grant.label, ready };
  });
}

/** Sends only the missing approvals, and waits until each one is mined. */
export async function grantAllowances(localKey: `0x${string}` | null, onStep?: (label: string, index: number, total: number) => void): Promise<void> {
  const { address, wallet } = await playerClient(localKey);
  const current = await readAllowances(address);
  const missing = GRANTS.filter((grant) => !current.find((row) => row.id === grant.id)?.ready);
  if (!missing.length) return;
  for (let index = 0; index < missing.length; index++) {
    const grant = missing[index]!;
    onStep?.(grant.label, index + 1, missing.length);
    const hash = await sendGame(localKey, address, (nonce) =>
      grant.kind === "bzb"
        ? wallet.writeContract({ address: BZB, abi: erc20, functionName: "approve", args: [grant.spender, maxUint256], nonce })
        : wallet.writeContract({ address: grant.collection, abi: cardsAbi, functionName: "setApprovalForAll", args: [grant.operator, true], nonce }),
    );
    await sentBy(hash, address);
  }
}
