import { MODULE_ID } from "./store.mjs";

/* Galaxy map data.
   Planets come from data/planets.json, built from Wookieepedia (CC BY-SA 3.0; see data/ATTRIBUTION.md).
   Each row: [title, grid, region, sector, system, flags, weight, class, climate, terrain, routes]
   flags: 1 = Legends-only, 2 = canon and Legends both, 0 = canon only.
   Positions: one grid square = 100 map units. A planet sits inside its square at a spot seeded from its system's name,
   so worlds in the same system cluster together. The GM can drag any planet anywhere. */

export const SQ = 100;
export const GALAXY_HOOK = `${MODULE_ID}.galaxy`;
export const REGION_ORDER = ["Deep Core", "Core Worlds", "Colonies", "Inner Rim", "Expansion Region", "Mid Rim", "Outer Rim Territories", "Wild Space", "Unknown Regions"];
export const REGION_COLOR = {
  "Deep Core": "#ffe9b3", "Core Worlds": "#ffd27a", "Colonies": "#f6b860", "Inner Rim": "#e69a28", "Expansion Region": "#7cc6ef",
  "Mid Rim": "#2aa3df", "Outer Rim Territories": "#1d6f9c", "Wild Space": "#8fa3b3", "Unknown Regions": "#a596c8"
};

export function registerGalaxySettings() {
  game.settings.register(MODULE_ID, "galaxy", { scope: "world", config: false, type: Object, default: {},
    onChange: () => Hooks.callAll(GALAXY_HOOK) });
  game.settings.register(MODULE_ID, "galaxyLegends", { name: "Galaxy map: Legends planets", scope: "world", config: true, type: String, default: "all",
    choices: { all: "Show canon and Legends", canon: "Canon only" } });
  game.settings.register(MODULE_ID, "galaxyHours", { name: "Galaxy map: hours per grid square", hint: "Travel time for one grid square at hyperdrive class 1, off the hyperlanes. Lanes are twice as fast.",
    scope: "world", config: true, type: Number, default: 6 });
  game.settings.register(MODULE_ID, "galaxyClass", { name: "Galaxy map: default hyperdrive class", hint: "Used for route estimates until a ship is chosen.",
    scope: "world", config: true, type: Number, default: 2 });
}

/* ---------- helpers ---------- */
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const rand01 = (seed) => { let x = seed || 1; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
export const baseName = (title) => title.replace(/\/Legends$/, "").replace(/ \((planet|moon|celestial body)\)$/i, "");
export const slug = (title) => baseName(title).toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** "R-16" -> {col: 17, row: 15}. Accepts "R16", "R-16", "R–16". */
export function parseGrid(g) {
  const m = String(g ?? "").toUpperCase().match(/^\s*([A-Z])\s*[-–—]?\s*(\d{1,2})/);
  if (!m) return null;
  return { col: m[1].charCodeAt(0) - 65, row: Number(m[2]) - 1 };
}
export const gridLabel = (x, y) => `${String.fromCharCode(65 + Math.floor(x / SQ))}-${Math.floor(y / SQ) + 1}`;

/* ---------- loading ---------- */
let cache = null;
export async function loadGalaxy() {
  if (cache) return cache;
  const rows = await fetch(`modules/${MODULE_ID}/data/planets.json`).then((r) => r.json()).catch(() => []);
  cache = buildGalaxy(rows);
  return cache;
}
export function resetGalaxyCache() { cache = null; }

/** Merges canon and Legends pages, places planets, and builds lanes and region rings. */
export function buildGalaxy(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const [title, grid, region, sector, system, legendsOnly, weight, cls, climate, terrain, routes, subs] = r;
    const g = parseGrid(grid);
    if (!g) continue;
    const key = slug(title), legends = !!legendsOnly;
    const prev = byKey.get(key);
    const entry = { key, title, name: baseName(title), grid: `${String.fromCharCode(65 + g.col)}-${g.row + 1}`, g, region: normRegion(region), sector: /^none$/i.test(sector ?? "") ? "" : sector, system,
      weight: weight ?? 0, cls, climate, terrain, routes: routes ? routes.split("|").map((x) => x.replace(/\/Legends$/, "")) : [], subregions: subs ? subs.split("|") : [], canon: !legends, legends };
    if (!prev) { byKey.set(key, entry); continue; }
    // Keep the canon page's data; fill gaps from Legends; mark as in both.
    const [keep, other] = prev.canon ? [prev, entry] : [entry, prev];
    for (const f of ["region", "sector", "system", "cls", "climate", "terrain"]) keep[f] ||= other[f];
    keep.routes = [...new Set([...keep.routes, ...other.routes])];
    keep.subregions = [...new Set([...keep.subregions, ...other.subregions])];
    keep.weight = Math.max(keep.weight, other.weight);
    keep.canon = prev.canon || entry.canon; keep.legends = prev.legends || entry.legends || !entry.canon || !prev.canon;
    if (!keep.canon) keep.title = other.title;
    byKey.set(key, keep);
  }
  const planets = [...byKey.values()];
  for (const p of planets) {
    const seed = hash(p.system || p.key);
    const sx = 0.15 + rand01(seed) * 0.7, sy = 0.15 + rand01(seed ^ 0x9e3779b9) * 0.7;
    const off = p.system ? (rand01(hash(p.key)) - 0.5) * 0.08 : 0, off2 = p.system ? (rand01(hash(p.key) ^ 77) - 0.5) * 0.08 : 0;
    p.x = (p.g.col + sx + off) * SQ; p.y = (p.g.row + sy + off2) * SQ;
  }
  // Importance rank: longer articles are better-known worlds. Fields, belts, clusters and stations rank lower than worlds.
  const score = (p) => p.weight * (/asteroid|field|belt|cluster|nebula|station|comet|rings of/i.test(p.name) ? 0.25 : 1);
  const sorted = [...planets].sort((a, b) => score(b) - score(a));
  sorted.forEach((p, i) => { p.rank = i; });
  const cols = Math.max(21, ...planets.map((p) => p.g.col + 1)), rows_ = Math.max(21, ...planets.map((p) => p.g.row + 1));
  const rings = buildRings(planets);
  const bands = buildBands(planets, rings), sectors = buildSectors(planets, bands);
  const wedgeNames = new Set(CANON_REGIONS);
  return { sectors, subregions: buildSubregions(planets, cols, rows_, { skip: wedgeNames }), planets, byKey: new Map(planets.map((p) => [p.key, p])), cols, rows: rows_, lanes: buildLanes(planets), rings, bands, zones: buildZones(planets, cols, rows_, rings) };
}

