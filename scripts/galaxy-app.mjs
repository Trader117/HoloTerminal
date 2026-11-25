import { MODULE_ID, SOCKET } from "./store.mjs";
import * as G from "./galaxy.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const WOOKIEE = "https://starwars.fandom.com/wiki/";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* Interactive galaxy map: pan/zoom canvas, planets, lanes, region rings, pins, the party ship and route plotting. */
export class GalaxyMapApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance;
  static get instance() { return (this.#instance ??= new GalaxyMapApp()); }

  static DEFAULT_OPTIONS = {
    id: "ht-galaxy", classes: ["ht-app", "ht-galaxy-app"],
    window: { title: "Galaxy Map", icon: "fas fa-earth-americas", resizable: true },
    position: { width: 1120, height: 780 },
    actions: {
      zoomIn: GalaxyMapApp.#zoomIn, zoomOut: GalaxyMapApp.#zoomOut, fit: GalaxyMapApp.#fit, toggle: GalaxyMapApp.#toggle,
      pick: GalaxyMapApp.#pick, closeCard: GalaxyMapApp.#closeCard, routeFrom: GalaxyMapApp.#routeFrom, routeTo: GalaxyMapApp.#routeTo,
      clearRoute: GalaxyMapApp.#clearRoute, shareRoute: GalaxyMapApp.#shareRoute, shipHere: GalaxyMapApp.#shipHere, findShip: GalaxyMapApp.#findShip,
      editPlanet: GalaxyMapApp.#editPlanet, hidePlanet: GalaxyMapApp.#hidePlanet, movePlanet: GalaxyMapApp.#movePlanet,
      openLink: GalaxyMapApp.#openLink, wiki: GalaxyMapApp.#wiki, menu: GalaxyMapApp.#menu, delPin: GalaxyMapApp.#delPin, ext: GalaxyMapApp.#ext
    }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/galaxy.hbs` } };

  galaxy = null; planets = []; view = null; selected = null; hover = null; route = null; routeFrom = null; ctx = null;
  show = { grid: true, lanes: true, regions: true, subregions: true, labels: true };
  query = ""; moving = null; menuAt = null; #raf = 0; #fly = null;

  constructor(o) {
    super(o);
    Hooks.on(G.GALAXY_HOOK, () => this.rendered && this.#refresh());
    game.socket.on(SOCKET, (m) => {
      if (m?.type !== "galaxyRoute" || m.userId === game.user.id) return;
      this.route = m.route; this.routeFrom = null;
      this.render({ force: true });
    });
  }

  /* ---------- data ---------- */
  async #ensure() {
    if (!this.galaxy) this.galaxy = await G.loadGalaxy();
    this.state = G.state();
    const pins = game.user.getFlag(MODULE_ID, "galaxyPins") ?? [];
    this.planets = G.visiblePlanets(this.galaxy, this.state);
    this.pmap = new Map(this.planets.map((p) => [p.key, p]));
    this.pins = [...(this.state.pins ?? []).map((p) => ({ ...p, shared: true })), ...pins.map((p) => ({ ...p, mine: true }))];
    this.#index();
  }
  #index() {
    this.buckets = new Map();
    for (const p of this.planets) {
      const k = `${Math.floor(p.x / G.SQ)},${Math.floor(p.y / G.SQ)}`;
      if (!this.buckets.has(k)) this.buckets.set(k, []);
      this.buckets.get(k).push(p);
    }
  }
  async #refresh() { await this.#ensure(); this.render(); }

  async _prepareContext() {
    await this.#ensure();
    const p = this.selected ? this.pmap.get(this.selected) : null;
    const shipKey = this.state.ship?.key;
    const results = this.query.length >= 2
      ? this.planets.filter((x) => x.name.toLowerCase().includes(this.query.toLowerCase())).sort((a, b) => a.rank - b.rank).slice(0, 8)
        .map((x) => ({ key: x.key, name: x.name, grid: x.grid, region: x.region })) : [];
    const route = this.route && {
      ...this.route, time: G.formatHours(this.route.hours), squares: Math.round(this.route.squares * 10) / 10,
      lanesText: this.route.lanes.join(", "), legs: this.route.legs.map((l, i) => ({ ...l, n: i + 1 }))
    };
    return {
      isGM: game.user.isGM, show: this.show, query: this.query, results, count: this.planets.length,
      hyper: this.hyper ?? game.settings.get(MODULE_ID, "galaxyClass"),
      ship: this.state.ship ? { ...this.state.ship, grid: G.gridLabel(this.state.ship.x, this.state.ship.y) } : null,
      routeFrom: this.routeFrom ? (this.routeFrom.name ?? G.gridLabel(this.routeFrom.x, this.routeFrom.y)) : null,
      moving: this.moving ? this.pmap.get(this.moving)?.name : null,
      card: p && {
        ...p, subText: (p.subregions ?? []).join(", "), regionColor: G.REGION_COLOR[p.region] ?? "#2aa3df", here: shipKey === p.key,
        badge: p.custom ? "Custom" : p.canon && p.legends ? "Canon + Legends" : p.canon ? "Canon" : "Legends",
        routesText: (p.routes ?? []).join(", "), showNotes: game.user.isGM || p.notesPublic, linkName: p.link ? (fromUuidSync?.(p.link)?.name ?? "Linked") : null,
        wiki: !p.custom
      },
      menu: this.menuAt, route, linkUrl: this.state.linkUrl || "https://henrybernberg.maps.arcgis.com/apps/instant/basic/index.html?appid=f8953229bb0e47fcbfbd080640bb57b0"
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const cv = this.element.querySelector("canvas.ht-gx-canvas");
    if (!cv) return;
    const wrap = cv.parentElement;
    const resize = () => { const r = wrap.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
      cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr); cv.style.width = `${r.width}px`; cv.style.height = `${r.height}px`;
      this.ctx = cv.getContext("2d"); this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); this.W = r.width; this.H = r.height; this.draw(); };
    this._ro?.disconnect(); this._ro = new ResizeObserver(resize); this._ro.observe(wrap);
    this.cv = cv;
    if (!this.view) this.#fitView();
    resize();
    this.#bind(cv);
    const q = this.element.querySelector("input[name=gx-search]");
    q?.addEventListener("input", (ev) => { this.query = ev.target.value; this.render().then(() => { const n = this.element.querySelector("input[name=gx-search]"); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }); });
    this.element.querySelector("input[name=gx-class]")?.addEventListener("change", (ev) => { this.hyper = Number(ev.target.value) || 1; if (this.route) this.#replot(); });
  }
  _onClose(o) { super._onClose?.(o); this._ro?.disconnect(); cancelAnimationFrame(this.#raf); }

  /* ---------- view ---------- */
  #fitView() {
    const g = this.galaxy;
    const W = this.W || 900, H = this.H || 640;
    this.view = { x: (g.cols * G.SQ) / 2, y: (g.rows * G.SQ) / 2, z: Math.min(W / (g.cols * G.SQ), H / (g.rows * G.SQ)) * 0.95 };
    this.minZ = this.view.z * 0.6;
  }
  toScreen(x, y) { const v = this.view; return [(x - v.x) * v.z + this.W / 2, (y - v.y) * v.z + this.H / 2]; }
  toWorld(sx, sy) { const v = this.view; return [(sx - this.W / 2) / v.z + v.x, (sy - this.H / 2) / v.z + v.y]; }
  #zoomAt(f, sx = this.W / 2, sy = this.H / 2) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.view.z = Math.min(40, Math.max(this.minZ ?? 0.02, this.view.z * f));
    const [nx, ny] = this.toWorld(sx, sy);
    this.view.x += wx - nx; this.view.y += wy - ny;
    this.draw();
  }
  flyTo(x, y, z = Math.max(this.view.z, 2.2)) {
    const from = { ...this.view }, start = performance.now(), dur = 650;
    const step = (t) => {
      const k = Math.min(1, (t - start) / dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.view = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e, z: from.z * (z / from.z) ** e };
      this.draw();
      if (k < 1) this.#raf = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this.#raf); this.#raf = requestAnimationFrame(step);
  }

  /* ---------- input ---------- */
  #bind(cv) {
    let drag = null;
    cv.addEventListener("wheel", (ev) => { ev.preventDefault(); const r = cv.getBoundingClientRect(); this.#zoomAt(ev.deltaY < 0 ? 1.2 : 1 / 1.2, ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
    cv.addEventListener("pointerdown", (ev) => { if (ev.button !== 0) return; cv.setPointerCapture(ev.pointerId); drag = { x: ev.clientX, y: ev.clientY, vx: this.view.x, vy: this.view.y, moved: false }; });
    cv.addEventListener("pointermove", (ev) => {
      const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        this.view.x = drag.vx - dx / this.view.z; this.view.y = drag.vy - dy / this.view.z; this.draw();
        return;
      }
      const h = this.#hit(sx, sy);
      const key = h?.planet?.key ?? null;
      if (key !== this.hover) { this.hover = key; cv.style.cursor = key || h ? "pointer" : this.moving ? "crosshair" : "grab"; this.draw(); }
    });
    cv.addEventListener("pointerup", (ev) => {
      const d = drag; drag = null;
      if (!d || d.moved) return;
      const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      if (this.moving) return this.#placeMoved(...this.toWorld(sx, sy));
      if (this.menuAt) { this.menuAt = null; return this.render(); }
      const h = this.#hit(sx, sy);
      this.selected = h?.planet?.key ?? null;
      this.render();
    });
    cv.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      const r = cv.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      const [wx, wy] = this.toWorld(sx, sy), h = this.#hit(sx, sy);
      this.menuAt = { sx, sy, wx, wy, planet: h?.planet?.key ?? null, planetName: h?.planet?.name, pin: h?.pin?.id ?? null, pinMine: h?.pin?.mine || (h?.pin?.shared && game.user.isGM) };
      this.render();
    });
  }
  #hit(sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy);
    const R = 9 / this.view.z;
    let best = null, bd = R;
    for (const pin of this.pins ?? []) { const d = Math.hypot(pin.x - wx, pin.y - wy); if (d < bd * 1.4) return { pin }; }
    const cx = Math.floor(wx / G.SQ), cy = Math.floor(wy / G.SQ);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const p of this.buckets.get(`${cx + i},${cy + j}`) ?? []) {
      if (!this.#drawn(p)) continue;
      const d = Math.hypot(p.x - wx, p.y - wy); if (d < bd) { bd = d; best = p; }
    }
    return best ? { planet: best } : null;
  }
  /** Is a planet's dot drawn at this zoom? Faint minor worlds appear as you zoom in. */
  #drawn(p) { return p.rank < this.#dotBudget() || p.key === this.selected || p.edited || p.custom; }
  #dotBudget() { const z0 = this.minZ / 0.6; return Math.floor(500 * (this.view.z / z0) ** 1.6); }
  #labelBudget() { const z0 = this.minZ / 0.6; return Math.floor(26 * (this.view.z / z0) ** 1.9); }

  /* ---------- drawing ---------- */
  draw() {
    const c = this.ctx, W = this.W, H = this.H, g = this.galaxy;
    if (!c || !g || !this.view) return;
    const z = this.view.z;
    c.clearRect(0, 0, W, H);
    c.fillStyle = "#04080c"; c.fillRect(0, 0, W, H);
    // starfield with light parallax
    const px = (this.view.x * z * 0.04) % W, py = (this.view.y * z * 0.04) % H;
    for (let i = 0; i < 260; i++) {
      const s = ((i * 2654435761) >>> 0) / 4294967296, t = ((i * 1597334677) >>> 0) / 4294967296;
      let x = (s * W * 1.3 - px) % W, y = (t * H * 1.3 - py) % H; if (x < 0) x += W; if (y < 0) y += H;
      c.fillStyle = `rgba(200,220,255,${0.15 + (i % 7) * 0.05})`; c.fillRect(x, y, i % 11 === 0 ? 1.6 : 1, i % 11 === 0 ? 1.6 : 1);
    }
    const { cx, cy, rings } = g.rings;
    const [ccx, ccy] = this.toScreen(cx, cy);
    const outer = rings.at(-1)?.r ?? 10 * G.SQ;
    const glow = c.createRadialGradient(ccx, ccy, 0, ccx, ccy, outer * z * 1.1);
    glow.addColorStop(0, "rgba(255,226,170,.30)"); glow.addColorStop(0.25, "rgba(230,154,40,.10)"); glow.addColorStop(0.7, "rgba(42,163,223,.07)"); glow.addColorStop(1, "rgba(4,8,12,0)");
    c.fillStyle = glow; c.beginPath(); c.arc(ccx, ccy, outer * z * 1.1, 0, Math.PI * 2); c.fill();
    this._labelBoxes = [];
    if (this.show.regions) this.#drawZones(c, g, z);
    if (this.show.subregions) this.#drawSubregions(c, g, z);
    if (this.show.grid) this.#drawGrid(c, g, z);
    if (this.show.lanes) this.#drawLanes(c, g, z);
    if (this.route) this.#drawRoute(c, z);
    this.#drawPlanets(c, z);
    this.#drawPins(c);
    this.#drawShip(c);
  }
  /** Region art: banded rings from the core, plus the Unknown Regions and Wild Space where the planets put them. Built once. */
  #zoneArt(g) {
    if (this._zoneArt) return this._zoneArt;
    const B = g.bands, Z = g.zones;
    const poly = (r) => { const p = new Path2D(); r.forEach((v, i) => { const a = ((i + 0.5) / B.n) * Math.PI * 2; const x = B.cx + Math.cos(a) * v, y = B.cy + Math.sin(a) * v; i ? p.lineTo(x, y) : p.moveTo(x, y); }); p.closePath(); return p; };
    const bands = B.bands.map((b, k) => {
      const ring = new Path2D(); ring.addPath(poly(b.r)); if (k) ring.addPath(poly(B.bands[k - 1].r));
      return { region: b.region, color: b.color, fill: ring, edge: poly(b.r) };
    });
    // Outer zones (Unknown Regions, Wild Space) from the planet vote, only beyond the Outer Rim edge's inner neighbour.
    const img = document.createElement("canvas"); img.width = Z.W; img.height = Z.H;
    const ic = img.getContext("2d"), data = ic.createImageData(Z.W, Z.H), border = new Path2D();
    const outerIdx = new Set(["Unknown Regions", "Wild Space"].map((r) => G.REGION_ORDER.indexOf(r)));
    // Keep only sizeable patches (drops specks from a lone planet).
    const keep = new Int8Array(Z.W * Z.H).fill(-1), seen = new Uint8Array(Z.W * Z.H);
    for (let s0 = 0; s0 < Z.cells.length; s0++) {
      if (seen[s0] || !outerIdx.has(Z.cells[s0])) continue;
      const v = Z.cells[s0], stack = [s0], comp = []; seen[s0] = 1;
      while (stack.length) {
        const k = stack.pop(); comp.push(k);
        const i = k % Z.W, j = (k - i) / Z.W;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + a, jj = j + b, kk = jj * Z.W + ii;
          if (ii < 0 || jj < 0 || ii >= Z.W || jj >= Z.H || seen[kk] || Z.cells[kk] !== v) continue;
          seen[kk] = 1; stack.push(kk);
        }
      }
      if (comp.length >= 60) for (const k of comp) keep[k] = v;
    }
    const at = (i, j) => (i < 0 || j < 0 || i >= Z.W || j >= Z.H ? -1 : keep[j * Z.W + i]);
    for (let j = 0; j < Z.H; j++) for (let i = 0; i < Z.W; i++) {
      const v = at(i, j); if (v < 0) continue;
      const n = Number.parseInt(G.REGION_COLOR[G.REGION_ORDER[v]].slice(1), 16); data.data.set([n >> 16, (n >> 8) & 255, n & 255, 60], (j * Z.W + i) * 4);
    }
    ic.putImageData(data, 0, 0);
    for (let j = 0; j <= Z.H; j++) for (let i = 0; i <= Z.W; i++) {
      const v = at(i, j);
      if (v !== at(i - 1, j)) { border.moveTo(i * Z.cell, j * Z.cell); border.lineTo(i * Z.cell, (j + 1) * Z.cell); }
      if (v !== at(i, j - 1)) { border.moveTo(i * Z.cell, j * Z.cell); border.lineTo((i + 1) * Z.cell, j * Z.cell); }
    }
    const labels = [];
    let prevR = null;
    for (const b of B.bands) { // north side, middle of the band
      const i = Math.round(B.n * 0.75 - 0.5) % B.n, outer = b.r[i], inner = prevR ? prevR[i] : 0;
      labels.push({ region: b.region, x: B.cx, y: B.cy - (outer + inner) / 2 }); prevR = b.r;
    }
    for (const l of Z.labels) if (outerIdx.has(G.REGION_ORDER.indexOf(l.region))) labels.push(l);
    return (this._zoneArt = { bands, img, border, labels });
  }
  #drawZones(c, g, z) {
    const Z = g.zones, art = this.#zoneArt(g), [ox, oy] = this.toScreen(0, 0);
    c.save();
    c.translate(ox, oy); c.scale(z, z);
    c.imageSmoothingEnabled = false;
    c.globalAlpha = 1;
    c.drawImage(art.img, 0, 0, Z.W * Z.cell, Z.H * Z.cell);
    for (const b of art.bands) { c.fillStyle = this.#alpha(b.color, 0.11); c.fill(b.fill, "evenodd"); }
    c.lineWidth = 1.4 / z; c.strokeStyle = "rgba(240,212,96,.7)";
    for (const b of art.bands) c.stroke(b.edge);
    c.setLineDash([5 / z, 4 / z]); c.strokeStyle = "rgba(240,212,96,.55)"; c.stroke(art.border); c.setLineDash([]);
    c.restore();
    if (!this.show.labels) return;
    c.font = `700 ${Math.min(15, Math.max(10, 9 + z * 6))}px Bahnschrift, 'Segoe UI', sans-serif`; c.textAlign = "center";
    const placed = [];
    for (const l of art.labels) {
      const [x, y] = this.toScreen(l.x, l.y);
      if (placed.some(([px, py]) => Math.abs(px - x) < 140 && Math.abs(py - y) < 16)) continue;
      placed.push([x, y]); this._labelBoxes.push([x, y, c.measureText(l.region.toUpperCase()).width]);
      if (x < -100 || y < -20 || x > this.W + 100 || y > this.H + 20) continue;
      const t = l.region.toUpperCase();
      c.lineWidth = 3; c.strokeStyle = "rgba(4,8,12,.85)"; c.strokeText(t, x, y + 4);
      c.fillStyle = this.#alpha(G.REGION_COLOR[l.region], 0.95); c.fillText(t, x, y + 4);
    }
    c.textAlign = "left";
  }
  /** Named sub-regions: a faint tint and a dashed outline each, built once. */
  #subArt(g) {
    if (this._subArt) return this._subArt;
    return (this._subArt = (g.subregions ?? []).map((s) => {
      const img = document.createElement("canvas"); img.width = s.W; img.height = s.H;
      const ic = img.getContext("2d"), data = ic.createImageData(s.W, s.H), n = Number.parseInt(s.color.slice(1), 16);
      for (let k = 0; k < s.mask.length; k++) if (s.mask[k]) data.data.set([n >> 16, (n >> 8) & 255, n & 255, 22], k * 4);
      ic.putImageData(data, 0, 0);
      const path = new Path2D();
      for (const l of s.lines) { path.moveTo(l[0], l[1]); for (let k = 2; k < l.length; k += 2) path.lineTo(l[k], l[k + 1]); path.closePath(); }
      return { ...s, img, path };
    }));
  }
  #drawSubregions(c, g, z) {
    const art = this.#subArt(g), [ox, oy] = this.toScreen(0, 0);
    c.save(); c.translate(ox, oy); c.scale(z, z);
    c.imageSmoothingEnabled = true;
    for (const s of art) c.drawImage(s.img, s.ox, s.oy, s.W * s.cell, s.H * s.cell);
    c.lineWidth = 1.3 / z; c.setLineDash([7 / z, 5 / z]);
    for (const s of art) { c.strokeStyle = this.#alpha(s.color, 0.8); c.stroke(s.path); }
    c.setLineDash([]); c.restore();
    if (!this.show.labels) return;
    c.font = `italic 600 ${Math.min(14, Math.max(10, 8 + z * 5))}px Bahnschrift, 'Segoe UI', sans-serif`; c.textAlign = "center";
    const placed = this._labelBoxes ?? [];
    for (const s of art) {
      const [x0, y0] = this.toScreen(s.label.x, s.label.y);
      if (x0 < -100 || y0 < -20 || x0 > this.W + 100 || y0 > this.H + 20) continue;
      const w = c.measureText(s.name).width;
      const clear = ([x, y]) => !placed.some(([px, py, pw]) => Math.abs(px - x) < (pw + w) / 2 + 6 && Math.abs(py - y) < 16);
      // Nudge off a clash with another label, but stay close to the area's centre.
      const spot = [[0, 0], [0, 18], [0, -18], [0, 34], [0, -34]].map(([a, b]) => [x0 + a, y0 + b]).find(clear);
      if (!spot) continue;
      const [x, y] = spot;
      placed.push([x, y, w]);
      c.lineWidth = 3; c.strokeStyle = "rgba(4,8,12,.85)"; c.strokeText(s.name, x, y + 4);
      c.fillStyle = this.#alpha(s.color, 0.95); c.fillText(s.name, x, y + 4);
    }
    c.textAlign = "left";
  }
  #alpha(hex, a) { const n = Number.parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  #drawGrid(c, g, z) {
    const [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(g.cols * G.SQ, g.rows * G.SQ);
    c.strokeStyle = "rgba(42,163,223,.12)"; c.lineWidth = 1; c.beginPath();
    for (let i = 0; i <= g.cols; i++) { const x = x0 + i * G.SQ * z; c.moveTo(x, Math.max(0, y0)); c.lineTo(x, Math.min(this.H, y1)); }
    for (let j = 0; j <= g.rows; j++) { const y = y0 + j * G.SQ * z; c.moveTo(Math.max(0, x0), y); c.lineTo(Math.min(this.W, x1), y); }
    c.stroke();
    c.font = "600 10px Bahnschrift, 'Segoe UI', sans-serif"; c.fillStyle = "rgba(124,198,239,.55)"; c.textAlign = "center";
    const ly = Math.max(12, y0 - 4);
    for (let i = 0; i < g.cols; i++) { const x = x0 + (i + 0.5) * G.SQ * z; if (x > 0 && x < this.W) c.fillText(String.fromCharCode(65 + i), x, ly); }
    c.textAlign = "left";
    const lx = Math.max(4, x0 - 18);
    for (let j = 0; j < g.rows; j++) { const y = y0 + (j + 0.5) * G.SQ * z; if (y > 10 && y < this.H) c.fillText(String(j + 1), lx, y + 3); }
    if (z * G.SQ > 120) { // square names inside cells when zoomed in
      c.fillStyle = "rgba(124,198,239,.25)";
      for (let i = 0; i < g.cols; i++) for (let j = 0; j < g.rows; j++) {
        const x = x0 + i * G.SQ * z + 4, y = y0 + j * G.SQ * z + 12; if (x > -50 && x < this.W && y > 0 && y < this.H + 20) c.fillText(`${String.fromCharCode(65 + i)}-${j + 1}`, x, y);
      }
    }
  }
  #drawLanes(c, g, z) {
    const zr = z / (this.minZ / 0.6), maxTier = zr > 3 ? 3 : zr > 1.6 ? 2 : 1;
    for (const lane of g.lanes) {
      if (lane.tier > maxTier) continue;
      const P = (k) => this.pmap.get(k) ?? this.galaxy.byKey.get(k);
      c.beginPath();
      for (const [ka, kb] of lane.edges) {
        const a = P(ka), b = P(kb); if (!a || !b) continue;
        const [ax, ay] = this.toScreen(a.x, a.y), [bx, by] = this.toScreen(b.x, b.y);
        c.moveTo(ax, ay); c.lineTo(bx, by);
      }
      c.strokeStyle = lane.tier === 1 ? "rgba(124,198,239,.55)" : lane.tier === 2 ? "rgba(124,198,239,.3)" : "rgba(124,198,239,.16)";
      c.lineWidth = lane.tier === 1 ? 1.6 : 1; c.stroke();
      if (lane.tier <= Math.min(2, maxTier - 0) && zr > 1.3 && this.show.labels) {
        const mid = P(lane.mid[0]), nxt = P(lane.mid[1]);
        if (!mid || !nxt) continue;
        const [mx, my] = this.toScreen(mid.x, mid.y), [nx, ny] = this.toScreen(nxt.x, nxt.y);
        let a = Math.atan2(ny - my, nx - mx); if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI;
        c.save(); c.translate((mx + nx) / 2, (my + ny) / 2); c.rotate(a);
        c.font = "italic 600 10px Bahnschrift, 'Segoe UI', sans-serif"; c.fillStyle = "rgba(124,198,239,.8)"; c.textAlign = "center"; c.fillText(lane.name, 0, -4);
        c.restore();
      }
    }
  }
  #drawPlanets(c, z) {
    const dotN = this.#dotBudget(), labN = this.show.labels ? this.#labelBudget() : 0;
    const vis = this.planets.filter((p) => { const [x, y] = this.toScreen(p.x, p.y); return x > -40 && y > -20 && x < this.W + 40 && y < this.H + 20; });
    vis.sort((a, b) => a.rank - b.rank);
    const boxes = [];
    for (const p of vis) {
      if (!(p.rank < dotN || p.key === this.selected || p.edited || p.custom)) continue;
      const [x, y] = this.toScreen(p.x, p.y);
      const big = p.rank < 60 ? 3.2 : p.rank < 400 ? 2.3 : 1.5;
      const col = p.dimmed ? "rgba(120,130,140,.5)" : p.hidden ? "rgba(255,81,70,.7)" : p.custom ? "#4cc38a" : p.canon ? "#e8f2fb" : "#d9c79a";
      if (p.rank < 60) { c.fillStyle = "rgba(124,198,239,.18)"; c.beginPath(); c.arc(x, y, big * 2.4, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = col; c.beginPath(); c.arc(x, y, big, 0, Math.PI * 2); c.fill();
      if (p.key === this.selected || p.key === this.hover) { c.strokeStyle = "#ff5146"; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, big + 5, 0, Math.PI * 2); c.stroke(); }
      if (p.rank < labN || p.key === this.selected || p.key === this.hover || p.custom) {
        const size = p.rank < 30 ? 13 : p.rank < 200 ? 11.5 : 10.5;
        c.font = `${p.rank < 30 ? 700 : 600} ${size}px Bahnschrift, 'Segoe UI', sans-serif`;
        const w = c.measureText(p.name).width, bx = x + big + 4, by = y - size / 2 - 1;
        const force = p.key === this.selected || p.key === this.hover;
        if (!force && boxes.some((b) => bx < b[2] && bx + w > b[0] && by < b[3] && by + size + 2 > b[1])) continue;
        boxes.push([bx, by, bx + w, by + size + 2]);
        c.lineWidth = 3; c.strokeStyle = "rgba(4,8,12,.9)"; c.strokeText(p.name, bx, y + size / 2 - 2);
        c.fillStyle = force ? "#ffffff" : p.rank < 30 ? "#f3f6f8" : "rgba(220,227,233,.85)"; c.fillText(p.name, bx, y + size / 2 - 2);
      }
    }
  }
  #drawPins(c) {
    for (const pin of this.pins ?? []) {
      const [x, y] = this.toScreen(pin.x, pin.y);
      c.fillStyle = pin.mine ? "#c38bff" : "#e69a28";
      c.beginPath(); c.moveTo(x, y); c.arc(x, y - 12, 6, Math.PI * 0.8, Math.PI * 2.2); c.closePath(); c.fill();
      c.fillStyle = "#04080c"; c.beginPath(); c.arc(x, y - 12, 2.2, 0, Math.PI * 2); c.fill();
      c.font = "600 11px Bahnschrift, 'Segoe UI', sans-serif"; c.textAlign = "left"; c.lineWidth = 3; c.strokeStyle = "rgba(4,8,12,.9)";
      c.strokeText(pin.label, x + 8, y - 9); c.fillStyle = pin.mine ? "#dcc2ff" : "#ffd27a"; c.fillText(pin.label, x + 8, y - 9);
    }
  }
  #drawShip(c) {
    const s = this.state.ship; if (!s) return;
    const [x, y] = this.toScreen(s.x, s.y), t = performance.now() / 600;
    c.strokeStyle = "rgba(255,81,70,.6)"; c.lineWidth = 1.5; c.beginPath(); c.arc(x, y, 12 + Math.sin(t) * 2, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "#ff5146"; c.beginPath(); c.moveTo(x, y - 9); c.lineTo(x + 7, y + 7); c.lineTo(x, y + 3); c.lineTo(x - 7, y + 7); c.closePath(); c.fill();
    c.font = "700 11px Bahnschrift, 'Segoe UI', sans-serif"; c.textAlign = "center"; c.lineWidth = 3; c.strokeStyle = "rgba(4,8,12,.9)";
    const label = (s.name || "Party ship").toUpperCase(); c.strokeText(label, x, y + 22); c.fillStyle = "#ff8a80"; c.fillText(label, x, y + 22); c.textAlign = "left";
  }
  #drawRoute(c, z) {
    const pts = this.route.path;
    c.save(); c.setLineDash([8, 5]); c.lineWidth = 2.5; c.strokeStyle = "#e69a28"; c.shadowColor = "#e69a28"; c.shadowBlur = 8;
    c.beginPath(); pts.forEach((p, i) => { const [x, y] = this.toScreen(p.x, p.y); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); c.restore();
    for (const p of pts) { const [x, y] = this.toScreen(p.x, p.y); c.fillStyle = "#e69a28"; c.beginPath(); c.arc(x, y, 3.5, 0, Math.PI * 2); c.fill(); }
  }

  /* ---------- planet / route actions ---------- */
  static #zoomIn() { this.#zoomAt(1.5); }
  static #zoomOut() { this.#zoomAt(1 / 1.5); }
  static #fit() { this.#fitView(); this.draw(); }
  static #toggle(e, el) { this.show[el.dataset.key] = !this.show[el.dataset.key]; this.render(); }
  static #pick(e, el) { const p = this.pmap.get(el.dataset.key); if (!p) return; this.selected = p.key; this.query = ""; this.render(); this.flyTo(p.x, p.y); }
  static #closeCard() { this.selected = null; this.render(); }
  static #findShip() { const s = this.state.ship; if (s) this.flyTo(s.x, s.y); }
  #point(el) {
    if (el?.dataset.key) { const p = this.pmap.get(el.dataset.key); return p && { x: p.x, y: p.y, key: p.key, name: p.name }; }
    const m = this.menuAt; if (!m) return null;
    if (m.planet) { const p = this.pmap.get(m.planet); return { x: p.x, y: p.y, key: p.key, name: p.name }; }
    return { x: m.wx, y: m.wy, name: G.gridLabel(m.wx, m.wy) };
  }
  static #routeFrom(e, el) { this.routeFrom = this.#point(el); this.menuAt = null; this.route = null; this.render(); }
  static #routeTo(e, el) {
    const to = this.#point(el); this.menuAt = null;
    const from = this.routeFrom ?? (this.state.ship && { x: this.state.ship.x, y: this.state.ship.y, key: this.state.ship.key, name: this.state.ship.name || "Party ship" });
    if (!to || !from) { ui.notifications.warn("Set a start point first (or the GM can place the party ship)."); return this.render(); }
    this.routeEnds = { from, to };
    this.#replot();
  }
  #replot() {
    const { from, to } = this.routeEnds ?? {};
    if (!from || !to) return;
    this.route = G.plotRoute(this.galaxy, this.planets, from, to, this.hyper ?? game.settings.get(MODULE_ID, "galaxyClass"));
    this.route.path[0].name ??= from.name; this.route.path.at(-1).name ??= to.name;
    this.render();
  }
  static #clearRoute() { this.route = null; this.routeFrom = null; this.routeEnds = null; this.render(); }
  static #shareRoute() { if (this.route) { game.socket.emit(SOCKET, { type: "galaxyRoute", userId: game.user.id, route: this.route }); ui.notifications.info("Route shown to everyone with the galaxy map open."); } }
  static async #shipHere(e, el) {
    if (!game.user.isGM) return;
    const pt = this.#point(el); this.menuAt = null;
    const s = G.state(); s.ship = { ...(s.ship ?? {}), x: pt.x, y: pt.y, key: pt.key ?? null, name: s.ship?.name ?? "Party ship" };
    await G.saveState(s);
  }
  static async #hidePlanet(e, el) {
    const key = el.dataset.key ?? this.menuAt?.planet; this.menuAt = null;
    const s = G.state(); s.edits[key] = { ...(s.edits[key] ?? {}), hidden: !s.edits[key]?.hidden };
    await G.saveState(s);
  }
  static #movePlanet(e, el) { this.moving = el.dataset.key ?? this.menuAt?.planet; this.menuAt = null; ui.notifications.info("Click the map where this planet should go."); this.render(); }
  async #placeMoved(x, y) {
    const key = this.moving; this.moving = null;
    const s = G.state();
    const custom = s.custom.find((c) => c.key === key);
    if (custom) Object.assign(custom, { x, y, grid: G.gridLabel(x, y) }); else s.edits[key] = { ...(s.edits[key] ?? {}), x, y, grid: G.gridLabel(x, y) };
    await G.saveState(s);
  }
  static async #editPlanet(e, el) {
    const key = el.dataset.key ?? this.menuAt?.planet; this.menuAt = null;
    const p = key ? this.pmap.get(key) : null;
    const isNew = !p;
    const at = isNew ? { x: this.menuAt?.wx ?? el.dataset.x, y: this.menuAt?.wy ?? el.dataset.y } : null;
    const content = `<div class="ht-sc-dialog ht-gx-dialog">
      <label>Name <input name="name" type="text" value="${esc(p?.name ?? "")}"></label>
      <label>Region <input name="region" type="text" value="${esc(p?.region ?? "")}"></label>
      <label>Sector <input name="sector" type="text" value="${esc(p?.sector ?? "")}"></label>
      <label>System <input name="system" type="text" value="${esc(p?.system ?? "")}"></label>
      <label class="ht-wide">Image <input name="img" type="text" value="${esc(p?.img ?? "")}" placeholder="path or URL"></label>
      <label class="ht-wide">Linked journal or scene (drag one here or paste its UUID) <input name="link" type="text" value="${esc(p?.link ?? "")}"></label>
      <label class="ht-wide">GM notes <textarea name="notes" rows="4">${esc(p?.notes ?? "")}</textarea></label>
      <label class="ht-check ht-wide"><input name="notesPublic" type="checkbox" ${p?.notesPublic ? "checked" : ""}> Players can read the notes</label>
      <label class="ht-check ht-wide"><input name="hidden" type="checkbox" ${p?.hidden ? "checked" : ""}> Hidden from players</label></div>`;
    const data = await foundry.applications.api.DialogV2.prompt({
      window: { title: isNew ? "New planet" : `Edit ${p.name}` }, content, position: { width: 460 },
      render: (ev, dlg) => {
        const root = dlg?.element ?? ev?.target?.element;
        const inp = root?.querySelector?.("input[name=link]");
        inp?.addEventListener("drop", (d) => { d.preventDefault(); try { const j = JSON.parse(d.dataTransfer.getData("text/plain")); if (j.uuid) inp.value = j.uuid; } catch {} });
      },
      ok: { label: "Save", callback: (ev, btn) => Object.fromEntries(new FormData(btn.form)) }
    }).catch(() => null);
    if (!data) return;
    const vals = { name: data.name?.trim() || p?.name || "New world", region: data.region, sector: data.sector, system: data.system, img: data.img, link: data.link,
      notes: data.notes, notesPublic: data.notesPublic === "on", hidden: data.hidden === "on" };
    const s = G.state();
    if (isNew) {
      const x = Number(at.x), y = Number(at.y);
      s.custom.push({ key: `custom-${foundry.utils.randomID()}`, ...vals, x, y, grid: G.gridLabel(x, y), custom: true, canon: true, rank: 0, routes: [] });
    } else if (p.custom) Object.assign(s.custom.find((c) => c.key === key), vals);
    else s.edits[key] = { ...(s.edits[key] ?? {}), ...vals };
    await G.saveState(s);
  }
  static async #openLink(e, el) {
    const p = this.pmap.get(el.dataset.key); if (!p?.link) return;
    const doc = await fromUuid(p.link);
    if (!doc) return ui.notifications.warn("The linked document no longer exists.");
    if (doc.documentName === "Scene") { if (game.user.isGM) doc.view(); else ui.notifications.info(`Linked scene: ${doc.name}`); }
    else if (doc.testUserPermission?.(game.user, "LIMITED")) doc.sheet?.render(true);
    else ui.notifications.warn("You don't have access to that entry.");
  }
  static #wiki(e, el) { const p = this.pmap.get(el.dataset.key); if (p) window.open(WOOKIEE + encodeURIComponent((p.title ?? p.name).replace(/ /g, "_")), "_blank", "noopener"); }
  static #ext() { window.open(this.state.linkUrl || "https://henrybernberg.maps.arcgis.com/apps/instant/basic/index.html?appid=f8953229bb0e47fcbfbd080640bb57b0", "_blank", "noopener"); }
  /** Context menu entries: pins, ship, new planet, course. */
  static async #menu(e, el) {
    const m = this.menuAt; this.menuAt = null;
    const what = el.dataset.do;
    if (what === "pin" || what === "sharedPin") {
      const label = await foundry.applications.api.DialogV2.prompt({ window: { title: "New pin" },
        content: `<label>Label <input name="label" type="text" autofocus></label>`, ok: { label: "Add", callback: (ev, btn) => btn.form.elements.label.value } }).catch(() => null);
      if (!label) return this.render();
      const pin = { id: foundry.utils.randomID(), x: m.wx, y: m.wy, label };
      if (what === "sharedPin" && game.user.isGM) { const s = G.state(); s.pins.push(pin); await G.saveState(s); }
      else { const mine = game.user.getFlag(MODULE_ID, "galaxyPins") ?? []; await game.user.setFlag(MODULE_ID, "galaxyPins", [...mine, pin]); await this.#refresh(); }
      return;
    }
    if (what === "newPlanet") { this.menuAt = m; return GalaxyMapApp.#editPlanet.call(this, e, { dataset: { x: m.wx, y: m.wy } }); }
    this.render();
  }
  static async #delPin(e, el) {
    const id = el.dataset.id ?? this.menuAt?.pin; this.menuAt = null;
    const mine = game.user.getFlag(MODULE_ID, "galaxyPins") ?? [];
    if (mine.some((p) => p.id === id)) { await game.user.setFlag(MODULE_ID, "galaxyPins", mine.filter((p) => p.id !== id)); return this.#refresh(); }
    if (game.user.isGM) { const s = G.state(); s.pins = s.pins.filter((p) => p.id !== id); await G.saveState(s); }
  }
}
