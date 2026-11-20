/**
 * Server feature flags, read from the environment (/etc/seal-forge.env on the droplet).
 * Everything here defaults to OFF. Set the variable to "1" to turn a feature on.
 */
export type Feature = "FEATURE_QUESTS" | "FEATURE_SEASONS" | "FEATURE_FREE_MINT";

export function featureOn(name: Feature, env: Record<string, string | undefined> = process.env): boolean {
  return env[name] === "1" || env[name]?.toLowerCase() === "true";
}
