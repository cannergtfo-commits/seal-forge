import { useEffect, useRef, useState } from "react";
import { KeyRound, Layers, Library, Package, ScrollText, Shield, Swords, User, Wallet } from "lucide-react";
import { BzbBox } from "@/components/veil/bzb-box";
import { ConnectButton } from "@/components/veil/connect-button";
import { CardBack, CardFace } from "@/components/veil/card";
import { DeckForge, SealMark } from "@/components/veil/deck";
import { Market } from "@/components/veil/market";
import { NewPlayer } from "@/components/veil/new-player";
import { Ranked } from "@/components/veil/ranked";
import { PackOpen } from "@/components/veil/pack-open";
import { PackSupply } from "@/components/veil/pack-supply";
import { PolygonWallet } from "@/components/veil/polygon-wallet";
import { Profile } from "@/components/veil/profile";
import { PRACTICE, botOf } from "@/veil/bots";
import { Table } from "@/components/veil/table";
import { armArenaMusic, stopArenaMusic } from "@/veil/arena-music";
import { CARDS, FACTIONS, SEALS, cardOf, type CardDef, type Faction } from "@/veil/cards";
import { veilBalances } from "@/veil/holds";
import { useInjected, usePlayer } from "@/veil/connect";
import { openSession } from "@/veil/game-session";
import { gameKeySigns } from "@/veil/signer";
import { shortAddr } from "@/veil/chain";
import { redactKey, usePolKey } from "@/veil/keys";
import { buySealedPack } from "@/veil/pack-buy";
import { armPackScore, type PackScore } from "@/veil/pack-score";
import { startMatch, type Match } from "@/veil/logic";
import { metadataFor, useVault } from "@/veil/store";
import { ASHEN_PACKS, KAGE_PACKS } from "@/veil/deployed";
import { isApk } from "@/veil/shell";
import { readSession } from "@/veil/session";
import { isAddress } from "viem";

type Screen = "home" | "start" | "duel" | "ranked" | "fight" | "packs" | "binder" | "codex" | "market" | "profile" | "deck" | "wallet" | "rules";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type PackEdition = "founding" | "blazar" | "kage" | "ashen";

function packBz(set: PackEdition, seal: boolean) {
  if (set === "founding") return seal ? "1.25" : "1";
  if (set === "ashen") return "15";
  return "10";
}

function packTitle(set: PackEdition, kind: "forge" | "seal") {
  if (set === "founding") return kind === "forge" ? "Forge Pack" : "Seal Pack";
  const name = set === "ashen" ? "Ashen" : set === "kage" ? "Kage" : "Blazar";
  return kind === "forge" ? `${name} Forge` : `${name} Seal`;
}

function factionName(id: Faction): string {
  return FACTIONS.find((faction) => faction.id === id)?.name ?? id;
}

function Bar({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
      <div className="flex items-center gap-3">
        {onBack ? (
          <button type="button" className="veil-btn" onClick={onBack}>
            Back
          </button>
        ) : null}
        <div>
          <p className="text-xs tracking-widest text-brass">SEAL FORGE</p>
          <h1 className="text-lg font-medium leading-tight">{title}</h1>
        </div>
      </div>
      <div className="bar-tools">
        <ConnectButton />
        <BzbBox />
      </div>
    </header>
  );
}

