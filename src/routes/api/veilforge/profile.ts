import { createFileRoute } from "@tanstack/react-router";
import { isAddress } from "viem";
import { challengeFor, leaderboard, openAccount, profileByToken, restoreProgress, saveProfile, sealProfile, walletByToken, type Profile } from "@/veil/accounts";
import { CARDS } from "@/veil/cards";
import { deckOwned, veilBalances } from "@/veil/holds";
import { MAX_DECKS, activateDeck, listDecks, renameDeck, sealDeck, unsealDeck, type DeckResult } from "@/veil/decks";
import { getSql } from "@/lib/db";
import { profileStats } from "@/veil/profile-stats";
import { paidVoucherCount, winsToBzb } from "@/veil/reward-reads";
import { equipTitle, titlesFor } from "@/veil/titles";

/** Deck ops answer with the full list plus the refreshed profile (its active-deck mirror may have moved). */
async function deckReply(token: string, run: (wallet: string) => Promise<DeckResult>): Promise<Response> {
  const wallet = await walletByToken(token);
  if (!wallet) return Response.json({ error: "Sign in again." }, { status: 401 });
  const result = await run(wallet);
  if ("error" in result) return Response.json(result, { status: 400 });
  const profile = await profileByToken(token);
  return Response.json({ decks: result.decks, max: MAX_DECKS, ...(profile ? await withTitles(token, profile) : {}) });
}

/** Read-only ownership check for sealing: the same existing helper single-deck sealing used. */
const owns = (wallet: string, cards: string[]) => deckOwned(wallet, cards);

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

async function packed(profile: Profile, extra: Record<string, unknown> = {}) {
  return { profile, seal: await sealProfile(profile), ...extra };
}

async function withTitles(token: string, profile: Profile) {
  try {
    const bundle = await titlesFor(await getSql(), profile.address);
    return packed(profile, { titles: bundle.titles, equipped: bundle.equipped, fresh: bundle.fresh });
  } catch (error) {
    console.error("[titles] catalog failed", error);
    return packed(profile);
  }
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
        if (token && url.searchParams.get("decks") === "1") {
          const wallet = await walletByToken(token);
          if (!wallet) return Response.json({ error: "Sign in again." }, { status: 401 });
          return Response.json({ decks: await listDecks(await getSql(), wallet), max: MAX_DECKS });
        }
        if (token) {
          const profile = await profileByToken(token);
          return Response.json(profile ? await withTitles(token, profile) : { error: "Sign in again." }, { status: profile ? 200 : 401 });
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
          titleId?: string;
          deckId?: string;
          cards?: unknown;
          activate?: boolean;
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
          return Response.json({ token: opened.token, ...(await withTitles(opened.token, opened.profile)) });
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
          return Response.json(await withTitles(body.token ?? "", restored.profile));
        }
        if (body.op === "deck-seal") {
          return deckReply(body.token ?? "", async (wallet) => sealDeck(await getSql(), wallet, { id: body.deckId, name: body.deckName, cards: body.cards, activate: body.activate }, owns));
        }
        if (body.op === "deck-rename") return deckReply(body.token ?? "", async (wallet) => renameDeck(await getSql(), wallet, body.deckId, body.deckName));
        if (body.op === "deck-activate") return deckReply(body.token ?? "", async (wallet) => activateDeck(await getSql(), wallet, body.deckId));
        if (body.op === "deck-unseal") return deckReply(body.token ?? "", async (wallet) => unsealDeck(await getSql(), wallet, body.deckId));
        if (body.op === "title") {
          const wallet = await walletByToken(body.token ?? "");
          if (!wallet) return Response.json({ error: "Sign in again." }, { status: 401 });
          const titleId = typeof body.titleId === "string" ? body.titleId : "";
          const result = await equipTitle(await getSql(), wallet, titleId || null);
          if ("error" in result) return Response.json(result, { status: 400 });
          const profile = await profileByToken(body.token ?? "");
          return Response.json(profile ? await withTitles(body.token ?? "", profile) : result);
        }
        if (body.op === "save") {
          const saved = await saveProfile(body.token ?? "", { name: body.name, portrait: body.portrait, deck: body.deck, deckName: body.deckName, nft: body.nft, motto: body.motto });
          if ("error" in saved) return Response.json(saved, { status: 400 });
          return Response.json(await withTitles(body.token ?? "", saved.profile));
        }
        return Response.json({ error: "Unknown request." }, { status: 400 });
      },
    },
  },
});
