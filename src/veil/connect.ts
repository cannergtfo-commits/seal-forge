import { useEffect, useState } from "react";
import { createWalletClient, custom, getAddress, http, parseEther, parseUnits, type Account, type Address, type Transport, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { create } from "zustand";
import { ensurePolygon, type Injected } from "./chain";
import { BZB } from "./deployed";
import { usePolKey } from "./keys";
import { addressOf, polygonClient } from "./pol";
import { isApk } from "./shell";
import { sendGame } from "./signer";

const HOLD = "veilforge-wallet-hold";

export type WalletKind = "metamask" | "phantom";

type ConnectState = {
  address: Address | null;
  ready: boolean;
  present: boolean;
  error: string | null;
  listen: () => void;
  connect: (kind?: WalletKind) => Promise<string | null>;
  logout: () => void;
};

let listening = false;
let pinned: Injected | null = null;

function discover(): Injected | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: Injected }).ethereum;
  return eth ?? null;
}

type Announced = { rdns: string; provider: Injected };

const announced: Announced[] = [];
let asked6963 = false;

function arm6963(): void {
  if (typeof window === "undefined" || asked6963) return;
  asked6963 = true;
  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const detail = (event as CustomEvent<{ info?: { rdns?: string }; provider?: Injected }>).detail;
    if (!detail?.provider || !detail.info?.rdns) return;
    if (!announced.some((item) => item.rdns === detail.info?.rdns)) announced.push({ rdns: detail.info.rdns, provider: detail.provider });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

function injectedList(): Injected[] {
  const eth = discover() as (Injected & { providers?: Injected[] }) | null;
  if (eth?.providers && Array.isArray(eth.providers)) return eth.providers;
  return eth ? [eth] : [];
}

function flagged(provider: Injected, flag: "isMetaMask" | "isPhantom"): boolean {
  return Boolean((provider as Injected & { isMetaMask?: boolean; isPhantom?: boolean })[flag]);
}

async function findWallet(kind: WalletKind): Promise<Injected | null> {
  arm6963();
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  const rdns = kind === "metamask" ? "io.metamask" : "app.phantom";
  const announcedHit = announced.find((item) => item.rdns === rdns);
  if (announcedHit) return announcedHit.provider;
  if (kind === "phantom") {
    const phantom = (window as Window & { phantom?: { ethereum?: Injected } }).phantom?.ethereum;
    if (phantom) return phantom;
    return injectedList().find((provider) => flagged(provider, "isPhantom")) ?? null;
  }
  return injectedList().find((provider) => flagged(provider, "isMetaMask") && !flagged(provider, "isPhantom")) ?? injectedList().find((provider) => flagged(provider, "isMetaMask")) ?? null;
}

function walletLink(kind: WalletKind): string | null {
  if (typeof window === "undefined") return null;
  const href = window.location.href;
  if (!/^https?:/i.test(href)) return kind === "metamask" ? "https://metamask.app.link" : "https://phantom.app";
  if (kind === "metamask") {
    const url = new URL(href);
    return `https://metamask.app.link/dapp/${url.host}${url.pathname}${url.search}`;
  }
  return `https://phantom.app/ul/browse/${encodeURIComponent(href)}?ref=${encodeURIComponent(window.location.origin)}`;
}

function provider(): Injected | null {
  return pinned ?? discover();
}

function held(): boolean {
  try {
    return localStorage.getItem(HOLD) === "1" || sessionStorage.getItem(HOLD) === "1";
  } catch {
    return false;
  }
}

function rememberLogout(): void {
  try {
    localStorage.setItem(HOLD, "1");
    sessionStorage.setItem(HOLD, "1");
  } catch {
    /* private mode */
  }
}

function clearHold(): void {
  try {
    localStorage.removeItem(HOLD);
    sessionStorage.removeItem(HOLD);
  } catch {
    /* private mode */
  }
}

function blame(error: unknown): string {
  if (typeof error === "object" && error) {
    if ("shortMessage" in error && typeof error.shortMessage === "string") return error.shortMessage;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return "The wallet refused the connection.";
}

function asAddress(value: unknown): Address | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

async function liveAccount(eth: Injected): Promise<Address | null> {
  const accounts = await eth.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts)) return null;
  return asAddress(accounts[0]);
}

