import { useEffect, useState, type FormEvent } from "react";
import { formatUnits, parseEther, parseUnits } from "viem";
import { CardFace } from "@/components/veil/card";
import { ConnectButton } from "@/components/veil/connect-button";
import { BzbBox, useBzbQuote } from "@/components/veil/bzb-box";
import { FundGuide, ImportWalletWarning, KeyBackup, KeyRestore, KeyWarning } from "@/components/veil/new-player";
import { CARDS, cardOf, type CardDef } from "@/veil/cards";
import { POLYGON_CHAIN_ID, shortAddr } from "@/veil/chain";
import { sendActive, sendBzb, sendVeilCard, useInjected, usePlayer } from "@/veil/connect";
import { grantAllowances, readAllowances, type AllowanceRow } from "@/veil/allowances";
import { ASHEN_NFT, BLAZAR_NFT, BZB, CARDS_NFT, KAGE_NFT } from "@/veil/deployed";
import { veilBalances } from "@/veil/holds";
import { redactKey, usePolKey } from "@/veil/keys";
import { isApk } from "@/veil/shell";
import { isPolAddress, polLabel, polygonClient, spendableAmount } from "@/veil/pol";

function message(error: unknown): string {
  if (typeof error === "object" && error) {
    if ("shortMessage" in error && typeof error.shortMessage === "string") return error.shortMessage;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return "The network refused that.";
}

function trimUnits(raw: bigint) {
  const [whole, frac = ""] = formatUnits(raw, 18).split(".");
  const cut = frac.replace(/0+$/, "");
  return cut ? `${whole}.${cut}` : whole;
}

function contractFor(card: CardDef) {
  if (card.edition === "ashen") return ASHEN_NFT;
  if (card.edition === "kage") return KAGE_NFT;
  if (card.edition === "blazar") return BLAZAR_NFT;
  return CARDS_NFT;
}

const bzbAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] }] as const;

type Held = { id: string; balance: number };

