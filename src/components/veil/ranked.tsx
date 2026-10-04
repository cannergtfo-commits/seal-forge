import { useEffect, useRef, useState } from "react";
import { Table, type TableAct } from "@/components/veil/table";
import { SEALS, type Faction } from "@/veil/cards";
import { playerClient, sentBy, usePlayer } from "@/veil/connect";
import { hostFriend, joinFriend } from "@/veil/friend-wire";
import { sendGame } from "@/veil/signer";
import { armArenaMusic } from "@/veil/arena-music";
import { redactKey } from "@/veil/keys";
import { deckSeal } from "@/veil/ranks";
import type { Bot } from "@/veil/bots";
import type { Match, Unit } from "@/veil/logic";
import { readSession } from "@/veil/session";
import { isApk } from "@/veil/shell";
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
type LobbyRow = { code: string; name: string; faction: Faction };

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
  const [hostCode, setHostCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [tables, setTables] = useState<LobbyRow[]>([]);
  const [friendCode, setFriendCode] = useState("");
  const [hostingFriend, setHostingFriend] = useState("");
  const [friend, setFriend] = useState<{
    match: Match;
    leftMs: number;
    you: Faction;
    rivalName: string;
    rivalFaction: Faction;
  } | null>(null);
  const friendWire = useRef<{ send: (action: TableAct) => void; close: () => void } | null>(null);
  const friendGen = useRef(0);

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
        .then((data: { status?: string; waitMs?: number; view?: View | null; claim?: Claim | null; reward?: string; code?: string; error?: string }) => {
          if (data.view) setView((prev) => (prev && sameBoard(prev, data.view!) ? prev : data.view!));
          if (typeof data.waitMs === "number") setWaitMs((prev) => (prev === data.waitMs ? prev : data.waitMs!));
          if (data.status === "lobby" && data.code) setHostCode((prev) => (prev === data.code ? prev : data.code!));
          if (data.claim) setClaim((prev) => (prev && prev.matchId === data.claim!.matchId && prev.signature === data.claim!.signature ? prev : data.claim!));
          if (data.reward) setReward((prev) => (prev === data.reward ? prev : data.reward!));
        })
        .catch(() => setError("The queue did not answer."));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [id]);

  useEffect(() => {
    if (view) return;
    let cancel = false;
    const pull = () => {
      void fetch("/api/veilforge/queue?list=1")
        .then((res) => res.json())
        .then((data: { lobbies?: LobbyRow[] }) => {
          if (!cancel) setTables(data.lobbies ?? []);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 2000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [view]);

  async function seatBody(): Promise<{ id: string; name: string; faction: Faction; address: string; deck: string[] | null }> {
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
    return { id: seatId(), name, faction, address, deck };
  }

  function noteDeck(deck?: string) {
    if (deck === "needs-nfts") setError("That deck includes cards this wallet does not hold, so the starter deck was used.");
    else if (deck === "wrong-seal") setError("That deck is not this seal. Unbound cards can join any seal, so the starter deck was used.");
  }

  async function join(now = false) {
    armArenaMusic();
    setBusy(true);
    setError(null);
    try {
      const body = await seatBody();
      const res = await fetch("/api/veilforge/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "join", ...body }),
      });
      const data = (await res.json()) as { view?: View | null; waitMs?: number; error?: string; deck?: string };
      if (data.error) setError(data.error);
      else noteDeck(data.deck);
      setHostCode("");
      setId(body.id);
      setWaitMs(data.waitMs ?? 20000);
      if (data.view) setView(data.view);
      else if (now && !data.error) {
        const botRes = await fetch("/api/veilforge/queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "bot", id: body.id }),
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

  async function host() {
    armArenaMusic();
    setBusy(true);
    setError(null);
    try {
      const body = await seatBody();
      const res = await fetch("/api/veilforge/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "host", ...body }),
      });
      const data = (await res.json()) as { view?: View | null; code?: string | null; error?: string; deck?: string };
      if (data.error) setError(data.error);
      else {
        noteDeck(data.deck);
        setId(body.id);
        if (data.code) setHostCode(data.code);
        if (data.view) setView(data.view);
      }
    } catch {
      setError("Could not open a table.");
    } finally {
      setBusy(false);
    }
  }

  async function enter(code: string) {
    const next = code.trim().toUpperCase();
    if (!next) return;
    armArenaMusic();
    setBusy(true);
    setError(null);
    try {
      const body = await seatBody();
      const res = await fetch("/api/veilforge/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "enter", ...body, code: next }),
      });
      const data = (await res.json()) as { view?: View | null; error?: string; deck?: string };
      if (data.error) setError(data.error);
      else {
        noteDeck(data.deck);
        setHostCode("");
        setId(body.id);
        if (data.view) setView(data.view);
      }
    } catch {
      setError("Could not sit at that table.");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (id) {
      await fetch("/api/veilforge/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "leave", id }),
      }).catch(() => undefined);
    }
    setId("");
    setHostCode("");
    setWaitMs(null);
  }

  function closeFriend() {
    friendGen.current += 1;
    friendWire.current?.close();
    friendWire.current = null;
    setFriend(null);
    setHostingFriend("");
  }

  function freshFriendCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let index = 0; index < 4; index++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }

  async function shareCode(code: string) {
    const text = `Seal Forge table ${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Seal Forge", text });
        return;
      }
    } catch {
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setError("Code copied.");
    } catch {
      setError("Read the code to your rival.");
    }
  }

  async function openFriend(role: "host" | "guest", code: string) {
    const next = code.trim().toUpperCase();
    if (next.length < 4) return;
    armArenaMusic();
    setBusy(true);
    setError(null);
    closeFriend();
    const mine = friendGen.current;
    try {
      const body = await seatBody();
      const hooks = {
        onFrame: (frame: { match: Match; leftMs: number; rivalName: string; rivalFaction: Faction }) => {
          if (friendGen.current !== mine) return;
          setFriend({ match: frame.match, leftMs: frame.leftMs, you: body.faction, rivalName: frame.rivalName, rivalFaction: frame.rivalFaction });
          setError(null);
        },
        onStatus: (text: string) => {
          if (friendGen.current !== mine) return;
          if (text === "Waiting for a rival." || text === "Sitting down.") return;
          setError(text);
          if (text.includes("already in use") || text.includes("No table") || text.includes("failed") || text.includes("dropped")) {
            friendGen.current += 1;
            friendWire.current?.close();
            friendWire.current = null;
            setHostingFriend("");
          }
        },
        onClose: () => {
          if (friendGen.current !== mine) return;
          setFriend(null);
          setHostingFriend("");
          setError("The rival left the table.");
        },
      };
      const wire = role === "host"
        ? hostFriend(next, { name: body.name, faction: body.faction, deck: body.deck }, hooks)
        : joinFriend(next, { name: body.name, faction: body.faction, deck: body.deck }, hooks);
      friendWire.current = wire;
      if (role === "host") setHostingFriend(next);
    } catch {
      setError("Could not open that table.");
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
      const hash = await sendGame(key, signer, (nonce) => wallet.writeContract({ address: REWARDS, abi: rewardsAbi, functionName: "claim", args: [claim.matchId, claim.signature], nonce }));
      await sentBy(hash, signer);
      setClaim(null);
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "The reward did not send.", key));
    } finally {
      setBusy(false);
    }
  }

  if (friend) {
    const ghost: Bot = { id: "friend", name: friend.rivalName, faction: friend.rivalFaction, style: "guard", line: "" };
    return (
      <Table
        match={friend.match}
        setMatch={() => undefined}
        you={friend.you}
        rival={friend.rivalFaction}
        bot={ghost}
        link={{ send: (action) => friendWire.current?.send(action), leftMs: friend.leftMs, you: 0, fault: error }}
        onHall={closeFriend}
      />
    );
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
          setHostCode("");
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
          {!address && <p className="mt-2 text-sm text-bone">{isApk() ? "Make a wallet in the game if you want the BzB. You can still play." : "Connect a wallet if you want the BzB. You can still play."}</p>}
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
              {id && !hostCode ? `Waiting ${Math.ceil((waitMs ?? 0) / 1000)}s` : "Find a match"}
            </button>
            <button type="button" className="veil-btn" disabled={busy || Boolean(view) || Boolean(hostCode)} onClick={() => void join(true)}>
              Auto start
            </button>
            {id && !view && (
              <button type="button" className="veil-btn" disabled={busy} onClick={() => void leave()}>
                Leave
              </button>
            )}
          </div>
        </section>
        <section className="rounded-md border border-brass bg-panel p-4">
          <h2 className="text-sm tracking-widest text-brass">A FRIEND</h2>
          <p className="mt-2 text-sm leading-relaxed text-ash">Host a code and send it to someone on another phone. They sit with that code. The duel runs between your two devices.</p>
          {hostingFriend ? (
            <>
              <p className="friend-code">{hostingFriend}</p>
              <p className="mt-2 text-sm text-ash">Waiting for them to sit.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="veil-btn veil-btn-primary" onClick={() => void shareCode(hostingFriend)}>
                  Share code
                </button>
                <button type="button" className="veil-btn" onClick={closeFriend}>
                  Leave
                </button>
              </div>
            </>
          ) : (
            <>
              <button type="button" className="veil-btn veil-btn-primary mt-3" disabled={busy || Boolean(id)} onClick={() => void openFriend("host", freshFriendCode())}>
                Host for a friend
              </button>
              <form
                className="mt-3 flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void openFriend("guest", friendCode);
                }}
              >
                <input
                  className="veil-field deck-name font-mono uppercase"
                  value={friendCode}
                  maxLength={4}
                  placeholder="Code"
                  aria-label="Friend table code"
                  disabled={Boolean(id)}
                  onChange={(event) => setFriendCode(event.target.value.toUpperCase())}
                />
                <button type="submit" className="veil-btn" disabled={busy || Boolean(id) || friendCode.trim().length < 4}>
                  Sit with a friend
                </button>
              </form>
            </>
          )}
        </section>
        <section className="rounded-md border border-line bg-panel p-4">
          <h2 className="text-sm tracking-widest text-brass">TABLES</h2>
          <p className="mt-2 text-sm leading-relaxed text-ash">Host a table and share the code, or sit at one that is already open. A bot does not take the other seat.</p>
          {hostCode ? (
            <p className="mt-3 font-mono text-2xl tracking-[0.35em] text-brass">{hostCode}</p>
          ) : (
            <button type="button" className="veil-btn veil-btn-primary mt-3" disabled={busy || Boolean(id)} onClick={() => void host()}>
              Host a table
            </button>
          )}
          {hostCode && <p className="mt-2 text-sm text-ash">Waiting for a rival.</p>}
          <div className="mt-4 grid gap-2">
            {tables.filter((table) => table.code !== hostCode).map((table) => (
              <div key={table.code} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                <p className="text-sm">
                  {table.name} · {SEALS.find((item) => item.id === table.faction)?.name ?? table.faction}
                  <span className="ml-2 font-mono text-brass">{table.code}</span>
                </p>
                <button type="button" className="veil-btn" disabled={busy || Boolean(id)} onClick={() => void enter(table.code)}>
                  Sit
                </button>
              </div>
            ))}
            {tables.filter((table) => table.code !== hostCode).length === 0 && <p className="text-sm text-ash">No open tables.</p>}
          </div>
          <form
            className="mt-4 flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void enter(joinCode);
            }}
          >
            <input
              className="veil-field deck-name font-mono uppercase"
              value={joinCode}
              maxLength={4}
              placeholder="Code"
              aria-label="Table code"
              disabled={Boolean(id)}
              onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
            />
            <button type="submit" className="veil-btn" disabled={busy || Boolean(id) || joinCode.trim().length < 4}>
              Sit
            </button>
          </form>
        </section>
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-ash">Rewards live at {REWARDS}. A win is {WIN_WEI.toString()} wei, which is 0.25 BzB.</p>
      </main>
    </>
  );
}
