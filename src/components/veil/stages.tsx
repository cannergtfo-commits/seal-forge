import { useEffect, useState } from "react";
import { encodeFunctionData, formatEther } from "viem";
import { playerClient, sentBy, usePlayer } from "@/veil/connect";
import { STAGE } from "@/veil/deployed";
import { redactKey } from "@/veil/keys";
import { sendGame } from "@/veil/signer";
import { STAGES, ownedStageIds, readDrop, stageAbi, type StageArt } from "@/veil/stages";

type Row = {
  id: number;
  name: string;
  blurb: string;
  art: string;
  price: bigint;
  cap: bigint;
  sold: bigint;
  owned: boolean;
};

async function imageFrom(uri: string): Promise<string> {
  if (!uri.startsWith("https://")) return "";
  try {
    const res = await fetch(uri);
    const body = (await res.json()) as { image?: string; name?: string };
    return typeof body.image === "string" && body.image.startsWith("https://") ? body.image : "";
  } catch {
    return "";
  }
}

export function StageShop({ onBack }: { onBack: () => void }) {
  const { key, address } = usePlayer();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    void (async () => {
      const owned = address ? await ownedStageIds(address) : [];
      const known = new Map<number, StageArt>(STAGES.map((item) => [item.id, item]));
      const next = Math.max(...STAGES.map((item) => item.id), 0) + 8;
      const listed: Row[] = [];
      for (let id = 1; id < next; id++) {
        const drop = await readDrop(id);
        if (!drop) {
          if (id > STAGES.length) break;
          continue;
        }
        const art = known.get(id);
        const remote = art ? "" : await imageFrom(drop.uri);
        listed.push({
          id,
          name: art?.name ?? `Stage ${id}`,
          blurb: art?.blurb ?? "A later Seal Forge backdrop.",
          art: art?.wide ?? remote,
          price: drop.price,
          cap: drop.cap,
          sold: drop.sold,
          owned: owned.includes(id),
        });
      }
      if (!cancel) setRows(listed);
    })();
    return () => {
      cancel = true;
    };
  }, [address, note]);

  async function mint(row: Row) {
    setBusy(row.id);
    setError(null);
    setNote(null);
    try {
      const { address: payer, wallet } = await playerClient(key);
      const hash = await sendGame(key, payer, (nonce) =>
        wallet.sendTransaction({
          account: payer,
          chain: wallet.chain,
          to: STAGE,
          value: row.price,
          data: encodeFunctionData({ abi: stageAbi, functionName: "mint", args: [BigInt(row.id)] }),
          nonce,
        }),
      );
      await sentBy(hash, payer);
      setNote(`${row.name} is yours. Turn it on in Find a match.`);
    } catch (err) {
      setError(redactKey(err instanceof Error ? err.message : "The mint did not send.", key));
    } finally {
      setBusy(0);
    }
  }

  return (
    <>
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <button type="button" className="veil-btn" onClick={onBack}>
            Back
          </button>
          <div>
            <p className="text-xs tracking-widest text-brass">BACKDROPS</p>
            <h1 className="text-lg font-medium leading-tight">NFTS</h1>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-5xl gap-4 px-4 pb-10">
        <p className="text-sm leading-relaxed text-ash">Each backdrop is its own mint. Skyhold is 2,000 editions at 10 POL. The POL goes straight to the treasury. The contract cannot change that price or that cap. Own it, then choose it in Find a match.</p>
        {rows.map((row) => {
          const left = row.cap > row.sold ? row.cap - row.sold : 0n;
          return (
            <section key={row.id} className="stage-card">
              {row.art ? <img src={row.art} alt="" className="stage-card-art" /> : <div className="stage-card-art stage-card-empty" />}
              <div className="stage-card-copy">
                <h2>{row.name}</h2>
                <p>{row.blurb}</p>
                <p className="font-mono text-xs text-brass">
                  {formatEther(row.price)} POL · {left.toString()} of {row.cap.toString()} left
                </p>
                {row.owned && <p className="text-sm text-bone">You hold this one.</p>}
                <button type="button" className="veil-btn veil-btn-spark mt-3" disabled={busy !== 0 || left === 0n || !address} onClick={() => void mint(row)}>
                  {left === 0n ? "Sold out" : busy === row.id ? "Minting…" : `Mint for ${formatEther(row.price)} POL`}
                </button>
              </div>
            </section>
          );
        })}
        {rows.length === 0 && <p className="text-sm text-ash">The stage sale did not answer.</p>}
        {note && <p className="text-sm text-bone">{note}</p>}
        {error && <p className="text-sm text-danger">{error}</p>}
      </main>
    </>
  );
}
