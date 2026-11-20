/**
 * Combat and UI sound effects.
 *
 * Every sound is synthesized at runtime with WebAudio: oscillators, filtered
 * noise and envelopes. There are no sample files, so nothing here is borrowed
 * from another game and the bundle stays tiny.
 *
 * - One shared AudioContext, created lazily and unlocked on the first gesture.
 * - Master chain: voices -> bus gain (volume) -> soft compressor -> speakers.
 * - Settings (volume, mute) persist in localStorage under `seal-sfx`, separate
 *   from the music toggle in arena-music.ts.
 * - `useMatchSfx` diffs Match snapshots, so the table only needs one hook call.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { cardOf } from "@/veil/cards";
import type { Match } from "@/veil/logic";

export type SfxName =
  | "click"
  | "pick"
  | "play"
  | "set"
  | "attack"
  | "hit"
  | "smash"
  | "spell"
  | "trap"
  | "death"
  | "victory"
  | "defeat"
  | "deny"
  | "turn";

export type SfxSettings = { volume: number; muted: boolean };

const KEY = "seal-sfx";
const DEFAULTS: SfxSettings = { volume: 0.7, muted: false };

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

function readSettings(): SfxSettings {
  if (typeof localStorage === "undefined") return DEFAULTS;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<SfxSettings> | null;
    if (!raw) return DEFAULTS;
    const volume = typeof raw.volume === "number" && Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : DEFAULTS.volume;
    return { volume, muted: raw.muted === true };
  } catch {
    return DEFAULTS;
  }
}

let settings: SfxSettings = DEFAULTS;
let loaded = false;
const listeners = new Set<() => void>();

function current(): SfxSettings {
  if (!loaded && typeof window !== "undefined") {
    settings = readSettings();
    loaded = true;
  }
  return settings;
}

function save(next: SfxSettings) {
  settings = next;
  loaded = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode: keep it for this visit */
  }
  if (bus && ctx) bus.gain.setTargetAtTime(effective(), ctx.currentTime, 0.02);
  for (const fn of listeners) fn();
}

export function sfxSettings(): SfxSettings {
  return current();
}

export function setSfxVolume(volume: number) {
  const v = Math.min(1, Math.max(0, volume));
  save({ ...current(), volume: v, muted: v === 0 });
}

export function setSfxMuted(muted: boolean) {
  const s = current();
  save({ ...s, muted, volume: !muted && s.volume === 0 ? DEFAULTS.volume : s.volume });
}

export function toggleSfx(): boolean {
  setSfxMuted(!current().muted);
  return !current().muted;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SERVER_SETTINGS = () => DEFAULTS;

/** React view of the persisted settings. */
export function useSfxSettings(): SfxSettings {
  return useSyncExternalStore(subscribe, current, SERVER_SETTINGS);
}

// ---------------------------------------------------------------------------
// Audio graph

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let noise: AudioBuffer | null = null;
const lastAt = new Map<SfxName, number>();

/** Current effects level after mute, 0..1. Other synths (pack score) scale by it. */
export function sfxLevel() {
  return effective() / 0.9;
}

function effective() {
  const s = current();
  if (s.muted) return 0;
  // Perceptual curve so the slider feels even.
  return 0.9 * s.volume * s.volume;
}

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctx = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!Ctx) return null;
  try {
    ctx = new Ctx({ latencyHint: "interactive" });
  } catch {
    return null;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);
  bus = ctx.createGain();
  bus.gain.value = effective();
  bus.connect(comp);
  const len = Math.floor(ctx.sampleRate * 1.2);
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noise.getChannelData(0);
  // Deterministic noise (no Math.random) so every visit sounds the same.
  let seed = 0x5ea1;
  for (let i = 0; i < len; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = seed / 2147483648 - 1;
  }
  return ctx;
}

/** Resume the context inside a user gesture (browsers start it suspended). */
export function unlockSfx() {
  const c = context();
  if (c && c.state === "suspended") void c.resume().catch(() => undefined);
}

type Env = { at: number; a?: number; peak: number; d: number };

function envelope(g: GainNode, { at, a = 0.005, peak, d }: Env) {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + a);
  g.gain.exponentialRampToValueAtTime(0.0001, at + a + d);
}

function tone(
  c: AudioContext,
  out: AudioNode,
  o: { type: OscillatorType; f: number; f2?: number; at: number; a?: number; d: number; peak: number; detune?: number },
) {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(o.f, o.at);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, o.at + (o.a ?? 0.005) + o.d);
  if (o.detune) osc.detune.value = o.detune;
  envelope(g, { at: o.at, a: o.a, peak: o.peak, d: o.d });
  osc.connect(g);
  g.connect(out);
  osc.start(o.at);
  osc.stop(o.at + (o.a ?? 0.005) + o.d + 0.05);
}

