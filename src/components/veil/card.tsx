import type { CSSProperties } from "react";
import { cardOf, schoolOf, type Faction } from "@/veil/cards";
import { power, type Match, type Unit } from "@/veil/logic";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { rarityTier } from "@/veil/pack-score";
import { cardPills, gemTier, rarityName as rarityNameOf, setBadge, type Pill } from "@/veil/card-meta";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type Size = "hand" | "board" | "fill";

const HOVER_MS = 420;
const PRESS_MS = 460;

/**
 * Hover (mouse, after a short rest), long-press (touch) or keyboard focus opens
 * a full-text inspect panel. A long-press swallows the click that follows, so
 * reading a card on a phone never plays it.
 */
function useInspect(enabled: boolean) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef(0);
  const swallow = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!rect) return;
    const close = () => setRect(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [rect]);
  if (!enabled) return { rect: null, handlers: {} };
  const clear = () => window.clearTimeout(timer.current);
  const handlers = {
    onPointerEnter(event: ReactPointerEvent<HTMLElement>) {
      if (event.pointerType !== "mouse") return;
      const el = event.currentTarget;
      clear();
      timer.current = window.setTimeout(() => setRect(el.getBoundingClientRect()), HOVER_MS);
    },
    onPointerLeave() {
      clear();
      setRect(null);
    },
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      swallow.current = false;
      if (event.pointerType === "mouse") {
        clear();
        setRect(null);
        return;
      }
      const el = event.currentTarget;
      start.current = { x: event.clientX, y: event.clientY };
      clear();
      timer.current = window.setTimeout(() => {
        swallow.current = true;
        setRect(el.getBoundingClientRect());
      }, PRESS_MS);
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const s = start.current;
      if (s && Math.hypot(event.clientX - s.x, event.clientY - s.y) > 10) {
        clear();
        start.current = null;
      }
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      start.current = null;
      clear();
      if (event.pointerType !== "mouse") setRect(null);
    },
    onPointerCancel() {
      start.current = null;
      clear();
      setRect(null);
    },
    onClickCapture(event: ReactMouseEvent<HTMLElement>) {
      if (swallow.current) {
        swallow.current = false;
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onContextMenu(event: ReactMouseEvent<HTMLElement>) {
      if (start.current || swallow.current) event.preventDefault();
    },
    onFocus(event: ReactFocusEvent<HTMLElement>) {
      const el = event.currentTarget;
      if (el.matches(":focus-visible")) setRect(el.getBoundingClientRect());
    },
    onBlur() {
      setRect(null);
    },
  };
  return { rect, handlers };
}

function Pills({ pills, compact }: { pills: Pill[]; compact: boolean }) {
  if (!pills.length) return null;
  return (
    <span className={cx("veil-pills", compact && "veil-pills-compact")}>
      {pills.map((item) => (
        <span key={item.id} className="veil-pill" data-pill={item.id} title={`${item.label}: ${item.reminder}`}>
          <span className="veil-pill-icon" aria-hidden>
            {item.icon}
          </span>
          {!compact && <span className="veil-pill-label">{item.label}</span>}
        </span>
      ))}
    </span>
  );
}

