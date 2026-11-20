import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CardBack, CardFace } from "@/components/veil/card";
import type { CardDef } from "@/veil/cards";
import { rarityLabel, rarityTier, type PackScore, type RarityTier } from "@/veil/pack-score";

/**
 * Pack ritual: closed -> charge -> burst -> deal (face down) -> reveal -> recap.
 *
 * Fairness: every card uses the same timing whatever its rarity. Card backs
 * glow in their true rarity colour (an honest tease, never a fake one), and
 * the only rarity-specific beat is the flash that plays *at* the reveal.
 */
type Phase = "closed" | "charge" | "burst" | "deal";

const CHARGE_MS = 1150;
const BURST_MS = 520;
const DEAL_MS = 140;
const FLIP_MS = 820;
const AUTO_OPEN_MS = 4000;

export function PackOpen({
  cards,
  score,
  onBinder,
  onAgain,
}: {
  cards: CardDef[];
  score: PackScore | null;
  onBinder: () => void;
  onAgain: () => void;
}) {
  const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [phase, setPhase] = useState<Phase>(reduce ? "deal" : "closed");
  const [open, setOpen] = useState<boolean[]>(() => cards.map(() => reduce));
  const [flash, setFlash] = useState<{ tier: RarityTier; key: number } | null>(null);
  const flashKey = useRef(0);
  const tiers = cards.map((card) => rarityTier(card.rarity ?? "basic", card.set));
  const shown = open.filter(Boolean).length;
  const done = phase === "deal" && shown >= cards.length;

  useEffect(() => {
    score?.begin();
  }, [score]);

  useEffect(() => () => score?.stop(), [score]);

  // Nobody gets stuck on the closed pack.
  useEffect(() => {
    if (phase !== "closed") return;
    const id = window.setTimeout(() => setPhase("charge"), AUTO_OPEN_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  useEffect(() => {
    if (phase === "charge") {
      const id = window.setTimeout(() => setPhase("burst"), CHARGE_MS);
      return () => window.clearTimeout(id);
    }
    if (phase === "burst") {
      const id = window.setTimeout(() => setPhase("deal"), BURST_MS);
      return () => window.clearTimeout(id);
    }
  }, [phase]);

  function reveal(index: number) {
    if (open[index]) return;
    setOpen((prev) => prev.map((value, i) => value || i === index));
    const tier = tiers[index] ?? "basic";
    score?.reveal(tier);
    if (!reduce && tier !== "basic") {
      flashKey.current += 1;
      setFlash({ tier, key: flashKey.current });
    }
  }

  // Auto-turn the next face-down card on one fixed beat, whatever its rarity.
  useEffect(() => {
    if (phase !== "deal" || done || reduce) return;
    const next = open.findIndex((value) => !value);
    if (next < 0) return;
    const wait = shown === 0 ? cards.length * DEAL_MS + 380 : FLIP_MS;
    const id = window.setTimeout(() => reveal(next), wait);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, open, done, reduce]);

  useEffect(() => {
    if (!flash) return;
    const id = window.setTimeout(() => setFlash((cur) => (cur?.key === flash.key ? null : cur)), 700);
    return () => window.clearTimeout(id);
  }, [flash]);

  function skip() {
    if (phase !== "deal") setPhase("deal");
    setOpen(cards.map(() => true));
    cards.forEach((_, index) => {
      if (!open[index]) score?.reveal(tiers[index] ?? "basic");
    });
  }

  const counts = (["legendary", "rare", "basic"] as const)
    .map((tier) => ({ tier, n: tiers.filter((t) => t === tier).length, label: labelFor(cards, tiers, tier) }))
    .filter((item) => item.n > 0);

  return (
    <div className="pack-open" data-phase={phase}>
      {flash && <div key={flash.key} className="pack-flash" data-tier={flash.tier} aria-hidden />}
      {phase !== "deal" && (
        <div className="pack-stage">
          <div className="pack-aura" aria-hidden />
          <button
            type="button"
            className={phase === "closed" ? "pack-seal pack-idle" : phase === "charge" ? "pack-seal pack-shake" : "pack-seal pack-burst"}
            onClick={() => phase === "closed" && setPhase("charge")}
            aria-label="Break the seal"
            disabled={phase !== "closed"}
            data-sfx={phase === "closed" ? undefined : "off"}
          >
            <CardBack size="hero" marked />
            <span className="pack-cracks" aria-hidden />
          </button>
          <p className="pack-cue mt-4 text-sm tracking-widest text-brass">
            {phase === "closed" ? "TAP TO BREAK THE SEAL" : phase === "charge" ? "THE SEAL SPLITS" : "THE VEIL OPENS"}
          </p>
          <button type="button" className="veil-btn mt-4" onClick={skip}>
            Skip
          </button>
        </div>
      )}
      {phase === "deal" && (
        <>
          <h2 className="text-lg font-medium">{done ? "Your pull" : "Tap a card to turn it"}</h2>
          {done && counts.length > 0 && (
            <p className="pack-recap" aria-live="polite">
              {counts.map((item) => (
                <span key={item.tier} className="pack-recap-chip" data-tier={item.tier}>
                  <span className="pack-recap-gem" aria-hidden />
                  {item.n} {item.label}
                </span>
              ))}
            </p>
          )}
          <div className="veil-grid pack-table mt-4">
            {cards.map((card, index) => (
              <div
                key={index}
                className={reduce ? "pack-slot" : "pack-slot pack-deal"}
                data-tier={tiers[index]}
                data-open={open[index] ? "true" : "false"}
                style={{ ["--deal-i"]: String(index) } as CSSProperties}
              >
                {open[index] ? (
                  <div className={reduce ? undefined : "pack-flip"}>
                    <CardFace defId={card.id} size="fill" />
                  </div>
                ) : (
                  <button type="button" className="pack-back" onClick={() => reveal(index)} aria-label={`Turn card ${index + 1}`}>
                    <CardBack size="fill" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {!done && (
              <button type="button" className="veil-btn" onClick={skip}>
                Reveal all
              </button>
            )}
            <button type="button" className="veil-btn veil-btn-primary" onClick={onBinder}>
              To the binder
            </button>
            <button type="button" className="veil-btn" onClick={onAgain}>
              Open another
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function labelFor(cards: CardDef[], tiers: RarityTier[], tier: RarityTier): string {
  const index = tiers.indexOf(tier);
  const card = cards[index];
  return card ? rarityLabel(card.rarity, card.set) : tier;
}