/** Hyperlanes: every route named by at least 3 planets. The planets are joined by a minimum spanning tree, which
    follows the route's real shape without zig-zagging; gaps over 6 squares are left open. */
export function buildLanes(planets) {
  const byRoute = new Map();
  for (const p of planets) for (const r of p.routes) { if (!byRoute.has(r)) byRoute.set(r, []); byRoute.get(r).push(p); }
  const lanes = [];
  for (const [name, pts] of byRoute) {
    if (pts.length < 3) continue;
    const n = pts.length, inTree = new Array(n).fill(false), best = new Array(n).fill(Infinity), from = new Array(n).fill(-1);
    const edges = [];
    best[0] = 0;
    for (let it = 0; it < n; it++) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
      inTree[u] = true;
      if (from[u] >= 0 && best[u] <= SQ * 6) edges.push([pts[from[u]].key, pts[u].key]);
      for (let v = 0; v < n; v++) {
        if (inTree[v]) continue;
        const d = Math.hypot(pts[u].x - pts[v].x, pts[u].y - pts[v].y);
        if (d < best[v]) { best[v] = d; from[v] = u; }
      }
    }
    if (edges.length < 2) continue;
    // A label anchor: the edge nearest the middle of the lane's extent.
    const mx = pts.reduce((t, p) => t + p.x, 0) / n, my = pts.reduce((t, p) => t + p.y, 0) / n;
    const km = new Map(pts.map((p) => [p.key, p]));
    const mid = edges.reduce((a, e) => {
      const d = (k) => Math.hypot(km.get(k).x - mx, km.get(k).y - my);
      return d(e[0]) + d(e[1]) < d(a[0]) + d(a[1]) ? e : a;
    });
    lanes.push({ name, edges, mid, count: n, tier: n >= 40 ? 1 : n >= 12 ? 2 : 3, major: n >= 40 });
  }
  return lanes.sort((a, b) => b.count - a.count);
}

const REGION_ALIAS = { "Mid Rim Territories": "Mid Rim", "Inner Rim Territories": "Inner Rim", "Outer Rim": "Outer Rim Territories", "Outer Rim Territories/Legends": "Outer Rim Territories",
  "Core": "Core Worlds", "Core Regions": "Core Worlds", "Colonies region": "Colonies", "Expansion region": "Expansion Region" };
export const normRegion = (r) => { const first = String(r ?? "").split(";")[0].trim(); return REGION_ALIAS[first] ?? first; };
/** The nine main zones of the galaxy; sub-regions such as Hutt Space count toward the zone around them. */
const ZONE_OF = { "Hutt Space": "Outer Rim Territories", "The Slice": "Outer Rim Territories", "Galactic Core": "Deep Core", "The Interior": "Core Worlds",
  "New Territories": "Outer Rim Territories", "Tingel Arm": "Outer Rim Territories" };
export const zoneOf = (region) => (REGION_ORDER.includes(region) ? region : ZONE_OF[region] ?? null);

