import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getSql } from "@/lib/db";
import { CARDS } from "./cards";
import { ASHEN_NFT, BLAZAR_NFT, CARDS_NFT, KAGE_NFT, KEEPER } from "./deployed";
import { deckOwned, veilBalances } from "./holds";
import { GIFT_LEVEL, LOSS_XP, WIN_XP, cleanDeckName, cleanName, isPortrait, parseDeck, rankFor } from "./ranks";

export type Profile = {
  address: string;
  name: string;
  portrait: string;
  nftContract: string | null;
  nftToken: string | null;
  nftImage: string | null;
  xp: number;
  wins: number;
  losses: number;
  rank: string;
  nextRank: number | null;
  deck: string[];
  deckName: string;
  gifted: boolean;
  giftOrder: string;
  giftReady: boolean;
};

type Row = {
  address: string;
  name: string;
  portrait: string;
  nft_contract: string | null;
  nft_token: string | null;
  nft_image: string | null;
  xp: number;
  wins: number;
  losses: number;
  deck: string;
  deck_name: string;
  gifted: number;
  gift_order: string;
  gift_cards: string;
};

const challenges = new Map<string, { nonce: string; message: string; at: number }>();

function toProfile(row: Row): Profile {
  const xp = Number(row.xp) || 0;
  const rank = rankFor(xp);
  return {
    address: row.address,
    name: row.name,
    portrait: row.portrait,
    nftContract: row.nft_contract,
    nftToken: row.nft_token,
    nftImage: row.nft_image,
    xp,
    wins: Number(row.wins) || 0,
    losses: Number(row.losses) || 0,
    rank: rank.name,
    nextRank: rank.next,
    deck: row.deck ? row.deck.split(",") : [],
    deckName: row.deck_name ?? "",
    gifted: Number(row.gifted) === 1,
    giftOrder: row.gift_order ?? "",
    giftReady: rankFor(xp).level >= GIFT_LEVEL,
  };
}

const BACKUP_DIR = "data/profile-backups";

export function progressMessage(input: { address: string; xp: number; wins: number; losses: number; name: string; portrait: string; deck: string[]; deckName: string }) {
  return [
    "Seal Forge progress",
    getAddress(input.address),
    String(Math.max(0, Math.floor(input.xp))),
    String(Math.max(0, Math.floor(input.wins))),
    String(Math.max(0, Math.floor(input.losses))),
    input.name,
    input.portrait,
    input.deck.join(","),
    input.deckName,
  ].join("\n");
}

