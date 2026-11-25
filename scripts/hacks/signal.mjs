/* Signal Tuning: three dials (frequency, amplitude, phase) shape your carrier wave.
   Match the intercepted signal exactly before the window closes. */
export const RANGES = { freq: [1, 8], amp: [1, 5], phase: [0, 7] };
export const LEVELS = { easy: { time: 75, noise: 0 }, normal: { time: 60, noise: 0.08 }, hard: { time: 50, noise: 0.16 }, elite: { time: 45, noise: 0.24 } };

const pick = ([lo, hi], rand) => lo + Math.floor(rand() * (hi - lo + 1));

export function newSignal(difficulty = "normal", bonus = 0, rand = Math.random) {
  const lvl = LEVELS[difficulty] ?? LEVELS.normal;
  const target = { freq: pick(RANGES.freq, rand), amp: pick(RANGES.amp, rand), phase: pick(RANGES.phase, rand) };
  let dials;
  do dials = { freq: pick(RANGES.freq, rand), amp: pick(RANGES.amp, rand), phase: pick(RANGES.phase, rand) };
  while (dials.freq === target.freq && dials.amp === target.amp && dials.phase === target.phase);
  return { target, dials, noise: lvl.noise, seed: Math.floor(rand() * 1e6), state: "playing", time: Math.max(20, lvl.time + bonus * 10) };
}

/** 0–100: how closely the dials match, so players can feel when they're getting warmer. */
export function sync(p) {
  const part = (k) => 1 - Math.abs(p.dials[k] - p.target[k]) / (RANGES[k][1] - RANGES[k][0]);
  return Math.round(((part("freq") * 0.4) + (part("amp") * 0.3) + (part("phase") * 0.3)) * 100);
}

export function setDial(p, key, value) {
  if (p.state !== "playing" || !(key in RANGES)) return p;
  const [lo, hi] = RANGES[key];
  p.dials[key] = Math.min(hi, Math.max(lo, Math.round(Number(value))));
  return p;
}

export function lockIn(p) {
  if (p.state !== "playing") return p;
  const { dials: d, target: t } = p;
  if (d.freq === t.freq && d.amp === t.amp && d.phase === t.phase) p.state = "won";
  else p.time = Math.max(0, p.time - 5); // a wrong lock costs time
  return p;
}

/** SVG path for a wave across a 300x100 box; noisy waves wobble deterministically from the seed. */
export function wavePath({ freq, amp, phase }, noise = 0, seed = 0) {
  let d = "";
  for (let x = 0; x <= 300; x += 3) {
    const t = (x / 300) * Math.PI * 2;
    const jitter = noise ? Math.sin(x * 12.9898 + seed) * 43758.5453 % 1 * noise * 30 : 0;
    const y = 50 - Math.sin(t * freq + (phase * Math.PI) / 4) * amp * 8.5 + jitter;
    d += `${x ? "L" : "M"}${x} ${y.toFixed(1)}`;
  }
  return d;
}
