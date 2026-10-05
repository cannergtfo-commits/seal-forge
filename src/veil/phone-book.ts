import { PORTRAITS, rankFor } from "./ranks";

export type PhoneBook = {
  name: string;
  portrait: string;
  xp: number;
  wins: number;
  losses: number;
  deck: string[];
  deckName: string;
};

function keyFor(address: string) {
  return `sealforge-book:${address.toLowerCase()}`;
}

function blank(address: string): PhoneBook {
  return {
    name: `${address.slice(0, 6)}`,
    portrait: PORTRAITS[0] ?? "lysara",
    xp: 0,
    wins: 0,
    losses: 0,
    deck: [],
    deckName: "",
  };
}

export function readBook(address: string): PhoneBook {
  try {
    const raw = localStorage.getItem(keyFor(address));
    if (!raw) return blank(address);
    const parsed = JSON.parse(raw) as Partial<PhoneBook>;
    const base = blank(address);
    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name : base.name,
      portrait: typeof parsed.portrait === "string" ? parsed.portrait : base.portrait,
      xp: typeof parsed.xp === "number" ? parsed.xp : 0,
      wins: typeof parsed.wins === "number" ? parsed.wins : 0,
      losses: typeof parsed.losses === "number" ? parsed.losses : 0,
      deck: Array.isArray(parsed.deck) ? parsed.deck.filter((id) => typeof id === "string") : [],
      deckName: typeof parsed.deckName === "string" ? parsed.deckName : "",
    };
  } catch {
    return blank(address);
  }
}

export function saveBook(address: string, patch: Partial<PhoneBook>): PhoneBook {
  const next = { ...readBook(address), ...patch };
  localStorage.setItem(keyFor(address), JSON.stringify(next));
  return next;
}

export function bookProfile(address: string, book = readBook(address)) {
  const rank = rankFor(book.xp);
  return {
    address,
    name: book.name,
    portrait: book.portrait,
    nftContract: null,
    nftToken: null,
    nftImage: null,
    xp: book.xp,
    wins: book.wins,
    losses: book.losses,
    rank: rank.name,
    nextRank: rank.next,
    deck: book.deck,
    deckName: book.deckName,
  };
}
