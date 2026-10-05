import { bookProfile, readBook, saveBook, type PhoneBook } from "./phone-book";

export type ProgressSeal = {
  address: string;
  name: string;
  portrait: string;
  xp: number;
  wins: number;
  losses: number;
  deck: string[];
  deckName: string;
  signature: string;
};

function slot(address: string) {
  return `seal-progress:${address.toLowerCase()}`;
}

export function readProgress(address: string): ProgressSeal | null {
  if (typeof localStorage === "undefined" || !address) return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(slot(address)) ?? "") as Partial<ProgressSeal>;
    if (!parsed || typeof parsed.signature !== "string" || !parsed.signature.startsWith("0x")) return null;
    if (typeof parsed.xp !== "number" || typeof parsed.wins !== "number" || typeof parsed.losses !== "number") return null;
    return {
      address,
      name: typeof parsed.name === "string" ? parsed.name : "",
      portrait: typeof parsed.portrait === "string" ? parsed.portrait : "lysara",
      xp: parsed.xp,
      wins: parsed.wins,
      losses: parsed.losses,
      deck: Array.isArray(parsed.deck) ? parsed.deck.filter((id) => typeof id === "string") : [],
      deckName: typeof parsed.deckName === "string" ? parsed.deckName : "",
      signature: parsed.signature,
    };
  } catch {
    return null;
  }
}

export function writeProgress(seal: ProgressSeal) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(slot(seal.address), JSON.stringify(seal));
  const book: Partial<PhoneBook> = {
    name: seal.name,
    portrait: seal.portrait,
    xp: seal.xp,
    wins: seal.wins,
    losses: seal.losses,
    deck: seal.deck,
    deckName: seal.deckName,
  };
  saveBook(seal.address, book);
}

export function localProfile(address: string) {
  const sealed = readProgress(address);
  if (sealed) return bookProfile(address, sealed);
  return bookProfile(address, readBook(address));
}
