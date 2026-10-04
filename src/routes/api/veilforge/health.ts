import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/veilforge/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { ok: true, service: "seal-forge" },
          { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
        ),
    },
  },
});
