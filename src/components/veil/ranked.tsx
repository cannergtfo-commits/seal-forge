import { useEffect, useState } from "react";
import { Table, type TableAct } from "@/components/veil/table";
import { SEALS, type Faction } from "@/veil/cards";
import { playerClient, sentBy, usePlayer } from "@/veil/connect";
import { armArenaMusic } from "@/veil/arena-music";
import { redactKey } from "@/veil/keys";
import { deckSeal } from "@/veil/ranks";
import type { Bot } from "@/veil/bots";
import type { Match, Unit } from "@/veil/logic";
import { readSession } from "@/veil/session";
import { REWARDS, WIN_WEI } from "@/veil/deployed";

type UnitView = {
  uid: string;
  defId: string;
  hp: number;
  maxHp?: number;
  atk: number;
  owner: 0 | 1;
  sick?: boolean;
  ready?: boolean;
  frozen?: boolean;
  swing?: number;
};
type HandView = { uid: string; defId: string };
type SeatView = {
  name: string;
  faction: Faction;
  hp: number;
  ward?: number;
  mana: number;
  manaMax: number;
  deck: number;
  grave?: string[];
  hand: HandView[];
  handCount: number;
  units: UnitView[];
  traps?: Array<{ uid: string; defId: string }>;
};
type View = {
  you: 0 | 1;
  turn: 0 | 1;
  phase: "main" | "trap" | "defend" | "over";
  turnCount: number;
  winner: 0 | 1 | null;
  log: string[];
  attackers: string[];
  attacked?: boolean;
  seq?: number;
  leftMs?: number;
  seats: [SeatView, SeatView];
};

type Claim = { matchId: `0x${string}`; player: `0x${string}`; signature: `0x${string}` };

