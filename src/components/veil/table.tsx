import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ArenaScene } from "@/components/veil/arena-scene";
import { CardBack, CardFace } from "@/components/veil/card";
import { SealMark } from "@/components/veil/deck";
import { stepRival } from "@/veil/ai";
import { armArenaMusic, toggleArenaMusic } from "@/veil/arena-music";
import type { Bot } from "@/veil/bots";
import { FACTIONS, cardOf, needsTarget, trapNeedsTarget, type Faction } from "@/veil/cards";
import {
  assignDefenders,
  attackTraps,
  canAttack,
  canBlock,
  declareAttack,
  endTurn,
  findUnit,
  playCard,
  power,
  skipTrap,
  springTrap,
  type Match,
  type Target,
  type Unit,
} from "@/veil/logic";

const TURN_SECONDS = 60;
const REACT_SECONDS = 6;

const BUST: Record<Faction, { src: string; focus: string }> = {
  elf: { src: "/assets/veil/elf.jpg", focus: "center 22%" },
  human: { src: "/assets/veil/captain.jpg", focus: "center 18%" },
  goblin: { src: "/assets/veil/king.jpg", focus: "center 16%" },
  robot: { src: "/assets/veil/robot.jpg", focus: "center 22%" },
  demon: { src: "/assets/veil/demon.jpg", focus: "center 14%" },
  veil: { src: "/assets/veil/cards/kg-faceless.jpg", focus: "center 10%" },
};

function clockSpan(match: Match): number {
  return match.phase === "trap" || match.phase === "defend" ? REACT_SECONDS : TURN_SECONDS;
}

function sameIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function ArenaClock({
  clockKey,
  span,
  reacting,
  label,
  over,
  leftMsRef,
  onDoneRef,
}: {
  clockKey: string;
  span: number;
  reacting: boolean;
  label: string;
  over: boolean;
  leftMsRef: { current: number | null };
  onDoneRef: { current: () => void };
}) {
  const [left, setLeft] = useState(span);
  const [ratio, setRatio] = useState(1);
  useLayoutEffect(() => {
    if (over) return;
    const raw = leftMsRef.current;
    const budget = Math.min(span, Math.max(0, (raw ?? span * 1000) / 1000));
    const start = performance.now();
    let shown = Math.ceil(budget);
    let fired = false;
    setLeft(shown);
    setRatio(span > 0 ? budget / span : 0);
    const id = window.setInterval(() => {
      const remain = Math.max(0, budget - (performance.now() - start) / 1000);
      const next = Math.ceil(remain);
      setRatio(span > 0 ? remain / span : 0);
      if (next !== shown) {
        shown = next;
        setLeft(next);
      }
      if (remain <= 0 && !fired) {
        fired = true;
        window.clearInterval(id);
        onDoneRef.current();
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [clockKey, over, span, leftMsRef, onDoneRef]);
  const urgent = left <= (reacting ? 2 : 10) && !over;
  const shown = over ? 0 : left;
  return (
    <div className={cx("arena-clock", reacting && "arena-clock-react", urgent && "arena-clock-urgent")} aria-live="polite" aria-label={over ? "Match over" : `${shown} seconds, ${label}`}>
      <svg viewBox="0 0 100 100" className="arena-clock-svg" key={clockKey} aria-hidden>
        <circle cx="50" cy="50" r="42" className="arena-clock-track" />
        <circle cx="50" cy="50" r="42" className="arena-clock-value" style={{ strokeDashoffset: 264 * (1 - Math.max(0, Math.min(1, over ? 0 : ratio))) }} />
      </svg>
      <div className="arena-clock-num">
        <span>{shown}</span>
        <small>{label}</small>
      </div>
    </div>
  );
}

export type TableAct =
  | { t: "play"; uid: string; target: Target | null }
  | { t: "attack"; ids: string[] }
  | { t: "block"; blocks: Record<string, string | null> }
  | { t: "trap"; uid: string; target: string | null }
  | { t: "skip" }
  | { t: "end" };

export type TableLink = {
  send: (action: TableAct) => void;
  leftMs: number;
  you: 0 | 1;
  fault?: string | null;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function factionName(id: Faction): string {
  return FACTIONS.find((faction) => faction.id === id)?.name ?? id;
}

function coach(match: Match): string {
  if (match.winner === 0) return "The rival is at 0 life.";
  if (match.winner === 1) return "Your life hit 0.";
  if (match.turn === 0 && match.phase === "main" && match.turnCount <= 1) {
    return "First turn: play cards, no attacks. One mana unlocks at the start of each of your turns.";
  }
  if (match.turn === 0 && match.phase === "main") return "Play from hand. Attack once with any ready units, or end the turn.";
  if (match.turn === 1 && match.phase === "trap") return "The rival is attacking. Six seconds to spring one trap, or pass.";
  if (match.turn === 1 && match.phase === "defend") return "Six seconds to assign defenders. A unit that attacked cannot block until its next turn.";
  if (match.turn === 0 && match.phase === "trap") return "The rival has six seconds to spring a trap.";
  if (match.turn === 0 && match.phase === "defend") return "The rival has six seconds to choose blockers.";
  return "The rival is acting.";
}

function unitStatus(match: Match, unit: Unit): string | null {
  if (canAttack(match, unit)) return "Ready";
  if (!unit.ready || unit.frozen) return "Rested";
  if (unit.sick) return "Summoning";
  if (power(match, unit) <= 0) return "No attack";
  return null;
}

function EdgeRow({ children, className, axis = "x" }: { children: ReactNode; className?: string; axis?: "x" | "y" }) {
  const ref = useRef<HTMLDivElement>(null);
  const edge = useRef(0);
  const holding = useRef(false);
  const frame = useRef(0);
  const endGesture = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      endGesture.current?.();
      cancelAnimationFrame(frame.current);
    };
  }, []);

  function pump() {
    const el = ref.current;
    const speed = edge.current;
    if (el && speed) {
      if (axis === "x") el.scrollLeft += speed * 14;
      else el.scrollTop += speed * 14;
    }
    if (holding.current) frame.current = requestAnimationFrame(pump);
  }

  function zone(client: number, start: number, end: number) {
    const band = 56;
    if (client < start + band) return -Math.min(1, (start + band - client) / band);
    if (client > end - band) return Math.min(1, (client - (end - band)) / band);
    return 0;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    endGesture.current?.();
    holding.current = true;
    const originX = event.clientX;
    const originY = event.clientY;
    let lastX = originX;
    let lastY = originY;
    let moved = false;

    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - originX, ev.clientY - originY) < 8) return;
      if (!moved) {
        moved = true;
        if (axis === "x") el.scrollLeft -= ev.clientX - originX;
        else el.scrollTop -= ev.clientY - originY;
      } else if (axis === "x") el.scrollLeft -= ev.clientX - lastX;
      else el.scrollTop -= ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      const rect = el.getBoundingClientRect();
      edge.current = axis === "x" ? zone(ev.clientX, rect.left, rect.right) : zone(ev.clientY, rect.top, rect.bottom);
    };

    const up = () => {
      holding.current = false;
      edge.current = 0;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      endGesture.current = null;
      if (!moved) return;
      const stop = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
      };
      window.addEventListener("click", stop, { capture: true, once: true });
    };

    endGesture.current = up;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(pump);
  }

  return (
    <div
      ref={ref}
      className={cx("veil-row", axis === "y" && "veil-row-y", className)}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>
  );
}

function ArenaBtn({
  icon,
  children,
  hot = false,
  onClick,
}: {
  icon?: string;
  children: string;
  hot?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={cx("arena-btn", hot && "arena-btn-hot")} onClick={onClick}>
      {icon ? <img src={icon} alt="" className="arena-ico" /> : null}
      <span>{children}</span>
    </button>
  );
}

function Mana({ max, current }: { max: number; current: number }) {
  return (
    <div className="arena-mana" aria-label={`${current} of ${max} mana`}>
      <span className="arena-mana-count">{current}<small>/{max}</small></span>
      <span className="arena-gems" aria-hidden>
        {Array.from({ length: max }, (_, index) => (
          <span key={index} className={index < current ? "arena-gem on" : "arena-gem"} />
        ))}
      </span>
    </div>
  );
}

