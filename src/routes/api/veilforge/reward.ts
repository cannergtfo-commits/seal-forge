import { createFileRoute } from "@tanstack/react-router";
import { getAddress, isAddress } from "viem";
import { profileByToken } from "@/veil/accounts";
import { confirmClaimTx } from "@/veil/daily-clear-server";
import { signPrize } from "@/veil/keeper-sign";
import { notePrizeSigned, releaseUnsentPrize, roomsReady, scoredPrizeFor } from "@/veil/rooms";

export const Route = createFileRoute("/api/veilforge/reward")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await roomsReady();
        const body = (await request.json()) as { address?: string; roomId?: string; token?: string; txHash?: string };
        // Confirm a already-sent claim() tx. Does not build, sign, or send a voucher.
        if (typeof body.txHash === "string" && body.txHash) {
          try {
            const result = await confirmClaimTx(typeof body.token === "string" ? body.token : "", body.txHash);
            const status = result.ok ? 200 : result.retry ? 503 : 400;
            return Response.json(result, { status });
          } catch (error) {
            console.error("[reward] claim confirm error", error);
            return Response.json({ ok: false, error: "Polygon did not answer. We'll try that claim again.", retry: true }, { status: 503 });
          }
        }
        // The wallet comes from the signed "Seal Forge account" session, never from the body.
        const profile = typeof body.token === "string" && body.token ? await profileByToken(body.token).catch(() => null) : null;
        if (!profile || !isAddress(profile.address)) return Response.json({ error: "Sign in to claim win rewards." }, { status: 401 });
        const address = getAddress(profile.address);
        if (body.address && (!isAddress(body.address) || body.address.toLowerCase() !== address.toLowerCase())) {
          return Response.json({ error: "Sign in with the wallet that won." }, { status: 401 });
        }
        const roomId = typeof body.roomId === "string" ? body.roomId : "";
        if (!roomId || roomId.length > 40) {
          return Response.json({ error: "This win was not recorded on the server table." }, { status: 400 });
        }
        let found;
        try {
          found = await scoredPrizeFor(address, roomId);
        } catch (error) {
          console.error("[reward] prize ledger error", error);
          return Response.json({ error: "down" }, { status: 503 });
        }
        if ("error" in found) {
          const status = found.error === "missing" || found.error === "not-winner" ? 400 : 200;
          return Response.json({ error: found.error === "not-winner" || found.error === "missing" ? "This win was not recorded on the server table." : found.error }, { status });
        }
        const signature = await signPrize(found.prize.player, found.prize.matchId);
        if (!signature) {
          if (found.created) await releaseUnsentPrize(roomId, found.prize.player);
          return Response.json({ error: "down" }, { status: 503 });
        }
        await notePrizeSigned(roomId);
        return Response.json({ matchId: found.prize.matchId, signature, player: found.prize.player });
      },
    },
  },
});
