import { createFileRoute } from "@tanstack/react-router";
import { getAddress, isAddress } from "viem";
import { profileByToken } from "@/veil/accounts";
import { claimFreeMint, freeMintConfig, freeMintStatus } from "@/veil/free-mint-server";

const NOT_RUNNING = { error: "Free packs are not running right now.", code: "off" } as const;

async function walletFrom(token: unknown): Promise<string | null> {
  if (typeof token !== "string" || !token || token === "device") return null;
  const profile = await profileByToken(token).catch(() => null);
  return profile && isAddress(profile.address) ? getAddress(profile.address) : null;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "";
  return forwarded.split(",")[0]!.trim().slice(0, 64);
}

/** Optional Cloudflare Turnstile check, only when TURNSTILE_SECRET is set. */
async function humanCheck(token: unknown, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (typeof token !== "string" || !token) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const body = (await res.json()) as { success?: boolean };
    return body.success === true;
  } catch {
    return false;
  }
}

export const Route = createFileRoute("/api/veilforge/free-mint")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!freeMintConfig().enabled) return Response.json({ live: false, claims: [] });
        const url = new URL(request.url);
        const wallet = await walletFrom(url.searchParams.get("token"));
        return Response.json(await freeMintStatus(wallet));
      },
      POST: async ({ request }) => {
        if (!freeMintConfig().enabled) return Response.json(NOT_RUNNING, { status: 404 });
        const body = (await request.json().catch(() => ({}))) as { token?: string; faction?: number; turnstile?: string };
        // The wallet comes from the signed "Seal Forge account" session, never from the body.
        const wallet = await walletFrom(body.token);
        if (!wallet) return Response.json({ error: "Sign in with your wallet to claim a free pack.", code: "sign-in" }, { status: 401 });
        const ip = clientIp(request);
        if (!(await humanCheck(body.turnstile, ip))) return Response.json({ error: "Please complete the check and try again.", code: "human" }, { status: 400 });
        try {
          const result = await claimFreeMint(wallet, { faction: typeof body.faction === "number" ? body.faction : undefined, ip });
          if ("error" in result) return Response.json(result, { status: 200 });
          return Response.json(result);
        } catch (error) {
          console.error("[free-mint] claim failed", error);
          return Response.json({ error: "Free packs are having trouble. Try again soon.", code: "down" }, { status: 503 });
        }
      },
    },
  },
});
