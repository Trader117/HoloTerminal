/* Firewall Run: move your probe through the grid to the data core. Every move, trace sentinels
   step along their patrol lines. Share a cell with one (or swap past one) and the trace locks you out. */
export const LEVELS = { easy: { size: 7, sentinels: 2, walls: 6 }, normal: { size: 7, sentinels: 3, walls: 8 },
  hard: { size: 8, sentinels: 4, walls: 10 }, elite: { size: 9, sentinels: 5, walls: 12 } };
const STEP = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

function reachable(size, walls, from, to) {
  const seen = new Set([from]); const q = [from];
  while (q.length) {
    const i = q.shift(); if (i === to) return true;
    const r = Math.floor(i / size), c = i % size;
    for (const [dr, dc] of Object.values(STEP)) {
      const nr = r + dr, nc = c + dc, j = nr * size + nc;
      if (nr < 0 || nc < 0 || nr >= size || nc >= size || walls.has(j) || seen.has(j)) continue;
      seen.add(j); q.push(j);
    }
  }
  return false;
}

export function newFirewall(difficulty = "normal", bonus = 0, rand = Math.random) {
  const lvl = LEVELS[difficulty] ?? LEVELS.normal;
  const size = lvl.size;
  const probe = (size - 1) * size;   // bottom-left
  const core = size - 1;             // top-right
  let walls;
  do {
    walls = new Set();
    while (walls.size < lvl.walls) {
      const i = Math.floor(rand() * size * size);
      if (i !== probe && i !== core) walls.add(i);
    }
  } while (!reachable(size, walls, probe, core));
  const sentinels = [];
  for (let k = 0; k < lvl.sentinels; k++) {
    const horizontal = k % 2 === 0;
    const line = 1 + Math.floor(rand() * (size - 2));         // keep the start row/col clear
    const pos = Math.floor(rand() * size);
    const r = horizontal ? line : pos, c = horizontal ? pos : line;
    if (walls.has(r * size + c)) walls.delete(r * size + c);
    sentinels.push({ r, c, dr: horizontal ? 0 : 1, dc: horizontal ? 1 : 0 });
  }
  const moves = size * 3 + bonus * 3;
  return { size, walls: [...walls], probe, core, sentinels, movesLeft: Math.max(6, moves), state: "playing" };
}

function stepSentinel(p, s, walls) {
  for (let tries = 0; tries < 2; tries++) {
    const nr = s.r + s.dr, nc = s.c + s.dc;
    if (nr >= 0 && nc >= 0 && nr < p.size && nc < p.size && !walls.has(nr * p.size + nc)) { s.r = nr; s.c = nc; return; }
    s.dr = -s.dr; s.dc = -s.dc; // bounce
  }
}

export function move(p, dir) {
  if (p.state !== "playing" || !STEP[dir]) return p;
  const walls = new Set(p.walls);
  const [dr, dc] = STEP[dir];
  const r = Math.floor(p.probe / p.size) + dr, c = (p.probe % p.size) + dc;
  if (r < 0 || c < 0 || r >= p.size || c >= p.size || walls.has(r * p.size + c)) return p; // bump: no turn used
  const before = p.sentinels.map((s) => s.r * p.size + s.c);
  const from = p.probe;
  p.probe = r * p.size + c;
  p.movesLeft--;
  if (p.probe === p.core) { p.state = "won"; return p; }
  p.sentinels.forEach((s) => stepSentinel(p, s, walls));
  const after = p.sentinels.map((s) => s.r * p.size + s.c);
  const caught = after.includes(p.probe) || after.some((a, i) => a === from && before[i] === p.probe);
  if (caught) p.state = "lost";
  else if (p.movesLeft <= 0) p.state = "lost";
  return p;
}

/** Cells for rendering: { kind: wall|probe|core|sentinel|open, warn: a sentinel could step here next }. */
export function cells(p) {
  const walls = new Set(p.walls);
  const sent = new Set(p.sentinels.map((s) => s.r * p.size + s.c));
  const warn = new Set(p.sentinels.map((s) => (s.r + s.dr) * p.size + (s.c + s.dc)));
  return Array.from({ length: p.size * p.size }, (_, i) => ({
    i, kind: i === p.probe ? "probe" : sent.has(i) ? "sentinel" : i === p.core ? "core" : walls.has(i) ? "wall" : "open",
    warn: warn.has(i) && !walls.has(i)
  }));
}
