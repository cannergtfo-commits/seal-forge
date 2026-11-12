export type PackMintPhase = "shop" | "buying" | "confirming" | "mint" | "minting";

export function packShopLocked(phase: PackMintPhase): boolean {
  return phase !== "shop";
}

export function PackMintGate({
  phase,
  error,
  onMint,
}: {
  phase: PackMintPhase;
  error?: string | null;
  onMint: () => void;
}) {
  if (phase === "shop" || phase === "buying") return null;
  const confirming = phase === "confirming";
  const minting = phase === "minting";
  return (
    <article className="rounded-md border border-line bg-panel p-4 md:col-span-2" aria-live="polite">
      {confirming || minting ? (
        <p className="flex items-center gap-2 text-sm text-brass" role="status">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
            <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2">
              <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.7s" repeatCount="indefinite" />
            </path>
          </svg>
          {confirming ? "Confirming payment…" : "Minting…"}
        </p>
      ) : (
        <h2 className="text-lg font-medium">Payment confirmed</h2>
      )}
      <p className="mt-2 text-sm leading-relaxed text-ash">
        {confirming
          ? "Your pack is paid. Waiting until your wallet is a couple of blocks past the payment before minting."
          : minting
            ? "Approve the mint in your wallet to receive the cards."
            : "Your pack is paid. Mint the cards to your wallet."}
      </p>
      {phase === "mint" && (
        <button type="button" className="veil-btn veil-btn-primary mt-4" onClick={onMint}>
          Mint your cards
        </button>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </article>
  );
}
