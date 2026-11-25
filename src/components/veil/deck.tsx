import { useEffect, useRef, useState } from "react";
import { CardFace } from "@/components/veil/card";
import { DeckTile } from "@/components/veil/deck-list";
import { deckRequest, fetchDecks, type SealedDeck } from "@/veil/deck-client";
import { CARDS, FACTIONS, SEALS, cardOf, type Faction } from "@/veil/cards";
import { usePlayer } from "@/veil/connect";
import { openSession } from "@/veil/game-session";
import { veilBalances } from "@/veil/holds";
import { readBook, saveBook } from "@/veil/phone-book";
import { redactKey } from "@/veil/keys";
import { deckFits, deckSeal, cleanDeckName } from "@/veil/ranks";
import { clearSession, readSession, writeSession, type AccountSession } from "@/veil/session";
import { isApk } from "@/veil/shell";

type Owned = { id: string; name: string; balance: number };

const SEAL_ART: Record<Faction, string> = {
  elf: "/assets/veil/seals/aureth.jpg",
  human: "/assets/veil/seals/veymar.jpg",
  goblin: "/assets/veil/seals/rixen.jpg",
  robot: "/assets/veil/seals/quorin.jpg",
  demon: "/assets/veil/seals/malrec.jpg",
  veil: "/assets/veil/seals/unbound.jpg",
};

export function SealMark({ id, className }: { id: Faction; className?: string }) {
  const name = FACTIONS.find((faction) => faction.id === id)?.name ?? id;
  return <img src={SEAL_ART[id]} alt="" title={name} draggable={false} className={className ? `seal-mark ${className}` : "seal-mark"} />;
}