function keeperAccount() {
  const fromEnv = process.env.SEAL_FORGE_SIGNER;
  const key = (fromEnv && /^0x[0-9a-fA-F]{64}$/.test(fromEnv) ? fromEnv : (JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8")) as { key: Hex }).key) as Hex;
  const account = privateKeyToAccount(key);
  if (getAddress(account.address) !== getAddress(KEEPER)) throw new Error("keeper mismatch");
  return account;
}

export async function sealProfile(profile: Profile): Promise<Hex | null> {
  try {
    return await keeperAccount().signMessage({ message: progressMessage(profile) });
  } catch {
    return null;
  }
}

export async function snapshotProfiles(): Promise<void> {
  try {
    const sql = await getSql();
    const rows = await sql`select address, name, portrait, xp, wins, losses, deck, deck_name, gifted, gift_order, gift_cards from veil_profiles order by address`;
    mkdirSync(BACKUP_DIR, { recursive: true });
    const body = JSON.stringify({ at: new Date().toISOString(), rows });
    writeFileSync(`${BACKUP_DIR}/latest.json`, body);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(`${BACKUP_DIR}/${stamp}.json`, body);
    const old = readdirSync(BACKUP_DIR)
      .filter((name) => name.endsWith(".json") && name !== "latest.json")
      .sort();
    for (const name of old.slice(0, Math.max(0, old.length - 12))) rmSync(`${BACKUP_DIR}/${name}`, { force: true });
  } catch {
    /* a missed backup must not fail the match */
  }
}

export async function restoreProgress(
  token: string,
  input: { address?: string; xp?: number; wins?: number; losses?: number; name?: string; portrait?: string; deck?: string[]; deckName?: string; signature?: string },
): Promise<{ profile: Profile } | { error: string }> {
  const row = await byToken(token);
  if (!row) return { error: "Sign in again." };
  if (!input.address || !isAddress(input.address) || !input.signature?.startsWith("0x")) return { error: "That backup is incomplete." };
  if (getAddress(input.address).toLowerCase() !== row.address) return { error: "That backup is for a different wallet." };
  const xp = Math.max(0, Math.floor(Number(input.xp) || 0));
  const wins = Math.max(0, Math.floor(Number(input.wins) || 0));
  const losses = Math.max(0, Math.floor(Number(input.losses) || 0));
  if (xp > 1_000_000 || wins > 100_000 || losses > 100_000) return { error: "That backup is not a real profile." };
  const name = cleanName(input.name ?? "") ?? row.name;
  const portrait = input.portrait && isPortrait(input.portrait) ? input.portrait : row.portrait;
  const deckList = Array.isArray(input.deck) ? input.deck : [];
  const deckName = cleanDeckName(input.deckName ?? "") ?? row.deck_name ?? "";
  const message = progressMessage({ address: row.address, xp, wins, losses, name, portrait, deck: deckList, deckName });
  const signed = await verifyMessage({ address: getAddress(KEEPER) as Address, message, signature: input.signature as Hex });
  if (!signed) return { error: "That backup was not signed by the game." };
  const serverGames = (Number(row.wins) || 0) + (Number(row.losses) || 0);
  if (wins + losses <= serverGames) return { profile: toProfile(row) };
  const parsed = deckList.length ? parseDeck(deckList) : { ok: true as const, deck: [] as string[] };
  const deck = parsed.ok ? parsed.deck.join(",") : row.deck;
  const sql = await getSql();
  await sql`update veil_profiles set xp = ${Math.max(Number(row.xp) || 0, xp)}, wins = ${Math.max(Number(row.wins) || 0, wins)}, losses = ${Math.max(Number(row.losses) || 0, losses)}, name = ${name}, portrait = ${portrait}, deck = ${deck}, deck_name = ${deckName} where address = ${row.address}`;
  const next = await sql<Row>`select * from veil_profiles where address = ${row.address}`;
  await snapshotProfiles();
  return { profile: toProfile(next[0]!) };
}

export function challengeFor(address: string): { message: string; nonce: string } | null {
  if (!isAddress(address)) return null;
  const key = address.toLowerCase();
  const nonce = randomBytes(16).toString("hex");
  const message = `Seal Forge account\n${getAddress(address)}\n${nonce}`;
  challenges.set(key, { nonce, message, at: Date.now() });
  return { message, nonce };
}

export async function openAccount(address: string, signature: string): Promise<{ token: string; profile: Profile } | { error: string }> {
  if (!isAddress(address) || !signature.startsWith("0x")) return { error: "Sign in with your wallet." };
  const key = address.toLowerCase();
  const pending = challenges.get(key);
  if (!pending || Date.now() - pending.at > 10 * 60 * 1000) return { error: "Ask for a new signature prompt." };
  const ok = await verifyMessage({ address: getAddress(address), message: pending.message, signature: signature as Hex });
  if (!ok) return { error: "That signature does not match this wallet." };
  challenges.delete(key);
  const sql = await getSql();
  const token = randomBytes(24).toString("hex");
  const existing = await sql<Row>`select * from veil_profiles where address = ${key}`;
  if (!existing[0]) {
    const name = `Duelist ${address.slice(2, 6)}`;
    await sql`insert into veil_profiles (address, name, portrait, session) values (${key}, ${name}, ${"lysara"}, ${token})`;
  } else {
    await sql`update veil_profiles set session = ${token} where address = ${key}`;
  }
  const rows = await sql<Row>`select * from veil_profiles where address = ${key}`;
  return { token, profile: toProfile(rows[0]!) };
}

async function byToken(token: string): Promise<Row | null> {
  if (!/^[a-f0-9]{48}$/.test(token)) return null;
  const sql = await getSql();
  const rows = await sql<Row>`select * from veil_profiles where session = ${token}`;
  return rows[0] ?? null;
}

export async function profileByToken(token: string): Promise<Profile | null> {
  const row = await byToken(token);
  return row ? toProfile(row) : null;
}

function publicImage(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host === "0.0.0.0") return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  return url.toString();
}

async function readJsonImage(body: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(body) as { image?: unknown };
    return typeof parsed.image === "string" ? parsed.image : null;
  } catch {
    return null;
  }
}

async function pictureFromUri(tokenUri: string): Promise<string | null> {
  if (tokenUri.startsWith("data:application/json")) {
    const comma = tokenUri.indexOf(",");
    const data = tokenUri.slice(comma + 1);
    const json = tokenUri.includes(";base64,") ? Buffer.from(data, "base64").toString("utf8") : decodeURIComponent(data);
    const image = await readJsonImage(json);
    return image ? publicImage(image) ?? (image.startsWith("ipfs://") ? publicImage(`https://ipfs.io/ipfs/${image.slice(7)}`) : null) : null;
  }
  const direct = tokenUri.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${tokenUri.slice(7)}` : tokenUri;
  const safe = publicImage(direct);
  if (!safe) return null;
  const response = await fetch(safe, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) return null;
  const type = response.headers.get("content-type") ?? "";
  if (type.startsWith("image/")) return safe;
  const text = (await response.text()).slice(0, 20_000);
  const image = await readJsonImage(text);
  if (!image) return null;
  if (image.startsWith("ipfs://")) return publicImage(`https://ipfs.io/ipfs/${image.slice(7)}`);
  return publicImage(image);
}

