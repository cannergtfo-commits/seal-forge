import { useEffect, useRef, useState, type RefObject } from "react";
import { CardFace } from "@/components/veil/card";
import { SealMark } from "@/components/veil/deck";
import { PackSupply } from "@/components/veil/pack-supply";
import { CARDS, FACTIONS, SEALS, schoolOf, type CardDef, type Edition, type Faction } from "@/veil/cards";
import { shortAddr } from "@/veil/chain";
import { playerClient, sentBy, usePlayer } from "@/veil/connect";
import { ASHEN_NFT, ASHEN_PACKS, BLAZAR_NFT, BLAZAR_PACKS, BAZAAR, BZB, CARDS_NFT, KAGE_NFT, KAGE_PACKS, MARKET } from "@/veil/deployed";
import { veilBalances } from "@/veil/holds";
import { redactKey } from "@/veil/keys";
import { buySealedPack } from "@/veil/pack-buy";
import { rarityLabel, rarityTier } from "@/veil/pack-score";
import { createPublicClient, decodeEventLog, formatUnits, http, isAddress, parseUnits, type Hex } from "viem";
import { polygon } from "viem/chains";

const reader = createPublicClient({ chain: polygon, transport: http("https://polygon-bor-rpc.publicnode.com") });
const WATCH_KEY = "veilforge.stall.watch";

const erc20 = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const cardsAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "id", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "setApprovalForAll", stateMutability: "nonpayable", inputs: [{ name: "operator", type: "address" }, { name: "approved", type: "bool" }], outputs: [] },
  { type: "function", name: "isApprovedForAll", stateMutability: "view", inputs: [{ name: "account", type: "address" }, { name: "operator", type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const marketAbi = [
  { type: "function", name: "length", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lots", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "seller", type: "address" }, { name: "id", type: "uint256" }, { name: "price", type: "uint256" }, { name: "live", type: "bool" }] },
  { type: "function", name: "list", stateMutability: "nonpayable", inputs: [{ name: "id", type: "uint256" }, { name: "price", type: "uint256" }], outputs: [] },
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "lotId", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "lotId", type: "uint256" }], outputs: [] },
  { type: "event", name: "Listed", inputs: [{ name: "lotId", type: "uint256", indexed: true }, { name: "seller", type: "address", indexed: true }, { name: "id", type: "uint256", indexed: false }, { name: "price", type: "uint256", indexed: false }] },
  { type: "event", name: "Sold", inputs: [{ name: "lotId", type: "uint256", indexed: true }, { name: "buyer", type: "address", indexed: true }] },
  { type: "event", name: "Cancelled", inputs: [{ name: "lotId", type: "uint256", indexed: true }] },
] as const;

const bazaarAbi = [
  { type: "function", name: "length", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "lots", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "seller", type: "address" }, { name: "collection", type: "address" }, { name: "id", type: "uint256" }, { name: "price", type: "uint256" }, { name: "live", type: "bool" }] },
  { type: "function", name: "list", stateMutability: "nonpayable", inputs: [{ name: "collection", type: "address" }, { name: "id", type: "uint256" }, { name: "price", type: "uint256" }], outputs: [] },
  { type: "function", name: "buy", stateMutability: "nonpayable", inputs: [{ name: "lotId", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "lotId", type: "uint256" }], outputs: [] },
  { type: "event", name: "Listed", inputs: [{ name: "lotId", type: "uint256", indexed: true }, { name: "seller", type: "address", indexed: true }, { name: "collection", type: "address", indexed: false }, { name: "id", type: "uint256", indexed: false }, { name: "price", type: "uint256", indexed: false }] },
  { type: "event", name: "Sold", inputs: [{ name: "lotId", type: "uint256", indexed: true }, { name: "buyer", type: "address", indexed: true }] },
  { type: "event", name: "Cancelled", inputs: [{ name: "lotId", type: "uint256", indexed: true }] },
] as const;

const FACTION_CODE = { elf: 1, human: 2, goblin: 3, robot: 4, demon: 5 } as const;

type Stall = "market" | "bazaar";
type Tab = "sale" | "mine" | "collection" | "activity" | "packs";
type KindFilter = "all" | "unit" | "spell" | "trap";
type TierFilter = "all" | "basic" | "rare" | "legendary";
type CostFilter = "all" | "low" | "mid" | "high";
type SortKey = "newest" | "price-asc" | "price-desc" | "rarity" | "name" | "listed" | "qty" | "cost" | "floor";
type Lot = { stall: Stall; index: number; seller: string; collection: `0x${string}`; id: number; price: bigint; live: boolean };
type Ask = { stall: Stall; index: number; seller: string; price: bigint };
type Shelf = { key: string; card: CardDef | null; tokenId: number; asks: Ask[]; floor: bigint; newest: number };
type FeedKind = "listed" | "sold" | "cancelled" | "closed";
type FeedItem = { key: string; kind: FeedKind; lotId: number; tokenId: number; price: bigint; who: string; time?: number; cardId: string | null };
type Approvals = Record<Edition, boolean>;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function bzb(wei: bigint): string {
  const raw = formatUnits(wei, 18);
  if (!raw.includes(".")) return raw;
  const [whole, frac] = raw.split(".");
  const trimmed = frac.slice(0, 4).replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

function priceWei(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(trimmed)) return null;
  try {
    const wei = parseUnits(trimmed, 18);
    return wei > 0n ? wei : null;
  } catch {
    return null;
  }
}

function fault(err: unknown, fallback: string, key: string | null): string {
  if (!(err instanceof Error)) return fallback;
  const line = err.message.split("\n")[0]?.trim() ?? "";
  if (!line || line.length > 180) return fallback;
  return redactKey(line, key);
}

function editionName(edition: Edition): string {
  if (edition === "core") return "Founding";
  if (edition === "blazar") return "Blazar";
  if (edition === "kage") return "Kage";
  return "Ashen";
}

function nftOf(edition: Edition): `0x${string}` {
  if (edition === "blazar") return BLAZAR_NFT;
  if (edition === "kage") return KAGE_NFT;
  if (edition === "ashen") return ASHEN_NFT;
  return CARDS_NFT;
}

