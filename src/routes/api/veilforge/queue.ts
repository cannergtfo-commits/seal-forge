import { createFileRoute } from "@tanstack/react-router";
import { isAddress } from "viem";
import { applyXp } from "@/veil/accounts";
import type { Faction } from "@/veil/cards";
import { deckOwned, veilBalances } from "@/veil/holds";
import { signPrize } from "@/veil/keeper-sign";
import { deckSeal, parseDeck } from "@/veil/ranks";
import { act, drainScores, hostLobby, joinLobby, joinQueue, leaveSeat, listLobbies, pollQueue, prizeFor, rewardGate, scoreboard, seatBot, type Act } from "@/veil/rooms";
import { ownsStage } from "@/veil/stages";

const factions = new Set<Faction>(["elf", "human", "goblin", "robot", "demon"]);

async function finish(id: string) {
  const scored = [...drainScores(), ...scoreboard(id)];
  if (scored.length) await applyXp(scored);
}

async function readSeat(body: { name?: string; faction?: string; address?: string; deck?: unknown; stage?: unknown }): Promise<
  | { error: string; status: number }
  | { name: string; faction: Faction; address: string; deck: string[] | null; eligible: boolean; deckNote: string; stage: number }
> {
  if (!body.faction || !factions.has(body.faction as Faction)) return { error: "Pick a seal.", status: 400 };
  const address = body.address && isAddress(body.address) ? body.address : "";
  const parsed = parseDeck(body.deck);
  let deck = parsed.ok ? parsed.deck : null;
  let eligible = false;
  let deckNote = deck ? "needs-nfts" : "starter";
  if (deck) {
    const sealed = deckSeal(deck);
    if (!sealed.ok || sealed.seal !== body.faction) {
      deck = null;
      deckNote = "wrong-seal";
    }
  }
  if (!address) deck = null;
  if (address) {
    const balances = await veilBalances(address).catch(() => null);
    eligible = Boolean(balances?.some((count) => count > 0));
    if (deck) {
      const owned = balances ? await deckOwned(address, deck) : { ok: false as const, error: "Could not read this wallet's card NFTs." };
      if (!owned.ok) deck = null;
      else deckNote = "yours";
    }
  }
  const asked = typeof body.stage === "number" ? body.stage : Number(body.stage);
  const stage = address && Number.isInteger(asked) && asked >= 1 && asked <= 64 && (await ownsStage(address, asked).catch(() => false)) ? asked : 0;
  return { name: body.name ?? "Duelist", faction: body.faction as Faction, address, deck, eligible, deckNote, stage };
}

export const Route = createFileRoute("/api/veilforge/queue")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("list") === "1") return Response.json({ lobbies: listLobbies() });
        const id = url.searchParams.get("id") ?? "";
        const found = pollQueue(id);
        await finish(id);
        const prize = prizeFor(id);
        const signature = prize ? await signPrize(prize.player, prize.matchId) : null;
        return Response.json({ ...found, reward: rewardGate(id), claim: prize && signature ? { ...prize, signature } : null });
      },
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          op?: string;
          id?: string;
          name?: string;
          faction?: string;
          address?: string;
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
          const seat = await readSeat(body);
          if ("error" in seat && "status" in seat) return Response.json({ error: seat.error }, { status: seat.status });
          if (body.op === "host") {
            const found = hostLobby({ id, ...seat });
            await finish(id);
            return Response.json({ ...found, eligible: seat.eligible, deck: seat.deckNote });
          }
          if (body.op === "enter") {
            const found = joinLobby(body.code ?? "", { id, ...seat });
            await finish(id);
            if (found.error && found.status !== "play") return Response.json({ error: found.error }, { status: 400 });
            return Response.json({ ...found, eligible: seat.eligible, deck: seat.deckNote });
          }
          const found = joinQueue({ id, ...seat });
          await finish(id);
          return Response.json({ ...found, eligible: seat.eligible, deck: seat.deckNote });
        }
        if (body.op === "bot") {
          const found = seatBot(id);
          if (found.error) return Response.json({ error: found.error }, { status: 400 });
          return Response.json(found);
        }
        if (body.op === "act" && body.action) {
          const result = act(id, body.action);
          await finish(id);
          const prize = prizeFor(id);
          const signature = prize ? await signPrize(prize.player, prize.matchId) : null;
          return Response.json({ ...result, reward: rewardGate(id), claim: prize && signature ? { ...prize, signature } : null });
        }
        return Response.json({ error: "Unknown request." }, { status: 400 });
      },
    },
  },
});