/**
 * Region zones: the map is cut into quarter-squares and each one takes the region most of its nearby planets
 * belong to (inverse-distance vote), then two smoothing passes tidy the edges. Empty space far from any planet stays blank.
 * Returns { res, cols, rows, cells: Int8Array (region index or -1), labels: [{region, x, y}] }.
 */
export function buildZones(planets, cols, rows, ringInfo = buildRings(planets)) {
  const res = 5, W = cols * res, H = rows * res, cell = SQ / res;
  const buckets = new Map();
  for (const p of planets) {
    const z = REGION_ORDER.indexOf(zoneOf(p.region));
    if (z < 0) continue;
    const k = `${p.g.col},${p.g.row}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push([p.x, p.y, z]);
  }
  let cells = new Int8Array(W * H).fill(-1);
  const votes = new Float32Array(REGION_ORDER.length);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = (i + 0.5) * cell, y = (j + 0.5) * cell, gc = Math.floor(i / res), gr = Math.floor(j / res);
    votes.fill(0); let any = false;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (const [px, py, z] of buckets.get(`${gc + a},${gr + b}`) ?? []) {
      const d = Math.hypot(px - x, py - y);
      if (d > SQ * 1.6) continue;
      votes[z] += 1 / (d / SQ + 0.35) ** 2; any = true;
    }
    // Ring prior: the region you'd expect at this distance from the core, so zones keep the galaxy's banded shape.
    const dist = Math.hypot(x - ringInfo.cx, y - ringInfo.cy);
    const ring = ringInfo.rings.find((r) => dist <= r.r);
    if (ring) { votes[REGION_ORDER.indexOf(ring.region)] += 2.2; any = true; }
    if (!any) continue;
    let best = 0; for (let z = 1; z < votes.length; z++) if (votes[z] > votes[best]) best = z;
    cells[j * W + i] = best;
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = new Int8Array(cells);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const counts = new Map(); let filled = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const v = cells[jj * W + ii]; if (v < 0) continue; filled++; counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      if (filled < 4) { next[j * W + i] = filled >= 3 && cells[j * W + i] >= 0 ? cells[j * W + i] : -1; continue; }
      let bv = cells[j * W + i], bc = counts.get(bv) ?? 0;
      for (const [v, c] of counts) if (c > bc) { bv = v; bc = c; }
      next[j * W + i] = bv;
    }
    cells = next;
  }
  // Labels: ring regions sit due north of the core in the middle of their band; others where they are thickest.
  const labels = [];
  let prevR = 0;
  const target = new Map();
  for (const r of ringInfo.rings) { target.set(r.region, [ringInfo.cx, ringInfo.cy - (prevR + r.r) / 2]); prevR = r.r; }
  for (let z = 0; z < REGION_ORDER.length; z++) {
    const t = target.get(REGION_ORDER[z]);
    let best = null, bs = -Infinity;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (cells[j * W + i] !== z) continue;
      let sc;
      if (t) sc = -Math.hypot((i + 0.5) * cell - t[0], (j + 0.5) * cell - t[1]);
      else { sc = 0; for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < W && jj < H && cells[jj * W + ii] === z) sc++; } }
      if (sc > bs) { bs = sc; best = [i, j]; }
    }
    if (best) labels.push({ region: REGION_ORDER[z], x: (best[0] + 0.5) * cell, y: (best[1] + 0.5) * cell });
  }
  return { res, cols, rows, W, H, cell, cells, labels };
}

/**
 * Region bands: each ring region's outer edge, measured in 72 directions from the core. In each direction the edge is
 * where 85% of that region's (and inner regions') planets lie inside, blended with the overall ring size where data is
 * thin, then smoothed. This keeps the familiar banded galaxy while following where the worlds actually are.
 */
export function buildBands(planets, ringInfo) {
  const N = 72, { cx, cy, rings } = ringInfo;
  const pts = planets.map((p) => {
    const z = REGION_ORDER.indexOf(zoneOf(p.region));
    const a = (Math.atan2(p.y - cy, p.x - cx) + Math.PI * 2) % (Math.PI * 2);
    return { z, a: Math.floor((a / (Math.PI * 2)) * N) % N, d: Math.hypot(p.x - cx, p.y - cy) };
  }).filter((p) => p.z >= 0 && p.z < rings.length + 2);
  const out = [];
  let prev = null;
  rings.forEach((ring, k) => {
    const zi = REGION_ORDER.indexOf(ring.region);
    let r = new Float32Array(N);
    for (let a = 0; a < N; a++) {
      const ds = pts.filter((p) => p.z <= zi && Math.min((p.a - a + N) % N, (a - p.a + N) % N) <= 3).map((p) => p.d).sort((x, y) => x - y);
      const q = k === rings.length - 1 ? 0.96 : 0.85;
      const pr = ds.length ? ds[Math.min(ds.length - 1, Math.floor(ds.length * q))] : ring.r;
      r[a] = (ds.length * pr + 12 * ring.r) / (ds.length + 12);
    }
    for (let pass = 0; pass < 3; pass++) {
      const n = new Float32Array(N);
      for (let a = 0; a < N; a++) n[a] = (r[(a + N - 2) % N] + 2 * r[(a + N - 1) % N] + 3 * r[a] + 2 * r[(a + 1) % N] + r[(a + 2) % N]) / 9;
      r = n;
    }
    if (prev) for (let a = 0; a < N; a++) r[a] = Math.max(r[a], prev[a] + SQ * 0.25);
    out.push({ region: ring.region, color: ring.color, r: Array.from(r, (v) => Math.round(v)) });
    prev = r;
  });
  return { cx, cy, n: N, bands: out };
}

/** Colours for the named sub-regions, picked to stand apart from the main region bands. */
const SUB_COLORS = ["#ff7eb6", "#7ee0c3", "#ffb454", "#b39dff", "#6fd3ff", "#ff8a65", "#c5e86c", "#f06292", "#4dd0e1", "#e6c36a", "#9fa8ff", "#81e6a1"];

/**
 * The six canon regions (The Galactic Explorer's Guide), laid out on the ring cells (5-degree slices of each main band).
 * - The Slice runs between the Perlemian Trade Route and the Corellian Run: in each ring its edges are where those
 *   two lanes' worlds actually sit, so it fans out from the Colonies to the Outer Rim.
 * - The rest of each ring, going clockwise from the Corellian Run (south, west, north), is split in canon order:
 *   Trailing Sectors, Western Reaches, the Interior, Unknown Regions, New Territories. The split points are chosen to
 *   agree with as many worlds' listed regions as possible; the Interior is strongly favoured in the inner rings.
 * Returns { n, cx, cy, rings: [{ inner, outer }], cells: (string|null)[][], names: [{name, color, label}] }.
 */
export const CANON_REGIONS = ["The Interior", "New Territories", "The Slice", "Trailing Sectors", "Western Reaches", "Unknown Regions"];
export const CANON_COLOR = { "The Interior": "#ffd36b", "New Territories": "#7ee0c3", "The Slice": "#ff7eb6", "Trailing Sectors": "#6fd3ff", "Western Reaches": "#c5e86c", "Unknown Regions": "#b39dff" };
const RING_ORDER = ["Trailing Sectors", "Western Reaches", "The Interior", "Unknown Regions", "New Territories"];

export function buildSectors(planets, B) {
  const N = B.n, K = B.bands.length, { cx, cy } = B, TAU = Math.PI * 2;
  const rings = B.bands.map((b, k) => ({ outer: b.r, inner: k ? B.bands[k - 1].r : new Array(N).fill(0) }));
  const place = (p) => {
    const ang = (Math.atan2(p.y - cy, p.x - cx) + TAU) % TAU, a = Math.floor((ang / TAU) * N) % N;
    const d = Math.hypot(p.x - cx, p.y - cy);
    return { ang, a, k: rings.findIndex((r) => d <= r.outer[a]) };
  };
  // Lane angle per ring: the circular median of the lane's worlds in that ring, filled in from neighbouring rings.
  const laneAngles = (route) => {
    const per = Array.from({ length: K }, () => []);
    for (const p of planets) if (p.routes?.includes(route)) { const { ang, k } = place(p); if (k >= 0) per[k].push(ang); }
    const out = per.map((angs) => {
      if (angs.length < 2) return null;
      const mean = Math.atan2(angs.reduce((t, a) => t + Math.sin(a), 0), angs.reduce((t, a) => t + Math.cos(a), 0));
      const rel = angs.map((a) => ((a - mean + Math.PI * 3) % TAU) - Math.PI).sort((x, y) => x - y);
      return (mean + rel[Math.floor(rel.length / 2)] + TAU) % TAU;
    });
    for (let k = 0; k < K; k++) if (out[k] === null) out[k] = out.slice(k + 1).find((v) => v !== null) ?? out.slice(0, k).reverse().find((v) => v !== null) ?? null;
    return out;
  };
  const perl = laneAngles("Perlemian Trade Route"), corr = laneAngles("Corellian Run");
  // Region votes per ring cell from the worlds' listed regions.
  const votes = Array.from({ length: K }, () => Array.from({ length: N }, () => new Map()));
  for (const p of planets) {
    const names = (p.subregions ?? []).filter((n) => RING_ORDER.includes(n));
    if (p.region === "Unknown Regions" && !names.includes("Unknown Regions")) names.push("Unknown Regions");
    if (!names.length) continue;
    const { a, k } = place(p); if (k < 0) continue;
    for (const [da, w] of [[0, 1], [-1, 0.4], [1, 0.4]]) { const m = votes[k][(a + da + N) % N]; for (const n of names) m.set(n, (m.get(n) ?? 0) + w); }
  }
  const interiorPrior = [9, 3, 2, 1.5, 0.35, 0, 0];
  const cells = [];
  for (let k = 0; k < K; k++) {
    const row = new Array(N).fill(null);
    // The Slice: from the Perlemian clockwise to the Corellian Run, when that is a real wedge (both lanes start at
    // Coruscant, so in the innermost rings they overlap and there is no Slice yet).
    let s0 = null, s1 = null;
    if (k > 0 && perl[k] !== null && corr[k] !== null) {
      const width = (corr[k] - perl[k] + TAU) % TAU;
      if (width > TAU / 36 && width < TAU / 2) { s0 = Math.round((perl[k] / TAU) * N) % N; s1 = Math.round((corr[k] / TAU) * N) % N; }
    }
    if (s0 !== null) for (let a = s0; a !== s1; a = (a + 1) % N) row[a] = "The Slice";
    // The rest: split in canon order by dynamic programming (each cell's label index never goes back).
    const arc = [];
    for (let i = 0, a = s1 ?? Math.round(((corr[k] ?? 0) / TAU) * N) % N; i < N; i++, a = (a + 1) % N) if (!row[a]) arc.push(a);
    const L = RING_ORDER.length, score = (a, l) => (votes[k][a].get(RING_ORDER[l]) ?? 0) + (RING_ORDER[l] === "The Interior" ? interiorPrior[k] ?? 0 : 0);
    const dp = arc.map(() => new Array(L).fill(-Infinity)), from = arc.map(() => new Array(L).fill(0));
    for (let l = 0; l < L; l++) dp[0][l] = score(arc[0], l);
    for (let i = 1; i < arc.length; i++) for (let l = 0; l < L; l++) {
      let best = -Infinity, bl = 0;
      for (let q = 0; q <= l; q++) { const v = dp[i - 1][q] - (q === l ? 0 : 0.5); if (v > best) { best = v; bl = q; } }
      dp[i][l] = best + score(arc[i], l); from[i][l] = bl;
    }
    if (arc.length) {
      let l = dp.at(-1).indexOf(Math.max(...dp.at(-1)));
      for (let i = arc.length - 1; i >= 0; i--) { row[arc[i]] = RING_ORDER[l]; l = from[i][l]; }
    }
    cells.push(row);
  }
  // Labels: in the cell with the most same-region neighbours, preferring thick bands.
  const count = new Map();
  for (const row of cells) for (const v of row) if (v) count.set(v, (count.get(v) ?? 0) + 1);
  const names = [...count.keys()].map((name) => {
    let best = null, bs = -1;
    for (let k = 0; k < K; k++) for (let a = 0; a < N; a++) {
      if (cells[k][a] !== name) continue;
      let sc = 0;
      for (let dk = -1; dk <= 1; dk++) for (let da = -2; da <= 2; da++) if (cells[k + dk]?.[(a + da + N) % N] === name) sc++;
      sc += (rings[k].outer[a] - rings[k].inner[a]) / SQ;
      if (sc > bs) { bs = sc; best = [k, a]; }
    }
    const [k, a] = best, ang = ((a + 0.5) / N) * TAU, r = (rings[k].inner[a] + rings[k].outer[a]) / 2;
    return { name, color: CANON_COLOR[name], cells: count.get(name), label: { x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r } };
  });
  return { n: N, cx, cy, rings, cells, names };
}

/**
 * Named sub-regions (Hutt Space, The Slice, Western Reaches...): each one with at least 8 member worlds gets an area
 * where its members outweigh other worlds nearby (closed, specks dropped, holes filled), and a smooth outline traced
 * from that area. Returns [{ name, color, count, W, H, cell, ox, oy, mask, lines: [[x,y,...]], label: {x,y} }].
 */
export function buildSubregions(planets, cols, rows, { min = 8, skip = new Set() } = {}) {
  const res = 6, cell = SQ / res, R = SQ * 1.3, GW = cols * res, GH = rows * res, rc = Math.ceil(R / cell);
  // Splat each world's influence onto the cells around it (only worlds that name a sub-region take part in the vote).
  const splat = (pts, into) => {
    for (const p of pts) {
      const ci = Math.floor(p.x / cell), cj = Math.floor(p.y / cell);
      for (let j = Math.max(0, cj - rc); j <= Math.min(GH - 1, cj + rc); j++) for (let i = Math.max(0, ci - rc); i <= Math.min(GW - 1, ci + rc); i++) {
        const d = Math.hypot(p.x - (i + 0.5) * cell, p.y - (j + 0.5) * cell); if (d > R) continue;
        into[j * GW + i] += 1 / (d / SQ + 0.3) ** 2;
      }
    }
    return into;
  };
  const labelled = planets.filter((p) => p.subregions?.length);
  const allW = splat(labelled, new Float32Array(GW * GH));
  const groups = new Map();
  for (const p of labelled) for (const n of p.subregions) { if (!groups.has(n)) groups.set(n, []); groups.get(n).push(p); }
  const out = [];
  const names = [...groups.keys()].filter((n) => groups.get(n).length >= min && !skip.has(n)).sort((a, b) => groups.get(b).length - groups.get(a).length);
  names.forEach((name, idx) => {
    const mem = groups.get(name);
    const winW = splat(mem, new Float32Array(GW * GH));
    // Working window: the members' extent plus a margin, in cells.
    const pad = 4 * res;
    const i0 = Math.max(0, Math.floor(Math.min(...mem.map((p) => p.x)) / cell) - pad), j0 = Math.max(0, Math.floor(Math.min(...mem.map((p) => p.y)) / cell) - pad);
    const i1 = Math.min(GW, Math.ceil(Math.max(...mem.map((p) => p.x)) / cell) + pad), j1 = Math.min(GH, Math.ceil(Math.max(...mem.map((p) => p.y)) / cell) + pad);
    const W = i1 - i0, H = j1 - j0;
    // A cell belongs when the members are a clear share of the worlds there. Small areas often sit inside bigger
    // ones (Tion Cluster inside The Slice), so the share needed scales with how common the area is overall.
    const share = Math.min(0.4, (6 * mem.length) / labelled.length);
    let m = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = (j + j0) * GW + i + i0, win = winW[k];
      if (win >= 1.2 && win >= allW[k] * share) m[j * W + i] = 1;
    }
    const morph = (src, grow) => {
      const o = new Uint8Array(W * H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        let hit = !grow;
        for (let a = -1; a <= 1 && hit !== grow; a++) for (let b = -1; b <= 1; b++) {
          const ii = i + a, jj = j + b, v = ii >= 0 && jj >= 0 && ii < W && jj < H ? src[jj * W + ii] : 0;
          if (grow ? v : !v) { hit = grow; break; }
        }
        o[j * W + i] = hit ? 1 : 0;
      }
      return o;
    };
    // Closing joins nearby clusters into one area.
    for (let k = 0; k < 3; k++) m = morph(m, true);
    for (let k = 0; k < 3; k++) m = morph(m, false);
    // Components: keep those holding a fair share of the members.
    const comp = new Int32Array(W * H).fill(-1), sizes = [];
    for (let s0 = 0; s0 < W * H; s0++) {
      if (!m[s0] || comp[s0] >= 0) continue;
      const id = sizes.length, st = [s0]; comp[s0] = id; let n = 0;
      while (st.length) {
        const k = st.pop(); n++;
        const i = k % W, j = (k - i) / W;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + a, jj = j + b, kk = jj * W + ii;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H || !m[kk] || comp[kk] >= 0) continue;
          comp[kk] = id; st.push(kk);
        }
      }
      sizes.push(n);
    }
    const hold = new Array(sizes.length).fill(0);
    for (const p of mem) { const i = Math.floor(p.x / cell) - i0, j = Math.floor(p.y / cell) - j0; if (i >= 0 && j >= 0 && i < W && j < H && comp[j * W + i] >= 0) hold[comp[j * W + i]]++; }
    const need = Math.max(4, Math.ceil(mem.length * 0.08));
    for (let k = 0; k < W * H; k++) m[k] = comp[k] >= 0 && hold[comp[k]] >= need ? 1 : 0;
    // Fill holes: anything not reachable from the window's edge through empty cells.
    const outside = new Uint8Array(W * H), st = [];
    for (let i = 0; i < W; i++) for (const j of [0, H - 1]) if (!m[j * W + i]) { outside[j * W + i] = 1; st.push(j * W + i); }
    for (let j = 0; j < H; j++) for (const i of [0, W - 1]) if (!m[j * W + i] && !outside[j * W + i]) { outside[j * W + i] = 1; st.push(j * W + i); }
    while (st.length) {
      const k = st.pop(), i = k % W, j = (k - i) / W;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + a, jj = j + b, kk = jj * W + ii;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H || m[kk] || outside[kk]) continue;
        outside[kk] = 1; st.push(kk);
      }
    }
    let total = 0;
    for (let k = 0; k < W * H; k++) { if (!outside[k]) m[k] = 1; total += m[k]; }
    if (!total) return;
    // Smooth field, then trace the 0.5 contour (marching squares) and chain the pieces into polylines.
    let f = Float32Array.from(m);
    for (let pass = 0; pass < 2; pass++) {
      const n = new Float32Array(W * H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        let t = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const ii = i + a, jj = j + b; t += ii >= 0 && jj >= 0 && ii < W && jj < H ? f[jj * W + ii] : 0; }
        n[j * W + i] = t / 9;
      }
      f = n;
    }
    const lines = contour(f, W, H, 0.5).map((l) => l.map((v, k) => Math.round((k % 2 ? (v + j0 + 0.5) : (v + i0 + 0.5)) * cell)));
    // Label: the cell deepest inside the area (furthest from its edge).
    let best = null, bd = -1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      if (!m[j * W + i]) continue;
      let d = 0;
      while (d < 40) { const r = d + 1; if (i - r < 0 || j - r < 0 || i + r >= W || j + r >= H || !m[j * W + i - r] || !m[j * W + i + r] || !m[(j - r) * W + i] || !m[(j + r) * W + i]) break; d++; }
      if (d > bd) { bd = d; best = [i, j]; }
    }
    out.push({ name, color: SUB_COLORS[idx % SUB_COLORS.length], count: mem.length, W, H, cell, ox: i0 * cell, oy: j0 * cell, mask: m, lines,
      label: { x: (best[0] + i0 + 0.5) * cell, y: (best[1] + j0 + 0.5) * cell } });
  });
  return out;
}

/** Marching squares over a W×H field at level t. Returns closed or open polylines as flat [x0,y0,x1,y1...] in cell units. */
function contour(f, W, H, t) {
  const at = (i, j) => (i < 0 || j < 0 || i >= W || j >= H ? 0 : f[j * W + i]);
  const segs = [];
  const lerp = (a, b) => (t - a) / (b - a);
  for (let j = -1; j < H; j++) for (let i = -1; i < W; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    const code = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0);
    if (!code || code === 15) continue;
    const T = [i + lerp(a, b), j], Rt = [i + 1, j + lerp(b, c)], B = [i + lerp(d, c), j + 1], L = [i, j + lerp(a, d)];
    const map = { 1: [[L, B]], 2: [[B, Rt]], 3: [[L, Rt]], 4: [[T, Rt]], 5: [[L, T], [B, Rt]], 6: [[T, B]], 7: [[L, T]], 8: [[L, T]], 9: [[T, B]], 10: [[L, B], [T, Rt]], 11: [[T, Rt]], 12: [[L, Rt]], 13: [[B, Rt]], 14: [[L, B]] };
    for (const s of map[code]) segs.push(s);
  }
  // Chain segments by shared endpoints.
  const key = (p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`;
  const ends = new Map();
  segs.forEach((s, k) => { for (const p of s) { const q = key(p); if (!ends.has(q)) ends.set(q, []); ends.get(q).push(k); } });
  const used = new Uint8Array(segs.length), lines = [];
  for (let k0 = 0; k0 < segs.length; k0++) {
    if (used[k0]) continue;
    used[k0] = 1;
    const pts = [segs[k0][0], segs[k0][1]];
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir ? pts.at(-1) : pts[0];
        const nk = (ends.get(key(tip)) ?? []).find((k) => !used[k]);
        if (nk === undefined) break;
        used[nk] = 1;
        const s = segs[nk], nxt = key(s[0]) === key(tip) ? s[1] : s[0];
        dir ? pts.push(nxt) : pts.unshift(nxt);
      }
    }
    if (pts.length > 3) lines.push(pts.flat());
  }
  return lines;
}

