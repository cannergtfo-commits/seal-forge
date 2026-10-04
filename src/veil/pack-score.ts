export type RarityTier = "basic" | "rare" | "legendary";

export type PackScore = {
  begin: () => void;
  reveal: (tier: RarityTier) => void;
  stop: () => void;
};

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

export function rarityTier(rarity: string, set?: string): RarityTier {
  if (set && set !== "founding") {
    if (rarity === "legendary") return "legendary";
    if (rarity === "rare") return "rare";
    return "basic";
  }
  if (rarity === "legendary" || rarity === "rare") return "legendary";
  if (rarity === "uncommon") return "rare";
  return "basic";
}

export function rarityLabel(rarity: string, set?: string): string {
  if (set && set !== "founding") {
    if (rarity === "legendary") return "Legendary";
    if (rarity === "rare") return "Rare";
    return "Basic";
  }
  if (rarity === "legendary" || rarity === "rare") return "Legendary";
  if (rarity === "uncommon") return "Rare";
  return "Common";
}

export function armPackScore(): PackScore | null {
  const Ctx = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx();
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(ctx.destination);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 520;
  filter.Q.value = 0.7;
  filter.connect(master);

  const bed = [110, 164.81, 220, 261.63];
  const drones = bed.map((freq, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = index === 0 ? "sawtooth" : "triangle";
    osc.frequency.value = freq;
    gain.gain.value = index === 0 ? 0.07 : 0.045;
    osc.connect(gain);
    gain.connect(filter);
    osc.start();
    return osc;
  });

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.16;
  lfoGain.gain.value = 160;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();

  const arp = [220, 261.63, 329.63, 392, 329.63, 261.63];
  let step = 0;
  let timer = 0;
  let dead = false;

  function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    if (dead) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const at = ctx.currentTime + delay;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(vol, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  return {
    begin() {
      if (dead) return;
      void ctx.resume();
      const at = ctx.currentTime;
      master.gain.cancelScheduledValues(at);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), at);
      master.gain.exponentialRampToValueAtTime(0.2, at + 0.6);
      if (!timer) {
        timer = window.setInterval(() => {
          tone(arp[step % arp.length] ?? 220, 0.42, "sine", 0.07);
          step += 1;
        }, 460);
      }
    },
    reveal(tier) {
      if (tier === "legendary") {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => tone(freq, 1.05, "triangle", 0.08, index * 0.045));
        return;
      }
      if (tier === "rare") {
        tone(493.88, 0.5, "triangle", 0.09);
        tone(739.99, 0.62, "sine", 0.05, 0.07);
        return;
      }
      tone(392, 0.24, "sine", 0.055);
    },
    stop() {
      if (dead) return;
      dead = true;
      window.clearInterval(timer);
      const at = ctx.currentTime;
      master.gain.cancelScheduledValues(at);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), at);
      master.gain.exponentialRampToValueAtTime(0.0001, at + 0.4);
      window.setTimeout(() => {
        for (const osc of drones) osc.stop();
        lfo.stop();
        void ctx.close();
      }, 450);
    },
  };
}