function hiss(
  c: AudioContext,
  out: AudioNode,
  o: { at: number; a?: number; d: number; peak: number; type: BiquadFilterType; f: number; f2?: number; q?: number; offset?: number },
) {
  if (!noise) return;
  const src = c.createBufferSource();
  src.buffer = noise;
  const filter = c.createBiquadFilter();
  filter.type = o.type;
  filter.frequency.setValueAtTime(o.f, o.at);
  if (o.f2) filter.frequency.exponentialRampToValueAtTime(o.f2, o.at + (o.a ?? 0.005) + o.d);
  filter.Q.value = o.q ?? 0.8;
  const g = c.createGain();
  envelope(g, { at: o.at, a: o.a, peak: o.peak, d: o.d });
  src.connect(filter);
  filter.connect(g);
  g.connect(out);
  src.start(o.at, o.offset ?? 0);
  src.stop(o.at + (o.a ?? 0.005) + o.d + 0.05);
}

const VOICES: Record<SfxName, (c: AudioContext, out: AudioNode, t: number) => void> = {
  // A dry wooden tick for buttons.
  click(c, out, t) {
    tone(c, out, { type: "triangle", f: 1650, f2: 900, at: t, a: 0.002, d: 0.045, peak: 0.16 });
    hiss(c, out, { type: "bandpass", f: 3200, q: 2, at: t, a: 0.001, d: 0.025, peak: 0.08 });
  },
  // Softer lift for picking a card.
  pick(c, out, t) {
    hiss(c, out, { type: "bandpass", f: 1800, f2: 3600, q: 1.4, at: t, a: 0.01, d: 0.09, peak: 0.1 });
    tone(c, out, { type: "sine", f: 880, f2: 1240, at: t, a: 0.004, d: 0.08, peak: 0.05 });
  },
  // A card slapped onto stone: thump plus paper slap.
  play(c, out, t) {
    tone(c, out, { type: "sine", f: 150, f2: 48, at: t, a: 0.003, d: 0.22, peak: 0.55 });
    hiss(c, out, { type: "bandpass", f: 2200, q: 1.1, at: t, a: 0.002, d: 0.07, peak: 0.25 });
    hiss(c, out, { type: "lowpass", f: 700, at: t + 0.01, a: 0.004, d: 0.16, peak: 0.12 });
  },
  // A trap set face-down: muffled and secretive.
  set(c, out, t) {
    hiss(c, out, { type: "bandpass", f: 900, q: 1.5, at: t, a: 0.003, d: 0.1, peak: 0.18 });
    tone(c, out, { type: "sine", f: 220, f2: 110, at: t + 0.02, a: 0.004, d: 0.18, peak: 0.12 });
  },
  // Steel cutting air.
  attack(c, out, t) {
    hiss(c, out, { type: "bandpass", f: 420, f2: 2600, q: 2.2, at: t, a: 0.08, d: 0.2, peak: 0.32 });
    tone(c, out, { type: "sawtooth", f: 180, f2: 90, at: t + 0.04, a: 0.03, d: 0.18, peak: 0.05 });
  },
  // A blow landing on a unit.
  hit(c, out, t) {
    tone(c, out, { type: "sine", f: 120, f2: 42, at: t, a: 0.002, d: 0.16, peak: 0.5 });
    hiss(c, out, { type: "lowpass", f: 2400, f2: 400, at: t, a: 0.001, d: 0.12, peak: 0.34 });
    tone(c, out, { type: "square", f: 310, f2: 140, at: t, a: 0.001, d: 0.05, peak: 0.05 });
  },
  // Heavy face damage: deeper, with a stone crack.
  smash(c, out, t) {
    tone(c, out, { type: "sine", f: 90, f2: 32, at: t, a: 0.002, d: 0.38, peak: 0.7 });
    hiss(c, out, { type: "lowpass", f: 3200, f2: 300, at: t, a: 0.001, d: 0.3, peak: 0.42 });
    hiss(c, out, { type: "highpass", f: 4500, at: t + 0.015, a: 0.001, d: 0.06, peak: 0.12 });
  },
  // A rising shimmer of glass and breath.
  spell(c, out, t) {
    [523.25, 783.99, 1046.5, 1567.98].forEach((f, i) => {
      tone(c, out, { type: "triangle", f, at: t + i * 0.055, a: 0.01, d: 0.42 - i * 0.05, peak: 0.09 });
      tone(c, out, { type: "sine", f: f * 2.005, at: t + i * 0.055, a: 0.01, d: 0.25, peak: 0.025 });
    });
    hiss(c, out, { type: "highpass", f: 2400, f2: 7000, at: t, a: 0.18, d: 0.32, peak: 0.08 });
  },
  // A sprung trap: metallic snap and a falling sting.
  trap(c, out, t) {
    hiss(c, out, { type: "highpass", f: 3000, at: t, a: 0.001, d: 0.04, peak: 0.3 });
    [587.33, 830.6, 1244.5].forEach((f) => tone(c, out, { type: "square", f, f2: f * 0.94, at: t, a: 0.002, d: 0.28, peak: 0.045 }));
    tone(c, out, { type: "sawtooth", f: 740, f2: 185, at: t + 0.06, a: 0.01, d: 0.36, peak: 0.08 });
    tone(c, out, { type: "sine", f: 110, f2: 55, at: t, a: 0.003, d: 0.2, peak: 0.3 });
  },
  // A unit breaking apart: falling growl and crumble.
  death(c, out, t) {
    tone(c, out, { type: "sawtooth", f: 330, f2: 55, at: t, a: 0.01, d: 0.55, peak: 0.12 });
    tone(c, out, { type: "sine", f: 160, f2: 40, at: t, a: 0.005, d: 0.45, peak: 0.3 });
    hiss(c, out, { type: "bandpass", f: 1800, f2: 220, q: 0.9, at: t + 0.04, a: 0.03, d: 0.6, peak: 0.2 });
  },
  // A rising brass fanfare in a major key.
  victory(c, out, t) {
    const notes = [261.63, 329.63, 392, 523.25];
    notes.forEach((f, i) => {
      tone(c, out, { type: "sawtooth", f, at: t + i * 0.13, a: 0.02, d: 0.5, peak: 0.06 });
      tone(c, out, { type: "triangle", f: f / 2, at: t + i * 0.13, a: 0.02, d: 0.5, peak: 0.08 });
    });
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(c, out, { type: "triangle", f, at: t + 0.55, a: 0.04, d: 1.4, peak: 0.07 }));
    tone(c, out, { type: "sine", f: 65.41, at: t + 0.55, a: 0.02, d: 1.2, peak: 0.25 });
    hiss(c, out, { type: "highpass", f: 5000, at: t + 0.55, a: 0.05, d: 0.9, peak: 0.05 });
  },
  // A slow minor fall with a toll.
  defeat(c, out, t) {
    [440, 349.23, 293.66, 220].forEach((f, i) => {
      tone(c, out, { type: "triangle", f, at: t + i * 0.32, a: 0.03, d: 0.7, peak: 0.08 });
      tone(c, out, { type: "sine", f: f / 2, at: t + i * 0.32, a: 0.03, d: 0.7, peak: 0.06 });
    });
    tone(c, out, { type: "sine", f: 55, at: t + 1.0, a: 0.01, d: 1.6, peak: 0.3 });
    tone(c, out, { type: "sine", f: 55 * 2.76, at: t + 1.0, a: 0.01, d: 1.0, peak: 0.04 });
  },
  // Two low buzzes: "not allowed".
  deny(c, out, t) {
    tone(c, out, { type: "square", f: 150, at: t, a: 0.004, d: 0.07, peak: 0.07 });
    tone(c, out, { type: "square", f: 118, at: t + 0.1, a: 0.004, d: 0.09, peak: 0.07 });
  },
  // A soft bell when your turn begins.
  turn(c, out, t) {
    tone(c, out, { type: "sine", f: 659.25, at: t, a: 0.005, d: 0.9, peak: 0.12 });
    tone(c, out, { type: "sine", f: 659.25 * 2.4, at: t, a: 0.005, d: 0.4, peak: 0.03 });
    tone(c, out, { type: "sine", f: 987.77, at: t + 0.09, a: 0.005, d: 0.8, peak: 0.07 });
  },
};