export const useInjected = create<ConnectState>((set) => ({
  address: null,
  ready: false,
  present: false,
  error: null,
  listen: () => {
    const eth = provider();
    set({ present: Boolean(eth), ready: true });
    if (!eth) return;
    pinned = eth;
    if (!held()) {
      void liveAccount(eth)
        .then((address) => {
          if (!held() && provider() === eth) set({ address });
        })
        .catch(() => undefined);
    }
    if (listening || !eth.on) return;
    listening = true;
    eth.on("accountsChanged", (value: unknown) => {
      if (held() || provider() !== eth) return;
      const accounts = Array.isArray(value) ? value : [];
      const address = asAddress(accounts[0]);
      if (!accounts[0]) set({ address: null, error: null });
      else if (!address) set({ address: null, error: "The wallet returned an account this game cannot use." });
      else set({ address, error: null });
    });
    eth.on("chainChanged", () => {
      if (held() || provider() !== eth) return;
      void liveAccount(eth)
        .then((address) => {
          if (!held() && provider() === eth) set({ address });
        })
        .catch(() => undefined);
    });
  },
  connect: async (kind: WalletKind = "metamask") => {
    const eth = await findWallet(kind);
    if (!eth) {
      const link = walletLink(kind);
      const label = kind === "phantom" ? "Phantom" : "MetaMask";
      if (link && typeof window !== "undefined" && /^https?:/i.test(window.location.href)) {
        window.location.assign(link);
        return null;
      }
      if (link && typeof window !== "undefined") window.location.assign(link);
      const error = `${label} is not open in this browser. Open Seal Forge inside ${label}, then connect.`;
      set({ error, present: false, ready: true });
      return error;
    }
    pinned = eth;
    try {
      const requested = await eth.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(requested) || !asAddress(requested[0])) {
        const error = "The wallet did not share an account.";
        set({ error, address: null });
        return error;
      }
      await ensurePolygon(eth);
      const address = await liveAccount(eth);
      if (!address) {
        const error = "The wallet did not share an account.";
        set({ error, address: null });
        return error;
      }
      clearHold();
      set({ address, error: null, present: true });
      useInjected.getState().listen();
      return null;
    } catch (error) {
      const message = blame(error);
      set({ error: message });
      return message;
    }
  },
  logout: () => {
    const eth = provider();
    rememberLogout();
    pinned = null;
    set({ address: null, error: null });
    if (!eth) return;
    void eth.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => undefined);
  },
}));

export async function playerClient(localKey: `0x${string}` | null): Promise<{ address: Address; wallet: WalletClient<Transport, typeof polygon, Account> }> {
  const external = isApk() ? null : useInjected.getState().address;
  if (external) {
    const eth = provider();
    if (!eth) throw new Error("The wallet extension disconnected.");
    await ensurePolygon(eth);
    const address = await liveAccount(eth);
    if (!address) throw new Error("The wallet has no selected account.");
    if (address.toLowerCase() !== external.toLowerCase()) {
      useInjected.setState({ address });
      throw new Error("The wallet account changed. Check the address, then try again.");
    }
    const wallet = createWalletClient({ account: address, chain: polygon, transport: custom(eth) });
    return { address, wallet: wallet as WalletClient<Transport, typeof polygon, Account> };
  }
  if (!localKey) throw new Error(isApk() ? "Make a wallet in the game first." : "Connect a wallet, or generate one in the game.");
  const account = privateKeyToAccount(localKey);
  const wallet = createWalletClient({ account, chain: polygon, transport: http("https://polygon-bor-rpc.publicnode.com") });
  return { address: account.address, wallet };
}

export async function sentBy(hash: `0x${string}`, address: Address) {
  const receipt = await polygonClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success" || receipt.from.toLowerCase() !== address.toLowerCase()) {
    throw new Error("That transaction was not confirmed from this wallet.");
  }
  return receipt;
}

export async function sendActive(localKey: `0x${string}` | null, to: Address, amount: string): Promise<`0x${string}`> {
  const { address, wallet } = await playerClient(localKey);
  const hash = await sendGame(localKey, address, (nonce) => wallet.sendTransaction({ to, value: parseEther(amount), nonce }));
  await sentBy(hash, address);
  return hash;
}

const erc20Transfer = [
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

const erc1155Transfer = [
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "id", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

export async function sendBzb(localKey: `0x${string}` | null, to: Address, amount: string): Promise<`0x${string}`> {
  const { address, wallet } = await playerClient(localKey);
  const hash = await sendGame(localKey, address, (nonce) => wallet.writeContract({ address: BZB, abi: erc20Transfer, functionName: "transfer", args: [to, parseUnits(amount, 18)], nonce }));
  await sentBy(hash, address);
  return hash;
}

export async function sendVeilCard(localKey: `0x${string}` | null, contract: Address, tokenId: number, amount: number, to: Address): Promise<`0x${string}`> {
  const { address, wallet } = await playerClient(localKey);
  const hash = await sendGame(localKey, address, (nonce) =>
    wallet.writeContract({
      address: contract,
      abi: erc1155Transfer,
      functionName: "safeTransferFrom",
      args: [address, to, BigInt(tokenId), BigInt(amount), "0x"],
      nonce,
    }),
  );
  await sentBy(hash, address);
  return hash;
}

export function usePlayer() {
  const key = usePolKey((state) => state.key);
  const external = useInjected((state) => state.address);
  const extReady = useInjected((state) => state.ready);
  const [keyReady, setKeyReady] = useState(false);

  useEffect(() => {
    const finish = () => setKeyReady(true);
    const unsub = usePolKey.persist.onFinishHydration(finish);
    void usePolKey.persist.rehydrate();
    if (isApk()) useInjected.setState({ ready: true, present: false, address: null });
    else useInjected.getState().listen();
    if (usePolKey.persist.hasHydrated()) finish();
    return unsub;
  }, []);

  const address = (isApk() ? null : external) ?? (key ? addressOf(key) : null);
  return { ready: keyReady && (isApk() || extReady), key, address, external: isApk() ? null : external };
}
