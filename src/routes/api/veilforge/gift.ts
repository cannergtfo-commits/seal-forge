import { createFileRoute } from "@tanstack/react-router";
import { claimGift } from "@/veil/gift-server";
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
          return Response.json({ error: error instanceof Error ? error.message : "The gift did not finish." }, { status: 400 });
        }
      },
    },
  },
});