const rewardsAbi = [
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [
      { name: "matchId", type: "bytes32" },
      { name: "sig", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

function seatId(): string {
  const key = "veilforge-seat";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const next = `p${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem(key, next);
  return next;
}

function flip(side: 0 | 1, you: 0 | 1): 0 | 1 {
  return you === 0 ? side : side === 0 ? 1 : 0;
}

function orientLog(line: string, you: 0 | 1): string {
  if (you === 0) return line;
  return line
    .replaceAll("You win.", "§WIN")
    .replaceAll("You lose.", "You win.")
    .replaceAll("§WIN", "You lose.")
    .replaceAll("Your", "§YOUR")
    .replaceAll("Rival", "Your")
    .replaceAll("§YOUR", "Rival")
    .replaceAll("The rival", "§TR")
    .replaceAll("the rival", "§tr")
    .replaceAll("You ", "The rival ")
    .replace(/\byou\b/g, "the rival")
    .replaceAll("§TR", "You")
    .replaceAll("§tr", "you");
}

function sameBoard(a: View, b: View): boolean {
  return (
    a.you === b.you &&
    a.turn === b.turn &&
    a.phase === b.phase &&
    a.turnCount === b.turnCount &&
    a.winner === b.winner &&
    a.attacked === b.attacked &&
    a.seq === b.seq &&
    (a.log ?? []).join("\n") === (b.log ?? []).join("\n") &&
    (a.attackers ?? []).join("|") === (b.attackers ?? []).join("|") &&
    JSON.stringify(a.seats) === JSON.stringify(b.seats)
  );
}

function viewAsMatch(view: View): Match {
  const seat = (raw: SeatView, owner: 0 | 1) => ({
    hp: raw.hp,
    ward: raw.ward ?? 0,
    mana: raw.mana,
    manaMax: raw.manaMax,
    deck: Array.from({ length: raw.deck }, () => ""),
    hand: raw.hand.length > 0 ? raw.hand : Array.from({ length: raw.handCount }, (_, index) => ({ uid: `back-${owner}-${index}`, defId: "moonpetal" })),
    grave: raw.grave ?? [],
    units: raw.units.map(
      (unit): Unit => ({
        uid: unit.uid,
        defId: unit.defId,
        owner: flip(unit.owner, view.you),
        atk: unit.atk,
        hp: unit.hp,
        maxHp: unit.maxHp ?? unit.hp,
        sick: Boolean(unit.sick),
        ready: unit.ready !== false,
        frozen: Boolean(unit.frozen),
        swing: unit.swing ?? 0,
      }),
    ),
    traps: (raw.traps ?? []).map((trap) => ({ uid: trap.uid, defId: trap.defId || "glade", owner })),
  });
  return {
    players: [seat(view.seats[view.you], 0), seat(view.seats[view.you === 0 ? 1 : 0], 1)],
    turn: flip(view.turn, view.you),
    turnCount: view.turnCount,
    phase: view.phase,
    winner: view.winner === null ? null : flip(view.winner, view.you),
    log: (view.log ?? []).map((line) => orientLog(line, view.you)),
    attackers: view.attackers ?? [],
    attacked: Boolean(view.attacked),
    seed: 1,
    seq: view.seq ?? view.turnCount,
  };
}

export function Ranked({ onBack }: { onBack: () => void }) {
  const { key, address: player } = usePlayer();
  const address = player ?? "";
  const [faction, setFaction] = useState<Faction>("elf");
  const [id, setId] = useState("");
  const [waitMs, setWaitMs] = useState<number | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [reward, setReward] = useState("none");
  const [busy, setBusy] = useState(false);
  const [useSealed, setUseSealed] = useState(false);
  const [sealed, setSealed] = useState<{ ids: string[]; seal: Exclude<Faction, "veil">; name: string } | null>(null);

  useEffect(() => {
    const session = readSession();
    if (!session || !address || session.address.toLowerCase() !== address.toLowerCase()) {
      setSealed(null);
      setUseSealed(false);
      return;
    }
    let cancel = false;
    void fetch(`/api/veilforge/profile?token=${encodeURIComponent(session.token)}`)
      .then((res) => res.json())
      .then((data: { profile?: { deck: string[]; deckName?: string } }) => {
        if (cancel) return;
        const ids = data.profile?.deck ?? [];
        const found = ids.length === 20 ? deckSeal(ids) : null;
        if (found?.ok) setSealed({ ids, seal: found.seal, name: data.profile?.deckName ?? "" });
        else {
          setSealed(null);
          setUseSealed(false);
        }
      })
      .catch(() => {
        if (!cancel) setSealed(null);
      });
    return () => {
      cancel = true;
    };
  }, [address]);

  useEffect(() => {
    if (!id) return;
    const timer = window.setInterval(() => {
      void fetch(`/api/veilforge/queue?id=${id}`)
        .then((res) => res.json())
        .then((data: { status?: string; waitMs?: number; view?: View | null; claim?: Claim | null; reward?: string; error?: string }) => {
          if (data.view) setView((prev) => (prev && sameBoard(prev, data.view!) ? prev : data.view!));
          if (typeof data.waitMs === "number") setWaitMs((prev) => (prev === data.waitMs ? prev : data.waitMs!));
          if (data.claim) setClaim((prev) => (prev && prev.matchId === data.claim!.matchId && prev.signature === data.claim!.signature ? prev : data.claim!));
          if (data.reward) setReward((prev) => (prev === data.reward ? prev : data.reward!));
        })
        .catch(() => setError("The queue did not answer."));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [id]);

  async function join(now = false) {
    armArenaMusic();
    const seat = seatId();
    setBusy(true);
    setError(null);
    try {
      const session = readSession();
      let name = address ? address.slice(0, 6) : "Duelist";
      let deck: string[] | null = null;
      if (session && address && session.address.toLowerCase() === address.toLowerCase()) {
        const profileRes = await fetch(`/api/veilforge/profile?token=${encodeURIComponent(session.token)}`);
        const profileBody = (await profileRes.json()) as { profile?: { name: string; deck: string[] } };
        if (profileBody.profile) {
          name = profileBody.profile.name;
          const ids = profileBody.profile.deck;
          const found = ids.length === 20 ? deckSeal(ids) : null;
          if (useSealed && found?.ok && found.seal === faction) deck = ids;
        }
      }
      const res = await fetch("/api/veilforge/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "join", id: seat, name, faction, address, deck }),
      });
      const data = (await res.json()) as { view?: View | null; waitMs?: number; error?: string; deck?: string };
      if (data.error) setError(data.error);
      else if (data.deck === "needs-nfts") setError("That deck includes cards this wallet does not hold, so the starter deck was used.");
      else if (data.deck === "wrong-seal") setError("That deck is not this seal. Unbound cards can join any seal, so the starter deck was used.");
      setId(seat);
      setWaitMs(data.waitMs ?? 20000);
      if (data.view) setView(data.view);
      else if (now && !data.error) {
        const botRes = await fetch("/api/veilforge/queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "bot", id: seat }),
        });
        const botData = (await botRes.json()) as { view?: View | null; error?: string };
        if (botData.error) setError(botData.error);
        else if (botData.view) setView(botData.view);
      }
    } catch {
      setError("Could not join the queue.");
    } finally {
      setBusy(false);
    }
  }

  async function send(action: unknown) {
    if (!id) return;
    setError(null);
    const res = await fetch("/api/veilforge/queue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "act", id, action }),
    });
    const data = (await res.json()) as { view?: View | null; error?: string; claim?: Claim | null; reward?: string };
    if (data.error) setError(data.error);
    if (data.view) setView(data.view);
    if (data.claim) setClaim(data.claim);
    if (data.reward) setReward(data.reward);
  }

  async function takeReward() {
    if (!claim || (!key && !address)) return;
    setBusy(true);
    setError(null);
    try {
      const { address: signer, wallet } = await playerClient(key);
      const hash = await wallet.writeContract({ address: REWARDS, abi: rewardsAbi, functionName: "claim", args: [claim.matchId, claim.signature] });
      await sentBy(hash, signer);
      setClaim(null);
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "The reward did not send.", key));
    } finally {
      setBusy(false);
    }
  }

  const you = view?.seats[view.you];
  const them = view ? view.seats[view.you === 0 ? 1 : 0] : null;
  const ghost: Bot | null = them
    ? { id: "seat", name: them.name, faction: them.faction, style: "guard", line: "" }
    : null;

  if (view && you && them && ghost) {
    return (
      <Table
        match={viewAsMatch(view)}
        setMatch={() => undefined}
        you={you.faction}
        rival={them.faction}
        bot={ghost}
        link={{ send: (action: TableAct) => void send(action), leftMs: view.leftMs ?? (view.phase === "trap" || view.phase === "defend" ? 6_000 : 60_000), you: view.you, fault: error }}
        onHall={onBack}
        onRematch={() => {
          setView(null);
          setId("");
          setClaim(null);
        }}
        winnerExtra={
          <div className="mt-3">
            <p className="text-sm text-ash">Signed-in accounts gain 20 XP for a win and lose 10 XP for a loss.</p>
            {view.winner === view.you && claim && (
              <button type="button" className="veil-btn veil-btn-primary mt-3" disabled={busy} onClick={() => void takeReward()}>
                Claim 0.25 BzB
              </button>
            )}
            {view.winner === view.you && reward === "needs-card" && (
              <p className="mt-2 text-sm text-ash">No BzB. Rewards go only to wallets that hold a Seal Forge card NFT.</p>
            )}
            {view.winner === view.you && !claim && reward !== "needs-card" && (
              <p className="mt-2 text-sm text-ash">No payout. The daily cap is four, or the wallet was not connected. XP still applies if you are signed in.</p>
            )}
          </div>
        }
      />
    );
  }

  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" className="veil-btn" onClick={onBack}>
            Back
          </button>
          <div>
            <p className="text-xs tracking-widest text-brass">MATCHMAKING</p>
            <h1 className="text-lg font-medium leading-tight">Find a match</h1>
          </div>
        </div>
        <p className="font-mono text-xs text-ash">0.25 BzB · 4 a day</p>
      </header>
      <main className="mx-auto grid max-w-5xl gap-4 px-4 pb-10">
        <section className="rounded-md border border-brass bg-panel p-4">
          <p className="text-sm leading-relaxed text-ash">
            Wait for another player. Signed-in accounts gain 20 XP for a win and lose 10 XP for a loss. 0.25 BzB is paid only if this wallet holds a Seal Forge card NFT.
          </p>
          {!address && <p className="mt-2 text-sm text-bone">Connect a wallet if you want the BzB. You can still play.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {SEALS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={faction === item.id ? "veil-btn veil-btn-primary" : "veil-btn"}
                disabled={Boolean(id)}
                onClick={() => {
                  setFaction(item.id);
                  if (!sealed || item.id !== sealed.seal) setUseSealed(false);
                }}
              >
                {item.name}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <p className="text-sm text-ash">Deck</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={!useSealed ? "veil-btn veil-btn-primary" : "veil-btn"} disabled={Boolean(id)} onClick={() => setUseSealed(false)}>
                Starter
              </button>
              <button
                type="button"
                className={useSealed ? "veil-btn veil-btn-primary" : "veil-btn"}
                disabled={!sealed || Boolean(id)}
                onClick={() => {
                  if (!sealed) return;
                  setUseSealed(true);
                  setFaction(sealed.seal);
                }}
              >
                {sealed ? `Sealed · ${sealed.name || SEALS.find((item) => item.id === sealed.seal)?.name || "Deck"}` : "No sealed deck"}
              </button>
            </div>
            {!sealed && <p className="mt-2 text-sm text-ash">Seal a deck in the forge, then choose it here. Otherwise the starter deck plays.</p>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="veil-btn veil-btn-primary" disabled={busy || Boolean(id)} onClick={() => void join()}>
              {id ? `Waiting ${Math.ceil((waitMs ?? 0) / 1000)}s` : "Find a match"}
            </button>
            <button type="button" className="veil-btn" disabled={busy || Boolean(view)} onClick={() => void join(true)}>
              Auto start
            </button>
          </div>
        </section>
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-ash">Rewards live at {REWARDS}. A win is {WIN_WEI.toString()} wei, which is 0.25 BzB.</p>
      </main>
    </>
  );
}