export function DeckForge({ onBack }: { onBack: () => void }) {
  const { ready, key, address } = usePlayer();
  const [session, setSession] = useState<AccountSession | null>(null);
  const [owned, setOwned] = useState<Owned[]>([]);
  const [holdState, setHoldState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [deck, setDeck] = useState<string[]>([]);
  const [deckName, setDeckName] = useState("");
  const [seal, setSeal] = useState<Exclude<Faction, "veil"> | null>(null);
  const [showUnbound, setShowUnbound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const touched = useRef(false);
  const [decks, setDecks] = useState<SealedDeck[] | null>(null);
  const [maxDecks, setMaxDecks] = useState(6);
  const [editingId, setEditingId] = useState<string | null>(null);

  function loadIntoForge(next: string[], name: string, id: string | null) {
    setEditingId(id);
    setDeck(next);
    setDeckName(name);
    const found = deckSeal(next);
    setSeal(found.ok && found.seal !== "veil" ? found.seal : next.length ? null : seal);
    setShowUnbound(
      next.some((cardId) => {
        try {
          return cardOf(cardId).faction === "veil";
        } catch {
          return false;
        }
      }),
    );
    setNotice(null);
    setError(null);
  }

  useEffect(() => {
    if (!ready) return;
    const saved = readSession();
    if (saved && address && saved.address.toLowerCase() === address.toLowerCase()) setSession(saved);
    else setSession(null);
  }, [ready, address]);

  useEffect(() => {
    if (!address) {
      setOwned([]);
      setHoldState("idle");
      return;
    }
    let cancel = false;
    setHoldState("loading");
    void veilBalances(address)
      .then((counts) => {
        if (cancel) return;
        setOwned(CARDS.flatMap((card, index) => ((counts[index] ?? 0) > 0 ? [{ id: card.id, name: card.name, balance: counts[index]! }] : [])));
        setHoldState("ready");
      })
      .catch(() => {
        if (cancel) return;
        setOwned([]);
        setHoldState("error");
      });
    return () => {
      cancel = true;
    };
  }, [address]);

  useEffect(() => {
    if (isApk()) {
      if (!address || touched.current) return;
      const book = readBook(address);
      setDeck(book.deck);
      setDeckName(book.deckName);
      const found = deckSeal(book.deck);
      if (found.ok && found.seal !== "veil") setSeal(found.seal);
      setShowUnbound(book.deck.some((id) => {
        try {
          return cardOf(id).faction === "veil";
        } catch {
          return false;
        }
      }));
      return;
    }
    if (!session) return;
    void fetchDecks(session.token).then((list) => {
      if (!list) return;
      setDecks(list.decks);
      setMaxDecks(list.max);
      if (touched.current) return;
      const active = list.decks.find((item) => item.active);
      if (active) {
        touched.current = true;
        loadIntoForge(active.cards, active.name, active.id);
      }
    });
    void fetch(`/api/veilforge/profile?token=${encodeURIComponent(session.token)}`)
      .then((res) => res.json())
      .then((data: { profile?: { deck: string[]; deckName?: string } }) => {
        if (touched.current) return;
        const next = data.profile?.deck ?? [];
        setDeck(next);
        setDeckName(data.profile?.deckName ?? "");
        const found = deckSeal(next);
        if (found.ok && found.seal !== "veil") setSeal(found.seal);
        setShowUnbound(next.some((id) => {
          try {
            return cardOf(id).faction === "veil";
          } catch {
            return false;
          }
        }));
      })
      .catch(() => setError("The account did not load."));
  }, [session, address]);

  async function signIn(): Promise<AccountSession | null> {
    if (!address) return null;
    setError(null);
    try {
      const opened = await openSession(key, address);
      const next = { token: opened.token, address };
      writeSession(next);
      setSession(next);
      return next;
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "Sign-in failed.", key));
      return null;
    }
  }

  async function save() {
    if (!deckLegal) return;
    const named = cleanDeckName(deckName);
    if (named === null) {
      setError("Deck names are 2 to 18 letters or numbers.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isApk()) {
        if (!address) throw new Error("Make a wallet in the game.");
        saveBook(address, { deck, deckName: named });
        setNotice("Deck sealed.");
        return;
      }
      const active = session ?? (await signIn());
      if (!active) return;
      const body = await deckRequest(active.token, "deck-seal", { deckId: editingId ?? undefined, cards: deck, deckName: named });
      if (!body.decks) {
        if (body.status === 401) {
          clearSession();
          setSession(null);
        }
        throw new Error(body.error ?? "Could not save.");
      }
      setDecks(body.decks);
      const key = [...deck].sort().join(",");
      const saved = body.decks.find((item) => [...item.cards].sort().join(",") === key);
      setEditingId(saved?.id ?? null);
      setDeckName(saved?.name ?? named);
      setNotice(saved?.active ? "Deck sealed. It is your active deck." : "Deck sealed. Set it active to play it.");
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "Could not save.", key));
    } finally {
      setBusy(false);
    }
  }

  async function shelfOp(op: "deck-rename" | "deck-activate" | "deck-unseal", deckId: string, extra: Record<string, unknown> = {}) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const body = await deckRequest(session.token, op, { deckId, ...extra });
      if (!body.decks) {
        if (body.status === 401) {
          clearSession();
          setSession(null);
        }
        throw new Error(body.error ?? "Could not update the deck.");
      }
      setDecks(body.decks);
      if (op === "deck-unseal" && deckId === editingId) loadIntoForge([], "", null);
      if (op === "deck-activate") setNotice(`${body.decks.find((item) => item.active)?.name || "Deck"} is now your active deck.`);
      if (op === "deck-rename") setNotice("Deck renamed.");
      if (op === "deck-unseal") setNotice("Deck unsealed. Your cards stay in your wallet.");
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "Could not update the deck.", key));
    } finally {
      setBusy(false);
    }
  }

  function chooseSeal(next: Faction) {
    if (next === "veil") return;
    touched.current = true;
    setSeal(next);
    setDeck((current) => current.filter((id) => {
      try {
        const card = cardOf(id);
        return card.faction === "veil" || card.faction === next;
      } catch {
        return false;
      }
    }));
    setNotice(null);
  }

  function addCopy(id: string) {
    const card = cardOf(id);
    const balance = owned.find((item) => item.id === id)?.balance ?? 0;
    if (balance <= 0) return;
    if (!seal) return;
    if (card.faction === "veil") {
      if (!showUnbound) return;
    } else if (card.faction !== seal) return;
    const copies = deck.filter((item) => item === id).length;
    if (deck.length >= 20 || copies >= 2 || copies >= balance) return;
    touched.current = true;
    setDeck([...deck, id]);
    setNotice(null);
  }

  function removeAt(index: number) {
    touched.current = true;
    setDeck(deck.filter((_, item) => item !== index));
    setNotice(null);
  }

  const balances = new Map(owned.map((card) => [card.id, card.balance]));
  const sealed = deckSeal(deck);
  const copiesOf = (id: string) => deck.filter((item) => item === id).length;
  const pool = CARDS.filter((card) => {
    const balance = balances.get(card.id) ?? 0;
    const copies = copiesOf(card.id);
    if (balance <= 0 || copies >= 2 || copies >= balance) return false;
    if (!seal) return false;
    if (card.faction === "veil") return showUnbound;
    return card.faction === seal;
  }).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  const fits = holdState === "ready" && deckFits(deck, balances);
  const deckLegal = deck.length === 20 && sealed.ok && fits;
  const canAddMore = pool.length > 0;
  const block = !address
    ? isApk() ? "Make a wallet in the game." : "Connect a wallet."
    : holdState === "loading" || holdState === "idle"
      ? "Reading your cards."
      : holdState === "error"
        ? "Could not read this wallet's cards."
        : !sealed.ok
          ? deck.length === 0
            ? "Empty forge."
            : sealed.error
          : deck.length < 20
            ? canAddMore
              ? `Add ${20 - deck.length} more.`
              : showUnbound
                ? `Need ${20 - deck.length} more. Two copies is the limit.`
                : `Need ${20 - deck.length} more. Two copies is the limit. Turn on Unbound if you hold those.`
            : !fits
              ? "A card in this deck is not in the wallet."
              : null;
  const editing = editingId ? decks?.find((item) => item.id === editingId) ?? null : null;
  const sameCards = Boolean(editing && [...editing.cards].sort().join(",") === [...deck].sort().join(","));
  const renameOnly = Boolean(editing && sameCards && cleanDeckName(deckName) !== null && (cleanDeckName(deckName) ?? "") !== editing.name);
  const atCap = Boolean(decks && decks.length >= maxDecks);
  const lastCopy = new Map<string, number>();
  deck.forEach((id, index) => lastCopy.set(id, index));

  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" className="veil-btn" onClick={onBack}>
            Back
          </button>
          <div>
            <p className="text-xs tracking-widest text-brass">FORGE</p>
            <h1 className="text-lg font-medium leading-tight">Deck</h1>
          </div>
        </div>
        <p className="font-mono text-sm text-brass">{deck.length}/20</p>
      </header>
      <main className="mx-auto grid max-w-5xl grid-cols-[minmax(0,1fr)] gap-4 px-4 pb-10">
        {!address && <p className="text-sm text-ash">{isApk() ? "Make a wallet in the game. Only card NFTs in that wallet can enter a deck." : "Connect a wallet. Only card NFTs in that wallet can enter a deck."}</p>}
        {address && !session && (
          <section className="rounded-md border border-line bg-panel p-4">
            <p className="text-sm leading-relaxed text-ash">Sign in with {address} so this deck is the one ranked matches use.</p>
            <button type="button" className="veil-btn veil-btn-primary mt-3" disabled={busy} onClick={() => void signIn()}>
              Sign in with wallet
            </button>
          </section>
        )}
        {session && !isApk() && decks && (
          <section className="deck-shelf" aria-label="Sealed decks">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm tracking-widest text-brass">SEALED DECKS · {decks.length}/{maxDecks}</h2>
              <p className="text-xs text-ash">The active deck is the one ranked and server tables play.</p>
            </div>
            <div className="dl-grid mt-3">
              {decks.map((item) => (
                <DeckTile
                  key={item.id}
                  deck={item}
                  selected={item.id === editingId}
                  busy={busy}
                  onSelect={() => {
                    touched.current = true;
                    loadIntoForge(item.cards, item.name, item.id);
                  }}
                  onActivate={() => void shelfOp("deck-activate", item.id)}
                  onUnseal={() => void shelfOp("deck-unseal", item.id)}
                />
              ))}
              <button
                type="button"
                className="dl-new"
                disabled={atCap}
                data-selected={editingId === null ? "1" : undefined}
                onClick={() => {
                  touched.current = true;
                  loadIntoForge([], "", null);
                }}
              >
                <span className="dl-new-plus" aria-hidden>
                  +
                </span>
                New deck
                <small>{atCap ? `All ${maxDecks} slots used. Unseal one first.` : editingId === null ? "Building a new deck below" : "Start an empty forge"}</small>
              </button>
            </div>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          {SEALS.map((faction) => (
            <button key={faction.id} type="button" className={seal === faction.id ? "veil-btn veil-btn-primary" : "veil-btn"} aria-pressed={seal === faction.id} onClick={() => chooseSeal(faction.id)}>
              <SealMark id={faction.id} />
              {faction.name}
            </button>
          ))}
          {seal && (
            <button type="button" className={showUnbound ? "veil-btn veil-btn-primary" : "veil-btn"} aria-pressed={showUnbound} onClick={() => setShowUnbound((value) => !value)}>
              <SealMark id="veil" />
              Unbound
            </button>
          )}
        </div>
        {!seal && <p className="text-sm text-ash">Choose one seal. Unbound stays hidden until you call it. A deck of only unbound cards plays in any seal.</p>}
        <section className="rounded-md border border-line bg-panel p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="veil-field deck-name text-sm"
              value={deckName}
              maxLength={18}
              placeholder="Name this deck"
              aria-label="Deck name"
              onChange={(event) => {
                touched.current = true;
                setDeckName(event.target.value);
                setNotice(null);
              }}
            />
            <p className="font-mono text-sm text-brass">{deck.length}/20</p>
            <div className="ml-auto flex flex-wrap gap-2">
              {renameOnly && editing && (
                <button type="button" className="veil-btn" disabled={busy} onClick={() => void shelfOp("deck-rename", editing.id, { deckName: cleanDeckName(deckName) ?? "" })}>
                  Rename
                </button>
              )}
              <button type="button" className="veil-btn veil-btn-primary" disabled={busy || !deckLegal || (!editingId && atCap && !isApk())} onClick={() => void save()}>
                {busy ? "Sealing" : editingId && !isApk() ? "Reseal deck" : decks && !isApk() ? "Seal new deck" : "Seal deck"}
              </button>
              <button type="button" className="veil-btn" disabled={deck.length === 0 && deckName === ""} onClick={() => { touched.current = true; setDeck([]); setDeckName(""); }}>
                Clear
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-ash">
            {block ?? (sealed.ok ? (sealed.seal === "veil" ? "Unbound deck. Plays in any seal. Ready to seal." : `${SEALS.find((item) => item.id === sealed.seal)?.name ?? "Seal"} deck. Ready to seal.`) : "Empty forge.")}
            {!session && deckLegal ? " Sign-in opens when you seal." : ""}
          </p>
          {notice && <p className="mt-2 text-sm text-brass">{notice}</p>}
          <div className="deck-row mt-2">
            {deck.length === 0 && <div className="veil-slot deck-row-slot" aria-hidden />}
            {deck.map((id, index) => {
              const balance = balances.get(id) ?? 0;
              const copies = deck.filter((item) => item === id).length;
              const canSecond = index === lastCopy.get(id) && deck.length < 20 && copies < 2 && copies < balance;
              return (
                <button key={`${id}-${index}`} type="button" className="deck-row-card" onClick={() => removeAt(index)} aria-label={`Remove ${cardOf(id).name}`}>
                  <CardFace defId={id} size="fill" />
                  {canSecond && (
                    <span
                      className="deck-stack-add"
                      onClick={(event) => {
                        event.stopPropagation();
                        addCopy(id);
                      }}
                    >
                      +1
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
        <section>
          <h2 className="text-sm tracking-widest text-brass">{seal ? (showUnbound ? "OWNED · SEAL AND UNBOUND" : "OWNED") : "OWNED"}</h2>
          {seal && pool.length === 0 && <p className="mt-3 text-sm text-ash">No owned cards in this view. Open a pack, or turn Unbound on if you hold those.</p>}
          <div className="veil-grid mt-3">
            {pool.map((card) => {
              const balance = balances.get(card.id) ?? 0;
              const copies = deck.filter((id) => id === card.id).length;
              const full = deck.length >= 20 || copies >= 2 || copies >= balance;
              return (
                <button key={card.id} type="button" className="text-left disabled:opacity-40" disabled={full} onClick={() => addCopy(card.id)}>
                  <CardFace defId={card.id} size="fill" />
                  <p className="mt-1 text-center font-mono text-xs text-ash">
                    {copies} in deck · {balance} owned
                  </p>
                </button>
              );
            })}
          </div>
        </section>
        {error && <p className="text-sm text-danger">{error}</p>}
      </main>
    </>
  );
}