export function CardFace({
  defId,
  match,
  unit,
  size = "hand",
  selected = false,
  dim = false,
  playable = false,
  fanIndex,
  fanCount,
  onClick,
  inspect = true,
}: {
  defId: string;
  match?: Match | null;
  unit?: Unit;
  size?: Size;
  selected?: boolean;
  dim?: boolean;
  playable?: boolean;
  fanIndex?: number;
  fanCount?: number;
  onClick?: () => void;
  /** Hover / long-press / focus inspect panel with the full text. */
  inspect?: boolean;
}) {
  const card = cardOf(defId);
  const atk = unit && match ? power(match, unit) : card.atk;
  const hp = unit ? unit.hp : card.hp;
  const maxHp = unit?.maxHp ?? card.hp;
  const hpState = hp < maxHp ? "hurt" : hp > card.hp ? "up" : "base";
  const atkState = atk > card.atk ? "up" : atk < card.atk ? "down" : "base";
  const wide = size !== "board";
  const tier = rarityTier(card.rarity, card.set);
  const gem = gemTier(card);
  const rarityName = rarityNameOf(card);
  const pills = cardPills(card);
  const badge = setBadge(card);
  const { rect, handlers } = useInspect(inspect);
  const cls = cx(
    "veil-card shrink-0",
    size === "hand" && "w-36 sm:w-44",
    size === "board" && "w-28 sm:w-32",
    size === "fill" && "w-full",
    selected && "veil-card-selected",
    dim && "veil-card-dim",
    playable && !dim && "veil-card-playable",
  );
  const fanStyle =
    fanIndex != null && fanCount != null && fanCount > 0
      ? ({ ["--fan-i"]: String(fanIndex), ["--fan-n"]: String(fanCount) } as CSSProperties)
      : undefined;
  const body = (
    <>
      <img src={card.art} alt="" draggable={false} decoding="async" className="veil-art" />
      <span className="veil-foil" aria-hidden />
      <span className="veil-gem">{card.cost}</span>
      <span className="veil-rarity" data-gem={gem} title={rarityName}>
        <span className="veil-rarity-gem" aria-hidden />
        {wide && <span className="veil-rarity-name">{rarityName}</span>}
      </span>
      <div className={cx("veil-lore", wide ? "veil-lore-wide" : "veil-lore-tight")}>
        <p className={cx("veil-name font-medium leading-tight", wide ? "line-clamp-1 text-sm" : "truncate text-xs")}>{card.name}</p>
        <p className="veil-typeline text-xs uppercase tracking-wider text-brass">
          <span>{schoolOf(card)}</span>
          {wide && (
            <span className="veil-set" data-format={badge.format} title={badge.label} aria-label={badge.label}>
              {badge.format === "eternal" ? "∞" : "◆"} {badge.numeral}
            </span>
          )}
        </p>
        <Pills pills={pills} compact={!wide} />
        {wide && <p className={cx("veil-text text-xs leading-snug text-bone", pills.length ? "line-clamp-2" : "line-clamp-3")}>{card.text}</p>}
        {card.kind === "unit" && (
          <div className="veil-stats mt-1 flex justify-between font-mono text-xs">
            <span className="veil-stat veil-stat-atk" data-state={atkState} aria-label={`Attack ${atk}`}>
              {atk}
            </span>
            <span className="veil-stat veil-stat-hp" data-state={hpState} aria-label={`Health ${hp}`}>
              {hp}
            </span>
          </div>
        )}
      </div>
    </>
  );
  const data = {
    "data-faction": card.faction,
    "data-rarity": card.rarity,
    "data-tier": tier,
    "data-gem": gem,
    "data-kind": card.kind,
    "data-size": size,
  };
  const panel = rect ? <CardInspect defId={defId} match={match} unit={unit} anchor={rect} /> : null;
  if (!onClick) {
    return (
      <div {...data} className={cls} style={fanStyle} title={inspect ? undefined : card.text} {...handlers}>
        {body}
        {panel}
      </div>
    );
  }
  return (
    <button
      type="button"
      {...data}
      className={cls}
      style={fanStyle}
      aria-pressed={selected}
      onClick={onClick}
      aria-label={`${card.name}. ${rarityName}. ${card.text}`}
      {...handlers}
    >
      {body}
      {panel}
    </button>
  );
}

/** Enlarged card plus full text and keyword reminders, floated near the anchor. */
function CardInspect({ defId, match, unit, anchor }: { defId: string; match?: Match | null; unit?: Unit; anchor: DOMRect }) {
  const card = cardOf(defId);
  const pills = cardPills(card);
  const badge = setBadge(card);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 12;
    let left: number;
    let top: number;
    if (anchor.top - h - gap >= 8) {
      // Above (hand cards at the bottom of the screen).
      top = anchor.top - h - gap;
      left = anchor.left + anchor.width / 2 - w / 2;
    } else if (anchor.right + gap + w <= vw - 8) {
      left = anchor.right + gap;
      top = anchor.top + anchor.height / 2 - h / 2;
    } else if (anchor.left - gap - w >= 8) {
      left = anchor.left - gap - w;
      top = anchor.top + anchor.height / 2 - h / 2;
    } else {
      left = vw / 2 - w / 2;
      top = vh / 2 - h / 2;
    }
    setPos({ left: Math.max(8, Math.min(left, vw - w - 8)), top: Math.max(8, Math.min(top, vh - h - 8)) });
  }, [anchor]);
  if (typeof document === "undefined") return null;
  const node: ReactNode = (
    <div ref={ref} className="veil-inspect" role="tooltip" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0, visibility: "hidden" }}>
      <div className="veil-inspect-card">
        <CardFace defId={defId} match={match} unit={unit} size="fill" inspect={false} />
      </div>
      <div className="veil-inspect-body">
        <p className="veil-inspect-name">{card.name}</p>
        <p className="veil-inspect-meta">
          <span data-gem={gemTier(card)} className="veil-inspect-rarity">
            {rarityNameOf(card)}
          </span>
          {" · "}
          {card.kind === "unit" ? `Unit · ${card.atk}/${card.hp}` : card.kind === "spell" ? "Spell" : "Trap"}
          {" · "}
          {card.cost} mana
        </p>
        <p className="veil-inspect-text">{card.text}</p>
        {pills.length > 0 && (
          <ul className="veil-inspect-keys">
            {pills.map((item) => (
              <li key={item.id}>
                <span className="veil-pill" data-pill={item.id}>
                  <span className="veil-pill-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="veil-pill-label">{item.label}</span>
                </span>
                <span>{item.reminder}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="veil-inspect-set" data-format={badge.format}>
          {badge.format === "eternal" ? "∞" : "◆"} {badge.label}
        </p>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}

export function CardBack({
  size = "tiny",
  faction,
}: {
  size?: "tiny" | "trap" | "hero" | "fill";
  marked?: boolean;
  faction?: Faction;
}) {
  const width = size === "hero" ? "w-48 sm:w-56" : size === "fill" ? "w-full" : size === "trap" ? "w-16 sm:w-20" : "w-10";
  return (
    <div className={cx("veil-card shrink-0", width)} data-faction={faction} aria-hidden={size === "tiny"}>
      <img src="/assets/veil/back.jpg?v=3" alt={size === "tiny" ? "" : "Seal Forge card back"} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
    </div>
  );
}
