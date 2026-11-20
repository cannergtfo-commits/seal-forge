import { createFileRoute } from "@tanstack/react-router";
import { getAddress, isAddress } from "viem";
import { applyXp, profileByToken } from "@/veil/accounts";
import type { Faction } from "@/veil/cards";
import { deckOwned, veilBalances } from "@/veil/holds";
import { signPrize } from "@/veil/keeper-sign";
import { MMR_START, deckSeal, parseDeck } from "@/veil/ranks";
import {
  act,
  deferScores,
  drainScores,
  flushRooms,
  hostLobby,
  joinLobby,
  joinQueue,
  leaveSeat,
  listLobbies,
  notePrizeSigned,
  pollQueue,
  prizeFor,
  releaseUnsentPrize,
  rewardGate,
  roomsReady,
  scoreboard,
  seatBot,
  type Act,
} from "@/veil/rooms";
import { ownsStage } from "@/veil/stages";

const factions = new Set<Faction>(["elf", "human", "goblin", "robot", "demon"]);

async function finish(id: string) {
  const scored = [...drainScores(), ...scoreboard(id)];
  if (scored.length) {
    try {
      const failed = await applyXp(scored);
      if (failed.length) deferScores(failed);
    } catch (error) {
      console.error("[xp] could not apply match scores; will retry", error);
      deferScores(scored);
    }
  }
  await flushRooms();
}

/** The live voucher for this seat, signed. Every reconnect gets the same matchId back. */
async function signedClaim(id: string) {
  const found = await prizeFor(id).catch((error) => {
    console.error("[reward] could not read the prize ledger", error);
    return null;
  });
  if (!found) return null;
  const signature = await signPrize(found.prize.player, found.prize.matchId);
  if (!signature) {
    await releaseUnsentPrize(found.roomId, found.prize.player);
    return null;
  }
  await notePrizeSigned(found.roomId);
  return { ...found.prize, signature };
}

/**
 * The wallet comes from the signed "Seal Forge account" session, never from the body.
 * A body address with no valid session plays as a guest: free play still works,
 * but no XP, no reward, and no wallet deck (Techno P0 #2a).
 */
async function sessionWallet(token: unknown): Promise<{ address: string; mmr: number }> {
  if (typeof token !== "string" || !token || token === "device") return { address: "", mmr: MMR_START };
  const profile = await profileByToken(token).catch(() => null);
  return profile && isAddress(profile.address) ? { address: getAddress(profile.address), mmr: profile.mmr } : { address: "", mmr: MMR_START };
}

async function readSeat(body: { name?: string; faction?: string; address?: string; token?: string; deck?: unknown; stage?: unknown }): Promise<
  | { error: string; status: number }
  | { name: string; faction: Faction; address: string; deck: string[] | null; eligible: boolean; deckNote: string; stage: number; mmr: number; auth: "signed-in" | "signed-out" | "guest" }
> {
  if (!body.faction || !factions.has(body.faction as Faction)) return { error: "Pick a seal.", status: 400 };
  const claimed = body.address && isAddress(body.address) ? body.address : "";
  const { address: verified, mmr } = await sessionWallet(body.token);
  // A session for a different wallet than the one connected is treated as signed out.
  const address = verified && (!claimed || claimed.toLowerCase() === verified.toLowerCase()) ? verified : "";
  const auth = address ? "signed-in" : claimed ? "signed-out" : "guest";
  const parsed = parseDeck(body.deck);
  let deck = parsed.ok ? parsed.deck : null;
  let eligible = false;
  let deckNote = deck ? "needs-nfts" : "starter";
  if (deck) {
    const sealed = deckSeal(deck);
    if (!sealed.ok || (sealed.seal !== "veil" && sealed.seal !== body.faction)) {
      deck = null;
      deckNote = "wrong-seal";
    }
  }
  if (!address) {
    if (deck) deckNote = "sign-in";
    deck = null;
  }
  if (address) {
    const balances = await readBalances(address);
    eligible = Boolean(balances?.some((count) => count > 0));
    if (deck) {
      const owned = balances ? await deckOwned(address, deck) : { ok: false as const, error: "Could not read this wallet's card NFTs." };
      if (!owned.ok) deck = null;
      else deckNote = "yours";
    }
  }
  // The arena backdrop is cosmetic and read-only, so the connected (unverified) wallet may still show its stage.
  const stageWallet = address || claimed;
  const asked = typeof body.stage === "number" ? body.stage : Number(body.stage);
  const stage = stageWallet && Number.isInteger(asked) && asked >= 1 && asked <= 64 && (await ownsStage(stageWallet, asked).catch(() => false)) ? asked : 0;
  return { name: body.name ?? "Duelist", faction: body.faction as Faction, address, deck, eligible, deckNote, stage, mmr: address ? mmr : MMR_START, auth };
}

export const Route = createFileRoute("/api/veilforge/queue")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await roomsReady();
        const url = new URL(request.url);
        if (url.searchParams.get("list") === "1") return Response.json({ lobbies: listLobbies() });
        const id = url.searchParams.get("id") ?? "";
        const found = pollQueue(id);
        await finish(id);
        const claim = await signedClaim(id);
        return Response.json({ ...found, reward: rewardGate(id), claim });
      },
      POST: async ({ request }) => {
        await roomsReady();
        const body = (await request.json()) as {
          op?: string;
          id?: string;
          name?: string;
          faction?: string;
          address?: string;
          token?: string;
          deck?: unknown;
          code?: string;
          action?: Act;
          stage?: unknown;
          epoch?: number;
        };
        const id = body.id ?? "";
        if (!id || id.length > 40) return Response.json({ error: "Missing player." }, { status: 400 });
        if (body.op === "leave") {
          leaveSeat(id, body.epoch);
          await finish(id);
          return Response.json({ ok: true });
        }
        if (body.op === "join" || body.op === "host" || body.op === "enter") {
          const read = await readSeat(body);
          if ("error" in read && "status" in read) return Response.json({ error: read.error }, { status: read.status });
          const { auth, ...seat } = read;
          if (body.op === "host") {
            const found = hostLobby({ id, ...seat });
            await finish(id);
            return Response.json({ ...found, eligible: seat.eligible, deck: seat.deckNote, auth });
          }
          if (body.op === "enter") {
            const found = joinLobby(body.code ?? "", { id, ...seat });
            await finish(id);
            if (found.error && found.status !== "play") return Response.json({ error: found.error }, { status: 400 });
            return Response.json({ ...found, eligible: seat.eligible, deck: seat.deckNote, auth });
          }
          const found = joinQueue({ id, ...seat });
          await finish(id);
          return Response.json({ ...found, eligible: seat.eligible, deck: seat.deckNote, auth });
        }
        if (body.op === "bot") {
          const found = seatBot(id);
          await finish(id);
          if (found.error) return Response.json({ error: found.error }, { status: 400 });
          return Response.json(found);
        }
        if (body.op === "act" && body.action) {
          const result = act(id, body.action);
          await finish(id);
          const claim = await signedClaim(id);
          return Response.json({ ...result, reward: rewardGate(id), claim });
        }
        return Response.json({ error: "Unknown request." }, { status: 400 });
      },
    },
  },
});

/** Polygon reads sometimes fail; retry so a flaky RPC does not silently cost a player their win reward. */
async function readBalances(address: string): Promise<number[] | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const balances = await veilBalances(address as `0x${string}`).catch(() => null);
    if (balances) return balances;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  console.warn(`[veilforge] card ownership read failed for ${address}; win reward eligibility off for this match`);
  return null;
}
