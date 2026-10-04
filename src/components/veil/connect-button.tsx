import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { shortAddr } from "@/veil/chain";
import { useInjected } from "@/veil/connect";

export function ConnectButton() {
  const address = useInjected((state) => state.address);
  const error = useInjected((state) => state.error);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    useInjected.getState().listen();
  }, []);

  useEffect(() => {
    if (!address) setOpen(false);
  }, [address]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function connect() {
    setBusy(true);
    await useInjected.getState().connect();
    setBusy(false);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="veil-btn"
        disabled={busy}
        aria-expanded={address ? open : undefined}
        aria-haspopup={address ? "menu" : undefined}
        title={error ?? "MetaMask, Rabby, and other injected wallets on Polygon"}
        onClick={() => {
          if (address) setOpen((value) => !value);
          else void connect();
        }}
      >
        {busy ? "Connecting…" : address ? shortAddr(address) : "Connect wallet"}
        {address ? <ChevronDown className="h-4 w-4" aria-hidden /> : null}
      </button>
      {open && address ? (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-full rounded-md border border-brass bg-panel p-1">
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
