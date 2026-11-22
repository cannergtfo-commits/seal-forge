import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CARDS, FACTIONS, cardOf, type Faction } from "@/veil/cards";
import { gemTier, rarityName } from "@/veil/card-meta";
import { CardFace } from "@/components/veil/card";
import { DeckTile } from "@/components/veil/deck-list";
import { deckRequest, fetchDecks, type SealedDeck } from "@/veil/deck-client";
import "./profile.css";
import { usePlayer } from "@/veil/connect";
import { openSession } from "@/veil/game-session";
import { veilBalances } from "@/veil/holds";
import { gameKeySigns } from "@/veil/signer";
import { redactKey } from "@/veil/keys";
import { bookProfile, saveBook } from "@/veil/phone-book";
import { PORTRAITS, GIFT_WINS, MOTTO_MAX, cleanName, deckSeal, mmrTier, rankFor } from "@/veil/ranks";
import { localProfile, readProgress, writeProgress, type ProgressSeal } from "@/veil/progress";
import { clearSession, readSession, writeSession, type AccountSession } from "@/veil/session";
import { isApk } from "@/veil/shell";

type Profile = {
  address: string;
  name: string;
  portrait: string;
  nftContract: string | null;
  nftToken: string | null;
  nftImage: string | null;
  xp: number;
  wins: number;
  losses: number;
  rank: string;
  nextRank: number | null;
  deck: string[];
  deckName?: string;
  gifted?: boolean;
  giftReady?: boolean;
  mmr?: number;
  motto?: string;
};

type SealPlay = { faction: string; games: number; wins: number };
type Stats = {
  scored: number;
  wins: number;
  losses: number;
  vsBot: { games: number; wins: number };
  vsHuman: { games: number; wins: number };
  streak: { current: number; currentWin: boolean | null; best: number };
  form: boolean[];
  avgTurns: number | null;
  seals: SealPlay[];
  mostPlayedSeal: string | null;
  favoriteCards: { id: string; games: number }[];
  firstMatchAt: string | null;
  mmr: number;
  mmrGames: number;
};
type StatSheet = { stats: Stats; rewards: { signed: number; paid: number | null; bzb: string | null }; giftCards: string[] };

type Owned = { id: string; name: string; balance: number };
type BoardRow = Profile;

function face(profile: { portrait: string; nftImage: string | null }): string {
  return profile.nftImage || `/assets/veil/cards/${profile.portrait}.jpg`;
}

function keep(address: string, profile: Profile, seal: string | null | undefined) {
  if (!seal) return;
  const saved: ProgressSeal = {
    address,
    name: profile.name,
    portrait: profile.portrait,
    xp: profile.xp,
    wins: profile.wins,
    losses: profile.losses,
    deck: profile.deck,
    deckName: profile.deckName ?? "",
    signature: seal,
  };
  writeProgress(saved);
}

