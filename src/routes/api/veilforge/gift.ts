import { createFileRoute } from "@tanstack/react-router";
import { claimGift } from "@/veil/gift-server";
import { giftErrorText } from "@/veil/gift-core";
import { sealProfile } from "@/veil/accounts";

export const Route = createFileRoute("/api/veilforge/gift")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as { token?: string };
        try {
          const result = await claimGift(body.token ?? "");
          if ("error" in result) return Response.json(result, { status: 400 });
          return Response.json({ ...result, seal: await sealProfile(result.profile) });
        } catch (error) {
          // The raw error (RPC dumps, revert data) stays in the server log; the player gets a plain line.
          console.error("[gift] claim failed:", error instanceof Error ? error.message : error);
          return Response.json({ error: giftErrorText(error) }, { status: 400 });
        }
      },
    },
  },
});
