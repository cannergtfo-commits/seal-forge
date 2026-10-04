import { useEffect, useState } from "react";
import { readBzb, type BzbQuote } from "@/veil/bzb";
import { usePlayer } from "@/veil/connect";

export function useBzbQuote() {
  const { ready, address } = usePlayer();
  const [quote, setQuote] = useState<BzbQuote | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancel = false;
    const load = () => {
      void readBzb(address)
        .then((next) => {
          if (!cancel) setQuote(next);
        })
        .catch(() => {
          if (!cancel) setQuote(null);
        });
    };
    load();
    const timer = window.setInterval(load, 45_000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [ready, address]);

  return { ready, address, quote };
}

export function BzbBox() {
  const { ready, address, quote } = useBzbQuote();
  const amount = !ready || (address && !quote) ? "…" : (quote?.amount ?? "—");
  const value = !address ? "No wallet" : (quote?.usd ?? "");
  return (
    <div className="veil-box shrink-0 rounded-sm px-2.5 py-1.5 text-right">
      <p className="text-xs tracking-widest text-brass">BZB</p>
      <p className="font-mono text-sm leading-tight">{amount}</p>
      <p className="font-mono text-xs leading-tight text-ash">{value}</p>
    </div>
  );
}