function FactionPick({ value, onChange, label }: { value: Faction; onChange: (faction: Faction) => void; label: string }) {
  return (
    <fieldset>
      <legend className="text-sm text-ash">{label}</legend>
      <div className="mt-2 grid gap-2">
        {SEALS.map((faction) => (
          <button
            key={faction.id}
            type="button"
            aria-pressed={value === faction.id}
            onClick={() => onChange(faction.id)}
            className="veil-pick"
          >
            <SealMark id={faction.id} />
            <span>
              <span className="block text-sm font-medium">{faction.name}</span>
              <span className="block text-xs leading-snug text-ash">
                {faction.seal}. {faction.line}
              </span>
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function VeilApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [ready, setReady] = useState(false);
  const [you, setYou] = useState<Faction>("elf");
  const [botId, setBotId] = useState("pebble");
  const [rival, setRival] = useState<Faction>("goblin");
  const [seal, setSeal] = useState<Faction>("elf");
  const [match, setMatch] = useState<Match | null>(null);
  const [pulls, setPulls] = useState<CardDef[] | null>(null);
  const [packError, setPackError] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [packSet, setPackSet] = useState<PackEdition>("ashen");
  const [binderSeal, setBinderSeal] = useState<Faction | "all">("all");
  const [codexSeal, setCodexSeal] = useState<Faction | "all">("all");
  const key = usePolKey((state) => state.key);
  const player = usePlayer();
  const signedFor = useRef<string | null>(null);
  const notePull = useVault((state) => state.notePull);
  const scoreRef = useRef<PackScore | null>(null);

  useEffect(() => {
    const finish = () => setReady(true);
    const unsub = useVault.persist.onFinishHydration(finish);
    void useVault.persist.rehydrate();
    void usePolKey.persist.rehydrate();
    if (useVault.persist.hasHydrated()) finish();
    return unsub;
  }, []);

  useEffect(() => {
    if (!player.ready || !player.address || !player.key || !gameKeySigns(player.key)) return;
    const id = player.address.toLowerCase();
    if (readSession()?.address.toLowerCase() === id || signedFor.current === id) return;
    signedFor.current = id;
    void openSession(player.key, player.address).catch(() => {
      if (signedFor.current === id) signedFor.current = null;
    });
  }, [player.ready, player.address, player.key]);

  useEffect(() => () => scoreRef.current?.stop(), []);

  useEffect(() => {
    if (screen !== "fight" && screen !== "ranked") stopArenaMusic();
  }, [screen]);

  function begin(nextYou = you, nextBot = botId) {
    armArenaMusic();
    const picked = botOf(nextBot);
    const seed = Math.floor(Math.random() * 0xffffffff) || 1;
    setYou(nextYou);
    setBotId(picked.id);
    setRival(picked.faction);
    setMatch(startMatch(nextYou, picked.faction, seed));
    setScreen("fight");
  }

  function concede() {
    if (match && match.winner === null) {
      setMatch({
        ...match,
        winner: 1,
        phase: "over",
        log: ["You concede.", ...match.log].slice(0, 14),
      });
      return;
    }
    setScreen("home");
  }

  const kageLive = isAddress(KAGE_PACKS);
  const ashenLive = isAddress(ASHEN_PACKS) && BigInt(ASHEN_PACKS) !== 0n;
  const packLive = packSet === "kage" ? kageLive : packSet === "ashen" ? ashenLive : true;

  async function buy(faction: number) {
    if (!ready || pulls || packBusy) return;
    if ((isApk() || !useInjected.getState().address) && !key) {
      setPackError(isApk() ? "Make a wallet in the game and send it BzB before opening a pack." : "Connect a wallet, or generate one, and send it BzB before opening a pack.");
      return;
    }
    scoreRef.current?.stop();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scoreRef.current = reduce ? null : armPackScore();
    setPackBusy(true);
    setPackError(null);
    try {
      const result = await buySealedPack(key, packSet, faction);
      notePull(result);
      setPulls(result);
    } catch (err) {
      setPackError(redactKey(err instanceof Error ? err.message : "The pack did not open.", key));
      scoreRef.current?.stop();
      scoreRef.current = null;
    } finally {
      setPackBusy(false);
    }
  }

  return (
    <div className="veil-shell overflow-x-hidden text-bone">
      {screen === "home" && (
        <main className="hall">
          <div className="hall-world" aria-hidden="true">
            <video
              className="hall-video"
              autoPlay
              muted
              loop
              playsInline
              poster="/assets/veil/hall/terrace.jpg?v=3"
              src="/assets/veil/hall/terrace.mp4?v=3"
            />
            <div className="hall-vignette" />
            <div className="hall-weather" />
          </div>
          <div className="hall-frame">
            <div className="hall-hero">
              <CardBack size="hero" marked />
            </div>
            <div className="hall-sheet">
            <div className="hall-head">
              <div>
                <h1 className="hall-title">Seal Forge</h1>
              </div>
              <div className="hall-tools">
                <button type="button" className="veil-btn" disabled={!ready} onClick={() => setScreen("profile")}>
                  <User className="h-4 w-4" aria-hidden />
                  Profile
                </button>
                <ConnectButton />
                <BzbBox />
              </div>
            </div>
            <div className="hall-lead">
              <p>Five Seals divide the world: Aureth, Veymar, Rixen, Quorin, and Malrec, each bound to a different fate.</p>
              <p>Aureth endure through ancient grace, Veymar through ambition, Rixen through cunning, Quorin through cold invention, and Malrec through darkness.</p>
              <p>As the Seals begin to break, old rivalries return and the fate of every realm hangs in the balance.</p>
            </div>
            <div className="mt-5 hall-actions">
              <button type="button" className="veil-btn veil-btn-primary" disabled={!ready} onClick={() => setScreen("packs")}>
                <Package className="h-4 w-4" aria-hidden />
                Open a pack
              </button>
              <button type="button" className="veil-btn" disabled={!ready} onClick={() => setScreen("ranked")}>
                <Swords className="h-4 w-4" aria-hidden />
                Find a match
              </button>
              <button type="button" className="veil-btn" disabled={!ready} onClick={() => setScreen("market")}>
                Market
              </button>
              <button type="button" className="veil-btn" disabled={!ready} onClick={() => setScreen("deck")}>
                <Shield className="h-4 w-4" aria-hidden />
                Deck
              </button>
            </div>
            <div className="mt-3 hall-actions">
              <button type="button" className="veil-btn" onClick={() => setScreen("binder")}>
                <Layers className="h-4 w-4" aria-hidden />
                Binder
              </button>
              <button type="button" className="veil-btn" onClick={() => { setCodexSeal("all"); setScreen("codex"); }}>
                <Library className="h-4 w-4" aria-hidden />
                Codex
              </button>
              <button type="button" className="veil-btn" onClick={() => setScreen("duel")}>
                Practice
              </button>
              <button type="button" className="veil-btn" onClick={() => setScreen("wallet")}>
                <Wallet className="h-4 w-4" aria-hidden />
                Wallet
              </button>
              <button type="button" className="veil-btn" onClick={() => setScreen("rules")}>
                <ScrollText className="h-4 w-4" aria-hidden />
                Rules
              </button>
              <button type="button" className="veil-btn" disabled={!ready} onClick={() => setScreen("start")}>
                <KeyRound className="h-4 w-4" aria-hidden />
                Wallet maker
              </button>
            </div>
            <div className="mt-6 grid gap-2">
              {SEALS.map((faction) => (
                <button
                  key={faction.id}
                  type="button"
                  onClick={() => {
                    setCodexSeal(faction.id);
                    setScreen("codex");
                  }}
                  className="veil-seal"
                  data-faction={faction.id}
                >
                  <span className="seal-icon" data-faction={faction.id}>
                    <SealMark id={faction.id} />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">
                      {faction.name}
                      <span className="font-normal text-ash"> · {faction.seal}</span>
                    </span>
                    <span className="block text-xs leading-snug text-ash">{faction.line}</span>
                  </span>
                </button>
              ))}
            </div>
            </div>
          </div>
        </main>
      )}

      {screen === "start" && <NewPlayer onBack={() => setScreen("home")} onWallet={() => setScreen("wallet")} />}

      {screen === "ranked" && <Ranked onBack={() => setScreen("home")} />}
      {screen === "profile" && <Profile onBack={() => setScreen("home")} onDeck={() => setScreen("deck")} />}
      {screen === "market" && <Market onBack={() => setScreen("home")} />}

      {screen === "duel" && (
        <>
          <Bar title="Choose seals" onBack={() => setScreen("home")} />
          <main className="mx-auto grid max-w-5xl gap-6 px-4 pb-8">
            <FactionPick value={you} onChange={setYou} label="Your seal" />
            <fieldset>
              <legend className="text-sm text-ash">Practice · one bot for each seal</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {PRACTICE.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={botId === item.id}
                    onClick={() => {
                      setBotId(item.id);
                      setRival(item.faction);
                    }}
                    className="veil-pick"
                  >
                    <SealMark id={item.faction} />
                    <span>
                      <span className="block text-sm font-medium">{item.name}</span>
                      <span className="block text-xs leading-snug text-ash">{item.line}</span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="veil-btn veil-btn-primary" onClick={() => begin()}>
                  Duel {botOf(botId).name}
                </button>
                <button
                  type="button"
                  className="veil-btn"
                  onClick={() => {
                    const next = PRACTICE[Math.floor(Math.random() * PRACTICE.length)] ?? PRACTICE[0]!;
                    setBotId(next.id);
                    setRival(next.faction);
                  }}
                >
                  Random bot
                </button>
              </div>
            </div>
          </main>
        </>
      )}

      {screen === "fight" && match && (
        <Table match={match} setMatch={setMatch} you={you} rival={rival} bot={botOf(botId)} onHall={concede} onRematch={() => begin()} />
      )}

      {screen === "packs" && (
        <>
          <Bar title="Packs" onBack={() => { setPulls(null); setScreen("home"); }} />
          <main className="mx-auto max-w-5xl px-4 pb-8">
            {pulls ? (
              <PackOpen
                cards={pulls}
                score={scoreRef.current}
                onBinder={() => { setPulls(null); setScreen("binder"); }}
                onAgain={() => setPulls(null)}
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-wrap gap-2 md:col-span-2">
                  <button type="button" className={cx("veil-btn", packSet === "founding" && "veil-btn-primary")} onClick={() => setPackSet("founding")}>
                    Founding
                  </button>
                  <button type="button" className={cx("veil-btn", packSet === "blazar" && "veil-btn-primary")} onClick={() => setPackSet("blazar")}>
                    Blazar Veil
                  </button>
                  <button type="button" className={cx("veil-btn", packSet === "kage" && "veil-btn-primary")} onClick={() => setPackSet("kage")}>
                    Kage Veil
                  </button>
                  <button type="button" className={cx("veil-btn", packSet === "ashen" && "veil-btn-primary")} onClick={() => setPackSet("ashen")}>
                    Ashen Veil
                  </button>
                </div>
                <article className="rounded-md border border-line bg-panel p-4">
                  <CardBack size="trap" marked />
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-medium">{packTitle(packSet, "forge")}</h2>
                    <PackSupply edition={packSet} />
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ash">
                    {packSet === "ashen"
                      ? "Five Ashen Veil cards from any seal. Four are basic. The fifth is rare, or legendary about one time in five. Six cards in each seal. Two thousand packs."
                      : packSet === "kage"
                      ? "Five Kage Veil cards from any seal. Four are basic. The fifth is rare, or legendary about one time in five. Each seal has fifteen ninja cards."
                      : packSet === "blazar"
                      ? "Five Blazar Veil cards from any seal. Four are basic. The fifth is rare, or legendary about one time in five."
                      : "Five founding cards from any seal. About 62% common, 25% uncommon, 13% rare. Starter decks stay on this set."}
                  </p>
                  {!packLive && <p className="mt-2 text-sm text-brass">That set is in the codex. Packs open after the edition is sealed and frozen.</p>}
                  <button type="button" className="veil-btn veil-btn-primary mt-4" disabled={!ready || packBusy || !packLive} onClick={() => void buy(0)}>
                    Open · {packBusy ? "sealing" : packBz(packSet, false)} BzB
                  </button>
                </article>
                <article className="rounded-md border border-line bg-panel p-4">
                  <CardBack size="trap" marked faction={seal} />
                  <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-lg font-medium">{packTitle(packSet, "seal")}</h2>
                    <PackSupply edition={packSet} />
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ash">Five cards from one seal. Unbound cards can show up in any seal pack. They are not a deck of their own.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {SEALS.map((faction) => (
                      <button
                        key={faction.id}
                        type="button"
                        aria-pressed={seal === faction.id}
                        onClick={() => setSeal(faction.id)}
                        className={cx("veil-btn", seal === faction.id && "veil-btn-primary")}
                      >
                        <span className="seal-icon" data-faction={faction.id}>
                          <SealMark id={faction.id} className="h-4 w-4" />
                        </span>
                        {faction.name}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="veil-btn veil-btn-primary mt-4" disabled={!ready || packBusy || !packLive} onClick={() => void buy(seal === "elf" ? 1 : seal === "human" ? 2 : seal === "goblin" ? 3 : seal === "robot" ? 4 : 5)}>
                    Open · {packBusy ? "sealing" : packBz(packSet, true)} BzB
                  </button>
                </article>
                {packError && <p className="text-sm text-danger md:col-span-2">{packError}</p>}
                <p className="text-sm leading-relaxed text-ash md:col-span-2">
                  Packs are paid in BzB. The roll is the hash of the block that took the payment, then the cards mint on the next block. Forge and seal packs share one mint for the set you have selected.
                </p>
              </div>
            )}
          </main>
        </>
      )}

      {screen === "deck" && <DeckForge onBack={() => setScreen("home")} />}

      {screen === "binder" && (
        <Binder seal={binderSeal} setSeal={setBinderSeal} onBack={() => setScreen("home")} />
      )}

      {screen === "codex" && <Codex initialSeal={codexSeal} onBack={() => setScreen("home")} />}

      {screen === "wallet" && (
        <PolygonWallet onBack={() => setScreen("home")} />
      )}

      {screen === "rules" && (
        <>
          <Bar title="Rules" onBack={() => setScreen("home")} />
          <main className="mx-auto max-w-3xl space-y-4 px-4 pb-10 text-sm leading-relaxed text-ash">
            <p className="text-bone">Each player has 20 life. Life from healing stops at 30. Reduce the rival to 0 to win.</p>
            <p>Maximum mana starts at 0 and rises by 1 at the start of each of your turns, up to 10. It refills to that maximum. Cards cost mana to play.</p>
            <p>You draw one card each turn. An empty deck deals 1 fatigue instead. Hands hold 7 cards; extras are discarded. The board holds 6 units. You may set 3 traps.</p>
            <p>The first player cannot attack on turn 1. After that, each turn has one attack: choose any number of ready units. The defender may spring one attack trap, then assigns at most one blocker per attacker. A unit that attacked cannot block until its next turn. Unblocked damage hits the player. Combat damage is simultaneous.</p>
            <p>New units cannot attack until your next turn, unless they have Haste or Swift, a War Drummer is letting Rixen attack, Overclock clears the wait, or Blazar Slip grants haste. Turn 1 still cannot attack. A unit with no attack cannot swing.</p>
            <p>Bulwark must be blocked if the defender blocks anything. Crush spills extra damage past a blocker onto the player. Drain heals you for damage dealt to a player. Firewall prevents the next 4 damage to you. Soul Snare heals 3 when any unit dies, then leaves. Crossroad Trap deals 2. Event Horizon deals 2 and freezes.</p>
            <p>Founding decks are the basic starters: two copies of each common and uncommon, one of each rare. Blazar Veil is set 1. Kage Veil is set 2. Ashen Veil is set 3, six cards a seal. A Blazar or Kage pack is 10 BzB. An Ashen pack is 15 BzB. Each of those packs is four basic cards and one rare or legendary. Founding mint stops at 10,000 packs. Blazar and Kage each stop at 1,000. Ashen stops at 2,000.</p>
            <p>A unit that says it cannot attack does not attack. A unit that attacked cannot block until its next turn.</p>
            <p>Aureth mend and stall. Veymar trade evenly. Rixen are cheap and fast. Quorin stack walls and repairs. Malrec pay life for cards and reach. Unbound cards have no seal. They can be played in every deck, and they are not a deck by themselves.</p>
            <p>Magic is typed on the card: Bolt, Mend, Hex, Banner, Pact, and Trap. Units that must be blocked read as Wall. Haste, Swift, Drain, and Crush stay on the fighter.</p>
          </main>
        </>
      )}
    </div>
  );
}

function Codex({ onBack, initialSeal }: { onBack: () => void; initialSeal: Faction | "all" }) {
  const [seal, setSeal] = useState<Faction | "all">(initialSeal);
  const [edition, setEdition] = useState<"all" | "founding" | "blazar" | "kage" | "ashen">("all");
  const list = CARDS.filter((card) => (seal === "all" || card.faction === seal) && (edition === "all" || card.set === edition));
  return (
    <>
      <Bar title="Codex" onBack={onBack} />
      <main className="mx-auto max-w-5xl px-4 pb-8">
        <p className="max-w-xl text-sm leading-relaxed text-ash">
          Founding is the starter set. Blazar Veil is set 1. Kage Veil is set 2. Ashen Veil is set 3. Unbound is the silver seal in every set. Every line on an Ashen card is a rule the duel resolves.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={cx("veil-btn", edition === "all" && "veil-btn-primary")} onClick={() => setEdition("all")}>
            All sets
          </button>
          <button type="button" className={cx("veil-btn", edition === "founding" && "veil-btn-primary")} onClick={() => setEdition("founding")}>
            Founding
          </button>
          <button type="button" className={cx("veil-btn", edition === "blazar" && "veil-btn-primary")} onClick={() => setEdition("blazar")}>
            Blazar Veil
          </button>
          <button type="button" className={cx("veil-btn", edition === "kage" && "veil-btn-primary")} onClick={() => setEdition("kage")}>
            Kage Veil
          </button>
          <button type="button" className={cx("veil-btn", edition === "ashen" && "veil-btn-primary")} onClick={() => setEdition("ashen")}>
            Ashen Veil
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={cx("veil-btn", seal === "all" && "veil-btn-primary")} onClick={() => setSeal("all")}>
            All
          </button>
          {FACTIONS.map((faction) => (
            <button key={faction.id} type="button" className={cx("veil-btn", seal === faction.id && "veil-btn-primary")} onClick={() => setSeal(faction.id)}>
              <span className="seal-dot h-2.5 w-2.5 rounded-full" data-faction={faction.id} />
              {faction.name}
            </button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {list.map((card) => (
            <CardFace key={card.id} defId={card.id} size="fill" />
          ))}
        </div>
      </main>
    </>
  );
}

function Binder({
  seal,
  setSeal,
  onBack,
}: {
  seal: Faction | "all";
  setSeal: (seal: Faction | "all") => void;
  onBack: () => void;
}) {
  const { address } = usePlayer();
  const [owned, setOwned] = useState<{ id: string; balance: number }[]>([]);
  const [hold, setHold] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setOwned([]);
      setHold("idle");
      return;
    }
    let cancel = false;
    setHold("loading");
    void veilBalances(address)
      .then((balances) => {
        if (cancel) return;
        setOwned(CARDS.map((card, index) => ({ id: card.id, balance: balances[index] ?? 0 })).filter((card) => card.balance > 0));
        setHold("ready");
      })
      .catch(() => {
        if (cancel) return;
        setOwned([]);
        setHold("error");
      });
    return () => {
      cancel = true;
    };
  }, [address]);

  const counts = new Map(owned.map((card) => [card.id, card.balance]));
  const ids = owned
    .map((card) => card.id)
    .filter((id) => {
      try {
        return seal === "all" || cardOf(id).faction === seal;
      } catch {
        return false;
      }
    });
  const meta = picked ? metadataFor(picked) : null;

  return (
    <>
      <Bar title="Binder" onBack={onBack} />
      <main className="mx-auto max-w-5xl px-4 pb-8">
        <p className="mb-3 text-sm text-ash">
          {address ? `Card NFTs held by ${shortAddr(address)}.` : isApk() ? "Make a wallet in the game. The binder reads the card NFTs that wallet holds." : "Connect a wallet. The binder reads the card NFTs that wallet holds."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cx("veil-btn", seal === "all" && "veil-btn-primary")} onClick={() => setSeal("all")}>
            All
          </button>
          {FACTIONS.map((faction) => (
            <button key={faction.id} type="button" className={cx("veil-btn", seal === faction.id && "veil-btn-primary")} onClick={() => setSeal(faction.id)}>
              <span className="seal-dot h-2.5 w-2.5 rounded-full" data-faction={faction.id} />
              {faction.name}
            </button>
          ))}
        </div>
        {!address ? null : hold === "loading" || hold === "idle" ? (
          <p className="mt-6 text-sm text-ash">Reading the wallet.</p>
        ) : hold === "error" ? (
          <p className="mt-6 text-sm text-danger">Could not read this wallet's cards.</p>
        ) : ids.length === 0 ? (
          <p className="mt-6 text-sm text-ash">No cards in this wallet yet.</p>
        ) : (
          <div className="veil-grid mt-4">
            {ids.map((id) => (
              <div key={id}>
                <CardFace defId={id} size="fill" selected={picked === id} onClick={() => setPicked(id)} />
                <p className="mt-1 text-center font-mono text-xs text-ash">×{counts.get(id)}</p>
              </div>
            ))}
          </div>
        )}
        {meta && picked && counts.has(picked) && (
          <div className="mt-4 rounded-md border border-line bg-panel p-3">
            <p className="text-sm font-medium">{meta.name}</p>
            <p className="mt-1 text-xs text-ash">
              Token #{meta.attributes.find((item) => item.trait_type === "Token ID")?.value} · {counts.get(picked)} held
              {meta.attributes.find((item) => item.trait_type === "Set") ? ` · ${meta.attributes.find((item) => item.trait_type === "Set")?.value}` : ""}
            </p>
            <pre className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed text-ash">{JSON.stringify(meta, null, 2)}</pre>
          </div>
        )}
      </main>
    </>
  );
}

