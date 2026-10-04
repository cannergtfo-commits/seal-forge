let track: HTMLAudioElement | null = null;
let wanted = true;
let live = false;
let watching = false;

function element() {
  if (typeof window === "undefined") return null;
  if (!track) {
    track = new Audio("/assets/veil/music/knight-of-the-ruins.mp3");
    track.loop = true;
    track.volume = 0.42;
    track.preload = "auto";
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
  watch();
  live = true;
  const audio = element();
  if (!audio || !wanted) return;
  void audio.play().catch(() => undefined);
}

export function arenaMusicOn() {
  return wanted && Boolean(track && !track.paused);
}

export function toggleArenaMusic() {
  watch();
  const audio = element();
  wanted = !wanted;
  if (!audio) return wanted;
  if (wanted && live) void audio.play().catch(() => undefined);
  else audio.pause();
  return wanted;
}

export function stopArenaMusic() {
  live = false;
  track?.pause();
}