export async function saveProfile(
  token: string,
  input: { name?: string; portrait?: string; deck?: unknown; deckName?: string; nft?: { contract?: string; tokenId?: string } | null },
): Promise<{ profile: Profile } | { error: string }> {
  const row = await byToken(token);
  if (!row) return { error: "Sign in again." };
  const name = input.name === undefined ? row.name : cleanName(input.name);
  if (!name) return { error: "Use 2 to 18 letters or numbers." };
  let portrait = row.portrait;
  let nftContract = row.nft_contract;
  let nftToken = row.nft_token;
  let nftImage = row.nft_image;
  if (input.portrait) {
    if (!isPortrait(input.portrait)) return { error: "Pick one of the twenty portraits." };
    portrait = input.portrait;
    nftContract = null;
    nftToken = null;
    nftImage = null;
  }
  if (input.nft) {
    const found = await nftPortrait(row.address, input.nft.contract ?? "", input.nft.tokenId ?? "");
    if ("error" in found) return found;
    portrait = found.portrait;
    nftContract = found.nftContract;
    nftToken = found.nftToken;
    nftImage = found.nftImage;
  }
  let deck = row.deck;
  if (input.deck !== undefined) {
    if (Array.isArray(input.deck) && input.deck.length === 0) deck = "";
    else {
      const parsed = parseDeck(input.deck);
      if (!parsed.ok) return { error: parsed.error };
      const owned = await deckOwned(row.address, parsed.deck);
      if (!owned.ok) return { error: owned.error };
      deck = parsed.deck.join(",");
    }
  }
  let deckName = row.deck_name ?? "";
  if (input.deckName !== undefined) {
    const cleaned = cleanDeckName(input.deckName);
    if (cleaned === null) return { error: "Deck names are 2 to 18 letters or numbers." };
    deckName = cleaned;
  }
  const sql = await getSql();
  await sql`update veil_profiles set name = ${name}, portrait = ${portrait}, nft_contract = ${nftContract}, nft_token = ${nftToken}, nft_image = ${nftImage}, deck = ${deck}, deck_name = ${deckName} where address = ${row.address}`;
  const next = await sql<Row>`select * from veil_profiles where address = ${row.address}`;
  await snapshotProfiles();
  return { profile: toProfile(next[0]!) };
}

async function nftPortrait(
  owner: string,
  contract: string,
  tokenId: string,
): Promise<{ portrait: string; nftContract: string; nftToken: string; nftImage: string | null } | { error: string }> {
  if (!isAddress(contract) || !/^\d+$/.test(tokenId)) return { error: "Enter a contract and a token id." };
  const { createPublicClient, http } = await import("viem");
  const { polygon } = await import("viem/chains");
  const client = createPublicClient({ chain: polygon, transport: http("https://polygon-bor-rpc.publicnode.com") });
  const id = BigInt(tokenId);
  const ownedCard = CARDS.find((card) => {
    const token = card.edition === "ashen" ? ASHEN_NFT : card.edition === "kage" ? KAGE_NFT : card.edition === "blazar" ? BLAZAR_NFT : CARDS_NFT;
    return token && token.toLowerCase() === contract.toLowerCase() && card.tokenId === Number(id);
  });
  if (ownedCard) {
    const balances = await veilBalances(getAddress(owner));
    const index = CARDS.indexOf(ownedCard);
    if ((balances[index] ?? 0) < 1) return { error: "This wallet does not hold that card." };
    return { portrait: ownedCard.id, nftContract: getAddress(contract), nftToken: tokenId, nftImage: null };
  }
  const erc721 = [
    { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "address" }] },
    { type: "function", name: "tokenURI", stateMutability: "view", inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "string" }] },
  ] as const;
  try {
    const holder = await client.readContract({ address: contract, abi: erc721, functionName: "ownerOf", args: [id] });
    if (holder.toLowerCase() !== owner.toLowerCase()) return { error: "This wallet does not hold that NFT." };
    const uri = await client.readContract({ address: contract, abi: erc721, functionName: "tokenURI", args: [id] });
    const image = await pictureFromUri(uri);
    if (!image) return { error: "That NFT has no public picture." };
    return { portrait: "lysara", nftContract: getAddress(contract), nftToken: tokenId, nftImage: image };
  } catch {
    return { error: "That contract did not answer as an NFT you own." };
  }
}

export async function applyXp(results: { address: string; win: boolean }[]): Promise<void> {
  if (!results.length) return;
  const sql = await getSql();
  for (const result of results) {
    const address = result.address.toLowerCase();
    const delta = result.win ? WIN_XP : -LOSS_XP;
    if (result.win) {
      await sql`update veil_profiles set xp = xp + ${delta}, wins = wins + 1 where address = ${address}`;
    } else {
      await sql`update veil_profiles set xp = greatest(0, xp + ${delta}), losses = losses + 1 where address = ${address}`;
    }
  }
  await snapshotProfiles();
}

export async function leaderboard(): Promise<Profile[]> {
  const sql = await getSql();
  const rows = await sql<Row>`select * from veil_profiles order by xp desc, wins desc, name asc limit 20`;
  return rows.map(toProfile);
}
