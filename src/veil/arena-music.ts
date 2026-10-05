const MUSIC_KEY = "seal-music";

function storedWanted() {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem(MUSIC_KEY) !== "off";
}

let track: HTMLAudioElement | null = null;
let trackSrc = "/assets/veil/music/knight-of-the-ruins.mp3";
let wanted = storedWanted();
let live = false;
let watching = false;

const DEFAULT_TRACK = "/assets/veil/music/knight-of-the-ruins.mp3";

function element(src: string) {
  if (typeof window === "undefined") return null;
  if (!track) {
    track = new Audio(src);
    track.loop = true;
    track.volume = 0.42;
    track.preload = "auto";
    trackSrc = src;
    return track;
  }
  if (trackSrc !== src) {
    track.pause();
    track.src = src;
    track.load();
    trackSrc = src;
  }
  return track;
}

function watch() {
  if (watching || typeof document === "undefined") return;
  watching = true;
  document.addEventListener("visibilitychange", () => {
    const audio = track;
    if (!audio) return;
    if (document.hidden) audio.pause();
    else if (wanted && live) void audio.play().catch(() => undefined);
  });
}

export function armArenaMusic() {
  playArenaTrack(null);
}

/** A stage track replaces the hall music. Null keeps the usual match theme. */
export function playArenaTrack(src: string | null) {
  watch();
  live = true;
  const audio = element(src || DEFAULT_TRACK);
  if (!audio || !wanted) return;
  void audio.play().catch(() => undefined);
}

export function arenaMusicOn() {
  return wanted && Boolean(track && !track.paused);
}

export function musicWanted() {
  return wanted;
}

export function toggleArenaMusic() {
  watch();
  const audio = element(trackSrc);
  wanted = !wanted;
  try {
    localStorage.setItem(MUSIC_KEY, wanted ? "on" : "off");
  } catch {
    /* a private browser can still mute for this visit */
  }
  if (!audio) return wanted;
  if (wanted && live) void audio.play().catch(() => undefined);
  else audio.pause();
  return wanted;
}

export function stopArenaMusic() {
  live = false;
  track?.pause();
}