/** Region rings: centred on the Deep Core, radius = 80th-percentile distance of each region's planets. */
export function buildRings(planets) {
  const core = planets.filter((p) => p.region === "Deep Core");
  const src = core.length ? core : planets.filter((p) => p.region === "Core Worlds");
  const cx = src.length ? src.reduce((s, p) => s + p.x, 0) / src.length : 10.5 * SQ;
  const cy = src.length ? src.reduce((s, p) => s + p.y, 0) / src.length : 10.5 * SQ;
  const rings = [];
  let last = 0;
  for (const region of REGION_ORDER.slice(0, 7)) {
    const ds = planets.filter((p) => p.region === region).map((p) => Math.hypot(p.x - cx, p.y - cy)).sort((a, b) => a - b);
    if (!ds.length) continue;
    const r = Math.max(last + SQ * 0.3, ds[Math.floor(ds.length * (region === "Outer Rim Territories" ? 0.95 : 0.8))]);
    rings.push({ region, r, color: REGION_COLOR[region] }); last = r;
  }
  return { cx, cy, rings };
}

/* ---------- world state (GM edits, pins, ship) ---------- */
export const state = () => foundry.utils.mergeObject({ edits: {}, custom: [], pins: [], ship: null, linkUrl: "" }, game.settings.get(MODULE_ID, "galaxy") ?? {}, { inplace: false });
export const saveState = (s) => game.settings.set(MODULE_ID, "galaxy", s);

