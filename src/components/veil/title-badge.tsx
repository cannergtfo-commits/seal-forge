import type { TitleRarity } from "@/veil/titles";

const MOTIF: Record<string, string> = {
  spark: "M12 3.5 13.8 8l4.7.4-3.6 3.1 1.1 4.6L12 13.8 7.99 16.1 9.1 11.5 5.5 8.4 10.2 8Z",
  ash: "M8 16.5c2.4-1.4 3.2-3.4 3.2-5.2 0-2.2.8-3.6 1.8-5.3 1.8 2.4 3.2 4.3 3.2 6.6 0 2.6-1.8 4.8-5.2 5.2C9.2 17.6 8.4 17.2 8 16.5Z",
  crest: "M12 3.2 18.5 6v5.1c0 3.8-2.8 6.4-6.5 7.7C8.3 17.5 5.5 14.9 5.5 11.1V6Z",
  crown: "M4.5 16.5h15l-.6-7.2-3.7 2.8L12 6.5 9 12.1 5.1 9.3Z",
  pack: "M6 8.5h12v9.5H6Zm3-2h6l1 2H8Z",
  flame: "M12 3.2c2.6 3 5.3 5.4 5.3 9.1A5.3 5.3 0 0 1 12 17.6 5.3 5.3 0 0 1 6.7 12.3C6.7 9.4 8.8 6.8 12 3.2Zm0 6.4c.9 1.1 1.7 2 1.7 3.2A1.7 1.7 0 0 1 12 14.5 1.7 1.7 0 0 1 10.3 12.8c0-.8.5-1.6 1.7-3.2Z",
  "seal-elf": "M12 3.5c2.6 2.8 6 6.4 6 10.1A6 6 0 0 1 12 19.5 6 6 0 0 1 6 13.6C6 9.9 9.4 6.3 12 3.5Zm0 5.2-2 5h4Z",
  "seal-human": "M12 3.2 13.1 9h5.2l-4.2 3.1 1.6 5.2L12 14.6 8.3 17.3l1.6-5.2-4.2-3.1h5.2Z",
  "seal-goblin": "M5.5 9.2 12 4.5l6.5 4.7-2 8.8H7.5Zm3.2 4.2 3.3-4.2 3.3 4.2Z",
  "seal-robot": "M8 7h8v2.2h2.2v2.2H16V17H8v-5.6H5.8V9.2H8Zm2.2 3.4v4.2h3.6v-4.2Z",
  "seal-demon": "M5 6.5 8.2 9 12 4.8 15.8 9 19 6.5 17.2 18.5H6.8Zm7 4.2c-1.6 0-2.6 1.3-2.6 2.6S10.4 16 12 16s2.6-1.4 2.6-2.7S13.6 10.7 12 10.7Z",
  pentacle: "M12 3.4 14.3 9h6l-4.8 3.6 1.8 5.6L12 14.8 6.7 18.2l1.8-5.6L3.7 9h6Z",
  decks: "M7 7.2h10v12H7Zm1.6-2.2h10V17M5.4 9.2H7",
  season: "M12 3.2 18.4 12 12 20.8 5.6 12Z",
};

type Props = {
  badge?: string;
  rarity?: TitleRarity | string;
  size?: number;
  className?: string;
  title?: string;
};

export function TitleBadge({ badge = "crest", rarity = "common", size = 28, className = "", title }: Props) {
  const path = MOTIF[badge] ?? MOTIF.crest;
  const stroke = badge === "crest" || badge === "pack" || badge === "decks" || badge === "seal-robot" ? "none" : "currentColor";
  return (
    <span className={`tb-badge ${className}`.trim()} data-rarity={rarity} data-badge={badge} title={title} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" aria-hidden width={size} height={size}>
        <circle className="tb-ring" cx="12" cy="12" r="11" />
        <circle className="tb-well" cx="12" cy="12" r="8.6" />
        <path className="tb-motif" d={path} fill={stroke === "none" ? "currentColor" : "none"} stroke={stroke === "none" ? "none" : "currentColor"} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}