function sameAddr(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function editionOf(collection: string): Edition | null {
  if (sameAddr(collection, CARDS_NFT)) return "core";
  if (sameAddr(collection, BLAZAR_NFT)) return "blazar";
  if (sameAddr(collection, KAGE_NFT)) return "kage";
  if (sameAddr(collection, ASHEN_NFT)) return "ashen";
  return null;
}

function cardFor(collection: string, tokenId: number): CardDef | null {
  const edition = editionOf(collection);
  if (!edition) return null;
  return CARDS.find((card) => card.edition === edition && card.tokenId === tokenId) ?? null;
}

function spenderOf(stall: Stall): `0x${string}` {
  return stall === "market" ? MARKET : BAZAAR;
}

function factionName(id: Faction): string {
  return FACTIONS.find((faction) => faction.id === id)?.name ?? id;
}

function ago(time: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - time));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function matchCard(card: CardDef, query: string, faction: Faction | "all", kind: KindFilter, tier: TierFilter, cost: CostFilter, edition: Edition | "all"): boolean {
  if (query && !card.name.toLowerCase().includes(query)) return false;
  if (faction !== "all" && card.faction !== faction) return false;
  if (kind !== "all" && card.kind !== kind) return false;
  if (tier !== "all" && rarityTier(card.rarity, card.set) !== tier) return false;
  if (cost === "low" && card.cost > 2) return false;
  if (cost === "mid" && (card.cost < 3 || card.cost > 4)) return false;
  if (cost === "high" && card.cost < 5) return false;
  if (edition !== "all" && card.edition !== edition) return false;
  return true;
}

function shelvesOf(lots: Lot[]): Shelf[] {
  const groups = new Map<string, { card: CardDef | null; tokenId: number; asks: Ask[]; newest: number }>();
  for (const lot of lots) {
    if (!lot.live) continue;
    const card = cardFor(lot.collection, lot.id);
    const key = card?.id ?? `${lot.stall}-${lot.collection}-${lot.id}`;
    const group = groups.get(key) ?? { card, tokenId: lot.id, asks: [], newest: 0 };
    group.asks.push({ stall: lot.stall, index: lot.index, seller: lot.seller, price: lot.price });
    group.newest = Math.max(group.newest, lot.index);
    groups.set(key, group);
  }
  const shelves: Shelf[] = [];
  for (const [key, group] of groups) {
    group.asks.sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : a.index - b.index));
    shelves.push({ key, card: group.card, tokenId: group.tokenId, asks: group.asks, floor: group.asks[0]?.price ?? 0n, newest: group.newest });
  }
  return shelves;
}

async function readMarketLots(): Promise<Lot[]> {
  const count = Number(await reader.readContract({ address: MARKET, abi: marketAbi, functionName: "length" }));
  const lots: Lot[] = [];
  for (let start = 0; start < count; start += 150) {
    const end = Math.min(count, start + 150);
    const contracts = [];
    for (let i = start; i < end; i++) contracts.push({ address: MARKET, abi: marketAbi, functionName: "lots" as const, args: [BigInt(i)] as const });
    const rows = await reader.multicall({ contracts, allowFailure: true });
    rows.forEach((row, offset) => {
      if (row.status !== "success") return;
      const [seller, id, price, live] = row.result;
      lots.push({ stall: "market", index: start + offset, seller, collection: CARDS_NFT, id: Number(id), price, live });
    });
  }
  return lots;
}

async function readBazaarLots(): Promise<Lot[]> {
  if (!isAddress(BAZAAR)) return [];
  const count = Number(await reader.readContract({ address: BAZAAR, abi: bazaarAbi, functionName: "length" }));
  const lots: Lot[] = [];
  for (let start = 0; start < count; start += 150) {
    const end = Math.min(count, start + 150);
    const contracts = [];
    for (let i = start; i < end; i++) contracts.push({ address: BAZAAR, abi: bazaarAbi, functionName: "lots" as const, args: [BigInt(i)] as const });
    const rows = await reader.multicall({ contracts, allowFailure: true });
    rows.forEach((row, offset) => {
      if (row.status !== "success") return;
      const [seller, collection, id, price, live] = row.result;
      lots.push({ stall: "bazaar", index: start + offset, seller, collection, id: Number(id), price, live });
    });
  }
  return lots;
}

async function readLots(): Promise<Lot[]> {
  const [market, bazaar] = await Promise.all([readMarketLots(), readBazaarLots()]);
  return [...market, ...bazaar];
}

async function pullLogs(address: `0x${string}`, latest: bigint): Promise<{ logs: Awaited<ReturnType<typeof reader.getLogs>>; failed: boolean }> {
  const span = 9_999n;
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let i = 0; i < 24; i++) {
    const toBlock = latest - span * BigInt(i);
    if (toBlock <= 0n) break;
    const fromBlock = toBlock > span ? toBlock - span + 1n : 1n;
    ranges.push({ fromBlock, toBlock });
  }
  const logs: Awaited<ReturnType<typeof reader.getLogs>> = [];
  let failed = false;
  for (let i = 0; i < ranges.length; i += 6) {
    const part = await Promise.all(ranges.slice(i, i + 6).map((range) => reader.getLogs({ address, ...range }).catch(() => {
      failed = true;
      return [];
    })));
    logs.push(...part.flat());
  }
  return { logs, failed };
}

function remember(lot: Lot, kind: FeedKind, who: string, time?: number, key?: string): FeedItem {
  return {
    key: key ?? `${lot.stall}-${kind}-${lot.index}`,
    kind,
    lotId: lot.index,
    tokenId: lot.id,
    price: lot.price,
    who,
    time,
    cardId: cardFor(lot.collection, lot.id)?.id ?? null,
  };
}

