import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { isApk } from "./shell";

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

const STORE = "veilforge-pol-v1";
const KEY_SHAPE = /^0x[0-9a-f]{64}$/;

function readStore(name: string): string | null {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
}

function writeStore(name: string, value: string) {
  try {
    localStorage.setItem(name, value);
  } catch {
    /* the phone can refuse page storage; the keystore still holds the key */
  }
}

function dropStore(name: string) {
  try {
    localStorage.removeItem(name);
  } catch {
    /* ignore */
  }
}

function vaultStore(): StateStorage {
  return {
    getItem: (name) => {
      const vault = window.SealVault;
      if (!isApk() || !vault) return readStore(name);
      let key = vault.read();
      const legacy = readStore(name);
      if (!KEY_SHAPE.test(key) && legacy) {
        try {
          const old = (JSON.parse(legacy) as { state?: { key?: string } }).state?.key;
          if (typeof old === "string" && KEY_SHAPE.test(old)) {
            vault.write(old);
            key = old;
          }
        } catch {
          /* ignore a damaged browser copy */
        }
      }
      dropStore(name);
      let sent: SentTx[] = [];
      try {
        const raw = readStore(`${name}:meta`);
        if (raw) sent = JSON.parse(raw) as SentTx[];
      } catch {
        sent = [];
      }
      if (!KEY_SHAPE.test(key) && sent.length === 0) return null;
      return JSON.stringify({ state: { key: KEY_SHAPE.test(key) ? key : null, sent }, version: 0 });
    },
    setItem: (name, value) => {
      const vault = window.SealVault;
      if (!isApk() || !vault) {
        writeStore(name, value);
        return;
      }
      const parsed = JSON.parse(value) as { state?: { key?: string | null; sent?: SentTx[] } };
      const key = parsed.state?.key;
      if (typeof key === "string" && KEY_SHAPE.test(key)) vault.write(key);
      else vault.clear();
      writeStore(`${name}:meta`, JSON.stringify(parsed.state?.sent ?? []));
      dropStore(name);
    },
    removeItem: (name) => {
      window.SealVault?.clear();
      dropStore(name);
      dropStore(`${name}:meta`);
    },
  };
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
    { name: STORE, skipHydration: true, storage: createJSONStorage(vaultStore) },
  ),
);
