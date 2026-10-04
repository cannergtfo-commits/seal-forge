import { useEffect, useState, type FormEvent } from "react";
import { BzbBox } from "@/components/veil/bzb-box";
import { POLYGON_CHAIN_ID } from "@/veil/chain";
import { downloadText, openKey, sealKey } from "@/veil/keyfile";
import { usePolKey } from "@/veil/keys";
import { isApk } from "@/veil/shell";
import { addressOf, polLabel, polygonClient } from "@/veil/pol";

export function KeyWarning() {
  return (
    <p className="mt-3 flex gap-2 text-sm leading-relaxed text-danger">
      <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M8 1.2 15 14H1L8 1.2Zm0 4.3-.55 3.8h1.1L8 5.5Zm0 5.3a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
      </svg>
      <strong>Save your private key ASAP. Loss of cards or funds sent to a wallet generated on this site is not the game's responsibility and cannot be recovered.</strong>
    </p>
  );
}

export function ImportWalletWarning() {
  return (
    <p className="mt-3 flex gap-2 text-sm leading-relaxed text-danger">
      <svg className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M8 1.2 15 14H1L8 1.2Zm0 4.3-.55 3.8h1.1L8 5.5Zm0 5.3a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5Z" />
      </svg>
      <strong>
        {isApk()
          ? "This key stays on the phone, wrapped by the device keystore. Download the locked file and keep it off the phone. Do not paste the key into a chat, a site, or another app unless you mean to move the wallet."
          : "Import this key into MetaMask, or another wallet extension that can switch to Polygon. Then connect that wallet in the game. A key left only in this browser is not the wallet you should hold cards or funds in."}
      </strong>
    </p>
  );
}

export function FundGuide() {
  return (
    <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm leading-relaxed text-ash">
      <li>Buy POL on an exchange that can withdraw on Polygon.</li>
      <li>Withdraw to the address on this page. Choose the Polygon network, not Ethereum.</li>
      <li>Send a small amount first. Receiving does not cost you gas. This page shows the balance after the transfer lands.</li>
      <li>Keep a little POL in the wallet. Sending later pays a network fee from that balance.</li>
      <li>BzB is the token for packs and match rewards. Send it to this same address on Polygon.</li>
    </ol>
  );
}

export function KeyBackup({ privateKey }: { privateKey: string }) {
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (password !== again) {
      setError("Those passwords do not match.");
      return;
    }
    try {
      downloadText("seal-forge-key.json", await sealKey(privateKey, password));
      setSaved(true);
      setPassword("");
      setAgain("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not lock the key.");
    }
  }

  return (
    <form className="mt-3 grid gap-2" onSubmit={(event) => void onSubmit(event)}>
      <p className="text-sm leading-relaxed text-ash">Lock the private key in a file only this password can open. Keep the file off this browser.</p>
      <input className="veil-field" type="password" autoComplete="new-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <input className="veil-field" type="password" autoComplete="new-password" placeholder="Repeat password" value={again} onChange={(event) => setAgain(event.target.value)} />
      {error && <p className="text-sm text-danger">{error}</p>}
      {saved && <p className="text-sm text-brass">{isApk() ? "Locked key file saved in Downloads. The raw key is not in that file." : "Key file downloaded."}</p>}
      <button type="submit" className="veil-btn w-fit">
        Download key file
      </button>
    </form>
  );
}

export function KeyRestore({ onRestored }: { onRestored: (raw: string) => string | null }) {
  const [password, setPassword] = useState("");
  const [fileText, setFileText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const key = await openKey(fileText, password);
      const problem = onRestored(key);
      if (problem) setError(problem);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open that file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-4 grid gap-2" onSubmit={(event) => void onSubmit(event)}>
      <label className="text-sm text-ash" htmlFor="key-file">
        Key file
      </label>
      <input
        id="key-file"
        className="text-sm text-ash"
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          void file.text().then(setFileText);
        }}
      />
      <input className="veil-field" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
      {error && <p className="text-sm text-danger">{error}</p>}
      <button type="submit" className="veil-btn w-fit" disabled={busy || !fileText}>
        {busy ? "Opening…" : "Restore wallet"}
      </button>
    </form>
  );
}

export function NewPlayer({ onBack, onWallet }: { onBack: () => void; onWallet: () => void }) {
  const key = usePolKey((state) => state.key);
  const create = usePolKey((state) => state.create);
  const importKey = usePolKey((state) => state.importKey);
  const [ready, setReady] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const address = key ? addressOf(key) : null;

  useEffect(() => {
    const finish = () => setReady(true);
    const unsub = usePolKey.persist.onFinishHydration(finish);
    void usePolKey.persist.rehydrate();
    if (usePolKey.persist.hasHydrated()) finish();
    return unsub;
  }, []);

  useEffect(() => {
    if (!address) return;
    let cancel = false;
    polygonClient
      .getBalance({ address })
      .then((wei) => {
        if (!cancel) setBalance(polLabel(wei));
      })
      .catch(() => {
        if (!cancel) setBalance(null);
      });
    return () => {
      cancel = true;
    };
  }, [address]);

  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" className="veil-btn" onClick={onBack}>
            Back
          </button>
          <div>
            <p className="text-xs tracking-widest text-brass">NEW PLAYER</p>
            <h1 className="text-lg font-medium leading-tight">Your Polygon wallet</h1>
          </div>
        </div>
        <BzbBox />
      </header>
      <main className="mx-auto grid max-w-3xl gap-4 px-4 pb-10">
        {!ready ? (
          <p className="text-sm text-ash">Opening…</p>
        ) : !address || !key ? (
          <section className="rounded-md border border-brass bg-panel p-4">
            <h2 className="text-lg font-medium">Make a wallet on this device</h2>
            <p className="mt-2 text-sm leading-relaxed text-ash">The key stays in this browser. Download a locked copy before you send anything to it.</p>
            <KeyWarning />
            <ImportWalletWarning />
            <button type="button" className="veil-btn veil-btn-primary mt-4" onClick={() => create()}>
              Create wallet
            </button>
            <KeyRestore onRestored={importKey} />
          </section>
        ) : (
          <section className="rounded-md border border-brass bg-panel p-4">
            <p className="text-xs tracking-widest text-ash">POLYGON · {POLYGON_CHAIN_ID}</p>
            <p className="mt-2 break-all font-mono text-sm">{address}</p>
            <p className="mt-2 font-mono text-sm text-brass">{balance ?? "…"} POL</p>
            <KeyWarning />
            <ImportWalletWarning />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className="veil-btn"
                onClick={() => {
                  void navigator.clipboard.writeText(address).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy address"}
              </button>
              <button type="button" className="veil-btn veil-btn-primary" onClick={onWallet}>
                Open wallet
              </button>
            </div>
            <FundGuide />
            <KeyBackup privateKey={key} />
          </section>
        )}
      </main>
    </>
  );
}