async function readFeed(lots: Lot[]): Promise<{ items: FeedItem[]; sales: { count: number; volume: bigint } | null }> {
  if (!lots.length) return { items: [], sales: { count: 0, volume: 0n } };
  const latest = await reader.getBlockNumber();
  const wantMarket = lots.some((lot) => lot.stall === "market");
  const wantBazaar = lots.some((lot) => lot.stall === "bazaar");
  const [marketLogs, bazaarLogs] = await Promise.all([
    wantMarket ? pullLogs(MARKET, latest) : Promise.resolve({ logs: [], failed: false }),
    wantBazaar ? pullLogs(BAZAAR, latest) : Promise.resolve({ logs: [], failed: false }),
  ]);
  const failed = marketLogs.failed || bazaarLogs.failed;
  const logs = [...marketLogs.logs, ...bazaarLogs.logs];
  const times = new Map<string, number>();
  const blocks = [...new Set(logs.map((log) => log.blockNumber).filter((block): block is bigint => block != null))].slice(0, 12);
  await Promise.all(blocks.map(async (blockNumber) => {
    try {
      const block = await reader.getBlock({ blockNumber });
      times.set(blockNumber.toString(), Number(block.timestamp));
    } catch {
      /* time is optional */
    }
  }));
  const byLot = new Map(lots.map((lot) => [`${lot.stall}-${lot.index}`, lot]));
  const items: FeedItem[] = [];
  const seenList = new Set<string>();
  const seenClose = new Set<string>();
  for (const log of marketLogs.logs) {
    if (!log.topics.length) continue;
    let decoded: ReturnType<typeof decodeEventLog<typeof marketAbi>>;
    try {
      decoded = decodeEventLog({ abi: marketAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    } catch {
      continue;
    }
    const lotId = Number(decoded.args.lotId);
    const key = `market-${lotId}`;
    const lot = byLot.get(key);
    const time = log.blockNumber != null ? times.get(log.blockNumber.toString()) : undefined;
    if (decoded.eventName === "Listed") {
      seenList.add(key);
      const card = cardFor(CARDS_NFT, Number(decoded.args.id));
      items.push({ key: `market-listed-${lotId}-${log.logIndex ?? 0}`, kind: "listed", lotId, tokenId: Number(decoded.args.id), price: decoded.args.price, who: decoded.args.seller, time, cardId: card?.id ?? null });
    } else if (decoded.eventName === "Sold") {
      seenClose.add(key);
      items.push(lot ? remember(lot, "sold", decoded.args.buyer, time, `market-sold-${lotId}`) : { key: `market-sold-${lotId}`, kind: "sold", lotId, tokenId: 0, price: 0n, who: decoded.args.buyer, time, cardId: null });
    } else {
      seenClose.add(key);
      items.push(lot ? remember(lot, "cancelled", lot.seller, time, `market-cancel-${lotId}`) : { key: `market-cancel-${lotId}`, kind: "cancelled", lotId, tokenId: 0, price: 0n, who: "", time, cardId: null });
    }
  }
  for (const log of bazaarLogs.logs) {
    if (!log.topics.length) continue;
    let decoded: ReturnType<typeof decodeEventLog<typeof bazaarAbi>>;
    try {
      decoded = decodeEventLog({ abi: bazaarAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
    } catch {
      continue;
    }
    const lotId = Number(decoded.args.lotId);
    const key = `bazaar-${lotId}`;
    const lot = byLot.get(key);
    const time = log.blockNumber != null ? times.get(log.blockNumber.toString()) : undefined;
    if (decoded.eventName === "Listed") {
      seenList.add(key);
      const card = cardFor(decoded.args.collection, Number(decoded.args.id));
      items.push({ key: `bazaar-listed-${lotId}-${log.logIndex ?? 0}`, kind: "listed", lotId, tokenId: Number(decoded.args.id), price: decoded.args.price, who: decoded.args.seller, time, cardId: card?.id ?? null });
    } else if (decoded.eventName === "Sold") {
      seenClose.add(key);
      items.push(lot ? remember(lot, "sold", decoded.args.buyer, time, `bazaar-sold-${lotId}`) : { key: `bazaar-sold-${lotId}`, kind: "sold", lotId, tokenId: 0, price: 0n, who: decoded.args.buyer, time, cardId: null });
    } else {
      seenClose.add(key);
      items.push(lot ? remember(lot, "cancelled", lot.seller, time, `bazaar-cancel-${lotId}`) : { key: `bazaar-cancel-${lotId}`, kind: "cancelled", lotId, tokenId: 0, price: 0n, who: "", time, cardId: null });
    }
  }
  for (const lot of lots) {
    const key = `${lot.stall}-${lot.index}`;
    if (!seenList.has(key)) items.push(remember(lot, "listed", lot.seller));
    if (!lot.live && !seenClose.has(key)) items.push(remember(lot, "closed", lot.seller));
  }
  items.sort((a, b) => (b.time ?? -1) - (a.time ?? -1) || b.lotId - a.lotId);
  const sold = items.filter((item) => item.kind === "sold");
  const sales = failed && sold.length === 0 ? null : { count: sold.length, volume: sold.reduce((sum, item) => sum + item.price, 0n) };
  return { items, sales };
}

function sortShelves(shelves: Shelf[], sort: SortKey): Shelf[] {
  const next = [...shelves];
  const rank = (shelf: Shelf) => (shelf.card ? rarityTier(shelf.card.rarity, shelf.card.set) === "legendary" ? 3 : rarityTier(shelf.card.rarity, shelf.card.set) === "rare" ? 2 : 1 : 0);
  next.sort((a, b) => {
    if (sort === "price-asc") return a.floor < b.floor ? -1 : a.floor > b.floor ? 1 : b.newest - a.newest;
    if (sort === "price-desc" || sort === "floor") return a.floor > b.floor ? -1 : a.floor < b.floor ? 1 : b.newest - a.newest;
    if (sort === "name") return (a.card?.name ?? "").localeCompare(b.card?.name ?? "");
    if (sort === "rarity") return rank(b) - rank(a) || (a.card?.name ?? "").localeCompare(b.card?.name ?? "");
    if (sort === "listed") return b.asks.length - a.asks.length || (a.floor < b.floor ? -1 : 1);
    return b.newest - a.newest;
  });
  return next;
}

export function Market({ onBack }: { onBack: () => void }) {
  const { ready, key, address, external } = usePlayer();
  const [bzbBal, setBzbBal] = useState("—");
  const [lots, setLots] = useState<Lot[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [sales, setSales] = useState<{ count: number; volume: bigint } | null>(null);
  const [balances, setBalances] = useState<number[] | null>(null);
  const [approved, setApproved] = useState<Approvals | null>(null);
  const [tab, setTab] = useState<Tab>("sale");
  const [query, setQuery] = useState("");
  const [faction, setFaction] = useState<Faction | "all">("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [tier, setTier] = useState<TierFilter>("all");
  const [cost, setCost] = useState<CostFilter>("all");
  const [edition, setEdition] = useState<Edition | "all">("all");
  const [sort, setSort] = useState<SortKey>("newest");
  const [watchOnly, setWatchOnly] = useState(false);
  const [watch, setWatch] = useState<string[]>([]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [askPrice, setAskPrice] = useState("1");
  const [copies, setCopies] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(true);
  const flight = useRef(0);
  const detailRef = useRef<HTMLElement>(null);

  async function refresh() {
    const token = ++flight.current;
    const [nextLots, walletRows] = await Promise.all([
      readLots(),
      address
        ? Promise.all([
            reader.readContract({ address: BZB, abi: erc20, functionName: "balanceOf", args: [address] }),
            veilBalances(address),
            Promise.all([
              reader.readContract({ address: CARDS_NFT, abi: cardsAbi, functionName: "isApprovedForAll", args: [address, MARKET] }),
              reader.readContract({ address: BLAZAR_NFT, abi: cardsAbi, functionName: "isApprovedForAll", args: [address, BAZAAR] }),
              reader.readContract({ address: KAGE_NFT, abi: cardsAbi, functionName: "isApprovedForAll", args: [address, BAZAAR] }),
              reader.readContract({ address: ASHEN_NFT, abi: cardsAbi, functionName: "isApprovedForAll", args: [address, BAZAAR] }),
            ]),
          ])
        : Promise.resolve(null),
    ]);
    if (flight.current !== token) return;
    setLots(nextLots);
    if (walletRows) {
      const [bal, held, flags] = walletRows;
      setBzbBal(formatUnits(bal, 18));
      setBalances(held);
      setApproved({ core: flags[0], blazar: flags[1], kage: flags[2], ashen: flags[3] });
    } else {
      setBzbBal("—");
      setBalances(null);
      setApproved(null);
    }
    setBooting(false);
    try {
      const book = await readFeed(nextLots);
      if (flight.current !== token) return;
      setFeed(book.items);
      setSales(book.sales);
    } catch {
      if (flight.current !== token) return;
      setFeed([]);
      setSales(null);
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCH_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) setWatch(parsed.filter((id) => typeof id === "string"));
    } catch {
      /* ignore a bad watch list */
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancel = false;
    setBooting(true);
    void refresh()
      .then(() => {
        if (!cancel) setBooting(false);
      })
      .catch(() => {
        if (cancel) return;
        setError("The market did not answer.");
        setBooting(false);
      });
    return () => {
      cancel = true;
    };
  }, [ready, address]);

  useEffect(() => {
    setCopies(1);
    if (!focusId || !window.matchMedia("(max-width: 959px)").matches) return;
    detailRef.current?.scrollIntoView({ block: "nearest" });
  }, [focusId]);

  function canSign() {
    return Boolean(key || external);
  }

  function mine(seller: string) {
    return Boolean(address && seller.toLowerCase() === address.toLowerCase());
  }

  function toggleWatch(id: string) {
    setWatch((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      localStorage.setItem(WATCH_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function buyPack(editionId: "founding" | "blazar" | "kage" | "ashen", factionId: number) {
    if (!canSign()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await buySealedPack(key, editionId, factionId);
      await refresh();
      setNotice("Pack opened.");
    } catch (err) {
      setError(fault(err, "The pack did not open.", key));
    } finally {
      setBusy(false);
    }
  }

  async function listCopies(card: CardDef, count: number) {
    if (!address || !canSign()) return;
    const wei = priceWei(askPrice);
    if (!wei) {
      setError("Enter a price in BzB.");
      return;
    }
    const collection = nftOf(card.edition);
    const spender = card.edition === "core" ? MARKET : BAZAAR;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { address: signer, wallet } = await playerClient(key);
      const ok = await reader.readContract({ address: collection, abi: cardsAbi, functionName: "isApprovedForAll", args: [signer, spender] });
      if (!ok) {
        const approval = await wallet.writeContract({ address: collection, abi: cardsAbi, functionName: "setApprovalForAll", args: [spender, true] });
        await sentBy(approval, signer);
        setApproved((current) => ({ core: false, blazar: false, kage: false, ashen: false, ...current, [card.edition]: true }));
      }
      for (let i = 0; i < count; i++) {
        const listed = card.edition === "core"
          ? await wallet.writeContract({ address: MARKET, abi: marketAbi, functionName: "list", args: [BigInt(card.tokenId), wei] })
          : await wallet.writeContract({ address: BAZAAR, abi: bazaarAbi, functionName: "list", args: [collection, BigInt(card.tokenId), wei] });
        await sentBy(listed, signer);
      }
      await refresh();
      setNotice(count === 1 ? "Listed." : `Listed ${count} copies.`);
    } catch (err) {
      setError(fault(err, "The listing failed.", key));
      void refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function buyLot(stall: Stall, index: number, cost: bigint) {
    if (!address || !canSign()) return;
    const spender = spenderOf(stall);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { address: signer, wallet } = await playerClient(key);
      const allowance = await reader.readContract({ address: BZB, abi: erc20, functionName: "allowance", args: [signer, spender] });
      if (allowance < cost) {
        const approval = await wallet.writeContract({ address: BZB, abi: erc20, functionName: "approve", args: [spender, cost] });
        await sentBy(approval, signer);
      }
      const bought = stall === "market"
        ? await wallet.writeContract({ address: MARKET, abi: marketAbi, functionName: "buy", args: [BigInt(index)] })
        : await wallet.writeContract({ address: BAZAAR, abi: bazaarAbi, functionName: "buy", args: [BigInt(index)] });
      await sentBy(bought, signer);
      await refresh();
      setNotice("Bought.");
    } catch (err) {
      setError(fault(err, "The purchase failed.", key));
    } finally {
      setBusy(false);
    }
  }

  async function cancelLot(stall: Stall, index: number) {
    if (!canSign()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { address: signer, wallet } = await playerClient(key);
      const cancelled = stall === "market"
        ? await wallet.writeContract({ address: MARKET, abi: marketAbi, functionName: "cancel", args: [BigInt(index)] })
        : await wallet.writeContract({ address: BAZAAR, abi: bazaarAbi, functionName: "cancel", args: [BigInt(index)] });
      await sentBy(cancelled, signer);
      await refresh();
      setNotice("Listing cancelled. The card is back in your wallet.");
    } catch (err) {
      setError(fault(err, "The listing stayed up.", key));
    } finally {
      setBusy(false);
    }
  }

  const live = lots.filter((lot) => lot.live);
  const shelves = shelvesOf(live);
  const mineShelves = shelvesOf(live.filter((lot) => mine(lot.seller))).map((shelf) => ({ ...shelf, asks: shelf.asks.filter((ask) => mine(ask.seller)) }));
  const heldCount = balances?.reduce((sum, count) => sum + count, 0) ?? 0;
  const floor = shelves.reduce<bigint | null>((best, shelf) => (best == null || shelf.floor < best ? shelf.floor : best), null);
  const needle = query.trim().toLowerCase();
  const editionFilter: Edition | "all" = tab === "collection" ? edition : "all";
  const watched = new Set(watch);

  function visibleShelf(shelf: Shelf): boolean {
    if (watchOnly && !watched.has(shelf.key)) return false;
    if (!shelf.card) return !needle && faction === "all" && kind === "all" && tier === "all" && cost === "all";
    return matchCard(shelf.card, needle, faction, kind, tier, cost, editionFilter);
  }

  const saleShelves = sortShelves(shelves.filter(visibleShelf), sort);
  const ownShelves = sortShelves(mineShelves.filter(visibleShelf), sort);
  const holdings = CARDS.flatMap((card, index) => {
    const balance = balances?.[index] ?? 0;
    if (balance <= 0) return [];
    if (watchOnly && !watched.has(card.id)) return [];
    if (!matchCard(card, needle, faction, kind, tier, cost, edition)) return [];
    return [{ card, balance }];
  });
  holdings.sort((a, b) => {
    const floorOf = (card: CardDef) => shelves.find((shelf) => shelf.card?.id === card.id)?.floor;
    if (sort === "name") return a.card.name.localeCompare(b.card.name);
    if (sort === "rarity") {
      const rank = (card: CardDef) => (rarityTier(card.rarity, card.set) === "legendary" ? 3 : rarityTier(card.rarity, card.set) === "rare" ? 2 : 1);
      return rank(b.card) - rank(a.card) || a.card.name.localeCompare(b.card.name);
    }
    if (sort === "cost") return b.card.cost - a.card.cost || a.card.name.localeCompare(b.card.name);
    if (sort === "floor" || sort === "price-asc") {
      const af = floorOf(a.card);
      const bf = floorOf(b.card);
      if (af == null && bf == null) return a.card.name.localeCompare(b.card.name);
      if (af == null) return 1;
      if (bf == null) return -1;
      return af < bf ? -1 : af > bf ? 1 : 0;
    }
    if (sort === "price-desc") {
      const af = floorOf(a.card);
      const bf = floorOf(b.card);
      if (af == null && bf == null) return 0;
      if (af == null) return 1;
      if (bf == null) return -1;
      return af > bf ? -1 : af < bf ? 1 : 0;
    }
    return b.balance - a.balance || a.card.name.localeCompare(b.card.name);
  });

  const activity = feed.filter((item) => {
    const card = item.cardId ? CARDS.find((entry) => entry.id === item.cardId) ?? null : null;
    if (!card) return !needle && faction === "all" && kind === "all" && tier === "all" && cost === "all" && !watchOnly;
    if (watchOnly && !watched.has(card.id)) return false;
    return matchCard(card, needle, faction, kind, tier, cost, "all");
  });

  const focusCard = focusId ? CARDS.find((card) => card.id === focusId) ?? null : null;
  const focusShelf = focusCard ? shelves.find((shelf) => shelf.card?.id === focusCard.id) ?? null : shelves.find((shelf) => shelf.key === focusId) ?? null;
  const focusBalance = focusCard && balances ? balances[CARDS.indexOf(focusCard)] ?? 0 : 0;
  const filtersOn = Boolean(needle) || faction !== "all" || kind !== "all" || tier !== "all" || cost !== "all" || edition !== "all" || watchOnly;
  const sortChoices: { id: SortKey; label: string }[] = tab === "collection"
    ? [
        { id: "qty", label: "Quantity" },
        { id: "name", label: "Name" },
        { id: "rarity", label: "Rarity" },
        { id: "cost", label: "Cost" },
        { id: "floor", label: "Floor" },
      ]
    : [
        { id: "newest", label: "Newest" },
        { id: "price-asc", label: "Price: low" },
        { id: "price-desc", label: "Price: high" },
        { id: "rarity", label: "Rarity" },
        { id: "name", label: "Name" },
        { id: "listed", label: "Most listed" },
      ];
  const activeSort = sortChoices.some((choice) => choice.id === sort) ? sort : sortChoices[0].id;

  function clearFilters() {
    setQuery("");
    setFaction("all");
    setKind("all");
    setTier("all");
    setCost("all");
    setEdition("all");
    setWatchOnly(false);
  }

  const shownShelves = tab === "mine" ? ownShelves : saleShelves;

  return (
    <>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" className="veil-btn" onClick={onBack}>
            Back
          </button>
          <div>
            <p className="text-xs tracking-widest text-brass">Card stalls</p>
            <h1 className="text-lg leading-tight">Market</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <p className="font-mono text-sm text-ash">{!address ? "No wallet" : bzbBal === "—" ? "…" : `${bzb(parseUnits(bzbBal, 18))} BzB`}</p>
          <button type="button" className="veil-btn" disabled={busy || booting} onClick={() => void refresh().catch(() => setError("The market did not answer."))}>
            Refresh
          </button>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-4 px-4 pb-10">
        {!address && <p className="text-sm text-ash">Connect a wallet extension, or generate one, before you buy, sell, or open your collection.</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
        {notice && <p className="text-sm text-brass">{notice}</p>}
        <dl className="stall-stats">
          <div className="veil-box stall-stat rounded-md" title="Live listings across both stalls">
            <dt>Listings</dt>
            <dd>{booting ? "…" : live.length}</dd>
          </div>
          <div className="veil-box stall-stat rounded-md" title="Cheapest live ask">
            <dt>Floor</dt>
            <dd>{floor == null ? "—" : `${bzb(floor)} BzB`}</dd>
          </div>
          <div className="veil-box stall-stat rounded-md" title="Sales found in recent blocks. Older sales can sit outside this window.">
            <dt>Seen sales</dt>
            <dd>{sales ? `${sales.count} · ${bzb(sales.volume)} BzB` : "—"}</dd>
          </div>
          <div className="veil-box stall-stat rounded-md" title="Card NFTs in this wallet. Listed copies sit in the stall.">
            <dt>Held</dt>
            <dd>{address ? (balances ? heldCount : "…") : "—"}</dd>
          </div>
        </dl>
        <p className="text-sm leading-relaxed text-ash">Founding cards clear on the original stall. Blazar, Kage, and Ashen clear on the set stall. A card stays in escrow until someone pays BzB or you cancel.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cx("veil-btn", tab === "sale" && "veil-btn-primary")} aria-pressed={tab === "sale"} onClick={() => setTab("sale")}>
            For sale · {live.length}
          </button>
          <button type="button" className={cx("veil-btn", tab === "mine" && "veil-btn-primary")} aria-pressed={tab === "mine"} onClick={() => setTab("mine")}>
            My listings · {live.filter((lot) => mine(lot.seller)).length}
          </button>
          <button type="button" className={cx("veil-btn", tab === "collection" && "veil-btn-primary")} aria-pressed={tab === "collection"} onClick={() => setTab("collection")}>
            Collection · {address && !balances ? "…" : heldCount}
          </button>
          <button type="button" className={cx("veil-btn", tab === "activity" && "veil-btn-primary")} aria-pressed={tab === "activity"} onClick={() => setTab("activity")}>
            Activity
          </button>
          <button type="button" className={cx("veil-btn", tab === "packs" && "veil-btn-primary")} aria-pressed={tab === "packs"} onClick={() => setTab("packs")}>
            Packs
          </button>
        </div>
        {tab !== "packs" && (
          <section className="veil-box grid gap-3 rounded-md p-3">
            <div className={cx("grid gap-2", tab !== "activity" && "sm:grid-cols-[minmax(0,1fr)_12rem]")}>
              <input className="veil-field" placeholder="Search cards" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search cards" />
              {tab !== "activity" && (
                <select className="veil-field" aria-label="Sort" value={activeSort} onChange={(event) => setSort(event.target.value as SortKey)}>
                  {sortChoices.map((choice) => (
                    <option key={choice.id} value={choice.id}>{choice.label}</option>
                  ))}
                </select>
              )}
            </div>
            {tab === "activity" && <p className="text-sm text-ash">Newest first. Every lot the stall still records is included.</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className={cx("veil-btn", faction === "all" && "veil-btn-primary")} aria-pressed={faction === "all"} onClick={() => setFaction("all")}>All seals</button>
              {FACTIONS.map((item) => (
                <button key={item.id} type="button" className={cx("veil-btn", faction === item.id && "veil-btn-primary")} aria-pressed={faction === item.id} onClick={() => setFaction(item.id)}>
                  {item.name}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {([
                ["all", "Any type"],
                ["unit", "Unit"],
                ["spell", "Spell"],
                ["trap", "Trap"],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" className={cx("veil-btn", kind === id && "veil-btn-primary")} aria-pressed={kind === id} onClick={() => setKind(id)}>
                  {label}
                </button>
              ))}
              {([
                ["all", "Any rarity"],
                ["basic", "Common / basic"],
                ["rare", "Rare"],
                ["legendary", "Legendary"],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" className={cx("veil-btn", tier === id && "veil-btn-primary")} aria-pressed={tier === id} onClick={() => setTier(id)}>
                  {label}
                </button>
              ))}
              {([
                ["all", "Any cost"],
                ["low", "Cost 1–2"],
                ["mid", "Cost 3–4"],
                ["high", "Cost 5+"],
              ] as const).map(([id, label]) => (
                <button key={id} type="button" className={cx("veil-btn", cost === id && "veil-btn-primary")} aria-pressed={cost === id} onClick={() => setCost(id)}>
                  {label}
                </button>
              ))}
              <button type="button" className={cx("veil-btn", watchOnly && "veil-btn-primary")} aria-pressed={watchOnly} onClick={() => setWatchOnly((on) => !on)}>
                Watching · {watch.length}
              </button>
              {filtersOn && (
                <button type="button" className="veil-btn" onClick={clearFilters}>
                  Clear
                </button>
              )}
            </div>
            {tab === "collection" && (
              <div className="flex flex-wrap gap-2">
                {([
                  ["all", "All sets"],
                  ["core", "Founding"],
                  ["blazar", "Blazar"],
                  ["kage", "Kage"],
                  ["ashen", "Ashen"],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" className={cx("veil-btn", edition === id && "veil-btn-primary")} aria-pressed={edition === id} onClick={() => setEdition(id)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
        {tab === "packs" ? (
          <Packs busy={busy} address={address} onBuy={(editionId, factionId) => void buyPack(editionId, factionId)} />
        ) : (
          <div className="stall-layout">
            <div>
              {tab === "activity" ? (
                <Activity items={activity} booting={booting} focusId={focusId} onOpen={setFocusId} />
              ) : tab === "collection" ? (
                <Collection holdings={holdings} shelves={shelves} focusId={focusId} booting={booting} address={address} onOpen={setFocusId} />
              ) : (
                <ShelfGrid
                  shelves={shownShelves}
                  focusId={focusId}
                  booting={booting}
                  empty={
                    tab === "mine"
                      ? live.some((lot) => mine(lot.seller))
                        ? "No listings match these filters."
                        : "You have nothing on the stall. List a card from Collection."
                      : live.length
                        ? "No live listings match these filters."
                        : "No live listings. Open a pack, then list a card from Collection."
                  }
                  showOwnerNote={tab === "sale"}
                  mine={mine}
                  busy={busy}
                  address={address}
                  onOpen={setFocusId}
                  onBuy={(stall, index, cost) => void buyLot(stall, index, cost)}
                />
              )}
            </div>
            {focusCard || focusShelf ? (
              <Detail
                card={focusCard}
                shelf={focusShelf}
                balance={focusBalance}
                feed={feed}
                askPrice={askPrice}
                copies={copies}
                approved={focusCard && approved ? approved[focusCard.edition] : null}
                busy={busy}
                address={address}
                canSign={canSign()}
                watched={focusCard ? watched.has(focusCard.id) : false}
                mine={mine}
                panelRef={detailRef}
                onPrice={setAskPrice}
                onCopies={setCopies}
                onWatch={() => focusCard && toggleWatch(focusCard.id)}
                onList={() => focusCard && void listCopies(focusCard, copies)}
                onBuy={(stall, index, cost) => void buyLot(stall, index, cost)}
                onCancel={(stall, index) => void cancelLot(stall, index)}
                onClose={() => setFocusId(null)}
              />
            ) : (
              <aside className="veil-box stall-detail stall-placeholder rounded-md">
                <h2 className="text-lg">Card</h2>
                <p className="mt-2 text-sm leading-relaxed text-ash">Select a listing or a card you hold. The panel shows the asks, traits, last sales, and the list form.</p>
              </aside>
            )}
          </div>
        )}
        <p className="text-xs text-ash">
          Stall{" "}
          <a className="text-brass underline" href={`https://polygonscan.com/address/${MARKET}`} target="_blank" rel="noreferrer">
            {shortAddr(MARKET)}
          </a>
          {" "}holds founding cards. Stall{" "}
          <a className="text-brass underline" href={`https://polygonscan.com/address/${BAZAAR}`} target="_blank" rel="noreferrer">
            {shortAddr(BAZAAR)}
          </a>
          {" "}holds Blazar, Kage, and Ashen. One card per listing. The first list on a set approves that stall.
        </p>
      </main>
    </>
  );
}

function ShelfGrid({
  shelves,
  focusId,
  booting,
  empty,
  showOwnerNote,
  mine,
  busy,
  address,
  onOpen,
  onBuy,
}: {
  shelves: Shelf[];
  focusId: string | null;
  booting: boolean;
  empty: string;
  showOwnerNote: boolean;
  mine: (seller: string) => boolean;
  busy: boolean;
  address: string | null;
  onOpen: (id: string) => void;
  onBuy: (stall: Stall, index: number, cost: bigint) => void;
}) {
  if (booting && shelves.length === 0) return <p className="text-sm text-ash">Reading the stall.</p>;
  if (shelves.length === 0) return <p className="text-sm text-ash">{empty}</p>;
  return (
    <>
      <p className="mb-3 text-sm text-ash">{shelves.length} {shelves.length === 1 ? "card" : "cards"}</p>
      <div className="veil-grid">
        {shelves.map((shelf) => {
          const floorAsk = shelf.asks[0];
          const yours = floorAsk ? mine(floorAsk.seller) : false;
          return (
            <article key={shelf.key}>
              {shelf.card ? (
                <CardFace defId={shelf.card.id} size="fill" selected={focusId === shelf.card.id} onClick={() => onOpen(shelf.card!.id)} />
              ) : (
                <button type="button" className="veil-slot w-full font-mono text-sm" onClick={() => onOpen(shelf.key)}>#{shelf.tokenId}</button>
              )}
              <div className="stall-meta">
                <span className="font-mono text-brass">{bzb(shelf.floor)} BzB</span>
                <span className="text-ash">{shelf.asks.length} listed</span>
              </div>
              {floorAsk && !yours ? (
                <button type="button" className="veil-btn veil-btn-primary mt-2 w-full" disabled={busy || !address} onClick={() => onBuy(floorAsk.stall, floorAsk.index, floorAsk.price)}>
                  Buy floor
                </button>
              ) : showOwnerNote ? (
                <p className="mt-2 text-center text-xs tracking-widest text-brass">You hold the floor</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}

function Collection({
  holdings,
  shelves,
  focusId,
  booting,
  address,
  onOpen,
}: {
  holdings: { card: CardDef; balance: number }[];
  shelves: Shelf[];
  focusId: string | null;
  booting: boolean;
  address: string | null;
  onOpen: (id: string) => void;
}) {
  if (!address) return <p className="text-sm text-ash">Connect a wallet to read the cards it holds.</p>;
  if (booting && holdings.length === 0) return <p className="text-sm text-ash">Reading the wallet.</p>;
  if (holdings.length === 0) return <p className="text-sm text-ash">No cards in this view. Listed copies are under My listings, not in the wallet.</p>;
  return (
    <>
      <p className="mb-3 text-sm text-ash">{holdings.length} {holdings.length === 1 ? "card" : "cards"} in the wallet. Listed copies are escrowed, so they are not in this count.</p>
      <div className="veil-grid">
        {holdings.map(({ card, balance }) => {
          const shelf = shelves.find((item) => item.card?.id === card.id);
          return (
            <article key={card.id}>
              <CardFace defId={card.id} size="fill" selected={focusId === card.id} onClick={() => onOpen(card.id)} />
              <div className="stall-meta">
                <span className="font-mono">×{balance}</span>
                <span className="text-ash">{shelf ? `Floor ${bzb(shelf.floor)}` : "Not listed"}</span>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function Activity({ items, booting, focusId, onOpen }: { items: FeedItem[]; booting: boolean; focusId: string | null; onOpen: (id: string) => void }) {
  if (booting && items.length === 0) return <p className="text-sm text-ash">Reading the lot book.</p>;
  if (items.length === 0) return <p className="text-sm text-ash">No listings, sales, or cancellations in this view.</p>;
  return (
    <div className="stall-feed">
      {items.map((item) => {
        const card = item.cardId ? CARDS.find((entry) => entry.id === item.cardId) ?? null : null;
        const verb = item.kind === "sold" ? "Sold" : item.kind === "cancelled" ? "Cancelled" : item.kind === "closed" ? "Closed" : "Listed";
        return (
          <article
            key={item.key}
            className={cx("veil-box stall-row rounded-md", card && focusId === card.id && "stall-row-on")}
            role={card ? "button" : undefined}
            tabIndex={card ? 0 : undefined}
            onClick={() => card && onOpen(card.id)}
            onKeyDown={(event) => {
              if (!card || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              onOpen(card.id);
            }}
          >
            <p className={cx("text-xs tracking-widest", item.kind === "sold" ? "text-signal" : "text-brass")}>{verb}</p>
            <p className="min-w-0">
              <span className="font-medium">{card?.name ?? `Token ${item.tokenId}`}</span>
              <span className="mt-0.5 block font-mono text-xs text-ash">
                {item.price > 0n ? `${bzb(item.price)} BzB · ` : ""}
                {item.who ? shortAddr(item.who) : "stall"}
                {item.time ? ` · ${ago(item.time)}` : ""}
              </span>
            </p>
            <p className="font-mono text-xs text-ash">#{item.lotId}</p>
          </article>
        );
      })}
    </div>
  );
}

function Detail({
  card,
  shelf,
  balance,
  feed,
  askPrice,
  copies,
  approved,
  busy,
  address,
  canSign,
  watched,
  mine,
  panelRef,
  onPrice,
  onCopies,
  onWatch,
  onList,
  onBuy,
  onCancel,
  onClose,
}: {
  card: CardDef | null;
  shelf: Shelf | null;
  balance: number;
  feed: FeedItem[];
  askPrice: string;
  copies: number;
  approved: boolean | null;
  busy: boolean;
  address: string | null;
  canSign: boolean;
  watched: boolean;
  mine: (seller: string) => boolean;
  panelRef: RefObject<HTMLElement | null>;
  onPrice: (value: string) => void;
  onCopies: (value: number) => void;
  onWatch: () => void;
  onList: () => void;
  onBuy: (stall: Stall, index: number, cost: bigint) => void;
  onCancel: (stall: Stall, index: number) => void;
  onClose: () => void;
}) {
  const asks = shelf?.asks ?? [];
  const top = asks.length ? asks[asks.length - 1].price : null;
  const spread = top != null && asks.length > 1 ? top - asks[0].price : null;
  const sellers = new Set(asks.map((ask) => ask.seller.toLowerCase())).size;
  const typed = priceWei(askPrice);
  const floor = shelf?.floor;
  const listable = Boolean(card) && balance > 0;
  const maxCopies = Math.min(balance, 8);
  const sales = card ? feed.filter((item) => item.kind === "sold" && item.cardId === card.id).slice(0, 3) : [];
  let quote = "";
  if (typed && floor) {
    if (typed < floor) quote = `${bzb(floor - typed)} under the floor`;
    else if (typed > floor) quote = `${bzb(typed - floor)} above the floor`;
    else quote = "Matches the floor";
  }
  return (
    <aside ref={panelRef} className="veil-box stall-detail rounded-md">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg leading-tight">
          {card && <SealMark id={card.faction} />}
          {card?.name ?? (shelf ? `Token ${shelf.tokenId}` : "Card")}
        </h2>
        <button type="button" className="veil-btn" onClick={onClose}>Close</button>
      </div>
      {card && (
        <div className="stall-hero mt-3">
          <CardFace defId={card.id} size="fill" />
        </div>
      )}
      {card && (
        <dl className="stall-traits">
          <div><dt>Seal</dt><dd>{factionName(card.faction)}</dd></div>
          <div><dt>Rarity</dt><dd>{rarityLabel(card.rarity, card.set)}</dd></div>
          <div><dt>Type</dt><dd>{schoolOf(card)}</dd></div>
          <div><dt>Cost</dt><dd>{card.cost}</dd></div>
          {card.kind === "unit" && <div><dt>Attack</dt><dd>{card.atk}</dd></div>}
          {card.kind === "unit" && <div><dt>Health</dt><dd>{card.hp}</dd></div>}
          <div><dt>Set</dt><dd>{editionName(card.edition)}</dd></div>
          <div><dt>Token</dt><dd>#{card.tokenId}</dd></div>
          <div><dt>Held</dt><dd>{balance}</dd></div>
          <div><dt>Listed</dt><dd>{asks.length}</dd></div>
        </dl>
      )}
      {card && <p className="mt-3 text-sm leading-relaxed text-ash">{card.text}</p>}
      {asks.length > 0 && (
        <>
          <p className="mt-3 text-xs tracking-widest text-brass">
            {sellers} {sellers === 1 ? "seller" : "sellers"}
            {spread != null && spread > 0n ? ` · spread ${bzb(spread)}` : ""}
          </p>
          <div className="stall-asks">
            {asks.map((ask) => (
              <div key={`${ask.stall}-${ask.index}`} className="stall-ask">
                <div>
                  <p className="font-mono text-sm">{bzb(ask.price)} BzB</p>
                  <p className="text-xs text-ash">{mine(ask.seller) ? "You" : shortAddr(ask.seller)} · #{ask.index}</p>
                </div>
                {mine(ask.seller) ? (
                  <button type="button" className="veil-btn" disabled={busy || !canSign} onClick={() => onCancel(ask.stall, ask.index)}>Cancel</button>
                ) : (
                  <button type="button" className="veil-btn veil-btn-primary" disabled={busy || !address || !canSign} onClick={() => onBuy(ask.stall, ask.index, ask.price)}>Buy</button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {listable && card && (
        <div className="mt-4 grid gap-2">
          <h3 className="text-base">List a copy</h3>
          <p className="text-sm text-ash">{approved ? `The stall can already hold your ${editionName(card.edition).toLowerCase()} cards.` : "The first listing approves the stall for this set, then moves one card into escrow."}</p>
          <label className="grid gap-1 text-sm text-ash">
            Price in BzB
            <input className="veil-field font-mono" inputMode="decimal" autoComplete="off" value={askPrice} onChange={(event) => onPrice(event.target.value)} />
          </label>
          {quote && <p className="text-xs text-brass">{quote}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="veil-btn" disabled={copies <= 1} onClick={() => onCopies(copies - 1)}>-</button>
            <span className="font-mono text-sm">{copies} of {balance}</span>
            <button type="button" className="veil-btn" disabled={copies >= maxCopies} onClick={() => onCopies(copies + 1)}>+</button>
            {floor != null && (
              <button type="button" className="veil-btn" onClick={() => onPrice(bzb(floor > parseUnits("0.01", 18) ? floor - parseUnits("0.01", 18) : floor))}>
                Undercut floor
              </button>
            )}
          </div>
          {copies > 1 && <p className="text-xs text-ash">Each copy is its own transaction.</p>}
          <button type="button" className="veil-btn veil-btn-primary" disabled={busy || !canSign || !priceWei(askPrice)} onClick={onList}>
            {copies === 1 ? "List" : `List ${copies}`}
          </button>
        </div>
      )}
      {card && balance === 0 && (
        <p className="mt-4 text-sm text-ash">None of this card is in the wallet. Copies you already listed are in the asks above.</p>
      )}
      {sales.length > 0 && (
        <p className="mt-4 text-sm text-ash">
          Last sales {sales.map((sale) => bzb(sale.price)).join(" · ")} BzB
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {card && (
          <button type="button" className={cx("veil-btn", watched && "veil-btn-primary")} aria-pressed={watched} onClick={onWatch}>
            {watched ? "Watching" : "Watch"}
          </button>
        )}
        {card && (
          <a className="veil-btn" href={`https://polygonscan.com/address/${nftOf(card.edition)}`} target="_blank" rel="noreferrer">
            Contract
          </a>
        )}
      </div>
    </aside>
  );
}

function Packs({
  busy,
  address,
  onBuy,
}: {
  busy: boolean;
  address: string | null;
  onBuy: (edition: "founding" | "blazar" | "kage" | "ashen", faction: number) => void;
}) {
  return (
    <div className="grid gap-4">
      <section className="veil-box rounded-md p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg">Packs</h2>
          <PackSupply edition="founding" tick={busy ? 1 : 0} />
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ash">A forge pack is 1 BzB. A seal pack is 1.25 BzB. Ten thousand founding packs, fifty thousand cards, then the mint stops. The coins go into the rewards pool, which pays 0.25 BzB for a ranked win.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="veil-btn veil-btn-primary" disabled={busy || !address} onClick={() => onBuy("founding", 0)}>
            Forge pack · 1
          </button>
          {SEALS.map((item) => (
            <button key={item.id} type="button" className="veil-btn" disabled={busy || !address || item.id === "veil"} onClick={() => onBuy("founding", FACTION_CODE[item.id as keyof typeof FACTION_CODE])}>
              {item.name} · 1.25
            </button>
          ))}
        </div>
      </section>
      {isAddress(BLAZAR_PACKS) && (
        <section className="veil-box rounded-md p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg">Blazar Veil</h2>
            <PackSupply edition="blazar" tick={busy ? 1 : 0} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ash">Set 1 packs are 10 BzB. One thousand packs, five thousand cards, then the mint stops. Five sealed cards: four basic, and one rare or legendary. Unbound cards can appear in any seal. The coins go into the same rewards pool.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="veil-btn veil-btn-primary" disabled={busy || !address} onClick={() => onBuy("blazar", 0)}>Any seal · 10</button>
            {SEALS.map((item) => (
              <button key={item.id} type="button" className="veil-btn" disabled={busy || !address || item.id === "veil"} onClick={() => onBuy("blazar", FACTION_CODE[item.id as keyof typeof FACTION_CODE])}>
                {item.name} · 10
              </button>
            ))}
          </div>
        </section>
      )}
      {isAddress(KAGE_PACKS) && (
        <section className="veil-box rounded-md p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg">Kage Veil</h2>
            <PackSupply edition="kage" tick={busy ? 1 : 0} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ash">Set 2 packs are 10 BzB. One thousand packs, five thousand cards, then the mint stops. Five sealed ninja cards: four basic, and one rare or legendary. Unbound cards can appear in any seal. The coins go into the same rewards pool.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="veil-btn veil-btn-primary" disabled={busy || !address} onClick={() => onBuy("kage", 0)}>Any seal · 10</button>
            {SEALS.map((item) => (
              <button key={item.id} type="button" className="veil-btn" disabled={busy || !address || item.id === "veil"} onClick={() => onBuy("kage", FACTION_CODE[item.id as keyof typeof FACTION_CODE])}>
                {item.name} · 10
              </button>
            ))}
          </div>
        </section>
      )}
      {isAddress(ASHEN_PACKS) && BigInt(ASHEN_PACKS) !== 0n && (
        <section className="veil-box rounded-md p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg">Ashen Veil</h2>
            <PackSupply edition="ashen" tick={busy ? 1 : 0} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ash">Set 3 packs are 15 BzB. Two thousand packs, then the mint stops. Five sealed cards: four basic, and one rare or legendary. Six cards in each seal. Unbound cards can appear in any seal. The coins go into the same rewards pool.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="veil-btn veil-btn-primary" disabled={busy || !address} onClick={() => onBuy("ashen", 0)}>Any seal · 15</button>
            {SEALS.map((item) => (
              <button key={item.id} type="button" className="veil-btn" disabled={busy || !address || item.id === "veil"} onClick={() => onBuy("ashen", FACTION_CODE[item.id as keyof typeof FACTION_CODE])}>
                {item.name} · 15
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