/** Minimum gap between two plays of the same sound, so bursts don't clip. */
const GAP_MS: Partial<Record<SfxName, number>> = { click: 35, pick: 35, hit: 45, death: 70, play: 60 };

/**
 * Play one sound. `delayMs` staggers layered combat beats.
 * Silent when muted, hidden, or before the browser allows audio.
 */
export function playSfx(name: SfxName, delayMs = 0) {
  if (typeof document !== "undefined" && document.hidden) return;
  if (effective() <= 0) return;
  const c = context();
  if (!c || !bus) return;
  if (c.state === "suspended") void c.resume().catch(() => undefined);
  if (c.state === "closed") return;
  const now = performance.now() + delayMs;
  const gap = GAP_MS[name] ?? 0;
  const prev = lastAt.get(name) ?? -Infinity;
  if (now - prev < gap) return;
  lastAt.set(name, now);
  try {
    VOICES[name](c, bus, c.currentTime + 0.005 + delayMs / 1000);
  } catch {
    /* a sound must never break the game */
  }
}

// ---------------------------------------------------------------------------
// UI clicks, app-wide

let uiInstalled = false;

/**
 * One delegated listener: buttons click, cards lift. Also unlocks the
 * AudioContext on the first gesture. Safe to call many times.
 */
export function installUiSfx() {
  if (uiInstalled || typeof document === "undefined") return;
  uiInstalled = true;
  document.addEventListener(
    "pointerdown",
    (event) => {
      unlockSfx();
      const el = (event.target as Element | null)?.closest?.("button, [role='button'], a.veil-btn");
      if (!el || (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return;
      if (el.closest("[data-sfx='off']")) return;
      playSfx(el.classList.contains("veil-card") ? "pick" : "click");
    },
    { capture: true, passive: true },
  );
  document.addEventListener("keydown", () => unlockSfx(), { capture: true, passive: true, once: true });
}

// ---------------------------------------------------------------------------
// Match diff -> sounds

type Snap = {
  turn: number;
  phase: string;
  winner: number | null;
  attackers: string;
  seats: { hp: number; units: Map<string, number>; traps: Set<string>; grave: number; graveTop: string[] }[];
};

function snap(m: Match): Snap {
  return {
    turn: m.turn,
    phase: m.phase,
    winner: m.winner,
    attackers: m.attackers.join("|"),
    seats: m.players.map((p) => ({
      hp: p.hp,
      units: new Map(p.units.map((u) => [u.uid, u.hp])),
      traps: new Set(p.traps.map((t) => t.uid)),
      grave: p.grave.length,
      graveTop: p.grave.slice(-4),
    })),
  };
}

function isSpell(defId: string) {
  try {
    return cardOf(defId).kind === "spell";
  } catch {
    return false;
  }
}

/**
 * The events a state change implies, with stagger offsets. Exported for tests
 * and for callers that want sounds without the hook. Side 0 is "you".
 */
export function diffSfx(a: Snap, b: Snap, grave: [string[], string[]]): Array<[SfxName, number]> {
  const out: Array<[SfxName, number]> = [];
  if (a.winner === null && b.winner !== null) {
    out.push([b.winner === 0 ? "victory" : "defeat", 250]);
  }
  if (!a.attackers && b.attackers) out.push(["attack", 0]);
  let unitHit = false;
  let faceHit = 0;
  let died = false;
  let born = false;
  let set = false;
  let sprung = false;
  let spell = false;
  b.seats.forEach((sb, side) => {
    const sa = a.seats[side];
    if (!sa) return;
    if (sb.hp < sa.hp) faceHit = Math.max(faceHit, sa.hp - sb.hp);
    for (const [uid, hp] of sb.units) {
      const before = sa.units.get(uid);
      if (before === undefined) born = true;
      else if (hp < before) unitHit = true;
    }
    for (const uid of sa.units.keys()) if (!sb.units.has(uid)) died = true;
    for (const uid of sb.traps) if (!sa.traps.has(uid)) set = true;
    for (const uid of sa.traps) if (!sb.traps.has(uid)) sprung = true;
    if (sb.grave > sa.grave) {
      const added = grave[side].slice(-(sb.grave - sa.grave));
      if (added.some(isSpell)) spell = true;
    }
  });
  if (spell) out.push(["spell", 0]);
  if (sprung) out.push(["trap", 0]);
  if (born) out.push(["play", spell ? 120 : 0]);
  if (set) out.push(["set", 0]);
  if (faceHit) out.push([faceHit >= 3 ? "smash" : "hit", sprung ? 140 : 60]);
  else if (unitHit) out.push(["hit", sprung || spell ? 140 : 60]);
  if (died) out.push(["death", 220]);
  if (b.winner === null && b.turn === 0 && b.phase === "main" && !(a.turn === 0 && a.phase === "main")) out.push(["turn", 120]);
  return out;
}

/**
 * Play combat sounds for every Match change. Call once from the table.
 * `error` plays the deny buzz whenever a new rejection message appears.
 */
export function useMatchSfx(match: Match, error?: string | null) {
  const prev = useRef<Snap | null>(null);
  useEffect(() => {
    installUiSfx();
  }, []);
  useEffect(() => {
    const next = snap(match);
    const before = prev.current;
    prev.current = next;
    // First paint or a fresh match: record only.
    if (!before || match.log.length <= 1) return;
    for (const [name, delay] of diffSfx(before, next, [match.players[0].grave, match.players[1].grave])) playSfx(name, delay);
  }, [match]);
  useEffect(() => {
    if (error) playSfx("deny");
  }, [error]);
}
