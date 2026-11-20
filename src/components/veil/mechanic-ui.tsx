import { cardOf, type CardDef } from "@/veil/cards";
import { titheText } from "@/veil/card-text";
import { hasTag, type Target, type Unit } from "@/veil/logic";
import "./mechanic-ui.css";

/**
 * S3 mechanic follow-ups (UI only, no rules): board marks for Plating, Unsealed
 * and Veilstep, plus the human Tithe pay/skip prompt. The rules engine stays the
 * only authority; everything here reads Match/Unit state.
 */

/** Plating left this turn, Unsealed and Veilstep marks for one board unit. */
export function UnitMarks({ unit }: { unit: Unit }) {
  const plating = unit.plating ?? 0;
  const left = Math.max(0, unit.plateLeft ?? 0);
  const cloaked = hasTag(unit, "veilstep") && !unit.revealed;
  if (!plating && !unit.silenced && !cloaked) return null;
  return (
    <span className="mech-marks" aria-hidden={false}>
      {plating > 0 && (
        <span
          className="mech-mark mech-plating"
          data-spent={left === 0 ? "true" : undefined}
          title={`Plating ${plating}: ${left} left this turn. Prevents the first ${plating} damage each turn.`}
          aria-label={`Plating ${left} of ${plating} left this turn`}
        >
          <span aria-hidden>▣</span>
          {left}/{plating}
        </span>
      )}
      {unit.silenced && (
        <span className="mech-mark mech-unsealed" title="Unsealed: printed keywords, abilities and buffs are gone for good." aria-label="Unsealed">
          <span aria-hidden>⊗</span>
          Unsealed
        </span>
      )}
      {cloaked && (
        <span className="mech-mark mech-veilstep" title="Veilstep: the rival's cards and traps can't target this until it attacks." aria-label="Veilstep, untargetable">
          <span aria-hidden>◌</span>
          Veilstep
        </span>
      )}
    </span>
  );
}

/** "Draw 1 more" style line for a card's Tithe. */
export function titheLine(card: CardDef): string {
  if (!card.tithe) return "";
  return titheText(card.tithe.effect, card);
}

export type TitheAsk = { uid: string; defId: string; target: Target | null };

/**
 * Tithe choice for a human player. Shown after the play is known to be legal;
 * Pay and Skip each commit the play with an explicit `tithe` option.
 */
export function TithePrompt({
  ask,
  hp,
  safe,
  onPay,
  onSkip,
  onCancel,
}: {
  ask: TitheAsk;
  hp: number;
  safe: boolean;
  onPay: () => void;
  onSkip: () => void;
  onCancel: () => void;
}) {
  const card = cardOf(ask.defId);
  const n = card.tithe?.n ?? 0;
  const canPay = hp > n;
  return (
    <div className="mech-tithe" role="dialog" aria-modal="false" aria-labelledby="mech-tithe-title">
      <p id="mech-tithe-title" className="mech-tithe-title">
        <span aria-hidden>✠</span> Tithe {n} · {card.name}
      </p>
      <p className="mech-tithe-body">
        Pay {n} life to also: <strong>{titheLine(card)}</strong>
      </p>
      <p className="mech-tithe-note" data-tone={canPay ? (safe ? "safe" : "risk") : "risk"}>
        {canPay
          ? safe
            ? `You'd go to ${hp - n} life. That looks safe against the rival's board.`
            : `You'd go to ${hp - n} life. Risky: the rival's board hits hard.`
          : `You need more than ${n} life to pay.`}
      </p>
      <div className="mech-tithe-actions">
        <button type="button" className="veil-btn veil-btn-primary" disabled={!canPay} onClick={onPay}>
          Pay {n} life
        </button>
        <button type="button" className="veil-btn" onClick={onSkip}>
          Skip
        </button>
        <button type="button" className="veil-btn mech-tithe-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