/** Planets as the current user should see them: GM edits applied, hidden and Legends filtered for players. */
export function visiblePlanets(galaxy, s = state(), { gm = game.user.isGM } = {}) {
  const canonOnly = game.settings.get(MODULE_ID, "galaxyLegends") === "canon";
  const out = [];
  for (const base of [...galaxy.planets, ...s.custom]) {
    const e = s.edits[base.key];
    const p = e ? { ...base, ...e, edited: true } : base;
    if (!gm && (p.hidden || (canonOnly && !p.canon && !p.custom))) continue;
    if (gm && canonOnly && !p.canon && !p.custom && !e?.forceShow) { p.dimmed = true; }
    out.push(p);
  }
  return out;
}

/* ---------- routing ---------- */
/**
 * Fastest route between two points. Off-lane jumps cost their distance; lane hops cost half.
 * from/to: {x, y, key?}. Returns { path: [{x,y,key,name,lane}], squares, laneSquares, hours, lanes: [names] }.
 */
export function plotRoute(galaxy, planets, from, to, hyperClass = 2) {
  const pmap = new Map(planets.map((p) => [p.key, p]));
  const nodes = new Map(); // key -> {x,y}
  const edges = new Map(); // key -> [{to, w, lane}]
  const addEdge = (a, b, w, lane) => { if (!edges.has(a)) edges.set(a, []); edges.get(a).push({ to: b, w, lane }); };
  for (const lane of galaxy.lanes) {
    for (const [ka, kb] of lane.edges) {
      const a = pmap.get(ka), b = pmap.get(kb);
      if (!a || !b) continue;
      nodes.set(a.key, a); nodes.set(b.key, b);
      const d = Math.hypot(a.x - b.x, a.y - b.y) / SQ;
      addEdge(a.key, b.key, d * 0.5, lane.name); addEdge(b.key, a.key, d * 0.5, lane.name);
    }
  }
  const S = "__start", E = "__end";
  nodes.set(S, from); nodes.set(E, to);
  const direct = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / SQ;
  addEdge(S, E, direct(from, to), null);
  // Enter or leave the lane network at the 12 nearest lane worlds to each end.
  const laneNodes = [...nodes.entries()].filter(([k]) => k !== S && k !== E);
  const nearest = (pt) => laneNodes.map(([k, n]) => [k, direct(pt, n)]).sort((a, b) => a[1] - b[1]).slice(0, 12);
  for (const [k, d] of nearest(from)) addEdge(S, k, d, null);
  for (const [k, d] of nearest(to)) addEdge(k, E, d, null);
  // Dijkstra (graph is small: a few thousand nodes).
  const dist = new Map([[S, 0]]), prev = new Map(), done = new Set();
  const queue = [[0, S]];
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, k] = queue.shift();
    if (done.has(k)) continue;
    done.add(k);
    if (k === E) break;
    for (const e of edges.get(k) ?? []) {
      const nd = d + e.w;
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { k, lane: e.lane }); queue.push([nd, e.to]); }
    }
  }
  const path = [];
  let k = E;
  while (k) { const n = nodes.get(k); const pv = prev.get(k); path.unshift({ x: n.x, y: n.y, key: n.key, name: n.name, lane: pv?.lane ?? null }); k = pv?.k; }
  // Drop zero-length hops (start or end sitting on a lane world).
  for (let i = path.length - 1; i > 0; i--) if (direct(path[i - 1], path[i]) < 0.01) { path[i - 1].name ??= path[i].name; path[i - 1].key ??= path[i].key; path.splice(i, 1); }
  let squares = 0, laneSquares = 0;
  for (let i = 1; i < path.length; i++) { const d = direct(path[i - 1], path[i]); squares += d; if (path[i].lane) laneSquares += d; }
  // Legs: consecutive hops on the same lane collapse into one line of the itinerary.
  const legs = [];
  for (let i = 1; i < path.length; i++) {
    const lane = path[i].lane, last = legs.at(-1);
    if (last && last.lane && last.lane === lane) { last.to = path[i].name; last.stops++; }
    else legs.push({ lane, from: path[i - 1].name, to: path[i].name, stops: 1 });
  }
  const effective = dist.get(E) ?? direct(from, to);
  const hours = effective * game.settings.get(MODULE_ID, "galaxyHours") * Math.max(0.25, Number(hyperClass) || 1);
  return { path, legs, squares, laneSquares, hours, lanes: [...new Set(path.map((p) => p.lane).filter(Boolean))] };
}

export function formatHours(h) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`;
  if (h < 48) return `${Math.round(h * 10) / 10} hours`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}
