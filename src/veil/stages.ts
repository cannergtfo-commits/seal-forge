import { isAddress, type Address } from "viem";
import { STAGE } from "@/veil/deployed";
import { polygonClient } from "@/veil/pol";
import { isApk } from "@/veil/shell";

export const STAGE_PRICE = 10_000_000_000_000_000_000n;

export type StageArt = {
  id: number;
  name: string;
  wide: string;
  tall: string;
  music: string | null;
  blurb: string;
};

export const STAGES: StageArt[] = [
  {
    id: 1,
    name: "Skyhold",
    wide: "/assets/veil/stage/skyhold-wide.jpg",
    tall: "/assets/veil/stage/skyhold-tall.jpg",
    music: "/assets/veil/music/skyhold.ogg",
    blurb: "The five seals meet above the falls. One token shows the wide board in the browser and the tall board on the phone.",
  },
];

export const stageAbi = [
  { type: "function", name: "mint", stateMutability: "payable", inputs: [{ name: "dropId", type: "uint256" }], outputs: [] },
  {
    type: "function",
    name: "drop",
    stateMutability: "view",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "cap", type: "uint256" },
      { name: "sold", type: "uint256" },
      { name: "payee", type: "address" },
      { name: "uri", type: "string" },
    ],
  },
  { type: "function", name: "owns", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "dropId", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "nextDrop", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "treasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export function stagePick(address: string): number {
  if (!address) return 0;
  const raw = Number(localStorage.getItem(`seal-stage:${address.toLowerCase()}`) ?? "0");
  return Number.isInteger(raw) && raw > 0 && raw < 64 ? raw : 0;
}

export function saveStagePick(address: string, dropId: number) {
  localStorage.setItem(`seal-stage:${address.toLowerCase()}`, String(dropId));
}

export async function ownsStage(account: string, dropId: number): Promise<boolean> {
  if (!isAddress(account) || dropId < 1) return false;
  try {
    return await polygonClient.readContract({ address: STAGE, abi: stageAbi, functionName: "owns", args: [account, BigInt(dropId)] });
  } catch {
    return false;
  }
}

export async function ownedStageIds(account: Address): Promise<number[]> {
  try {
    const next = Number(await polygonClient.readContract({ address: STAGE, abi: stageAbi, functionName: "nextDrop" }));
    const limit = Math.min(next, 25);
    const ids: number[] = [];
    for (let id = 1; id < limit; id++) {
      if (await ownsStage(account, id)) ids.push(id);
    }
    return ids;
  } catch {
    return [];
  }
}

export function stageVisual(id: number): { src: string; music: string | null; name: string } | null {
  const known = STAGES.find((item) => item.id === id);
  if (!known) return null;
  return { src: isApk() ? known.tall : known.wide, music: known.music, name: known.name };
}

export async function readDrop(id: number): Promise<{ price: bigint; cap: bigint; sold: bigint; payee: Address; uri: string } | null> {
  try {
    const [price, cap, sold, payee, uri] = await polygonClient.readContract({ address: STAGE, abi: stageAbi, functionName: "drop", args: [BigInt(id)] });
    if (cap === 0n) return null;
    return { price, cap, sold, payee, uri };
  } catch {
    return null;
  }
}
