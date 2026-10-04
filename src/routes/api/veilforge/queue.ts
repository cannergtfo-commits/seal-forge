import { createFileRoute } from "@tanstack/react-router";
import { readFileSync } from "node:fs";
import { createPublicClient, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { applyXp } from "@/veil/accounts";
import type { Faction } from "@/veil/cards";
import { REWARDS } from "@/veil/deployed";
import { deckOwned, veilBalances } from "@/veil/holds";
import { deckSeal, parseDeck } from "@/veil/ranks";
import { act, joinQueue, pollQueue, prizeFor, rewardGate, scoreboard, seatBot, type Act } from "@/veil/rooms";

const rewardsAbi = [
  {
    type: "function",
    name: "inner",
    stateMutability: "view",
    inputs: [
      { name: "player", type: "address" },
      { name: "matchId", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

const factions = new Set<Faction>(["elf", "human", "goblin", "robot", "demon"]);

async function sign(player: `0x${string}`, matchId: `0x${string}`): Promise<`0x${string}` | null> {
  if (REWARDS.length !== 42) return null;
  try {
    const { key } = JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8")) as { key: `0x${string}` };
    const account = privateKeyToAccount(key);
    const client = createPublicClient({ chain: polygon, transport: http("https://polygon-bor-rpc.publicnode.com") });
    const digest = await client.readContract({ address: REWARDS, abi: rewardsAbi, functionName: "inner", args: [player, matchId] });
    return account.signMessage({ message: { raw: digest } });
  } catch {
    return null;
  }
}

async function finish(id: string) {
  const scored = scoreboard(id);
  if (scored.length) await applyXp(scored);
}

export const Route = createFileRoute("/api/veilforge/queue")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        const found = pollQueue(id);
        await finish(id);
        const prize = prizeFor(id);
        const signature = prize ? await sign(prize.player, prize.matchId) : null;
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
          action?: Act;
        };
        const id = body.id ?? "";
        if (!id || id.length > 40) return Response.json({ error: "Missing player." }, { status: 400 });
        if (body.op === "join") {
          if (!body.faction || !factions.has(body.faction as Faction)) return Response.json({ error: "Pick a seal." }, { status: 400 });
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
          const found = joinQueue({ id, name: body.name ?? "Duelist", faction: body.faction as Faction, address, deck, eligible });
          return Response.json({ ...found, eligible, deck: deckNote });
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
          const signature = prize ? await sign(prize.player, prize.matchId) : null;
          return Response.json({ ...result, reward: rewardGate(id), claim: prize && signature ? { ...prize, signature } : null });
        }
        return Response.json({ error: "Unknown request." }, { status: 400 });
      },
    },
  },
});
