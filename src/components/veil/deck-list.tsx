import { useState, type CSSProperties } from "react";
import { cardOf } from "@/veil/cards";
import { SEAL_ART, asFaction, sealLabel, type SealedDeck } from "@/veil/deck-client";
import "./deck-list.css";

export type { SealedDeck } from "@/veil/deck-client";

export function MiniCurve({ cards }: { cards: string[] }) {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  for (const id of cards) {
    try {
      buckets[Math.min(6, Math.max(0, cardOf(id).cost))] += 1;
    } catch {
      /* unknown card */
    }
  }
  const top = Math.max(1, ...buckets);
  return (
    <div
      className="dl-curve"
      aria-label={`Mana curve: ${buckets.map((n, c) => `${n} at ${c === 6 ? "6+" : c}`).join(", ")}`}
    >
      {buckets.map((n, cost) => (
        <span key={cost} className="dl-curve-col">
          <span className="dl-curve-bar" style={{ height: `${(n / top) * 100}%` }} />
          <span className="dl-curve-cost">{cost === 6 ? "6+" : cost}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * A sealed deck as a banner tile: seal art, name, curve, record, active marker.
 * Actions are optional so the same tile serves the profile list and the forge shelf.
 */
export function DeckTile({
  deck,
  selected,
  busy,
  onSelect,
  onActivate,
  onUnseal,
}: {
  deck: SealedDeck;
  selected?: boolean;
  busy?: boolean;
  onSelect?: () => void;
  onActivate?: () => void;
  onUnseal?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const faction = asFaction(deck.seal);
  const rate = deck.record.games ? Math.round((deck.record.wins / deck.record.games) * 100) : null;
  const leader = deck.cards.reduce<string | null>((best, id) => {
    try {
      if (!best) return id;
      return cardOf(id).cost > cardOf(best).cost ? id : best;
    } catch {
      return best;
    }
  }, null);
  return (
    <article
      className="dl-tile"
      data-active={deck.active ? "1" : undefined}
      data-selected={selected ? "1" : undefined}
      style={{ "--tile": `var(--color-${faction})` } as CSSProperties}
    >
      <div
        className="dl-tile-art"
        style={{
          backgroundImage: `url(${leader ? `/assets/veil/cards/${leader}.jpg` : SEAL_ART[faction]})`,
        }}
        aria-hidden
      />
      <div className="dl-tile-shade" aria-hidden />
      {deck.active && <span className="dl-active">Active</span>}
      {onSelect ? (
        <button
          type="button"
          className="dl-tile-hit"
          onClick={onSelect}
          aria-pressed={selected}
          aria-label={`Edit ${deck.name || "deck"}`}
        />
      ) : null}
      <div className="dl-tile-body">
        <div className="dl-tile-head">
          <img src={SEAL_ART[faction]} alt="" className="dl-crest" />
          <div className="min-w-0">
            <p className="dl-name">{deck.name || "Unnamed deck"}</p>
            <p className="dl-meta">
              {sealLabel(faction)} · {deck.cards.length}/20
            </p>
          </div>
        </div>
        <MiniCurve cards={deck.cards} />
        <p className="dl-record">
          {deck.record.games
            ? `${deck.record.wins}–${deck.record.games - deck.record.wins} · ${rate}%`
            : "No scored matches yet"}
        </p>
        {(onActivate || onUnseal) && (
          <div className="dl-actions">
            {confirming ? (
              <>
                <span className="dl-confirm">Unseal {deck.name || "this deck"}?</span>
                <button
                  type="button"
                  className="veil-btn dl-btn-danger"
                  disabled={busy}
                  onClick={() => {
                    setConfirming(false);
                    onUnseal?.();
                  }}
                >
                  Unseal
                </button>
                <button type="button" className="veil-btn" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </>
            ) : (
              <>
                {onActivate && !deck.active && (
                  <button
                    type="button"
                    className="veil-btn veil-btn-primary"
                    disabled={busy}
                    onClick={onActivate}
                  >
                    Set active
                  </button>
                )}
                {onUnseal && (
                  <button
                    type="button"
                    className="veil-btn"
                    disabled={busy}
                    onClick={() => setConfirming(true)}
                  >
                    Unseal
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
