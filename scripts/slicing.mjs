/* Cipher Lock: crack a hidden glyph sequence. Each guess colours every glyph:
   LOCK (right glyph, right slot), DRIFT (in the code, wrong slot) or MISS.
   A good slicing check before starting reveals glyphs in place. Running out of
   attempts trips an alarm the slicer can push through for a few more tries; the
   second failure is a lockout that clears after a short timer. */
export const GLYPHS = ["◆", "▲", "●", "■", "✚", "★", "⬢", "✦"];
export const DIFFICULTY = {
  easy:   { length: 3, glyphs: 4, attempts: 8 },
  normal: { length: 4, glyphs: 5, attempts: 8 },
  hard:   { length: 5, glyphs: 6, attempts: 8 },
  elite:  { length: 5, glyphs: 8, attempts: 7 }
};
export const ALARM_ATTEMPTS = 3;   // extra tries after the alarm trips
export const LOCKOUT_SECONDS = 30; // wait after the final failure before a retry

/** Positive bonus = glyphs revealed (always leaves one slot hidden); negative = fewer attempts. */
export function newPuzzle(difficulty = "normal", bonus = 0) {
  const d = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
  const pool = GLYPHS.slice(0, d.glyphs);
  const code = Array.from({ length: d.length }, () => pool[Math.floor(Math.random() * pool.length)]);
  const reveal = Math.max(0, Math.min(d.length - 1, bonus));
  const slots = [...code.keys()].sort(() => Math.random() - 0.5).slice(0, reveal);
  const revealed = Object.fromEntries(slots.map((i) => [i, code[i]]));
  const p = { code, pool, length: d.length, attempts: Math.max(1, d.attempts + Math.min(0, bonus)), revealed,
    guesses: [], current: [], state: "playing", alarm: false };
  resetCurrent(p);
  return p;
}

function resetCurrent(p) { p.current = Array.from({ length: p.length }, (_, i) => p.revealed[i] ?? null); }

/** Per-slot marks for a guess: "lock", "drift" or "miss". */
export function marks(code, guess) {
  const out = guess.map((g, i) => (g === code[i] ? "lock" : null));
  const rest = code.filter((g, i) => out[i] !== "lock");
  guess.forEach((g, i) => {
    if (out[i]) return;
    const j = rest.indexOf(g);
    if (j >= 0) { out[i] = "drift"; rest.splice(j, 1); } else out[i] = "miss";
  });
  return out;
}

export function score(code, guess) {
  const m = marks(code, guess);
  return { locked: m.filter((x) => x === "lock").length, drift: m.filter((x) => x === "drift").length, marks: m };
}

/** Glyphs proven not to be anywhere in the code (marked miss with no lock/drift copy in that guess). */
export function ruledOut(p) {
  const out = new Set();
  for (const g of p.guesses) g.glyphs.forEach((x, i) => {
    if (g.marks?.[i] === "miss" && !g.glyphs.some((y, j) => y === x && g.marks[j] !== "miss")) out.add(x);
  });
  return out;
}

export function addGlyph(p, glyph) {
  if (p?.state !== "playing") return;
  const i = p.current.indexOf(null);
  if (i >= 0) p.current[i] = glyph;
}
export function removeGlyph(p) {
  if (p?.state !== "playing") return;
  for (let i = p.length - 1; i >= 0; i--) if (p.current[i] !== null && !(i in p.revealed)) { p.current[i] = null; return; }
}

/** Submits the current guess; returns the puzzle (mutated). State becomes "alarm" on the first run-out, "lost" on the second. */
export function submit(p) {
  if (p.state !== "playing" || p.current.includes(null)) return p;
  const r = score(p.code, p.current);
  p.guesses.push({ glyphs: [...p.current], ...r });
  resetCurrent(p);
  if (r.locked === p.length) p.state = "won";
  else if (p.guesses.length >= p.attempts) {
    p.state = p.alarm ? "lost" : "alarm";
    if (p.state === "lost") p.lockedUntil = Date.now() + LOCKOUT_SECONDS * 1000;
  }
  return p;
}

/** Push on after the alarm trips: a few more attempts, but security knows. */
export function pushThrough(p) {
  if (p.state !== "alarm") return p;
  p.alarm = true;
  p.attempts += ALARM_ATTEMPTS;
  p.state = "playing";
  return p;
}

/** Skill check bonus: +1 per 5 points the roll beats the DC (min 1), max +3. Failing gives -1.
   Cipher Lock reads it as glyphs revealed; the other games as extra time or moves. */
export function bonusFromRoll(total, dc) {
  if (total < dc) return -1;
  return Math.min(3, 1 + Math.floor((total - dc) / 5));
}
