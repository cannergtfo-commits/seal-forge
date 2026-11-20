/** Matchmaking rating helpers (Techno P2 #10). Pure, no imports, so they unit-test directly. */

export const MMR_START = 1000;
const MMR_K = 32;

/** Elo change for one decided game. Returns [winner delta, loser delta]. */
export function eloDelta(winner: number, loser: number, k: number = MMR_K): [number, number] {
  const expected = 1 / (1 + 10 ** ((loser - winner) / 400));
  const gain = Math.max(1, Math.round(k * (1 - expected)));
  return [gain, -gain];
}

/**
 * How far apart two ratings may be to pair, given how long the longer-waiting player
 * has been queued. Starts at ±150 and widens 75 per second; after 10 s anyone pairs,
 * because the client falls back to a bot at 20 s and the player base is small.
 */
export function mmrBand(waitedMs: number): number {
  if (waitedMs >= 10_000) return Number.POSITIVE_INFINITY;
  return 150 + Math.floor(Math.max(0, waitedMs) / 1000) * 75;
}
