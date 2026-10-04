import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { shortAddr } from "@/veil/chain";
import { useInjected, type WalletKind } from "@/veil/connect";
import { isApk } from "@/veil/shell";

export function ConnectButton() {
  const address = useInjected((state) => state.address);
  const error = useInjected((state) => state.error);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isApk()) useInjected.getState().listen();
  }, []);

  useEffect(() => {
    if (!address) setOpen(false);
  }, [address]);

  useEffect(() => {
    if (!open && !pick) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setPick(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setPick(false);
      }
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, pick]);

  async function connect(kind: WalletKind) {
    setPick(false);
    setBusy(true);
    await useInjected.getState().connect(kind);
    setBusy(false);
  }

  if (isApk()) return null;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="veil-btn"
        disabled={busy}
        aria-expanded={address ? open : pick}
        aria-haspopup="menu"
        title={error ?? "MetaMask or Phantom on Polygon"}
        onClick={() => {
          if (address) setOpen((value) => !value);
          else setPick((value) => !value);
        }}
      >
        {busy ? "Connecting…" : address ? shortAddr(address) : (
          <>
            <span className="connect-label">Connect wallet</span>
            <span className="connect-short">Wallet</span>
          </>
        )}
        {address ? <ChevronDown className="h-4 w-4" aria-hidden /> : null}
      </button>
      {pick && !address ? (
        <div role="menu" className="wallet-sheet">
          <button type="button" role="menuitem" className="veil-btn w-full" onClick={() => void connect("metamask")}>
            MetaMask
          </button>
          <button type="button" role="menuitem" className="veil-btn w-full" onClick={() => void connect("phantom")}>
            Phantom
          </button>
        </div>
      ) : null}
      {open && address ? (
        <div role="menu" className="wallet-sheet">
          <button
            type="button"
            role="menuitem"
            className="veil-btn w-full"
            onClick={() => {
              useInjected.getState().logout();
              setOpen(false);
            }}
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}