function SeatPlate({ faction, name }: { faction: Faction; name: string }) {
  const bust = BUST[faction];
  return (
    <div className="arena-plate" data-faction={faction}>
      <div className="arena-plate-art">
        <img className="arena-bust" src={bust.src} alt="" draggable={false} style={{ objectPosition: bust.focus }} />
        <SealMark id={faction} className="arena-plate-seal" />
      </div>
      <div className="min-w-0">
        <p className="arena-seal-name">{factionName(faction)}</p>
        <p className="arena-duelist">{name}</p>
      </div>
    </div>
  );
}

function LifeTotal({ hp, ward, deck, faction }: { hp: number; ward: number; deck: number; faction: Faction }) {
  return (
    <div className="arena-life" data-faction={faction} aria-label={`${hp} life`}>
      <em>Life</em>
      <strong>{hp}</strong>
      <small>{ward > 0 ? `Ward ${ward}` : `Deck ${deck}`}</small>
    </div>
  );
}

export function Table({
  match,
  setMatch,
  you,
  rival,
  bot,
  onHall,
  onRematch,
  link,
  winnerExtra,
}: {
  match: Match;
  setMatch: (match: Match) => void;
  you: Faction;
  rival: Faction;
  bot: Bot;
  onHall: () => void;
  onRematch?: () => void;
  link?: TableLink;
  winnerExtra?: ReactNode;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [attackers, setAttackers] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Record<string, string | null>>({});
  const [trapUid, setTrapUid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blurb, setBlurb] = useState<string | null>(null);
  const [graveSide, setGraveSide] = useState<0 | 1 | null>(null);
  const [music, setMusic] = useState(true);
  const [born, setBorn] = useState<string[]>([]);
  const [struck, setStruck] = useState<string[]>([]);
  const attackKey = match.attackers.join("|");
  const clockKey = `${match.turn}:${match.phase}:${match.turnCount}:${match.winner ?? "play"}`;
  const live = useRef({ match, bot });
  live.current = { match, bot };
  const linkRef = useRef(link);
  linkRef.current = link;
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const leftMsRef = useRef<number | null>(null);
  leftMsRef.current = link?.leftMs ?? null;
  const onDoneRef = useRef<() => void>(() => {});
  const linked = Boolean(link);
  const hpRef = useRef(new Map<string, number>());
  const line = match.log[0] ?? "";
  const yours = match.players[0];
  const theirs = match.players[1];
  const yourTime =
    match.winner === null && (match.phase === "main" ? match.turn === 0 : match.turn === 1);

  useEffect(() => {
    if (match.phase !== "defend" || match.turn !== 1) return;
    // attackKey is the combat. A fresh attackers array (ranked poll) must not clear picks.
    const ids = attackKey ? attackKey.split("|") : [];
    setBlocks(Object.fromEntries(ids.map((id) => [id, null])));
  }, [match.phase, match.turn, attackKey]);

  useEffect(() => {
    const nextBorn: string[] = [];
    const nextHit: string[] = [];
    const seen = new Set<string>();
    for (const seat of match.players) {
      for (const unit of seat.units) {
        seen.add(unit.uid);
        const before = hpRef.current.get(unit.uid);
        if (before === undefined) nextBorn.push(unit.uid);
        else if (unit.hp < before) nextHit.push(unit.uid);
        hpRef.current.set(unit.uid, unit.hp);
      }
    }
    for (const id of hpRef.current.keys()) if (!seen.has(id)) hpRef.current.delete(id);
    setBorn((prev) => (sameIds(prev, nextBorn) ? prev : nextBorn));
    setStruck((prev) => (sameIds(prev, nextHit) ? prev : nextHit));
  }, [match]);

  const rivalActing =
    match.winner === null &&
    ((match.turn === 1 && match.phase === "main") || (match.turn === 0 && (match.phase === "trap" || match.phase === "defend")));

  useEffect(() => {
    if (linked || !rivalActing) return;
    let timer = 0;
    let pending: Match | null = null;
    const tick = () => {
      const current = live.current.match;
      if (pending) {
        if (current === pending) pending = null;
        else {
          timer = window.setTimeout(tick, 80);
          return;
        }
      }
      const still =
        current.winner === null &&
        ((current.turn === 1 && current.phase === "main") ||
          (current.turn === 0 && (current.phase === "trap" || current.phase === "defend")));
      if (!still) return;
      const next = stepRival(current, live.current.bot.style);
      if (next && next !== current) {
        pending = next;
        setMatch(next);
      }
      timer = window.setTimeout(tick, 850);
    };
    timer = window.setTimeout(tick, 850);
    return () => window.clearTimeout(timer);
  }, [rivalActing, setMatch, linked]);

  function apply(result: { state: Match; error?: string }) {
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setSelected(null);
    setAttackers([]);
    setTrapUid(null);
    setMatch(result.state);
  }

  function absolutize(action: TableAct): TableAct {
    if (!link || link.you === 0 || action.t !== "play" || !action.target || action.target.kind !== "face") return action;
    return { ...action, target: { kind: "face", side: action.target.side === 0 ? 1 : 0 } };
  }

  function commit(action: TableAct, result: { state: Match; error?: string }) {
    if (link) {
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setSelected(null);
      setAttackers([]);
      setTrapUid(null);
      link.send(absolutize(action));
      return;
    }
    apply(result);
  }

  function rush(state: Match, style: Bot["style"]) {
    let next = state;
    for (let i = 0; i < 12 && next.winner === null; i++) {
      const stepped = stepRival(next, style);
      if (!stepped) break;
      next = stepped;
      if (next.turn === 0 && next.phase === "main") break;
      if (next.turn === 1 && (next.phase === "trap" || next.phase === "defend")) break;
    }
    setError(null);
    setSelected(null);
    setAttackers([]);
    setTrapUid(null);
    setMatch(next);
  }

  function inspect(defId: string) {
    const card = cardOf(defId);
    setBlurb(`${card.name}. ${card.text}`);
  }

  const hand = selected ? yours.hand.find((card) => card.uid === selected) : null;
  const chosen = hand ? cardOf(hand.defId) : null;
  const targeting = Boolean(chosen && needsTarget(chosen) && match.turn === 0 && match.phase === "main" && match.winner === null);
  const targetingHit = targeting && chosen?.play?.t === "hit";

  function legalUnit(unit: Unit): boolean {
    const effect = chosen?.play?.t;
    if (!targeting || !effect) return false;
    if (effect === "hit" || effect === "freeze") return true;
    if (effect === "healUnit" || effect === "buff" || effect === "charge" || effect === "grantHaste") return unit.owner === 0;
    if (effect === "overclock") return unit.owner === 0 && cardOf(unit.defId).faction === "robot";
    return false;
  }

  function onHand(uid: string) {
    const card = yours.hand.find((item) => item.uid === uid);
    if (!card) return;
    const def = cardOf(card.defId);
    setBlurb(`${def.name}. ${def.text}`);
    if (match.winner || match.turn !== 0 || match.phase !== "main") return;
    if (selected === uid) {
      setSelected(null);
      return;
    }
    if (def.cost > yours.mana) {
      setError("Not enough mana.");
      setSelected(uid);
      return;
    }
    setError(null);
    setAttackers([]);
    if (needsTarget(def)) {
      setSelected(uid);
      return;
    }
    commit({ t: "play", uid, target: null }, playCard(match, uid, null));
  }

  function onUnit(unit: Unit) {
    inspect(unit.defId);
    if (targeting) {
      if (!legalUnit(unit) || !selected) {
        setError("Not a legal target.");
        return;
      }
      commit({ t: "play", uid: selected, target: { kind: "unit", uid: unit.uid } }, playCard(match, selected, { kind: "unit", uid: unit.uid }));
      return;
    }
    if (match.winner || match.turn !== 0 || match.phase !== "main" || unit.owner !== 0) return;
    if (!canAttack(match, unit)) return;
    setAttackers((prev) => (prev.includes(unit.uid) ? prev.filter((id) => id !== unit.uid) : [...prev, unit.uid]));
  }

  function setBlock(attacker: string, blocker: string | null) {
    setBlocks((prev) => {
      const next = { ...prev };
      if (blocker) {
        for (const key of Object.keys(next)) {
          if (next[key] === blocker) next[key] = null;
        }
      }
      next[attacker] = blocker;
      return next;
    });
  }

  const trap = trapUid ? attackTraps(match).find((item) => item.uid === trapUid) : null;
  const trapCard = trap ? cardOf(trap.defId) : null;
  const yourTurn = match.turn === 0 && match.phase === "main" && match.winner === null;
  const grave = graveSide === null ? null : match.players[graveSide].grave;
  const span = clockSpan(match);
  const reacting = match.phase === "trap" || match.phase === "defend";
  const clockLabel = match.winner !== null ? "Over" : reacting ? (yourTime ? (match.phase === "trap" ? "Your trap" : "Your block") : match.phase === "trap" ? "Rival trap" : "Rival block") : yourTime ? "Your time" : "Rival time";
  const status = error || link?.fault || (targeting ? "Choose a target, or cancel." : blurb);
  onDoneRef.current = () => {
    const wire = linkRef.current;
    const current = live.current.match;
    const style = live.current.bot.style;
    if (current.winner !== null) return;
    if (wire) {
      if (current.phase === "defend" && current.turn === 1) {
        const chosen = blocksRef.current;
        if (!assignDefenders(current, chosen).error) wire.send({ t: "block", blocks: chosen });
      }
      return;
    }
    if (current.phase === "trap") apply(skipTrap(current));
    else if (current.phase === "defend") {
      const chosen = blocksRef.current;
      const result = assignDefenders(current, chosen);
      if (result.error) {
        const open = Object.fromEntries(current.attackers.map((id) => [id, null]));
        apply(assignDefenders(current, open));
      } else apply(result);
    } else if (current.turn === 0 && current.phase === "main") apply(endTurn(current));
    else if (current.turn === 1 && current.phase === "main") rush(current, style);
  };

  return (
    <div className="arena">
      <div className="arena-back" aria-hidden="true">
        <video className="arena-video" autoPlay muted loop playsInline poster="/assets/veil/arena/rift.jpg" src="/assets/veil/arena/rift.mp4" />
      </div>
      <ArenaScene />
      <div className="arena-fit">
        <div className="arena-hud">
          <ArenaBtn icon="/assets/veil/arena/icon-concede.jpg" onClick={onHall}>
            {match.winner === null ? (linked ? "Leave" : "Concede") : "Hall"}
          </ArenaBtn>
          <div className="arena-hud-clock">
            <ArenaClock clockKey={clockKey} span={span} reacting={reacting} label={clockLabel} over={match.winner !== null} leftMsRef={leftMsRef} onDoneRef={onDoneRef} />
            <p className="arena-now">{line}</p>
          </div>
          <button
            type="button"
            className="arena-btn"
            onClick={() => {
              armArenaMusic();
              setMusic(toggleArenaMusic());
            }}
          >
            {music ? "Music on" : "Music off"}
          </button>
        </div>

        <div className="arena-play">
          <p className="arena-coach">{coach(match)}</p>
          <section className="arena-seat">
            <div className="arena-seat-bar">
              <SeatPlate faction={rival} name={bot.name} />
              <div className="arena-vitals">
                <LifeTotal hp={theirs.hp} ward={theirs.ward} deck={theirs.deck.length} faction={rival} />
                <Mana max={theirs.manaMax} current={theirs.mana} />
              </div>
              <button type="button" className="arena-grave" onClick={() => setGraveSide(1)}>
                <img src="/assets/veil/arena/icon-grave.jpg" alt="" />
                <span>Grave {theirs.grave.length}</span>
              </button>
            </div>
            {targetingHit && (
              <button type="button" className="veil-btn" onClick={() => selected && commit({ t: "play", uid: selected, target: { kind: "face", side: 1 } }, playCard(match, selected, { kind: "face", side: 1 }))}>
                Target rival
              </button>
            )}
            {(theirs.hand.length > 0 || theirs.traps.length > 0) && (
              <EdgeRow className="arena-backs">
                {theirs.hand.map((card) => (
                  <CardBack key={card.uid} />
                ))}
                {theirs.traps.map((item) => (
                  <CardBack key={item.uid} size="trap" />
                ))}
              </EdgeRow>
            )}
            <EdgeRow className="arena-lane">
              {theirs.units.length === 0 && <p className="text-sm text-ash">No units</p>}
              {theirs.units.map((unit) => {
                const lunging = (match.phase === "trap" || match.phase === "defend") && match.attackers.includes(unit.uid);
                return (
                  <div
                    key={unit.uid}
                    className={cx(
                      "arena-token",
                      born.includes(unit.uid) && "arena-arrive",
                      struck.includes(unit.uid) && "arena-struck",
                      lunging && "arena-lunge-rival",
                    )}
                  >
                    <CardFace defId={unit.defId} match={match} unit={unit} size="board" dim={targeting && !legalUnit(unit)} onClick={() => onUnit(unit)} />
                  </div>
                );
              })}
            </EdgeRow>
          </section>

          <section className="arena-seat">
            <div className="arena-seat-bar">
              <SeatPlate faction={you} name="You" />
              <div className="arena-vitals">
                <LifeTotal hp={yours.hp} ward={yours.ward} deck={yours.deck.length} faction={you} />
                <Mana max={yours.manaMax} current={yours.mana} />
              </div>
              <button type="button" className="arena-grave" onClick={() => setGraveSide(0)}>
                <img src="/assets/veil/arena/icon-grave.jpg" alt="" />
                <span>Grave {yours.grave.length}</span>
              </button>
            </div>
            {targetingHit && (
              <button type="button" className="veil-btn" onClick={() => selected && commit({ t: "play", uid: selected, target: { kind: "face", side: 0 } }, playCard(match, selected, { kind: "face", side: 0 }))}>
                Target yourself
              </button>
            )}
            <EdgeRow className="arena-lane">
              {yours.units.length === 0 && <p className="text-sm text-ash">No units</p>}
              {yours.units.map((unit) => {
                const status = unitStatus(match, unit);
                const lunging = (match.phase === "trap" || match.phase === "defend") && match.attackers.includes(unit.uid);
                return (
                  <div
                    key={unit.uid}
                    className={cx(
                      "arena-token",
                      born.includes(unit.uid) && "arena-arrive",
                      struck.includes(unit.uid) && "arena-struck",
                      attackers.includes(unit.uid) && "arena-lift",
                      lunging && "arena-lunge-you",
                    )}
                  >
                    <CardFace
                      defId={unit.defId}
                      match={match}
                      unit={unit}
                      size="board"
                      selected={attackers.includes(unit.uid)}
                      dim={targeting && !legalUnit(unit)}
                      onClick={() => onUnit(unit)}
                    />
                    {status && <p className={cx("arena-status", status === "Ready" ? "text-brass" : "text-ash")}>{status}</p>}
                  </div>
                );
              })}
            </EdgeRow>
            {yours.traps.length > 0 && (
              <EdgeRow className="arena-traps">
                {yours.traps.map((item) => (
                  <CardFace key={item.uid} defId={item.defId} size="board" onClick={() => inspect(item.defId)} />
                ))}
              </EdgeRow>
            )}
          </section>

          <EdgeRow className="arena-hand">
            {yours.hand.map((card) => {
              const def = cardOf(card.defId);
              return (
                <CardFace
                  key={card.uid}
                  defId={card.defId}
                  size="hand"
                  selected={selected === card.uid}
                  dim={def.cost > yours.mana || !yourTurn}
                  onClick={() => onHand(card.uid)}
                />
              );
            })}
          </EdgeRow>
        </div>

        <div className="veil-dock arena-dock">
          <div className="flex flex-col gap-1">
            {status && <p className={cx("truncate text-sm", error || link?.fault ? "text-danger" : "text-ash")}>{status}</p>}
            {match.phase === "defend" && match.turn === 1 && match.winner === null && (
              <EdgeRow className="arena-dock-row">
                {match.attackers.map((id) => {
                  const unit = findUnit(match, id);
                  if (!unit) return null;
                  const card = cardOf(unit.defId);
                  return (
                    <div key={id} className="flex shrink-0 items-center gap-1">
                      <span className="text-xs text-ash">
                        {card.name} {power(match, unit)}
                        {card.tags.includes("bulwark") ? " · Bulwark" : ""}
                      </span>
                      <button type="button" className={cx("veil-btn", blocks[id] == null && "veil-btn-primary")} onClick={() => setBlock(id, null)}>
                        Through
                      </button>
                      {yours.units.filter((blocker) => canBlock(blocker)).map((blocker) => (
                        <button
                          key={blocker.uid}
                          type="button"
                          className={cx("veil-btn", blocks[id] === blocker.uid && "veil-btn-primary")}
                          onClick={() => setBlock(id, blocker.uid)}
                        >
                          {cardOf(blocker.defId).name}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </EdgeRow>
            )}
            {match.phase === "trap" && match.turn === 1 && match.winner === null && (
              <EdgeRow className="arena-dock-row">
                {attackTraps(match).map((item) => (
                  <button
                    key={item.uid}
                    type="button"
                    className={cx("veil-btn", trapUid === item.uid && "veil-btn-primary")}
                    onClick={() => {
                      const card = cardOf(item.defId);
                      setTrapUid(item.uid);
                      setBlurb(`${card.name}. ${card.text}`);
                      if (!trapNeedsTarget(card.trap)) commit({ t: "trap", uid: item.uid, target: null }, springTrap(match, item.uid, null));
                    }}
                  >
                    {cardOf(item.defId).name}
                  </button>
                ))}
                {trapCard && trapNeedsTarget(trapCard.trap) &&
                  match.attackers.map((id) => {
                    const unit = findUnit(match, id);
                    if (!unit) return null;
                    return (
                      <button key={id} type="button" className="veil-btn" onClick={() => trap && commit({ t: "trap", uid: trap.uid, target: unit.uid }, springTrap(match, trap.uid, unit.uid))}>
                        On {cardOf(unit.defId).name}
                      </button>
                    );
                  })}
                <ArenaBtn icon="/assets/veil/arena/icon-end.jpg" onClick={() => commit({ t: "skip" }, skipTrap(match))}>
                  Pass
                </ArenaBtn>
              </EdgeRow>
            )}
            <EdgeRow className="arena-dock-row">
              {targeting && (
                <button type="button" className="veil-btn" onClick={() => setSelected(null)}>
                  Cancel
                </button>
              )}
              {yourTurn && attackers.length > 0 && (
                <ArenaBtn icon="/assets/veil/arena/icon-attack.jpg" hot onClick={() => commit({ t: "attack", ids: attackers }, declareAttack(match, attackers))}>
                  {`Attack with ${attackers.length}`}
                </ArenaBtn>
              )}
              {match.phase === "defend" && match.turn === 1 && match.winner === null && (
                <ArenaBtn icon="/assets/veil/arena/icon-attack.jpg" hot onClick={() => commit({ t: "block", blocks }, assignDefenders(match, blocks))}>
                  Confirm blocks
                </ArenaBtn>
              )}
              {yourTurn && (
                <ArenaBtn icon="/assets/veil/arena/icon-end.jpg" onClick={() => commit({ t: "end" }, endTurn(match))}>
                  End turn
                </ArenaBtn>
              )}
              {!linked && match.turn === 1 && match.phase === "main" && match.winner === null && (
                <ArenaBtn icon="/assets/veil/arena/icon-end.jpg" hot onClick={() => rush(match, bot.style)}>
                  Skip rival
                </ArenaBtn>
              )}
            </EdgeRow>
          </div>
        </div>
      </div>

      {grave && (
        <div className="arena-modal" onClick={() => setGraveSide(null)}>
          <div className="arena-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">{graveSide === 0 ? "Your graveyard" : "Rival graveyard"}</h2>
              <button type="button" className="veil-btn" onClick={() => setGraveSide(null)}>
                Close
              </button>
            </div>
            {grave.length === 0 ? (
              <p className="mt-4 text-sm text-ash">Nothing has fallen yet.</p>
            ) : (
              <EdgeRow axis="y" className="arena-grave-grid">
                {[...grave].reverse().map((id, index) => (
                  <CardFace key={`${id}-${index}`} defId={id} size="fill" onClick={() => inspect(id)} />
                ))}
              </EdgeRow>
            )}
          </div>
        </div>
      )}

      {match.winner !== null && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/80 p-4">
          <div className="w-full max-w-sm rounded-md border border-line bg-panel p-6 text-center">
            <h2 className="text-2xl font-medium">{match.winner === 0 ? "You win" : "You lose"}</h2>
            {winnerExtra}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {onRematch && (
                <button type="button" className="veil-btn veil-btn-primary" onClick={onRematch}>
                  Duel again
                </button>
              )}
              <button type="button" className="veil-btn" onClick={onHall}>
                Hall
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
