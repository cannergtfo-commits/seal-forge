import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Table } from "@/components/veil/table";
import type { Match } from "@/veil/logic";
import {
  INTERRUPTS,
  STEPS,
  TUTOR_BOT,
  TUTORIAL_RIVAL,
  TUTORIAL_YOU,
  currentStep,
  setTutorialState,
  tutorialMatch,
  type CoachTarget,
} from "@/veil/tutorial-script";
import "./tutorial.css";

/**
 * Guided first match: the real Table in local mode with a stacked match and the
 * Easy bot, plus coach marks that ring the real UI. No Table rules are changed;
 * the table is only told not to auto-pass on its timers (`untimed`).
 */

type Coach = { key: string; title: string; body: string; target?: CoachTarget; next?: boolean; keyword?: string };

function findTarget(target: CoachTarget | undefined): Element | null {
  if (!target || typeof document === "undefined") return null;
  const root = document.querySelector(".tutorial-root");
  const all = (root ?? document).querySelectorAll(target.sel);
  return all[target.index ?? 0] ?? findTarget(target.fallback);
}

function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

type Box = { top: number; left: number; width: number; height: number };

/** Ring around the target plus a callout card placed on the roomier side. Never blocks the table. */
function CoachMark({
  coach,
  stepNo,
  steps,
  onNext,
  onSkip,
  hidden,
  onToggle,
}: {
  coach: Coach;
  stepNo: number;
  steps: number;
  onNext: () => void;
  onSkip: () => void;
  hidden: boolean;
  onToggle: () => void;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ w: 1024, h: 768 });
  const reduce = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(160);

  useLayoutEffect(() => {
    let alive = true;
    const measure = () => {
      if (!alive) return;
      setView({ w: window.innerWidth, h: window.innerHeight });
      const el = findTarget(coach.target);
      if (!el) {
        setBox(null);
        return;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        setBox(null);
        return;
      }
      setBox((prev) =>
        prev && Math.abs(prev.top - r.top) < 1 && Math.abs(prev.left - r.left) < 1 && Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
      if (cardRef.current) setCardH(cardRef.current.offsetHeight);
    };
    measure();
    // Layout moves as cards arrive and fly; a light poll keeps the ring honest.
    const id = window.setInterval(measure, 250);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [coach.key, coach.target]);

  if (hidden) {
    return (
      <button type="button" className="tut-show" onClick={onToggle} aria-label="Show tips">
        <span aria-hidden>?</span> Show tips
      </button>
    );
  }

  const narrow = view.w < 640;
  const pad = 8;
  const width = Math.min(narrow ? view.w - 16 : 360, view.w - 16);
  let top: number;
  let left: number;
  if (box) {
    const below = box.top + box.height / 2 < view.h / 2;
    top = below ? box.top + box.height + 12 : box.top - cardH - 12;
    top = Math.max(pad, Math.min(view.h - cardH - pad, top));
    left = narrow ? 8 : Math.max(pad, Math.min(view.w - width - pad, box.left + box.width / 2 - width / 2));
  } else {
    top = narrow ? 64 : 90;
    left = Math.max(pad, (view.w - width) / 2);
  }

  return (
    <div className="tut-layer" data-motion={reduce ? "reduce" : "full"}>
      {box && (
        <div
          className="tut-ring"
          aria-hidden
          style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }}
        />
      )}
      <div
        ref={cardRef}
        className="tut-card"
        role="dialog"
        aria-live="polite"
        aria-labelledby="tut-title"
        style={{ top, left, width }}
      >
        <div className="tut-card-head">
          <p className="tut-step">
            Guided duel · {Math.min(stepNo, steps)}/{steps}
            {coach.keyword && <span className="tut-kw">{coach.keyword}</span>}
          </p>
          <button type="button" className="tut-link" onClick={onToggle}>
            Hide tips
          </button>
        </div>
        <h2 id="tut-title" className="tut-title">
          {coach.title}
        </h2>
        <p className="tut-body">{coach.body}</p>
        <div className="tut-actions">
          {coach.next && (
            <button type="button" className="veil-btn veil-btn-primary" onClick={onNext} autoFocus>
              Next
            </button>
          )}
          <button type="button" className="tut-link" onClick={onSkip}>
            Skip tutorial
          </button>
        </div>
      </div>
    </div>
  );
}

