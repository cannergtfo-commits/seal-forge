import { useEffect, useState } from "react";
import { TitleBadge } from "@/components/veil/title-badge";
import type { TitleDef } from "@/veil/titles";

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TitleToast({
  titles,
  onDone,
}: {
  titles: TitleDef[];
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const current = titles[index];

  useEffect(() => {
    setIndex(0);
  }, [titles]);

  useEffect(() => {
    if (!current) {
      onDone();
      return;
    }
    const hold = prefersReducedMotion() ? 1600 : 2800;
    const timer = window.setTimeout(() => {
      if (index + 1 >= titles.length) onDone();
      else setIndex((n) => n + 1);
    }, hold);
    return () => window.clearTimeout(timer);
  }, [current, index, titles.length, onDone]);

  if (!current) return null;
  return (
    <div className="tb-toast" role="status" aria-live="polite" data-rarity={current.rarity}>
      <TitleBadge badge={current.badge} rarity={current.rarity} size={48} />
      <div className="tb-toast-copy">
        <p className="tb-toast-kicker">Title unlocked</p>
        <p className="tb-toast-name">{current.name}</p>
        <p className="tb-toast-flavor">{current.flavor}</p>
      </div>
    </div>
  );
}
