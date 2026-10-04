import { useEffect, useState } from "react";
import { isAddress } from "viem";
import { ASHEN_PACK_CAP, ASHEN_PACKS, BLAZAR_PACK_CAP, BLAZAR_PACKS, FOUNDING_PACK_CAP, KAGE_PACK_CAP, KAGE_PACKS, PACKS } from "@/veil/deployed";
import { polygonClient } from "@/veil/pol";

const abi = [
  { type: "function", name: "sold", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "remaining", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export function PackSupply({ edition, tick = 0 }: { edition: "founding" | "blazar" | "kage" | "ashen"; tick?: number }) {
  const cap = edition === "ashen" ? ASHEN_PACK_CAP : edition === "kage" ? KAGE_PACK_CAP : edition === "blazar" ? BLAZAR_PACK_CAP : FOUNDING_PACK_CAP;
  const address = edition === "ashen" ? ASHEN_PACKS : edition === "kage" ? KAGE_PACKS : edition === "blazar" ? BLAZAR_PACKS : PACKS;
  const [minted, setMinted] = useState<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!isAddress(address) || BigInt(address) === 0n) {
      setMinted(null);
      setLeft(null);
      return;
    }
    let cancel = false;
    Promise.all([
      polygonClient.readContract({ address, abi, functionName: "sold" }),
      polygonClient.readContract({ address, abi, functionName: "remaining" }),
    ])
      .then(([sold, remaining]) => {
        if (cancel) return;
        setMinted(Number(sold));
        setLeft(Number(remaining));
      })
      .catch(() => {
        if (!cancel) {
          setMinted(null);
          setLeft(null);
        }
      });
    return () => {
      cancel = true;
    };
  }, [address, tick]);

  return (
    <p className="font-mono text-xs text-brass">
      {minted === null || left === null
        ? `— minted of ${cap.toLocaleString()}`
        : `${minted.toLocaleString()} minted of ${cap.toLocaleString()} · ${left.toLocaleString()} remaining`}
    </p>
  );
}
