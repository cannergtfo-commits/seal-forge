import { createFileRoute } from "@tanstack/react-router";

const DEPLOY_GAS = 2_800_000n;
const RPCS = ["https://polygon-bor-rpc.publicnode.com", "https://polygon-rpc.com"];

async function rpc(method: string): Promise<string | null> {
  for (const url of RPCS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
        signal: AbortSignal.timeout(4000),
      });
      const data = (await response.json()) as { result?: unknown };
      if (typeof data.result === "string") return data.result;
    } catch {
      continue;
    }
  }
  return null;
}

function pol(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole}.${frac}`;
}

export const Route = createFileRoute("/api/veilforge/status")({
  server: {
    handlers: {
      GET: async () => {
        let rpcChainId: string | null = null;
        let deployFeePol: string | null = null;
        try {
          const [chain, gas] = await Promise.all([rpc("eth_chainId"), rpc("eth_gasPrice")]);
          rpcChainId = chain;
          if (gas?.startsWith("0x")) deployFeePol = pol(BigInt(gas) * DEPLOY_GAS);
        } catch {
          rpcChainId = null;
        }
        return Response.json({
          chainId: 137,
          expected: "0x89",
          rpcChainId,
          ok: rpcChainId === "0x89",
          deployFeePol,
        });
      },
    },
  },
});
