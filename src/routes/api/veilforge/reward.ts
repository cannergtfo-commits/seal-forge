import { createFileRoute } from "@tanstack/react-router";
import { isAddress, keccak256, toBytes } from "viem";
import { holdsVeilCard } from "@/veil/holds";
import { signPrize } from "@/veil/keeper-sign";
import { refundDailyWin, takeDailyWin } from "@/veil/rooms";

export const Route = createFileRoute("/api/veilforge/reward")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { address?: string };
        const address = body.address ?? "";
        if (!isAddress(address)) return Response.json({ error: "Missing wallet." }, { status: 400 });
        const holds = await holdsVeilCard(address).catch(() => false);
        if (!holds) return Response.json({ error: "needs-card" });
        if (!takeDailyWin(address)) return Response.json({ error: "cap" });
        const matchId = keccak256(toBytes(`${address}:${Date.now()}:${Math.random()}`));
        const signature = await signPrize(address, matchId);
        if (!signature) {
          refundDailyWin(address);
          return Response.json({ error: "down" }, { status: 503 });
        }
        return Response.json({ matchId, signature });
      },
    },
  },
});
