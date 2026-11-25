/* Cipher Lock: crack a hidden glyph sequence. Each guess reports how many glyphs are
   LOCKED (right glyph, right slot) and how many DRIFT (right glyph, wrong slot). */
export const GLYPHS = ["◆", "▲", "●", "■", "✚", "★", "⬢", "✦"];
export const DIFFICULTY = {
  easy:   { length: 3, glyphs: 5, attempts: 8 },
  normal: { length: 4, glyphs: 6, attempts: 8 },
  hard:   { length: 5, glyphs: 7, attempts: 9 },
  elite:  { length: 5, glyphs: 8, attempts: 7 }
};

export function newPuzzle(difficulty = "normal", bonusAttempts = 0) {
  const d = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
  const pool = GLYPHS.slice(0, d.glyphs);
  const code = Array.from({ length: d.length }, () => pool[Math.floor(Math.random() * pool.length)]);
  return { code, pool, length: d.length, attempts: d.attempts + bonusAttempts, guesses: [], current: [], state: "playing" };
}

export function score(code, guess) {
  let locked = 0;
  const restCode = [], restGuess = [];
  code.forEach((g, i) => (g === guess[i] ? locked++ : (restCode.push(g), restGuess.push(guess[i]))));
  let drift = 0;
  for (const g of restGuess) {
    const j = restCode.indexOf(g);
    if (j >= 0) { drift++; restCode.splice(j, 1); }
  }
  return { locked, drift };
}

/** Submits the current guess; returns the puzzle (mutated). */
export function submit(p) {
  if (p.state !== "playing" || p.current.length !== p.length) return p;
  const r = score(p.code, p.current);
  p.guesses.push({ glyphs: [...p.current], ...r });
  p.current = [];
  if (r.locked === p.length) p.state = "won";
  else if (p.guesses.length >= p.attempts) p.state = "lost";
  return p;
}

/** Bonus attempts from a skill check: +1 per 5 points the roll beats the DC, max +3. Failing costs one. */
export function bonusFromRoll(total, dc) {
  if (total < dc) return -1;
  return Math.min(3, 1 + Math.floor((total - dc) / 5));
}
