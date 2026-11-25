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
  "Mid Rim": "#2aa3df", "Outer Rim Territories": "#1d6f9c", "Wild Space": "#3b4d5c", "Unknown Regions": "#26323c"
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
    const [title, grid, region, sector, system, legendsOnly, weight, cls, climate, terrain, routes] = r;
    const g = parseGrid(grid);
    if (!g) continue;
    const key = slug(title), legends = !!legendsOnly;
    const prev = byKey.get(key);
    const entry = { key, title, name: baseName(title), grid: `${String.fromCharCode(65 + g.col)}-${g.row + 1}`, g, region: normRegion(region), sector, system,
      weight: weight ?? 0, cls, climate, terrain, routes: routes ? routes.split("|").map((x) => x.replace(/\/Legends$/, "")) : [], canon: !legends, legends };
    if (!prev) { byKey.set(key, entry); continue; }
    // Keep the canon page's data; fill gaps from Legends; mark as in both.
    const [keep, other] = prev.canon ? [prev, entry] : [entry, prev];
    for (const f of ["region", "sector", "system", "cls", "climate", "terrain"]) keep[f] ||= other[f];
    keep.routes = [...new Set([...keep.routes, ...other.routes])];
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
  return { planets, byKey: new Map(planets.map((p) => [p.key, p])), cols, rows: rows_, lanes: buildLanes(planets), rings: buildRings(planets) };
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
export const normRegion = (r) => REGION_ALIAS[r] ?? r;

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
    const r = Math.max(last + SQ * 0.3, ds[Math.floor(ds.length * 0.8)]);
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
