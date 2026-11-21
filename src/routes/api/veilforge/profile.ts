import { createFileRoute } from "@tanstack/react-router";
import { isAddress } from "viem";
import { challengeFor, leaderboard, openAccount, profileByToken, restoreProgress, saveProfile, sealProfile, walletByToken, type Profile } from "@/veil/accounts";
import { CARDS } from "@/veil/cards";
import { veilBalances } from "@/veil/holds";
import { getSql } from "@/lib/db";
import { profileStats } from "@/veil/profile-stats";
import { paidVoucherCount, winsToBzb } from "@/veil/reward-reads";

/** Owner-only stat sheet for the profile page. Read-only: database aggregates plus one public chain view. */
async function statSheet(token: string): Promise<Response> {
  const wallet = await walletByToken(token);
  if (!wallet) return Response.json({ error: "Sign in again." }, { status: 401 });
  const sql = await getSql();
  const stats = await profileStats(sql, wallet);
  const paid = await paidVoucherCount(wallet, stats.vouchers.matchIds);
  const giftCards = stats.giftTokens
    .map((token) => CARDS.find((card) => card.setNo === 1 && String(card.tokenId) === token)?.id)
    .filter((id): id is string => Boolean(id));
  const { vouchers, giftTokens: _drop, ...rest } = stats;
  return Response.json({
    stats: rest,
    rewards: { signed: vouchers.signed, paid, bzb: paid === null ? null : winsToBzb(paid) },
    giftCards,
  });
}

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
        if (token && url.searchParams.get("stats") === "1") return statSheet(token);
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
          motto?: string;
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
          const saved = await saveProfile(body.token ?? "", { name: body.name, portrait: body.portrait, deck: body.deck, deckName: body.deckName, nft: body.nft, motto: body.motto });
          if ("error" in saved) return Response.json(saved, { status: 400 });
          return Response.json(await packed(saved.profile));
        }
        return Response.json({ error: "Unknown request." }, { status: 400 });
      },
    },
  },
});
