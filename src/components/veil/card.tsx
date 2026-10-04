import { cardOf, schoolOf, type Faction } from "@/veil/cards";
import { power, type Match, type Unit } from "@/veil/logic";
import { rarityLabel, rarityTier } from "@/veil/pack-score";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function CardFace({
  defId,
  match,
  unit,
  size = "hand",
  selected = false,
  dim = false,
  onClick,
}: {
  defId: string;
  match?: Match | null;
  unit?: Unit;
  size?: "hand" | "board" | "fill";
  selected?: boolean;
  dim?: boolean;
  onClick?: () => void;
}) {
  const card = cardOf(defId);
  const atk = unit && match ? power(match, unit) : card.atk;
  const hp = unit ? unit.hp : card.hp;
  const maxHp = unit?.maxHp ?? card.hp;
  const hpClass = hp < maxHp ? "text-danger" : hp > card.hp ? "text-signal" : "text-bone";
  const atkClass = atk > card.atk ? "text-signal" : "text-bone";
  const wide = size !== "board";
  const tier = rarityTier(card.rarity, card.set);
  const rarityName = rarityLabel(card.rarity, card.set);
  const cls = cx(
    "veil-card shrink-0",
    size === "hand" && "w-36 sm:w-44",
    size === "board" && "w-28 sm:w-32",
    size === "fill" && "w-full",
    selected && "ring-2 ring-brass",
    dim && "opacity-45",
  );
  const body = (
    <>
      <img src={card.art} alt="" draggable={false} decoding="async" className="veil-art" />
      <span className="veil-gem">{card.cost}</span>
      <span className="veil-rarity">{rarityName}</span>
      <div className={cx("veil-lore", wide ? "veil-lore-wide" : "veil-lore-tight")}>
        <p className={cx("font-medium leading-tight", wide ? "line-clamp-1 text-sm" : "truncate text-xs")}>{card.name}</p>
        <p className="text-xs uppercase tracking-wider text-brass">{schoolOf(card)}</p>
        {wide && <p className="line-clamp-3 text-xs leading-snug text-bone">{card.text}</p>}
        {card.kind === "unit" && (
          <div className="mt-1 flex justify-between font-mono text-xs">
            <span className={cx("veil-stat", atkClass)}>{atk}</span>
            <span className={cx("veil-stat", hpClass)}>{hp}</span>
          </div>
        )}
      </div>
    </>
  );
  if (!onClick) {
    return (
      <div data-faction={card.faction} data-rarity={card.rarity} data-tier={tier} className={cls} title={card.text}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" data-faction={card.faction} data-rarity={card.rarity} data-tier={tier} className={cls} title={card.text} aria-pressed={selected} onClick={onClick} aria-label={`${card.name}. ${rarityName}. ${card.text}`}>
      {body}
    </button>
  );
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
