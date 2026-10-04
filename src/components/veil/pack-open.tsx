import { useEffect, useState } from "react";
import { CardBack, CardFace } from "@/components/veil/card";
import type { CardDef } from "@/veil/cards";
import { rarityTier, type PackScore } from "@/veil/pack-score";

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
  const [phase, setPhase] = useState<"crack" | "burst" | "deal">(reduce ? "deal" : "crack");
  const [shown, setShown] = useState(reduce ? cards.length : 0);
  const done = shown >= cards.length && phase === "deal";

  useEffect(() => {
    score?.begin();
    if (reduce) return;
    const crack = window.setTimeout(() => setPhase("burst"), 1100);
    const burst = window.setTimeout(() => setPhase("deal"), 1650);
    return () => {
      window.clearTimeout(crack);
      window.clearTimeout(burst);
    };
  }, [reduce, score]);

  useEffect(() => {
    if (phase !== "deal" || shown >= cards.length) return;
    const wait = shown === 0 ? 180 : 820;
    const id = window.setTimeout(() => {
      score?.reveal(rarityTier(cards[shown]?.rarity ?? "basic", cards[shown]?.set));
      setShown((count) => count + 1);
    }, wait);
    return () => window.clearTimeout(id);
  }, [phase, shown, cards, score]);

  useEffect(() => () => score?.stop(), [score]);

  function skip() {
    setPhase("deal");
    setShown(cards.length);
  }

  return (
    <div className="pack-open">
      {phase !== "deal" && (
        <div className="pack-stage">
          <div className={phase === "crack" ? "pack-seal pack-shake" : "pack-seal pack-burst"}>
            <CardBack size="hero" marked />
          </div>
          <p className="mt-4 text-sm tracking-widest text-brass">{phase === "crack" ? "THE SEAL SPLITS" : "THE VEIL OPENS"}</p>
          <button type="button" className="veil-btn mt-4" onClick={skip}>
            Skip
          </button>
        </div>
      )}
      {phase === "deal" && (
        <>
          <h2 className="text-lg font-medium">{done ? "Your pull" : "The cards turn"}</h2>
          <div className="veil-grid mt-4">
            {cards.map((card, index) => (
              <div key={index} className={index < shown && !reduce ? "pack-flip" : undefined}>
                {index < shown ? <CardFace defId={card.id} size="fill" /> : <CardBack size="fill" />}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {!done && (
              <button type="button" className="veil-btn" onClick={skip}>
                Skip
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
