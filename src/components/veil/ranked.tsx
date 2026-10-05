import { useEffect, useRef, useState } from "react";
import { Table, type TableAct } from "@/components/veil/table";
import { SEALS, type Faction } from "@/veil/cards";
import { playerClient, sentBy, usePlayer } from "@/veil/connect";
import { hostFriend, joinFriend } from "@/veil/friend-wire";
import { sendGame } from "@/veil/signer";
import { armArenaMusic } from "@/veil/arena-music";
import { liveBot, type Bot } from "@/veil/bots";
import { redactKey } from "@/veil/keys";
import { startMatch, type Match, type Unit } from "@/veil/logic";
import { readBook } from "@/veil/phone-book";
import { askPrize, type Prize } from "@/veil/prize-client";
import { deckSeal } from "@/veil/ranks";
import { readSession } from "@/veil/session";
import { isApk } from "@/veil/shell";
import { ownedStageIds, saveStagePick, stagePick, STAGES } from "@/veil/stages";
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
  stage?: number;
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
    .replaceAll("You concede.", "§CONCEDE")
    .replaceAll("The rival concedes.", "You concede.")
    .replaceAll("§CONCEDE", "The rival concedes.")
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

function RewardClaim({ won, address, signer }: { won: boolean; address: string; signer: `0x${string}` | null }) {
  const [prize, setPrize] = useState<Prize | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!won || !address) return;
    let cancel = false;
    void askPrize(address as `0x${string}`).then((result) => {
      if (cancel) return;
      if ("prize" in result) setPrize(result.prize);
      else if (result.error === "needs-card") setNote("No BzB. Rewards go only to wallets that hold a Seal Forge card NFT.");
      else if (result.error === "cap") setNote("No payout. The daily cap is four.");
      else setNote("The reward server did not answer.");
    });
    return () => {
      cancel = true;
    };
  }, [won, address]);

  async function claim() {
    if (!prize || !address) return;
    setBusy(true);
    setError(null);
    try {
      const { address: payer, wallet } = await playerClient(signer);
      const hash = await sendGame(signer, payer, (nonce) => wallet.writeContract({ address: REWARDS, abi: rewardsAbi, functionName: "claim", args: [prize.matchId, prize.signature], nonce }));
      await sentBy(hash, payer);
      setPrize(null);
      setNote("0.25 BzB claimed.");
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "The reward did not send.", signer));
    } finally {
      setBusy(false);
    }
  }

  if (!won) return null;
  return (
    <div className="mt-3">
      {!address && <p className="text-sm text-ash">Make a wallet before the win if you want the 0.25 BzB.</p>}
      {prize && (
        <button type="button" className="veil-btn veil-btn-primary" disabled={busy} onClick={() => void claim()}>
          {busy ? "Claiming…" : "Claim 0.25 BzB"}
        </button>
      )}
      {note && <p className="mt-2 text-sm text-ash">{note}</p>}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
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
  const [tables, setTables] = useState<LobbyRow[]>([]);
  const [friendCode, setFriendCode] = useState("");
  const [hostingFriend, setHostingFriend] = useState("");
  const [friend, setFriend] = useState<{
    match: Match;
    leftMs: number;
    you: Faction;
    rivalName: string;
    rivalFaction: Faction;
    stage?: number;
  } | null>(null);
  const [stageOwned, setStageOwned] = useState<number[]>([]);
  const [stageOn, setStageOn] = useState(0);
  const [local, setLocal] = useState<{ match: Match; bot: Bot } | null>(null);
  const friendWire = useRef<{ send: (action: TableAct) => void; close: () => void } | null>(null);
  const friendGen = useRef(0);
  const queueSeat = useRef("");
  const seekingPlayer = useRef(false);
  const enterRef = useRef<(code: string) => Promise<void>>(async () => undefined);
  const pollGen = useRef(0);
  const gate = useRef(Promise.resolve());
  const seatEpoch = useRef(0);
  const friendNow = useRef<typeof friend>(null);
  friendNow.current = friend;

  useEffect(() => {
    if (isApk()) {
      if (!address) {
        setSealed(null);
        setUseSealed(false);
        return;
      }
      const book = readBook(address);
      const found = book.deck.length === 20 ? deckSeal(book.deck) : null;
      if (found?.ok) setSealed({ ids: book.deck, seal: found.seal, name: book.deckName });
      else {
        setSealed(null);
        setUseSealed(false);
      }
      return;
    }
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
    if (!address) {
      setStageOwned([]);
      setStageOn(0);
      return;
    }
    const saved = stagePick(address);
    let cancel = false;
    void ownedStageIds(address as `0x${string}`).then((ids) => {
      if (cancel) return;
      setStageOwned(ids);
      setStageOn(ids.includes(saved) ? saved : 0);
    });
    return () => {
      cancel = true;
    };
  }, [address]);

  useEffect(() => {
    const onHide = () => {
      const seat = queueSeat.current;
      const epoch = seatEpoch.current;
      if (!seat) return;
      queueSeat.current = "";
      void fetch("/api/veilforge/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "leave", id: seat, epoch }),
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  useEffect(() => {
    if (!id || id === "seeking") return;
    const gen = pollGen.current;
    const timer = window.setInterval(() => {
      void fetch(`/api/veilforge/queue?id=${id}`)
        .then((res) => res.json())
        .then((data: { status?: string; waitMs?: number; view?: View | null; claim?: Claim | null; reward?: string; code?: string; error?: string; epoch?: number }) => {
          if (gen !== pollGen.current) return;
          if (typeof data.epoch === "number" && data.epoch > 0) seatEpoch.current = data.epoch;
          if (data.status === "missing") {
            setView((prev) => (prev && prev.winner !== null ? prev : null));
            setId("");
            return;
          }
          if (data.view) {
            seekingPlayer.current = false;
            friendWire.current?.close();
            friendWire.current = null;
            setView((prev) => (prev && sameBoard(prev, data.view!) ? prev : data.view!));
          }
          if (typeof data.waitMs === "number") setWaitMs((prev) => (prev === data.waitMs ? prev : data.waitMs!));
          if (data.status === "lobby" && data.code) setHostCode((prev) => (prev === data.code ? prev : data.code!));
          if (data.claim) setClaim((prev) => (prev && prev.matchId === data.claim!.matchId && prev.signature === data.claim!.signature ? prev : data.claim!));
          if (data.reward) setReward((prev) => (prev === data.reward ? prev : data.reward!));
        })
        .catch(() => {
          if (!friendWire.current) setError("The queue did not answer.");
        });
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
          if (cancel) return;
          const rows = data.lobbies ?? [];
          setTables(rows);
          if (!seekingPlayer.current) return;
          const open = rows[0];
          if (!open) return;
          seekingPlayer.current = false;
          void enterRef.current(open.code);
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

  async function seatBody(): Promise<{ id: string; name: string; faction: Faction; address: string; deck: string[] | null; stage: number }> {
    const stage = stageOwned.includes(stageOn) ? stageOn : 0;
    if (isApk()) {
      const book = address ? readBook(address) : null;
      const found = book && book.deck.length === 20 ? deckSeal(book.deck) : null;
      const deck = useSealed && found?.ok && found.seal === faction ? book!.deck : null;
      return { id: seatId(), name: book?.name || "Duelist", faction, address, deck, stage };
    }
    const session = readSession();
    let name = address ? address.slice(0, 6) : "Duelist";
    let deck: string[] | null = null;
    if (session && address && session.address.toLowerCase() === address.toLowerCase()) {
      try {
        const profileRes = await fetch(`/api/veilforge/profile?token=${encodeURIComponent(session.token)}`);
        const profileBody = (await profileRes.json()) as { profile?: { name: string; deck: string[] } };
        if (profileBody.profile) {
          name = profileBody.profile.name;
          const ids = profileBody.profile.deck;
          const found = ids.length === 20 ? deckSeal(ids) : null;
          if (useSealed && found?.ok && found.seal === faction) deck = ids;
        }
      } catch {
        /* the public lanes still work without the profile server */
      }
    }
    return { id: seatId(), name, faction, address, deck, stage };
  }

  function noteDeck(deck?: string) {
    if (deck === "needs-nfts") setError("That deck includes cards this wallet does not hold, so the starter deck was used.");
    else if (deck === "wrong-seal") setError("That deck is not this seal. Unbound cards can join any seal, so the starter deck was used.");
  }

  function startLocal() {
    const bot = liveBot();
    const seed = Math.floor(Math.random() * 0xffffffff) || 1;
    const deck = useSealed && sealed?.seal === faction ? sealed.ids : null;
    setLocal({ match: startMatch(faction, bot.faction, seed, [deck, null]), bot });
    setId("");
    setWaitMs(null);
    setError(null);
  }

  function lostBoard(prev: View): View {
    const other = prev.you === 0 ? 1 : 0;
    const line = prev.you === 0 ? "You concede." : "The rival concedes.";
    return { ...prev, winner: other, phase: "over", seq: (prev.seq ?? 0) + 1, log: [line, ...(prev.log ?? [])].slice(0, 14) };
  }

  async function join(now = false) {
    await gate.current;
    armArenaMusic();
    setBusy(true);
    setError(null);
    seekingPlayer.current = false;
    try {
      const body = await seatBody();
      if (!now) {
        const listed = await fetch("/api/veilforge/queue?list=1");
        const open = ((await listed.json()) as { lobbies?: LobbyRow[] }).lobbies?.[0];
        if (open) {
          setBusy(false);
          await enter(open.code);
          return;
        }
      }
      const res = await fetch("/api/veilforge/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "join", ...body }),
      });
      const data = (await res.json()) as { view?: View | null; error?: string; deck?: string; epoch?: number };
      if (data.error) {
        setError(data.error);
        return;
      }
      noteDeck(data.deck);
      if (typeof data.epoch === "number" && data.epoch > 0) seatEpoch.current = data.epoch;
      queueSeat.current = body.id;
      setHostCode("");
      setId(body.id);
      if (now) {
        const botRes = await fetch("/api/veilforge/queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "bot", id: body.id }),
        });
        const botData = (await botRes.json()) as { view?: View | null; error?: string; epoch?: number };
        if (typeof botData.epoch === "number" && botData.epoch > 0) seatEpoch.current = botData.epoch;
        if (botData.error) setError(botData.error);
        else if (botData.view) setView(botData.view);
        return;
      }
      seekingPlayer.current = !data.view;
      if (data.view) {
        friendWire.current?.close();
        friendWire.current = null;
      }
      setView(data.view ?? null);
    } catch {
      if (now) startLocal();
      else setError("Could not join the queue.");
    } finally {
      setBusy(false);
    }
  }

  async function host() {
    await gate.current;
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
      const data = (await res.json()) as { view?: View | null; code?: string | null; error?: string; deck?: string; epoch?: number };
      if (data.error) setError(data.error);
      else {
        noteDeck(data.deck);
        if (typeof data.epoch === "number" && data.epoch > 0) seatEpoch.current = data.epoch;
        queueSeat.current = body.id;
        setId(body.id);
        const code = data.code;
        if (code) {
          setHostCode(code);
          setTables((prev) => (prev.some((row) => row.code === code) ? prev : [{ code, name: body.name, faction: body.faction }, ...prev]));
        }
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
    await gate.current;
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
      const data = (await res.json()) as { view?: View | null; error?: string; deck?: string; epoch?: number };
      if (data.error) setError(data.error);
      else {
        noteDeck(data.deck);
        if (typeof data.epoch === "number" && data.epoch > 0) seatEpoch.current = data.epoch;
        queueSeat.current = body.id;
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

  enterRef.current = enter;

  async function leave(opts?: { keepBoard?: boolean }) {
    pollGen.current += 1;
    seekingPlayer.current = false;
    friendWire.current?.close();
    friendWire.current = null;
    setHostingFriend("");
    const seat = queueSeat.current || (id && id !== "seeking" ? id : "");
    queueSeat.current = "";
    if (!opts?.keepBoard) {
      setView(null);
      setClaim(null);
    }
    setId("");
    setHostCode("");
    setWaitMs(null);
    const epoch = seatEpoch.current;
    const task = seat
      ? fetch("/api/veilforge/queue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "leave", id: seat, epoch }),
        }).then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    const pending = gate.current.then(() => task, () => task);
    gate.current = pending;
    await pending;
  }

  function closeFriend() {
    const current = friendNow.current;
    friendGen.current += 1;
    friendWire.current?.close();
    friendWire.current = null;
    setHostingFriend("");
    if (current && current.match.winner === null) {
      const next = {
        ...current,
        leftMs: 0,
        match: {
          ...current.match,
          winner: 1 as const,
          phase: "over" as const,
          seq: current.match.seq + 1,
          log: ["You concede.", ...current.match.log].slice(0, 14),
        },
      };
      friendNow.current = next;
      setFriend(next);
      return;
    }
    friendNow.current = null;
    setFriend(null);
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
        onFrame: (frame: { match: Match; leftMs: number; rivalName: string; rivalFaction: Faction; stage?: number }) => {
          if (friendGen.current !== mine) return;
          const next = { match: frame.match, leftMs: frame.leftMs, you: body.faction, rivalName: frame.rivalName, rivalFaction: frame.rivalFaction, stage: frame.stage };
          friendNow.current = next;
          setFriend(next);
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
          setHostingFriend("");
          const prev = friendNow.current;
          if (!prev) {
            setError("The rival left the table.");
            return;
          }
          if (prev.match.winner !== null) return;
          const next = {
            ...prev,
            leftMs: 0,
            match: {
              ...prev.match,
              winner: 0 as const,
              phase: "over" as const,
              seq: prev.match.seq + 1,
              log: ["The rival concedes.", ...prev.match.log].slice(0, 14),
            },
          };
          friendNow.current = next;
          setError(null);
          setFriend(next);
        },
      };
      const wire = role === "host"
        ? hostFriend(next, { name: body.name, faction: body.faction, deck: body.deck, address: body.address, stage: body.stage }, hooks)
        : joinFriend(next, { name: body.name, faction: body.faction, deck: body.deck, address: body.address, stage: body.stage }, hooks);
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

  if (local) {
    return (
      <Table
        match={local.match}
        setMatch={(match) => setLocal({ match, bot: local.bot })}
        you={faction}
        rival={local.bot.faction}
        bot={local.bot}
        onHall={() => setLocal(null)}
        onRematch={startLocal}
        stage={stageOwned.includes(stageOn) ? stageOn : 0}
        winnerExtra={<RewardClaim won={local.match.winner === 0} address={address} signer={key} />}
      />
    );
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
        stage={friend.stage ?? 0}
        winnerExtra={<RewardClaim won={friend.match.winner === 0} address={address} signer={key} />}
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
        onHall={() => {
          if (view.winner !== null) {
            void leave();
            onBack();
            return;
          }
          setView((prev) => (prev && prev.winner === null ? lostBoard(prev) : prev));
          void leave({ keepBoard: true });
        }}
        stage={view.stage ?? (stageOwned.includes(stageOn) ? stageOn : 0)}
        onRematch={() => {
          void leave();
          setView(null);
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
          <button type="button" className="veil-btn" onClick={() => { void leave(); onBack(); }}>
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
            Find a match sits you with another player, on the phone app or in the browser. An open table is taken first. If none is up, you wait until someone else is looking. Leaving or conceding closes that match as a loss, and the player who stays gets the win. The next Find a match is a new queue. Auto start is the only way to play a bot.
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
          {stageOwned.length > 0 && (
            <div className="mt-4">
              <p className="text-sm text-ash">Backdrop</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={stageOn === 0 ? "veil-btn veil-btn-primary" : "veil-btn"}
                  disabled={Boolean(id)}
                  onClick={() => {
                    setStageOn(0);
                    if (address) saveStagePick(address, 0);
                  }}
                >
                  Off
                </button>
                {stageOwned.map((dropId) => (
                  <button
                    key={dropId}
                    type="button"
                    className={stageOn === dropId ? "veil-btn veil-btn-spark" : "veil-btn"}
                    disabled={Boolean(id)}
                    onClick={() => {
                      setStageOn(dropId);
                      if (address) saveStagePick(address, dropId);
                    }}
                  >
                    {STAGES.find((item) => item.id === dropId)?.name ?? `Stage ${dropId}`}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm text-ash">If both players bring a backdrop, the host's plays. Skyhold also changes the match music.</p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="veil-btn veil-btn-primary" disabled={busy || Boolean(id)} onClick={() => void join()}>
              {id && !hostCode ? "Looking for a player" : "Find a match"}
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
          <p className="mt-2 text-sm leading-relaxed text-ash">Host a code and send it to someone on the phone app or in the browser. They sit with that code. The duel runs between the two devices.</p>
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
          <h2 className="text-sm tracking-widest text-brass">OPEN TABLES</h2>
          <p className="mt-2 text-sm leading-relaxed text-ash">Host a table and it shows up in this list. Anyone on the site or the phone app can click your box to sit. A bot does not take the seat.</p>
          {hostCode ? (
            <button type="button" className="veil-btn mt-3" disabled={busy} onClick={() => void leave()}>
              Close table
            </button>
          ) : (
            <button type="button" className="veil-btn veil-btn-primary mt-3" disabled={busy || Boolean(id)} onClick={() => void host()}>
              Host
            </button>
          )}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {tables.map((table) => {
              const mine = table.code === hostCode;
              const seal = SEALS.find((item) => item.id === table.faction)?.name ?? table.faction;
              const box = (
                <>
                  <span className="text-xs tracking-widest text-brass">{mine ? "YOUR TABLE" : seal.toUpperCase()}</span>
                  <span className="mt-1 text-base text-bone">{table.name}</span>
                  <span className="mt-2 text-sm text-ash">{mine ? "Waiting for someone to sit" : "Click to join"}</span>
                </>
              );
              if (mine) {
                return (
                  <div key={table.code} className="flex min-h-28 flex-col items-start rounded-md border border-brass bg-ink px-4 py-3 text-left">
                    {box}
                  </div>
                );
              }
              return (
                <button
                  key={table.code}
                  type="button"
                  className="flex min-h-28 flex-col items-start rounded-md border border-line bg-ink px-4 py-3 text-left"
                  disabled={busy || Boolean(id)}
                  onClick={() => void enter(table.code)}
                >
                  {box}
                </button>
              );
            })}
            {tables.length === 0 && <div className="rounded-md border border-dashed border-line px-4 py-6 text-sm text-ash">No open tables yet.</div>}
          </div>
        </section>
        {error && <p className="text-sm text-danger">{error}</p>}
        <p className="text-xs text-ash">Rewards live at {REWARDS}. A win is {WIN_WEI.toString()} wei, which is 0.25 BzB.</p>
      </main>
    </>
  );
}
