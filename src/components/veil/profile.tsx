import { useEffect, useState } from "react";
import { CARDS } from "@/veil/cards";
import { usePlayer } from "@/veil/connect";
import { openSession } from "@/veil/game-session";
import { veilBalances } from "@/veil/holds";
import { gameKeySigns } from "@/veil/signer";
import { redactKey } from "@/veil/keys";
import { PORTRAITS, deckSeal, rankFor } from "@/veil/ranks";
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
};

type Owned = { id: string; name: string; balance: number };
type BoardRow = Profile;

function face(profile: { portrait: string; nftImage: string | null }): string {
  return profile.nftImage || `/assets/veil/cards/${profile.portrait}.jpg`;
}

export function Profile({ onBack, onDeck }: { onBack: () => void; onDeck: () => void }) {
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

  useEffect(() => {
    if (!ready) return;
    const saved = readSession();
    if (saved && address && saved.address.toLowerCase() === address.toLowerCase()) setSession(saved);
    else setSession(null);
  }, [ready, address]);

  useEffect(() => {
    if (!address) return;
    void veilBalances(address)
      .then((balances) => setOwned(CARDS.map((card, index) => ({ id: card.id, name: card.name, balance: balances[index] ?? 0 })).filter((card) => card.balance > 0)))
      .catch(() => setOwned([]));
    void fetch("/api/veilforge/profile?board=1")
      .then((res) => res.json())
      .then((data: { board?: BoardRow[] }) => setBoard(data.board ?? []))
      .catch(() => setBoard([]));
  }, [address, profile]);

  useEffect(() => {
    if (!session) return;
    void fetch(`/api/veilforge/profile?token=${encodeURIComponent(session.token)}`)
      .then((res) => res.json())
      .then((data: { profile?: Profile; error?: string }) => {
        if (!data.profile) {
          clearSession();
          setSession(null);
          return;
        }
        setProfile(data.profile);
        setName(data.profile.name);
      })
      .catch(() => setError("The account did not load."));
  }, [session]);

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
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "Sign-in failed.", key));
    } finally {
      setBusy(false);
    }
  }

  async function save(extra: { portrait?: string; deck?: string[]; nft?: { contract: string; tokenId: string } | null }) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/veilforge/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "save", token: session.token, name, ...extra }),
      });
      const body = (await res.json()) as { profile?: Profile; error?: string };
      if (!body.profile) throw new Error(body.error ?? "Could not save.");
      setProfile(body.profile);
      setName(body.profile.name);
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "Could not save.", key));
    } finally {
      setBusy(false);
    }
  }

  const rank = profile ? rankFor(profile.xp) : null;

  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" className="veil-btn" onClick={onBack}>
            Back
          </button>
          <div>
            <p className="text-xs tracking-widest text-brass">ACCOUNT</p>
            <h1 className="text-lg font-medium leading-tight">{profile?.name ?? (isApk() ? "Make a wallet" : "Connect a wallet")}</h1>
          </div>
        </div>
        {profile && <p className="font-mono text-sm text-brass">{profile.rank} · {profile.xp} XP</p>}
      </header>
      <main className="mx-auto grid max-w-5xl gap-4 px-4 pb-10">
        {!address && <p className="text-sm text-ash">{isApk() ? "Make a wallet in the game. Signing in never sends a key to the server." : "Connect a wallet extension, or generate one in the game. Signing in never sends a key to the server."}</p>}
        {address && !profile && (
          <section className="rounded-md border border-brass bg-panel p-4">
            <p className="text-sm leading-relaxed text-ash">{gameKeySigns(key) ? `Sign in with the game wallet ${address}. The key stays on this device and signs the login here.` : `Connect ${address} by signing a login message. That creates the account and lets you edit a profile, build a deck, and earn rank.`}</p>
            <button type="button" className="veil-btn veil-btn-primary mt-3" disabled={busy} onClick={() => void signIn()}>
              {busy ? "Signing…" : "Sign in with wallet"}
            </button>
          </section>
        )}
        {profile && (
          <section className="grid gap-4 rounded-md border border-line bg-panel p-4 sm:grid-cols-[8rem_1fr]">
            <img src={face(profile)} alt="" className="aspect-[5/7] w-full rounded-md object-cover" />
            <div>
              <p className="font-mono text-xs text-ash">{profile.address}</p>
              <p className="mt-1 text-sm text-bone">
                {profile.wins} wins · {profile.losses} losses
                {rank?.next ? ` · ${rank.next - profile.xp} XP to the next rank` : ""}
              </p>
              <label className="mt-3 block text-xs text-ash" htmlFor="duelist-name">
                Name
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                <input id="duelist-name" className="veil-field max-w-xs" value={name} onChange={(event) => setName(event.target.value)} />
                <button type="button" className="veil-btn veil-btn-primary" disabled={busy} onClick={() => void save({})}>
                  Save name
                </button>
              </div>
            </div>
          </section>
        )}
        {profile && (
          <section>
            <h2 className="text-lg font-medium">Portraits</h2>
            <p className="mt-1 text-sm text-ash">Twenty faces from the card set. An NFT you hold on Polygon can replace them.</p>
            <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
              {PORTRAITS.map((id) => (
                <button key={id} type="button" className={profile.portrait === id && !profile.nftImage ? "rounded-md ring-2 ring-brass" : "rounded-md"} aria-label={CARDS.find((card) => card.id === id)?.name ?? id} aria-pressed={profile.portrait === id && !profile.nftImage} onClick={() => void save({ portrait: id })}>
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
          </section>
        )}
        <section>
          <h2 className="text-lg font-medium">On-chain collection</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {owned.map((card) => (
              <div key={card.id} className="rounded-md border border-line p-2">
                <img src={`/assets/veil/cards/${card.id}.jpg`} alt="" className="aspect-[5/7] w-full rounded-md object-cover" />
                <p className="mt-1 text-sm leading-tight">{card.name}</p>
                <p className="font-mono text-xs text-brass">×{card.balance}</p>
              </div>
            ))}
            {owned.length === 0 && <p className="text-sm text-ash">No Seal Forge card NFTs on this wallet yet.</p>}
          </div>
        </section>
        {profile && (
          <section className="rounded-md border border-line bg-panel p-4">
            <h2 className="text-lg font-medium">{profile.deckName ? profile.deckName : "Deck"} · {profile.deck.length}/20</h2>
            <p className="mt-1 text-sm text-ash">
              {(() => {
                const sealed = deckSeal(profile.deck);
                return sealed.ok ? "Sealed for ranked play." : "Not a finished deck yet.";
              })()}
            </p>
            <button type="button" className="veil-btn veil-btn-primary mt-3" onClick={onDeck}>
              Open the forge
            </button>
          </section>
        )}
        <section>
          <h2 className="text-lg font-medium">Leaderboard</h2>
          <ol className="mt-3 grid gap-2">
            {board.map((row, index) => (
              <li key={row.address} className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
                <span className="w-6 font-mono text-sm text-ash">{index + 1}</span>
                <img src={face(row)} alt="" className="h-10 w-8 rounded-sm object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.name}</span>
                  <span className="block text-xs text-ash">{row.rank} · {row.wins}–{row.losses}</span>
                </span>
                <span className="font-mono text-sm text-brass">{row.xp} XP</span>
              </li>
            ))}
            {board.length === 0 && <li className="text-sm text-ash">No ranked accounts yet.</li>}
          </ol>
        </section>
        {error && <p className="text-sm text-danger">{error}</p>}
      </main>
    </>
  );
}
