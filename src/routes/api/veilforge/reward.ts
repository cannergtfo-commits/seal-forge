import { createFileRoute } from "@tanstack/react-router";
import { isAddress } from "viem";
import { signPrize } from "@/veil/keeper-sign";
import { releaseUnsentPrize, scoredPrizeFor } from "@/veil/rooms";

export const Route = createFileRoute("/api/veilforge/reward")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { address?: string; roomId?: string };
        const address = body.address ?? "";
        const roomId = typeof body.roomId === "string" ? body.roomId : "";
        if (!isAddress(address)) return Response.json({ error: "Missing wallet." }, { status: 400 });
        if (!roomId || roomId.length > 40) {
          return Response.json({ error: "This win was not recorded on the server table." }, { status: 400 });
        }
        const found = scoredPrizeFor(address, roomId);
        if ("error" in found) {
          const status = found.error === "missing" || found.error === "not-winner" ? 400 : 200;
          return Response.json({ error: found.error === "not-winner" || found.error === "missing" ? "This win was not recorded on the server table." : found.error }, { status });
        }
        const signature = await signPrize(found.prize.player, found.prize.matchId);
        if (!signature) {
          if (found.created) releaseUnsentPrize(roomId, found.prize.player);
          return Response.json({ error: "down" }, { status: 503 });
        }
        return Response.json({ matchId: found.prize.matchId, signature, player: found.prize.player });
      },
    },
  },
});
