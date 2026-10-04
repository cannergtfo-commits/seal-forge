import { create } from "zustand";
import { persist } from "zustand/middleware";
import { cardOf, schoolOf, type CardDef } from "./cards";

export type Copy = { serial: number; defId: string; tokenId: number };

type VaultState = {
  copies: Copy[];
  nextSerial: number;
  packsOpened: number;
  notePull: (cards: CardDef[]) => void;
};

export const PACK_TOKENS = [
  { id: 1000, name: "Forge Pack", note: "Five cards from any seal, including unbound." },
  { id: 1001, name: "Aureth Seal", note: "Aureth cards. Unbound cards can be mixed in." },
  { id: 1002, name: "Veymar Seal", note: "Veymar cards. Unbound cards can be mixed in." },
  { id: 1003, name: "Rixen Seal", note: "Rixen cards. Unbound cards can be mixed in." },
  { id: 1004, name: "Quorin Seal", note: "Quorin cards. Unbound cards can be mixed in." },
  { id: 1005, name: "Malrec Seal", note: "Malrec cards. Unbound cards can be mixed in." },
] as const;

export function metadataFor(id: string) {
  const card = cardOf(id);
  return {
    name: card.name,
    description: card.text,
    image: card.art,
    attributes: [
      { trait_type: "Faction", value: card.faction === "veil" ? "Unbound" : card.faction },
      { trait_type: "Set", value: card.set === "ashen" ? "Ashen Veil" : card.set === "kage" ? "Kage Veil" : card.set === "blazar" ? "Blazar Veil" : "Founding" },
      { trait_type: "Seal", value: card.faction === "veil" ? "Unbound" : card.faction === "elf" ? "Aureth" : card.faction === "human" ? "Veymar" : card.faction === "goblin" ? "Rixen" : card.faction === "robot" ? "Quorin" : "Malrec" },
      { trait_type: "Rarity", value: card.rarity },
      { trait_type: "Kind", value: card.kind },
      { trait_type: "School", value: schoolOf(card) },
      { trait_type: "Cost", value: card.cost },
      { trait_type: "Attack", value: card.atk },
      { trait_type: "Health", value: card.hp },
      { trait_type: "Token ID", value: card.tokenId },
    ],
  };
}

function tokenIdFor(id: string): number {
  return cardOf(id).tokenId;
}

export const useVault = create<VaultState>()(
  persist(
    (set) => ({
      copies: [],
      nextSerial: 1,
      packsOpened: 0,
      notePull: (cards) => {
        set((state) => ({
          copies: [
            ...state.copies,
            ...cards.map((card, index) => ({
              serial: state.nextSerial + index,
              defId: card.id,
              tokenId: card.tokenId || tokenIdFor(card.id),
            })),
          ],
          nextSerial: state.nextSerial + cards.length,
          packsOpened: state.packsOpened + 1,
        }));
      },
    }),
    { name: "veilforge-v1", skipHydration: true },
  ),
);
