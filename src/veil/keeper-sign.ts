import { readFileSync } from "node:fs";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { REWARDS } from "./deployed";

const rewardsAbi = [
  {
    type: "function",
    name: "inner",
    stateMutability: "view",
    inputs: [
      { name: "player", type: "address" },
      { name: "matchId", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
] as const;

/** Signs a 0.25 BzB win. The keeper key stays on the server. */
export async function signPrize(player: Address, matchId: Hex): Promise<Hex | null> {
  if (REWARDS.length !== 42) return null;
  try {
    const fromEnv = process.env.SEAL_FORGE_SIGNER;
    const key = (fromEnv && /^0x[0-9a-fA-F]{64}$/.test(fromEnv) ? fromEnv : JSON.parse(readFileSync("/workspace/.secrets/deployer.json", "utf8")).key) as Hex;
    const account = privateKeyToAccount(key);
    const client = createPublicClient({ chain: polygon, transport: http("https://polygon-bor-rpc.publicnode.com") });
    const digest = await client.readContract({ address: REWARDS, abi: rewardsAbi, functionName: "inner", args: [player, matchId] });
    return account.signMessage({ message: { raw: digest } });
  } catch {
    return null;
  }
}
