import { create } from "zustand";
import { persist } from "zustand/middleware";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export type SentTx = {
  hash: `0x${string}`;
  to: string;
  amount: string;
  at: number;
  asset?: string;
};

type KeyState = {
  key: `0x${string}` | null;
  sent: SentTx[];
  create: () => void;
  importKey: (raw: string) => string | null;
  erase: () => void;
  note: (tx: SentTx) => void;
};

function normalize(raw: string): `0x${string}` | null {
  const trimmed = raw.trim();
  const hex = trimmed.startsWith("0x") || trimmed.startsWith("0X") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) return null;
  return `0x${hex.slice(2).toLowerCase()}` as `0x${string}`;
}

/** Drop a key if a wallet error ever echoes it. Signing itself never sends the key. */
export function redactKey(text: string, key: string | null | undefined): string {
  if (!key) return text;
  const bare = key.startsWith("0x") || key.startsWith("0X") ? key.slice(2) : key;
  if (bare.length < 64) return text;
  return text.replaceAll(key, "0x[redacted]").replaceAll(bare, "[redacted]").replaceAll(bare.toLowerCase(), "[redacted]");
}

export const usePolKey = create<KeyState>()(
  persist(
    (set, get) => ({
      key: null,
      sent: [],
      create: () => {
        if (get().key) return;
        set({ key: generatePrivateKey() });
      },
      importKey: (raw) => {
        const key = normalize(raw);
        if (!key) return "Paste a 64-character hex private key.";
        try {
          privateKeyToAccount(key);
        } catch {
          return "That key cannot sign.";
        }
        set({ key, sent: [] });
        return null;
      },
      erase: () => set({ key: null, sent: [] }),
      note: (tx) => set((state) => ({ sent: [tx, ...state.sent].slice(0, 8) })),
    }),
    { name: "veilforge-pol-v1", skipHydration: true },
  ),
);
