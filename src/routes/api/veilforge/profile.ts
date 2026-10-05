import { createFileRoute } from "@tanstack/react-router";
import { isAddress } from "viem";
import { challengeFor, leaderboard, openAccount, profileByToken, restoreProgress, saveProfile, sealProfile, type Profile } from "@/veil/accounts";
import { CARDS } from "@/veil/cards";
import { veilBalances } from "@/veil/holds";

async function packed(profile: Profile) {
  return { profile, seal: await sealProfile(profile) };
}

export const Route = createFileRoute("/api/veilforge/profile")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("board") === "1") {
          const rows = await leaderboard();
          return Response.json({ board: rows });
        }
        const token = url.searchParams.get("token") ?? "";
        if (token) {
          const profile = await profileByToken(token);
          return Response.json(profile ? await packed(profile) : { error: "Sign in again." }, { status: profile ? 200 : 401 });
        }
        const address = url.searchParams.get("address") ?? "";
        if (!isAddress(address)) return Response.json({ error: "Missing wallet." }, { status: 400 });
        const balances = await veilBalances(address);
        const owned = CARDS.map((card, index) => ({ id: card.id, name: card.name, balance: balances[index] ?? 0 })).filter((card) => card.balance > 0);
        return Response.json({ owned });
      },
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          op?: string;
          address?: string;
          signature?: string;
          token?: string;
          name?: string;
          portrait?: string;
          deck?: unknown;
          deckName?: string;
          nft?: { contract?: string; tokenId?: string } | null;
          xp?: number;
          wins?: number;
          losses?: number;
        };
        if (body.op === "challenge") {
          const challenge = challengeFor(body.address ?? "");
          if (!challenge) return Response.json({ error: "That is not a wallet address." }, { status: 400 });
          return Response.json(challenge);
        }
        if (body.op === "sign") {
          const opened = await openAccount(body.address ?? "", body.signature ?? "");
          if ("error" in opened) return Response.json(opened, { status: 400 });
          return Response.json({ token: opened.token, ...(await packed(opened.profile)) });
        }
        if (body.op === "restore") {
          const restored = await restoreProgress(body.token ?? "", {
            address: body.address,
            xp: body.xp,
            wins: body.wins,
            losses: body.losses,
            name: body.name,
            portrait: body.portrait,
            deck: Array.isArray(body.deck) ? body.deck.filter((id): id is string => typeof id === "string") : [],
            deckName: body.deckName,
            signature: body.signature,
          });
          if ("error" in restored) return Response.json(restored, { status: 400 });
          return Response.json(await packed(restored.profile));
        }
        if (body.op === "save") {
          const saved = await saveProfile(body.token ?? "", { name: body.name, portrait: body.portrait, deck: body.deck, deckName: body.deckName, nft: body.nft });
          if ("error" in saved) return Response.json(saved, { status: 400 });
          return Response.json(await packed(saved.profile));
        }
        return Response.json({ error: "Unknown request." }, { status: 400 });
      },
    },
  },
});