export function GuidedDuel({ onExit, onPractice }: { onExit: () => void; onPractice: () => void }) {
  const [run, setRun] = useState(0);
  const [match, setMatch] = useState<Match>(() => tutorialMatch());
  const [from, setFrom] = useState(0);
  const [acked, setAcked] = useState<Set<string>>(() => new Set());
  const [taught, setTaught] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState(false);

  const idx = useMemo(() => currentStep(match, from, acked), [match, from, acked]);
  useEffect(() => {
    if (idx !== from) setFrom(idx);
  }, [idx, from]);

  const interrupt = INTERRUPTS.find((item) => item.show(match)) ?? null;
  const lastInterrupt = useRef<string | null>(null);
  useEffect(() => {
    const was = lastInterrupt.current;
    if (was && was !== interrupt?.id) setTaught((prev) => new Set(prev).add(was));
    lastInterrupt.current = interrupt?.id ?? null;
  }, [interrupt?.id]);

  useEffect(() => {
    if (match.winner === 0) setTutorialState("done");
  }, [match.winner]);

  const step = STEPS[idx] ?? null;
  const coach: Coach | null = useMemo(() => {
    if (match.winner !== null) return null;
    if (interrupt) {
      return {
        key: `i:${interrupt.id}:${taught.has(interrupt.id) ? "again" : "first"}`,
        title: interrupt.title,
        body: taught.has(interrupt.id) ? interrupt.again : interrupt.first,
        target: interrupt.target,
        keyword: interrupt.id === "trap" ? "Trap" : undefined,
      };
    }
    if (!step) return null;
    const ready = step.show?.(match) ?? true;
    if (!ready) return { key: `w:${step.id}`, title: "Rival's move", body: "The Training Golem is taking its turn. Watch the board.", target: { sel: ".arena-lane", index: 0 } };
    return {
      key: `s:${step.id}`,
      title: step.title,
      body: step.body,
      target: step.target,
      next: step.next,
      keyword: step.keyword ? step.keyword.charAt(0).toUpperCase() + step.keyword.slice(1) : undefined,
    };
  }, [match, interrupt, step, taught]);

  const replay = useCallback(() => {
    setMatch(tutorialMatch());
    setFrom(0);
    setAcked(new Set());
    setTaught(new Set());
    setHidden(false);
    setRun((n) => n + 1);
  }, []);

  const skip = useCallback(() => {
    setTutorialState("skipped");
    onExit();
  }, [onExit]);

  const leave = useCallback(() => {
    if (match.winner === null) setTutorialState("skipped");
    onExit();
  }, [match.winner, onExit]);

  const won = match.winner === 0;
  return (
    <div className="tutorial-root">
      <Table
        key={run}
        match={match}
        setMatch={setMatch}
        you={TUTORIAL_YOU}
        rival={TUTORIAL_RIVAL}
        bot={TUTOR_BOT}
        onHall={leave}
        onRematch={replay}
        untimed
        winnerExtra={
          <div className="tut-finish">
            <p className="tut-finish-title">{won ? "Duel complete" : "Try again"}</p>
            <p className="tut-finish-body">
              {won
                ? "You know the basics. Practice against bots of every seal, or build a deck from the cards you own."
                : "The Golem won this one. Replay the guided duel, or head to the hall."}
            </p>
            {won && (
              <button type="button" className="veil-btn veil-btn-primary mt-3" onClick={onPractice}>
                Practice duel
              </button>
            )}
          </div>
        }
      />
      {coach && (
        <CoachMark
          coach={coach}
          stepNo={Math.min(idx + 1, STEPS.length)}
          steps={STEPS.length}
          hidden={hidden}
          onToggle={() => setHidden((h) => !h)}
          onSkip={skip}
          onNext={() => {
            if (step?.next) setAcked((prev) => new Set(prev).add(step.id));
          }}
        />
      )}
    </div>
  );
}

/** One-time offer for new players. Shown before ranked or the market, and on the hall. */
export function TutorialOffer({ onStart, onLater, variant = "modal" }: { onStart: () => void; onLater: () => void; variant?: "modal" | "banner" }) {
  const body = (
    <>
      <p className="tut-offer-kicker">New to Seal Forge?</p>
      <p className="tut-offer-body">
        Learn the basics in a short guided duel: playing units, mana, attacking, blocking, traps, and three keywords. About three minutes.
      </p>
      <div className="tut-actions">
        <button type="button" className="veil-btn veil-btn-primary" onClick={onStart} autoFocus={variant === "modal"}>
          Start guided duel
        </button>
        <button type="button" className="veil-btn" onClick={onLater}>
          Not now
        </button>
      </div>
    </>
  );
  if (variant === "banner") return <section className="tut-banner" aria-label="Guided duel">{body}</section>;
  return (
    <div className="tut-modal" role="dialog" aria-modal="true" aria-label="Guided duel" onClick={onLater}>
      <div className="tut-modal-card" onClick={(event) => event.stopPropagation()}>
        {body}
      </div>
    </div>
  );
}
