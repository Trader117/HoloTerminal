/* Circuit Reroute: rotate tiles so power flows from the source (left edge) to the core (right edge).
   Each tile is a bitmask of open sides: N=1, E=2, S=4, W=8. The board is built from a random spanning
   tree, so every tile matters and a solution always exists; then every tile is spun at random. */
export const N = 1, E = 2, S = 4, W = 8;
const DIRS = [[N, -1, 0, S], [E, 0, 1, W], [S, 1, 0, N], [W, 0, -1, E]];
export const SIZES = { easy: { size: 4, time: 90 }, normal: { size: 5, time: 90 }, hard: { size: 6, time: 100 }, elite: { size: 7, time: 110 } };

export const rotate = (m) => ((m << 1) | (m >> 3)) & 15; // clockwise

export function newCircuit(difficulty = "normal", bonus = 0, rand = Math.random) {
  const { size, time } = SIZES[difficulty] ?? SIZES.normal;
  const tiles = new Array(size * size).fill(0);
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const r = Math.floor(cur / size), c = cur % size;
    const opts = DIRS.map(([bit, dr, dc, back]) => [bit, r + dr, c + dc, back])
      .filter(([, nr, nc]) => nr >= 0 && nr < size && nc >= 0 && nc < size && !seen.has(nr * size + nc));
    if (!opts.length) { stack.pop(); continue; }
    const [bit, nr, nc, back] = opts[Math.floor(rand() * opts.length)];
    const next = nr * size + nc;
    tiles[cur] |= bit; tiles[next] |= back;
    seen.add(next); stack.push(next);
  }
  const source = Math.floor(rand() * size) * size;              // a row on the left edge
  const sink = Math.floor(rand() * size) * size + (size - 1);   // a row on the right edge
  tiles[source] |= W; tiles[sink] |= E;
  const solution = [...tiles];
  for (let i = 0; i < tiles.length; i++) {
    let spins = Math.floor(rand() * 4);
    while (spins--) tiles[i] = rotate(tiles[i]);
  }
  const p = { size, tiles, solution, source, sink, state: "playing", time: Math.max(20, time + bonus * 15), moves: 0 };
  if (powered(p).has(sink) && (p.tiles[sink] & E)) rotateTile(p, sink); // never start solved
  return p;
}

/** Indices of tiles connected to the source. */
export function powered(p) {
  const on = new Set();
  if (!(p.tiles[p.source] & W)) return on;
  const queue = [p.source];
  on.add(p.source);
  while (queue.length) {
    const i = queue.shift();
    const r = Math.floor(i / p.size), c = i % p.size;
    for (const [bit, dr, dc, back] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (!(p.tiles[i] & bit) || nr < 0 || nr >= p.size || nc < 0 || nc >= p.size) continue;
      const j = nr * p.size + nc;
      if (!on.has(j) && (p.tiles[j] & back)) { on.add(j); queue.push(j); }
    }
  }
  return on;
}

export function rotateTile(p, i) {
  if (p.state !== "playing") return p;
  p.tiles[i] = rotate(p.tiles[i]);
  p.moves++;
  if (powered(p).has(p.sink) && (p.tiles[p.sink] & E)) p.state = "won";
  return p;
}

/** SVG for one tile: lines from the centre to each open side. */
export function tileSvg(mask, lit) {
  const seg = { [N]: "M50 50V0", [E]: "M50 50H100", [S]: "M50 50V100", [W]: "M50 50H0" };
  const d = [N, E, S, W].filter((b) => mask & b).map((b) => seg[b]).join("");
  return `<svg viewBox="0 0 100 100" class="ht-tile-svg${lit ? " lit" : ""}"><path d="${d}"/><circle cx="50" cy="50" r="9"/></svg>`;
}
