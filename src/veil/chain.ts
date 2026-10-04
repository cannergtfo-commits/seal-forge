export const POLYGON_CHAIN_ID = 137;
export const POLYGON_HEX = "0x89";

export const POLYGON_PARAMS = {
  chainId: POLYGON_HEX,
  chainName: "Polygon",
  nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
  rpcUrls: ["https://polygon-bor-rpc.publicnode.com"],
  blockExplorerUrls: ["https://polygonscan.com/"],
};

export type Injected = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

export function injected(): Injected | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: Injected }).ethereum;
  return eth ?? null;
}

export function formatPol(weiHex: string): string {
  const wei = BigInt(weiHex);
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole.toString()}.${frac}`;
}

export function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export async function readChainId(provider: Injected): Promise<bigint | null> {
  try {
    const hex = await provider.request({ method: "eth_chainId" });
    if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
    return BigInt(hex);
  } catch {
    return null;
  }
}

export async function ensurePolygon(provider: Injected): Promise<void> {
  const onPolygon = async () => (await readChainId(provider)) === BigInt(POLYGON_CHAIN_ID);
  if (await onPolygon()) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: POLYGON_HEX }],
    });
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? Number(error.code) : 0;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [POLYGON_PARAMS],
    });
  }
  if (await onPolygon()) return;
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: POLYGON_HEX }],
  });
  if (!(await onPolygon())) throw new Error("The wallet is not on Polygon. Switch to chain 137 and try again.");
}