export function Profile({ onBack, onDeck, onTutorial }: { onBack: () => void; onDeck: () => void; onTutorial?: () => void }) {
  const { ready, key, address } = usePlayer();
  const [session, setSession] = useState<AccountSession | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [owned, setOwned] = useState<Owned[]>([]);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [name, setName] = useState("");
  const [nftContract, setNftContract] = useState("");
  const [nftToken, setNftToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [giftNote, setGiftNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState<StatSheet | null>(null);
  const [sheetState, setSheetState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [ownedState, setOwnedState] = useState<"loading" | "ready" | "failed">("loading");
  const [motto, setMotto] = useState("");
  const [editingMotto, setEditingMotto] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [decks, setDecks] = useState<{ decks: SealedDeck[]; max: number } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const saved = readSession();
    if (saved && address && saved.address.toLowerCase() === address.toLowerCase()) setSession(saved);
    else setSession(null);
  }, [ready, address]);

  useEffect(() => {
    if (!address) return;
    setOwnedState((state) => (state === "ready" ? state : "loading"));
    void veilBalances(address)
      .then((balances) => {
        setOwned(CARDS.map((card, index) => ({ id: card.id, name: card.name, balance: balances[index] ?? 0 })).filter((card) => card.balance > 0));
        setOwnedState("ready");
      })
      .catch(() => {
        setOwned([]);
        setOwnedState("failed");
      });
    if (isApk()) return;
    void fetch("/api/veilforge/profile?board=1")
      .then((res) => res.json())
      .then((data: { board?: BoardRow[] }) => setBoard(data.board ?? []))
      .catch(() => setBoard([]));
  }, [address, profile]);

  useEffect(() => {
    if (!address) return;
    const local = localProfile(address);
    if (!session) {
      setProfile(local);
      setName(local.name);
      return;
    }
    if (session.token === "device") {
      setProfile(local);
      setName(local.name);
      return;
    }
    const backup = readProgress(address);
    void fetch(`/api/veilforge/profile?token=${encodeURIComponent(session.token)}`)
      .then((res) => res.json())
      .then(async (data: { profile?: Profile; seal?: string; error?: string }) => {
        if (!data.profile) {
          clearSession();
          setSession(null);
          setProfile(local);
          return;
        }
        const serverGames = data.profile.wins + data.profile.losses;
        const backupGames = backup ? backup.wins + backup.losses : 0;
        if (backup && backupGames > serverGames && backup.xp >= data.profile.xp) {
          const restored = await fetch("/api/veilforge/profile", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ op: "restore", token: session.token, ...backup }),
          });
          const body = (await restored.json()) as { profile?: Profile; seal?: string };
          if (body.profile) {
            keep(address, body.profile, body.seal);
            setProfile(body.profile);
            setName(body.profile.name);
            return;
          }
        }
        keep(address, data.profile, data.seal);
        setProfile(data.profile);
        setName(data.profile.name);
      })
      .catch(() => {
        setProfile(local);
        setName(local.name);
        setError("The account did not load. This device still has your saved rank.");
      });
  }, [session, address]);

  const signedIn = Boolean(session && session.token !== "device");
  const hasProfile = Boolean(profile);
  useEffect(() => {
    setMotto(profile?.motto ?? "");
  }, [profile?.motto]);

  useEffect(() => {
    if (!session || session.token === "device" || isApk() || !hasProfile) {
      setSheet(null);
      setSheetState("idle");
      return;
    }
    let live = true;
    setSheetState((state) => (state === "ready" ? state : "loading"));
    void fetch(`/api/veilforge/profile?stats=1&token=${encodeURIComponent(session.token)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((data: StatSheet) => {
        if (!live || !data.stats) return;
        setSheet(data);
        setSheetState("ready");
      })
      .catch(() => live && setSheetState("failed"));
    return () => {
      live = false;
    };
  }, [session, hasProfile, profile?.wins, profile?.losses, profile?.gifted]);

  useEffect(() => {
    if (!session || session.token === "device" || isApk() || !hasProfile) {
      setDecks(null);
      return;
    }
    let live = true;
    void fetchDecks(session.token).then((list) => live && list && setDecks(list));
    return () => {
      live = false;
    };
  }, [session, hasProfile, profile?.wins, profile?.losses]);

  async function activateDeck(deckId: string) {
    if (!session || session.token === "device") return;
    setBusy(true);
    setError(null);
    try {
      const body = await deckRequest(session.token, "deck-activate", { deckId });
      if (!body.decks) throw new Error(body.error ?? "Could not switch decks.");
      setDecks({ decks: body.decks, max: body.max ?? decks?.max ?? 6 });
      const next = body.profile as Profile | undefined;
      if (next) {
        setProfile(next);
        if (address) keep(address, next, body.seal);
      }
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "Could not switch decks.", key));
    } finally {
      setBusy(false);
    }
  }

  async function signIn() {
    if (!address) return;
    setBusy(true);
    setError(null);
    try {
      const opened = await openSession(key, address);
      if (!opened.profile || typeof opened.profile !== "object") throw new Error("Sign-in failed.");
      const next = { token: opened.token, address };
      writeSession(next);
      setSession(next);
      setProfile(opened.profile as Profile);
      setName((opened.profile as Profile).name);
      const seal = (opened as { seal?: string }).seal;
      if (seal) keep(address, opened.profile as Profile, seal);
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "Sign-in failed.", key));
    } finally {
      setBusy(false);
    }
  }

  async function save(extra: { portrait?: string; deck?: string[]; nft?: { contract: string; tokenId: string } | null; motto?: string }): Promise<boolean> {
    if (isApk()) {
      if (!address) return false;
      const named = cleanName(name);
      if (!named) {
        setError("Names are 2 to 18 letters or numbers.");
        return false;
      }
      setBusy(true);
      setError(null);
      const book = saveBook(address, { name: named, portrait: extra.portrait });
      const next = bookProfile(address, book);
      setProfile(next);
      setName(next.name);
      setBusy(false);
      return true;
    }
    if (!session || session.token === "device") {
      setError("Sign in with your wallet to save your name and portrait.");
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/veilforge/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "save", token: session.token, name, ...extra }),
      });
      const body = (await res.json()) as { profile?: Profile; seal?: string; error?: string };
      if (!body.profile) throw new Error(body.error ?? "Could not save.");
      setProfile(body.profile);
      setName(body.profile.name);
      const seal = (body as { seal?: string }).seal;
      if (address) keep(address, body.profile, seal);
      return true;
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "Could not save.", key));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function claimPack() {
    if (!session || session.token === "device") {
      await signIn();
      return;
    }
    setBusy(true);
    setError(null);
    setGiftNote(null);
    try {
      const res = await fetch("/api/veilforge/gift", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: session.token }),
      });
      const body = (await res.json().catch(() => ({ error: `The gift server answered ${res.status}. Claim again in a minute.` }))) as { profile?: Profile; seal?: string; note?: string; error?: string };
      if (body.profile && address) keep(address, body.profile, body.seal);
      if (body.profile) setProfile(body.profile);
      if (body.error) throw new Error(body.error);
      setGiftNote(body.note ?? "The pack is on its way.");
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "The pack was not gifted.", key));
    } finally {
      setBusy(false);
    }
  }

  const rank = profile ? rankFor(profile.xp) : null;
  const span = rank?.next ? rank.next - rank.min : 1;
  const filled = rank ? Math.max(0, profile ? profile.xp - rank.min : 0) : 0;
  const width = rank?.next ? Math.min(100, (filled / span) * 100) : 100;

  const stats = sheet?.stats ?? null;
  const deckSealed = profile && profile.deck.length ? deckSeal(profile.deck) : null;
  const deckFaction = deckSealed && deckSealed.ok ? deckSealed.seal : null;
  const heroFaction = (stats?.mostPlayedSeal as Faction | null) ?? deckFaction ?? "veil";
  const heroSource = stats?.mostPlayedSeal ? "Most played seal" : deckFaction ? "Sealed deck" : "No seal yet";
  const games = profile ? profile.wins + profile.losses : 0;
  const winRate = games ? Math.round((profile!.wins / games) * 100) : null;
  const tier = mmrTier(stats?.mmr ?? profile?.mmr ?? 1000, stats?.mmrGames ?? 0);
  const collection = useMemo(() => summarizeOwned(owned), [owned]);
  const sortedOwned = useMemo(
    () =>
      [...owned].sort((a, b) => {
        const ra = RARITY_ORDER[gemTier(cardOf(a.id))] ?? 9;
        const rb = RARITY_ORDER[gemTier(cardOf(b.id))] ?? 9;
        return ra - rb || b.balance - a.balance || a.name.localeCompare(b.name);
      }),
    [owned],
  );
  const shownOwned = showAll ? sortedOwned : sortedOwned.slice(0, 12);
  const justClaimed = Boolean(giftNote && profile?.gifted);

  return (
    <div className="pf-root" data-seal={heroFaction} style={{ "--seal": `var(--color-${heroFaction})` } as CSSProperties}>
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" className="veil-btn" onClick={onBack}>
            Back
          </button>
          <div>
            <p className="text-xs tracking-widest text-brass">ACCOUNT</p>
            <h1 className="pf-title-sm">{profile?.name ?? (isApk() ? "Make a wallet" : "Connect a wallet")}</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onTutorial && (
            <button type="button" className="veil-btn" onClick={onTutorial}>
              Replay guided duel
            </button>
          )}
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-5 px-4 pb-12">
        {!address && <p className="text-sm text-ash">{isApk() ? "Make a wallet in the game. Signing in never sends a key to the server." : "Connect a wallet extension, or generate one in the game. Signing in never sends a key to the server."}</p>}
        {address && !profile && (
          <section className="pf-panel pf-panel-brass">
            <p className="text-sm leading-relaxed text-ash">{gameKeySigns(key) ? `Sign in with the game wallet ${address}. The key stays on this device and signs the login here.` : `Connect ${address} by signing a login message. That creates the account and lets you edit a profile, build a deck, and earn rank.`}</p>
            <button type="button" className="veil-btn veil-btn-primary mt-3" disabled={busy} onClick={() => void signIn()}>
              {busy ? "Signing…" : "Sign in with wallet"}
            </button>
          </section>
        )}

        {profile && (
          <section className="pf-hero" aria-label="Duelist banner">
            <div className="pf-hero-art" style={{ backgroundImage: `url(${SEAL_ART[heroFaction]})` }} aria-hidden />
            <div className="pf-hero-veil" aria-hidden />
            <div className="pf-hero-body">
              <div className="pf-crest">
                <span className="pf-crest-ring" aria-hidden />
                <img src={face(profile)} alt="" className="pf-crest-face" />
                <span className="pf-crest-shine" aria-hidden />
                <span className="pf-crest-level" title={`Level ${rank?.level}`}>
                  <span>{rank?.level}</span>
                </span>
              </div>
              <div className="pf-hero-text">
                <div className="pf-badges">
                  <span className="pf-badge pf-badge-rank">{rank?.name}</span>
                  <span className="pf-badge" data-step={tier.step} title={stats?.mmrGames ? `Rating ${stats.mmr} from ${stats.mmrGames} human matches` : "Rating moves only in human-vs-human matches"}>
                    {tier.name}
                    {stats && stats.mmrGames > 0 ? ` · ${stats.mmr}` : ""}
                  </span>
                  <span className="pf-badge pf-badge-seal">
                    <img src={SEAL_ART[heroFaction]} alt="" />
                    {sealName(heroFaction)}
                    <em>{heroSource}</em>
                  </span>
                </div>
                <h2 className="pf-name">{profile.name}</h2>
                <Motto
                  motto={profile.motto ?? ""}
                  draft={motto}
                  setDraft={setMotto}
                  editing={editingMotto}
                  setEditing={setEditingMotto}
                  canEdit={signedIn && !isApk()}
                  busy={busy}
                  onSave={async () => {
                    if (await save({ motto })) setEditingMotto(false);
                  }}
                />
                <WalletChip address={profile.address} />
                <div className="pf-xp">
                  <div className="level-track pf-xp-track" role="progressbar" aria-valuemin={rank?.min ?? 0} aria-valuemax={rank?.next ?? profile.xp} aria-valuenow={profile.xp} aria-label="Experience">
                    <span className="level-fill pf-xp-fill" style={{ width: `${width}%` }} />
                  </div>
                  <p className="pf-xp-label">
                    <span>
                      Level {rank?.level} · <CountUp value={profile.xp} /> XP
                    </span>
                    <span>{rank?.next ? `${rank.next - profile.xp} XP to level ${(rank?.level ?? 1) + 1}` : "Highest rank"}</span>
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {profile && (!session || session.token === "device") && (
          <section className="pf-panel pf-panel-brass">
            <p className="text-sm text-ash">Connecting a wallet is not enough. Ranked wins only add XP after you sign in. Local practice and friend-device tables do not award XP.</p>
            <button type="button" className="veil-btn veil-btn-primary mt-3" disabled={busy} onClick={() => void signIn()}>
              Sign in to earn and save XP
            </button>
          </section>
        )}

        {profile && (
          <section className="pf-plates" aria-label="Stats">
            <Plate label="Record" sub={winRate === null ? "No scored matches yet" : `${winRate}% win rate`}>
              <CountUp value={profile.wins} />
              <span className="pf-dash">–</span>
              <CountUp value={profile.losses} />
            </Plate>
            <Plate label="Streak" sub={stats ? `Best ${stats.streak.best} wins` : sheetHint(sheetState, signedIn)}>
              {stats && stats.streak.current > 0 ? (
                <span className={stats.streak.currentWin ? "pf-good" : "pf-bad"}>
                  {stats.streak.currentWin ? "W" : "L"}
                  <CountUp value={stats.streak.current} />
                </span>
              ) : (
                <span className="pf-muted">—</span>
              )}
            </Plate>
            <Plate label="BzB earned" sub={rewardSub(sheet, sheetState, signedIn)} accent>
              {sheet?.rewards.bzb != null ? <CountUp value={Number(sheet.rewards.bzb)} decimals={2} /> : <span className="pf-muted">—</span>}
            </Plate>
            <Plate label="Cards owned" sub={ownedState === "ready" ? `${collection.unique} unique` : ownedState === "failed" ? "Polygon did not answer" : "Reading Polygon…"}>
              {ownedState === "ready" ? <CountUp value={collection.total} /> : <span className="pf-muted">—</span>}
            </Plate>
            <Plate label="Matches" sub={stats ? `${stats.vsHuman.games} vs players · ${stats.vsBot.games} vs bots` : sheetHint(sheetState, signedIn)}>
              <CountUp value={games} />
            </Plate>
            <Plate label="Avg. match" sub="Turns per scored match">
              {stats?.avgTurns != null ? <CountUp value={stats.avgTurns} decimals={1} /> : <span className="pf-muted">—</span>}
            </Plate>
          </section>
        )}

        {profile && (
          <div className="pf-grid">
            <section className="pf-panel">
              <h3 className="pf-h">Seal mastery</h3>
              {stats && stats.seals.length > 0 ? (
                <ul className="pf-seals">
                  {stats.seals.map((seal) => {
                    const top = stats.seals[0]!.games || 1;
                    const f = (seal.faction || "unknown") as Faction | "unknown";
                    return (
                      <li key={seal.faction || "unknown"} title={f === "unknown" ? "Matches scored before seal tracking was added" : undefined} className="pf-seal-row" style={{ "--row": f === "unknown" ? "var(--color-ash)" : `var(--color-${f})` } as CSSProperties}>
                        {f === "unknown" ? <span className="pf-seal-thumb pf-seal-thumb-unknown">?</span> : <img className="pf-seal-thumb" src={SEAL_ART[f]} alt="" />}
                        <span className="pf-seal-name">{f === "unknown" ? "Untracked" : sealName(f)}</span>
                        <span className="pf-seal-bar" aria-hidden>
                          <span style={{ width: `${(seal.games / top) * 100}%` }} />
                        </span>
                        <span className="pf-seal-num">
                          {seal.games} <em>· {seal.games ? Math.round((seal.wins / seal.games) * 100) : 0}%</em>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="pf-empty">{signedIn ? (sheetState === "loading" ? "Reading your match ledger…" : "Play a server table (Auto start or Find a match) and your seals show up here.") : "Sign in to see which seals you play."}</p>
              )}
              {stats && stats.form.length > 0 && (
                <div className="pf-form" aria-label="Last ten results, newest first">
                  <span className="pf-form-label">Recent</span>
                  {stats.form.map((win, i) => (
                    <span key={i} className={win ? "pf-pip pf-pip-w" : "pf-pip pf-pip-l"} title={win ? "Win" : "Loss"} style={{ animationDelay: `${i * 40}ms` }}>
                      {win ? "W" : "L"}
                    </span>
                  ))}
                </div>
              )}
              {stats?.firstMatchAt && <p className="pf-foot">Counting {stats.scored} server-scored matches since {new Date(stats.firstMatchAt).toLocaleDateString()}.</p>}
            </section>

            <section className="pf-panel">
              <h3 className="pf-h">Signature cards</h3>
              {stats && stats.favoriteCards.length > 0 ? (
                <div className="pf-sig">
                  {stats.favoriteCards.map((card) => (
                    <div key={card.id} className="pf-sig-card">
                      <CardFace defId={card.id} size="fill" />
                      <p className="pf-sig-note">In {card.games} {card.games === 1 ? "deck" : "decks"} played</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="pf-empty">{signedIn ? "Your most-played cards appear after a few server matches with a sealed deck." : "Sign in to track your signature cards."}</p>
              )}
            </section>
          </div>
        )}

        {profile && (
          <div className="pf-grid pf-grid-one">
            <section className="pf-panel pf-gift" data-state={profile.gifted ? "done" : profile.wins >= GIFT_WINS ? "ready" : "locked"}>
              <h3 className="pf-h">First-win gift</h3>
              {justClaimed ? (
                <p className="pf-gift-line pf-good">{giftNote}</p>
              ) : profile.gifted ? (
                <p className="pf-gift-line">Claimed. Your Founding Forge pack went to this wallet. One per profile.</p>
              ) : profile.wins >= GIFT_WINS && signedIn ? (
                <>
                  <p className="pf-gift-line">You won on a server table. A free Founding Forge pack is waiting.</p>
                  <button type="button" className="veil-btn veil-btn-spark mt-3" disabled={busy} onClick={() => void claimPack()}>
                    {busy ? "Gifting…" : "Claim your first-win pack"}
                  </button>
                </>
              ) : signedIn ? (
                <p className="pf-gift-line">Win one match on a server table (Auto start or Find a match) to unlock a free Founding Forge pack.</p>
              ) : (
                <p className="pf-gift-line">Sign in, then win one server match to unlock a free Founding Forge pack.</p>
              )}
              {giftNote && !justClaimed && <p className="mt-2 text-sm text-bone">{giftNote}</p>}
              {sheet && sheet.giftCards.length > 0 && (
                <div className="pf-gift-cards">
                  {sheet.giftCards.map((id, i) => (
                    <img key={`${id}-${i}`} src={`/assets/veil/cards/${id}.jpg`} alt={cardOf(id).name} title={cardOf(id).name} />
                  ))}
                </div>
              )}
              {error && (
                <p className="mt-2 text-sm text-danger" role="alert">
                  {error}
                </p>
              )}
            </section>

          </div>
        )}

        {profile && (
          <section className="pf-panel" aria-label="Sealed decks">
            <div className="pf-h-row">
              <h3 className="pf-h">Sealed decks</h3>
              <p className="text-xs text-ash">{decks ? `${decks.decks.length}/${decks.max}` : ""}</p>
            </div>
            {decks && decks.decks.length > 0 ? (
              <div className="dl-grid mt-3">
                {decks.decks.map((item) => (
                  <DeckTile key={item.id} deck={item} busy={busy} onActivate={() => void activateDeck(item.id)} />
                ))}
              </div>
            ) : profile.deck.length ? (
              <div className="dl-grid mt-3">
                <DeckTile deck={{ id: "mirror", name: profile.deckName ?? "", cards: profile.deck, seal: deckFaction ?? "veil", active: true, createdAt: null, record: { games: 0, wins: 0 } }} />
              </div>
            ) : (
              <p className="pf-empty">{signedIn ? "No deck sealed yet. Build one in the forge; you can keep several and pick which one plays." : "Sign in to see your sealed decks."}</p>
            )}
            <button type="button" className="veil-btn veil-btn-primary mt-3" onClick={onDeck}>
              Open the forge
            </button>
          </section>
        )}

        <section className="pf-panel">
          <div className="pf-h-row">
            <h3 className="pf-h">On-chain collection</h3>
            {ownedState === "ready" && owned.length > 0 && (
              <p className="text-xs text-ash">
                {collection.unique} unique · {collection.total} copies
              </p>
            )}
          </div>
          {ownedState === "ready" && owned.length > 0 && (
            <div className="pf-rarity">
              {collection.byRarity.map((row) => (
                <div key={row.label} className="pf-rarity-row" data-gem={row.gem}>
                  <span className="pf-rarity-gem" aria-hidden />
                  <span className="pf-rarity-label">{row.label}</span>
                  <span className="pf-rarity-bar" aria-hidden>
                    <span style={{ width: `${(row.unique / Math.max(1, collection.unique)) * 100}%` }} />
                  </span>
                  <span className="pf-rarity-num">{row.unique}</span>
                </div>
              ))}
              <div className="pf-sealmix">
                {collection.bySeal.map((row) => (
                  <span key={row.faction} style={{ flexGrow: row.unique, background: `var(--color-${row.faction})` }} title={`${sealName(row.faction)}: ${row.unique} unique`} />
                ))}
              </div>
            </div>
          )}
          <div className="pf-cards">
            {shownOwned.map((card) => (
              <div key={card.id} className="pf-owned">
                <CardFace defId={card.id} size="fill" />
                {card.balance > 1 && <span className="pf-owned-count">×{card.balance}</span>}
              </div>
            ))}
          </div>
          {ownedState === "loading" && <p className="pf-empty">Reading your cards from Polygon…</p>}
          {ownedState === "failed" && <p className="pf-empty">Polygon did not answer. Your cards are safe; try again in a moment.</p>}
          {ownedState === "ready" && owned.length === 0 && <p className="pf-empty">No Seal Forge card NFTs on this wallet yet.</p>}
          {sortedOwned.length > 12 && (
            <button type="button" className="veil-btn mt-3" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show fewer" : `Show all ${sortedOwned.length}`}
            </button>
          )}
        </section>

        {profile && (
          <section className="pf-panel">
            <button type="button" className="pf-h-row pf-toggle" aria-expanded={customize} onClick={() => setCustomize((v) => !v)}>
              <h3 className="pf-h">Customize</h3>
              <span className="text-xs text-ash">{customize ? "Hide" : "Name, portrait, NFT"}</span>
            </button>
            {customize && (
              <div className="mt-3 grid gap-4">
                <div>
                  <label className="block text-xs text-ash" htmlFor="duelist-name">
                    Name
                  </label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <input id="duelist-name" className="veil-field max-w-xs" value={name} onChange={(event) => setName(event.target.value)} />
                    <button type="button" className="veil-btn veil-btn-primary" disabled={busy} onClick={() => void save({})}>
                      Save name
                    </button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-ash">Portrait · twenty faces from the card set. An NFT you hold on Polygon can replace them.</p>
                  <div className="mt-2 grid grid-cols-5 gap-2 sm:grid-cols-10">
                    {PORTRAITS.map((id) => (
                      <button key={id} type="button" className={profile.portrait === id && !profile.nftImage ? "pf-portrait pf-portrait-on" : "pf-portrait"} aria-label={CARDS.find((card) => card.id === id)?.name ?? id} aria-pressed={profile.portrait === id && !profile.nftImage} onClick={() => void save({ portrait: id })}>
                        <img src={`/assets/veil/cards/${id}.jpg`} alt="" className="aspect-[5/7] w-full rounded-md object-cover" />
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
                    <input className="veil-field font-mono" placeholder="NFT contract" value={nftContract} onChange={(event) => setNftContract(event.target.value)} />
                    <input className="veil-field font-mono" placeholder="Token id" inputMode="numeric" value={nftToken} onChange={(event) => setNftToken(event.target.value)} />
                    <button type="button" className="veil-btn" disabled={busy} onClick={() => void save({ nft: { contract: nftContract.trim(), tokenId: nftToken.trim() } })}>
                      Use NFT
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        <section className="pf-panel">
          <h3 className="pf-h">Leaderboard</h3>
          <ol className="pf-board">
            {board.map((row, index) => (
              <li key={row.address} className="pf-board-row" data-me={address && row.address.toLowerCase() === address.toLowerCase() ? "1" : undefined} data-top={index < 3 ? index + 1 : undefined}>
                <span className="pf-board-pos">{index + 1}</span>
                <img src={face(row)} alt="" className="pf-board-face" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.name}</span>
                  <span className="block text-xs text-ash">
                    {row.rank} · {row.wins}–{row.losses}
                  </span>
                </span>
                <span className="font-mono text-sm text-brass">{row.xp} XP</span>
              </li>
            ))}
            {board.length === 0 && <li className="text-sm text-ash">No ranked accounts yet.</li>}
          </ol>
        </section>
        {error && !profile && <p className="text-sm text-danger">{error}</p>}
      </main>
    </div>
  );
}

const SEAL_ART: Record<Faction, string> = {
  elf: "/assets/veil/seals/aureth.jpg",
  human: "/assets/veil/seals/veymar.jpg",
  goblin: "/assets/veil/seals/rixen.jpg",
  robot: "/assets/veil/seals/quorin.jpg",
  demon: "/assets/veil/seals/malrec.jpg",
  veil: "/assets/veil/seals/unbound.jpg",
};

const RARITY_ORDER: Record<string, number> = { legendary: 0, epic: 1, rare: 2, common: 3 };

function sealName(faction: string): string {
  return FACTIONS.find((f) => f.id === faction)?.name ?? "Unbound";
}

function sheetHint(state: "idle" | "loading" | "ready" | "failed", signedIn: boolean): string {
  if (!signedIn) return "Sign in to track";
  if (state === "loading") return "Reading ledger…";
  if (state === "failed") return "Stats did not load";
  return "";
}

function rewardSub(sheet: StatSheet | null, state: "idle" | "loading" | "ready" | "failed", signedIn: boolean): string {
  if (!sheet) return sheetHint(state, signedIn);
  const { signed, paid } = sheet.rewards;
  if (paid === null) return signed ? `${signed} win vouchers · Polygon did not answer` : "No win vouchers yet";
  if (!signed) return "Win server matches to earn 0.25 BzB each";
  return `${paid} of ${signed} win vouchers claimed`;
}

function summarizeOwned(owned: Owned[]) {
  let total = 0;
  const rarity = new Map<string, { label: string; gem: string; unique: number; order: number }>();
  const seals = new Map<string, number>();
  for (const item of owned) {
    total += item.balance;
    const card = cardOf(item.id);
    const label = rarityName(card);
    const gem = gemTier(card);
    const row = rarity.get(label) ?? { label, gem, unique: 0, order: RARITY_ORDER[gem] ?? 9 };
    row.unique += 1;
    rarity.set(label, row);
    seals.set(card.faction, (seals.get(card.faction) ?? 0) + 1);
  }
  return {
    unique: owned.length,
    total,
    byRarity: [...rarity.values()].sort((a, b) => a.order - b.order || b.unique - a.unique),
    bySeal: FACTIONS.filter((f) => seals.has(f.id)).map((f) => ({ faction: f.id, unique: seals.get(f.id) ?? 0 })),
  };
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(value)) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const ms = 900;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + (value - origin) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <span className="pf-num">{shown.toFixed(decimals)}</span>;
}

function Plate({ label, sub, accent, children }: { label: string; sub: string; accent?: boolean; children: ReactNode }) {
  return (
    <div className={accent ? "pf-plate pf-plate-accent" : "pf-plate"}>
      <p className="pf-plate-label">{label}</p>
      <p className="pf-plate-value">{children}</p>
      <p className="pf-plate-sub">{sub || "\u00a0"}</p>
    </div>
  );
}

function WalletChip({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  return (
    <button
      type="button"
      className="pf-wallet"
      title={address}
      aria-label={`Copy wallet address ${address}`}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(address)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          })
          .catch(() => undefined);
      }}
    >
      <span className="pf-wallet-dot" aria-hidden />
      <span className="font-mono">{short}</span>
      <span className="pf-wallet-copy">{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function Motto({
  motto,
  draft,
  setDraft,
  editing,
  setEditing,
  canEdit,
  busy,
  onSave,
}: {
  motto: string;
  draft: string;
  setDraft: (v: string) => void;
  editing: boolean;
  setEditing: (v: boolean) => void;
  canEdit: boolean;
  busy: boolean;
  onSave: () => void | Promise<void>;
}) {
  const left = MOTTO_MAX - [...draft].length;
  if (editing && canEdit) {
    return (
      <form
        className="pf-motto-edit"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave();
        }}
      >
        <label htmlFor="duelist-motto" className="sr-only">
          Motto
        </label>
        <input id="duelist-motto" className="veil-field" value={draft} maxLength={MOTTO_MAX} placeholder="A line for your banner" autoFocus onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setEditing(false)} />
        <span className={left < 10 ? "pf-motto-left pf-bad" : "pf-motto-left"}>{left}</span>
        <button type="submit" className="veil-btn veil-btn-primary" disabled={busy || left < 0}>
          Save
        </button>
        <button
          type="button"
          className="veil-btn"
          onClick={() => {
            setDraft(motto);
            setEditing(false);
          }}
        >
          Cancel
        </button>
      </form>
    );
  }
  return (
    <div className="pf-motto">
      {motto ? <q>{motto}</q> : <span className="pf-motto-empty">{canEdit ? "No motto yet." : ""}</span>}
      {canEdit && (
        <button type="button" className="pf-motto-btn" onClick={() => setEditing(true)} aria-label={motto ? "Edit motto" : "Add a motto"}>
          {motto ? "Edit" : "Add motto"}
        </button>
      )}
    </div>
  );
}
