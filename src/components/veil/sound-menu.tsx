import { useEffect, useId, useRef, useState } from "react";
import { musicVolume, musicWanted, setMusicVolume, toggleArenaMusic } from "@/veil/arena-music";
import { playSfx, setSfxMuted, setSfxVolume, useSfxSettings } from "@/veil/sfx";

/**
 * Sound settings popover: effects on/off + volume, music on/off + volume.
 * Everything persists in localStorage. `onMusic` lets a parent keep its own
 * music toggle label in sync.
 */
export function SoundMenu({ onMusic }: { onMusic?: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const sfx = useSfxSettings();
  const [music, setMusic] = useState(musicWanted);
  const [mVol, setMVol] = useState(musicVolume);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    setMusic(musicWanted());
    const away = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const sfxOn = !sfx.muted && sfx.volume > 0;

  return (
    <div className="sound-menu" ref={root}>
      <button
        type="button"
        className="arena-btn sound-menu-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label="Sound settings"
        onClick={() => setOpen((v) => !v)}
      >
        <SpeakerIcon on={sfxOn || music} />
        <span className="sound-menu-label">Sound</span>
      </button>
      {open && (
        <div id={id} className="sound-sheet" role="group" aria-label="Sound settings">
          <div className="sound-row">
            <label className="sound-toggle">
              <input type="checkbox" checked={sfxOn} onChange={(e) => setSfxMuted(!e.target.checked)} />
              <span>Effects</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round((sfx.muted ? 0 : sfx.volume) * 100)}
              aria-label="Effects volume"
              onChange={(e) => setSfxVolume(Number(e.target.value) / 100)}
              onPointerUp={() => playSfx("hit")}
              onKeyUp={() => playSfx("click")}
            />
          </div>
          <div className="sound-row">
            <label className="sound-toggle">
              <input
                type="checkbox"
                checked={music}
                onChange={() => {
                  const on = toggleArenaMusic();
                  setMusic(on);
                  onMusic?.(on);
                }}
              />
              <span>Music</span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(mVol * 100)}
              aria-label="Music volume"
              onChange={(e) => setMVol(setMusicVolume(Number(e.target.value) / 100))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" className="sound-menu-icon">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {on ? (
        <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      ) : (
        <path d="M16.5 9.5l5 5m0-5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      )}
    </svg>
  );
}