export function PolygonWallet({ onBack }: { onBack: () => void }) {
  const key = usePolKey((state) => state.key);
  const { address, external, ready: playerReady } = usePlayer();
  const connectError = useInjected((state) => state.error);
  const sent = usePolKey((state) => state.sent);
  const create = usePolKey((state) => state.create);
  const importKey = usePolKey((state) => state.importKey);
  const erase = usePolKey((state) => state.erase);
  const note = usePolKey((state) => state.note);
  const [balance, setBalance] = useState<string | null>(null);
  const [bzbExact, setBzbExact] = useState("");
  const [held, setHeld] = useState<Held[]>([]);
  const [holdState, setHoldState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [mode, setMode] = useState<"pol" | "bzb" | "card">("pol");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [cardId, setCardId] = useState("");
  const [qty, setQty] = useState("1");
  const [importOpen, setImportOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [armErase, setArmErase] = useState(false);
  const [copied, setCopied] = useState(false);
  const [allowances, setAllowances] = useState<AllowanceRow[] | null>(null);
  const [allowStep, setAllowStep] = useState<string | null>(null);
  const { quote } = useBzbQuote();

  useEffect(() => {
    if (!isApk()) return;
    window.SealVault?.secure(showKey);
    return () => window.SealVault?.secure(false);
  }, [showKey]);

  useEffect(() => {
    if (!address) return;
    let cancel = false;
    setBalance(null);
    setHoldState("loading");
    Promise.all([
      polygonClient.getBalance({ address }),
      polygonClient.readContract({ address: BZB, abi: bzbAbi, functionName: "balanceOf", args: [address] }),
    ])
      .then(async ([wei, bzb]) => {
        if (cancel) return;
        setBalance(polLabel(wei));
        setBzbExact(trimUnits(bzb));
        try {
          const [counts, flags] = await Promise.all([veilBalances(address), readAllowances(address)]);
          if (cancel) return;
          setHeld(CARDS.flatMap((card, index) => ((counts[index] ?? 0) > 0 ? [{ id: card.id, balance: counts[index]! }] : [])));
          setAllowances(flags);
          setHoldState("ready");
        } catch {
          if (!cancel) setHoldState("error");
        }
      })
      .catch((err: unknown) => {
        if (cancel) return;
        setHoldState("error");
        setError(redactKey(message(err), key));
      });
    return () => {
      cancel = true;
    };
  }, [address, notice]);

  useEffect(() => {
    if (!cardId && held[0]) setCardId(held[0].id);
    if (cardId && !held.some((card) => card.id === cardId)) setCardId(held[0]?.id ?? "");
  }, [held, cardId]);

  function destAddress() {
    const dest = to.trim();
    if (!isPolAddress(dest)) {
      setError("That is not a Polygon address.");
      return null;
    }
    if (address && dest.toLowerCase() === address.toLowerCase()) {
      setError("That is this wallet.");
      return null;
    }
    return dest;
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      setError("Could not copy.");
    }
  }

  async function fillMax() {
    if (!address) return;
    setError(null);
    try {
      if (mode === "bzb") setAmount(bzbExact || "0");
      else setAmount(await spendableAmount(address));
    } catch (err) {
      setError(redactKey(message(err), key));
    }
  }

  async function onAllow() {
    if (!address) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await grantAllowances(key, (label, index, total) => setAllowStep(`${label} (${index} of ${total})`));
      setAllowances(await readAllowances(address));
      setNotice("Packs and the market can use this wallet.");
    } catch (err) {
      setError(redactKey(message(err), key));
      try {
        setAllowances(await readAllowances(address));
      } catch {
        /* the list stays as it was */
      }
    } finally {
      setAllowStep(null);
      setBusy(false);
    }
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    if (!address) return;
    const dest = destAddress();
    if (!dest) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "card") {
        const card = held.find((item) => item.id === cardId);
        const def = card ? cardOf(card.id) : null;
        const count = Number(qty);
        if (!card || !def) throw new Error("Pick a card this wallet holds.");
        if (!Number.isInteger(count) || count < 1 || count > card.balance) throw new Error("That amount is more than you hold.");
        const hash = await sendVeilCard(key, contractFor(def), def.tokenId, count, dest);
        note({ hash, to: dest, amount: String(count), asset: def.name, at: Date.now() });
        setNotice(`Sent ${def.name}. ${shortAddr(hash)}`);
      } else if (mode === "bzb") {
        if (!/^\d+(\.\d{1,18})?$/.test(amount) || parseUnits(amount, 18) <= 0n) throw new Error("Enter an amount of BzB.");
        const hash = await sendBzb(key, dest, amount);
        note({ hash, to: dest, amount, asset: "BzB", at: Date.now() });
        setNotice(`Sent BzB. ${shortAddr(hash)}`);
        setAmount("");
      } else {
        if (!/^\d+(\.\d{1,18})?$/.test(amount) || parseEther(amount) <= 0n) throw new Error("Enter an amount of POL.");
        const hash = await sendActive(key, dest, amount);
        note({ hash, to: dest, amount, asset: "POL", at: Date.now() });
        setNotice(`Sent POL. ${shortAddr(hash)}`);
        setAmount("");
      }
      setTo("");
    } catch (err) {
      setError(redactKey(message(err), key));
    } finally {
      setBusy(false);
    }
  }

  function onImport(event: FormEvent) {
    event.preventDefault();
    const problem = importKey(secret);
    if (problem) {
      setError(problem);
      return;
    }
    setSecret("");
    setImportOpen(false);
    setShowKey(false);
    setError(null);
    setNotice("Imported.");
  }

  const picked = held.find((card) => card.id === cardId);

  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" className="veil-btn" onClick={onBack}>
            Back
          </button>
          <div>
            <p className="text-xs tracking-widest text-brass">POLYGON · {POLYGON_CHAIN_ID}</p>
            <h1 className="text-lg font-medium leading-tight">Wallet</h1>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <ConnectButton />
          <BzbBox />
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-4 px-4 pb-10">
        {connectError && <p className="text-sm text-danger">{connectError}</p>}
        {!playerReady ? (
          <p className="text-sm text-ash">Opening the wallet…</p>
        ) : !address ? (
          <section className="rounded-md border border-brass bg-panel p-4">
            <h2 className="text-lg font-medium">No wallet yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-ash">{isApk() ? "This phone uses the wallet made in the game. Packs, the market, and transfers sign with that key. It should not hold a large balance." : "Connect an extension, or keep a key in this browser. Packs, the market, and transfers use whichever is active. The browser key should not hold a large balance."}</p>
            <KeyWarning />
            <ImportWalletWarning />
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="veil-btn veil-btn-primary" onClick={() => create()}>
                Create wallet
              </button>
              <button
                type="button"
                className="veil-btn"
                onClick={() =>
                  setImportOpen((open) => {
                    if (open) setSecret("");
                    return !open;
                  })
                }
              >
                Import a key
              </button>
            </div>
            {importOpen && (
              <form className="mt-4 grid gap-2" autoComplete="off" onSubmit={onImport}>
                <label className="text-sm text-ash" htmlFor="import-key">
                  Private key
                </label>
                <input
                  id="import-key"
                  className="veil-field font-mono text-sm"
                  type="password"
                  name="veil-import-secret"
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  translate="no"
                  data-1p-ignore="true"
                  data-lpignore="true"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                />
                <button type="submit" className="veil-btn veil-btn-primary w-fit">
                  Import
                </button>
              </form>
            )}
            <KeyRestore onRestored={importKey} />
          </section>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2">
              <article className="rounded-md border border-brass bg-panel p-4">
                <p className="text-xs tracking-widest text-ash">POL</p>
                <p className="mt-1 font-mono text-3xl">{balance ?? "…"}</p>
                <p className="mt-2 text-xs text-ash">Gas for every send.</p>
              </article>
              <article className="rounded-md border border-brass bg-panel p-4">
                <p className="text-xs tracking-widest text-ash">BZB</p>
                <p className="mt-1 font-mono text-3xl">{quote?.amount ?? "…"}</p>
                <p className="mt-2 text-xs text-ash">{quote ? `${quote.usd} · ${quote.price} each` : "Reading the pool…"}</p>
              </article>
            </section>

            <section className="rounded-md border border-line bg-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-all font-mono text-sm">{address}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="veil-btn" onClick={() => void copyAddress()}>
                    {copied ? "Copied" : "Copy"}
                  </button>
                  <a className="veil-btn" href={`https://polygonscan.com/address/${address}`} target="_blank" rel="noreferrer">
                    Polygonscan
                  </a>
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ash">
                {external ? "The extension signs. The browser key is idle." : isApk() ? "This phone key signs packs, the market, and sign-in." : "This game wallet signs packs, the market, and sign-in until you connect an extension."} Send only on Polygon.
              </p>
            </section>

            <section className="rounded-md border border-line bg-panel p-4">
              <h2 className="text-lg font-medium">Packs and market</h2>
              <p className="mt-2 text-sm leading-relaxed text-ash">Allow this wallet to spend BzB on packs and listings, and to place cards in the stalls. The approval is only for Seal Forge contracts, and it stays until you revoke it.</p>
              {allowances ? (
                <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                  {allowances.map((row) => (
                    <li key={row.id} className="flex items-center justify-between gap-3 text-sm">
                      <span>{row.label}</span>
                      <span className={row.ready ? "text-brass" : "text-ash"}>{row.ready ? "Allowed" : "Not yet"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ash">Reading allowances.</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className="veil-btn veil-btn-primary" disabled={busy || !balance || balance === "0.0000" || Boolean(allowances?.every((row) => row.ready))} onClick={() => void onAllow()}>
                  {allowStep ? `Allowing ${allowStep}` : allowances?.every((row) => row.ready) ? "Allowed" : "Allow packs and market"}
                </button>
              </div>
              {balance === "0.0000" && <p className="mt-2 text-sm text-danger">This wallet needs a little POL on Polygon before it can set allowances.</p>}
            </section>

            <section className="rounded-md border border-line bg-panel p-4">
              <h2 className="text-lg font-medium">Send</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {(["pol", "bzb", "card"] as const).map((item) => (
                  <button key={item} type="button" className={mode === item ? "veil-btn veil-btn-primary" : "veil-btn"} aria-pressed={mode === item} onClick={() => { setMode(item); setError(null); }}>
                    {item === "pol" ? "POL" : item === "bzb" ? "BzB" : "Card"}
                  </button>
                ))}
              </div>
              <form className="mt-4 grid gap-3" onSubmit={(event) => void onSend(event)}>
                {mode === "card" ? (
                  <label className="grid gap-1 text-sm text-ash">
                    Card
                    <select className="veil-field" value={cardId} onChange={(event) => setCardId(event.target.value)} disabled={!held.length}>
                      {held.length === 0 && <option value="">No cards in this wallet</option>}
                      {held.map((card) => (
                        <option key={card.id} value={card.id}>
                          {cardOf(card.id).name} · {card.balance}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="grid gap-1 text-sm text-ash">
                  To
                  <input className="veil-field font-mono text-sm" autoComplete="off" spellCheck={false} placeholder="0x…" value={to} onChange={(event) => setTo(event.target.value)} />
                </label>
                <label className="grid gap-1 text-sm text-ash">
                  Amount
                  <input
                    className="veil-field font-mono text-sm"
                    inputMode={mode === "card" ? "numeric" : "decimal"}
                    value={mode === "card" ? qty : amount}
                    onChange={(event) => (mode === "card" ? setQty(event.target.value) : setAmount(event.target.value))}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  {mode !== "card" && (
                    <button type="button" className="veil-btn" onClick={() => void fillMax()}>
                      Max
                    </button>
                  )}
                  {mode === "card" && picked && (
                    <button type="button" className="veil-btn" onClick={() => setQty(String(picked.balance))}>
                      All {picked.balance}
                    </button>
                  )}
                  <button type="submit" className="veil-btn veil-btn-primary" disabled={busy || (mode === "card" && !picked)}>
                    {busy ? "Sending…" : mode === "card" ? "Send card" : mode === "bzb" ? "Send BzB" : "Send POL"}
                  </button>
                </div>
              </form>
              {error && <p className="mt-2 text-sm text-danger">{error}</p>}
              {notice && <p className="mt-2 text-sm text-brass">{notice}</p>}
              {sent.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-ash">
                  {sent.map((tx) => (
                    <li key={tx.hash}>
                      {tx.amount} {tx.asset ?? "POL"} to {shortAddr(tx.to)} · {shortAddr(tx.hash)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-md border border-line bg-panel p-4">
              <h2 className="text-lg font-medium">Cards in this wallet</h2>
              {holdState === "loading" || holdState === "idle" ? <p className="mt-3 text-sm text-ash">Reading the wallet.</p> : null}
              {holdState === "error" ? <p className="mt-3 text-sm text-danger">Could not read the card NFTs.</p> : null}
              {holdState === "ready" && held.length === 0 ? <p className="mt-3 text-sm text-ash">No Seal Forge cards here yet.</p> : null}
              {held.length > 0 && (
                <div className="veil-grid mt-3">
                  {held.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      className="text-left"
                      onClick={() => {
                        setMode("card");
                        setCardId(card.id);
                        setQty("1");
                        setError(null);
                      }}
                    >
                      <CardFace defId={card.id} size="fill" selected={mode === "card" && cardId === card.id} />
                      <p className="mt-1 text-center font-mono text-xs text-ash">×{card.balance} · send</p>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-md border border-line bg-panel p-4">
              <h2 className="text-lg font-medium">Add POL</h2>
              <FundGuide />
            </section>

            {key ? (
              <section className="rounded-md border border-line bg-panel p-4">
                <h2 className="text-lg font-medium">{isApk() ? "Phone key" : "Browser key"}</h2>
                <p className="mt-2 text-sm text-ash">{external ? "Not used while the extension is connected." : isApk() ? "Signs from this phone. Showing it blocks screenshots until you hide it." : "Signs until you connect an extension."}</p>
                <KeyWarning />
            <ImportWalletWarning />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="veil-btn" onClick={() => setShowKey((open) => !open)}>
                    {showKey ? "Hide key" : "Show key"}
                  </button>
                  <button
                    type="button"
                    className="veil-btn"
                    onClick={() => {
                      if (!armErase) {
                        setArmErase(true);
                        return;
                      }
                      erase();
                      setArmErase(false);
                      setShowKey(false);
                      setBalance(null);
                      setNotice(null);
                    }}
                  >
                    {armErase ? "Erase key now" : "Erase wallet"}
                  </button>
                </div>
                {showKey && (
                  <input
                    readOnly
                    className="veil-field mt-3 font-mono text-xs"
                    aria-label="Private key"
                    translate="no"
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    value={key}
                  />
                )}
                <KeyBackup privateKey={key} />
              </section>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}