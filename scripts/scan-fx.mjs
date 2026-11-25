/* Pulse Scanner map effects (PIXI). Everything here is local to the client that draws it. */

const PULSE_MS = 1700;
const hex = (c) => typeof c === "number" ? c : Number.parseInt(String(c ?? "#2aa3df").replace("#", ""), 16);

function layer() {
  return canvas.interface ?? canvas.controls ?? canvas.stage;
}
function textStyle(size, color, bold = false) {
  return new PIXI.TextStyle({ fontFamily: "Bahnschrift, Signika, sans-serif", fontSize: size, fontWeight: bold ? "700" : "400",
    fill: color, stroke: 0x050b10, strokeThickness: Math.max(3, size / 5), letterSpacing: bold ? 1 : 0,
    dropShadow: true, dropShadowColor: 0x000000, dropShadowBlur: 4, dropShadowDistance: 0, wordWrap: true, wordWrapWidth: 320, align: "center" });
}
const TextCls = () => foundry.canvas?.containers?.PreciseText ?? globalThis.PreciseText ?? PIXI.Text;

/* ---------- pulse styles: draw(g, progress 0..1, radius px, colour, elapsed ms) ---------- */
const STYLE_DRAW = {
  ripple(g, p, R, c) {
    for (let k = 0; k < 3; k++) {
      const q = p - k * 0.14;
      if (q <= 0 || q > 1) continue;
      g.lineStyle(4 - k, c, (1 - q) * 0.9).drawCircle(0, 0, R * q);
    }
    g.lineStyle(0).beginFill(c, 0.06 * (1 - p)).drawCircle(0, 0, R * Math.min(1, p)).endFill();
  },
  sweep(g, p, R, c) {
    g.lineStyle(2, c, 0.6).drawCircle(0, 0, R);
    g.lineStyle(1, c, 0.25).drawCircle(0, 0, R / 3).drawCircle(0, 0, (2 * R) / 3);
    const a = p * Math.PI * 2 - Math.PI / 2;
    for (let i = 0; i < 14; i++) {
      const a0 = a - (i + 1) * 0.045, a1 = a - i * 0.045;
      g.lineStyle(0).beginFill(c, 0.32 * (1 - i / 14)).moveTo(0, 0).arc(0, 0, R, a0, a1).lineTo(0, 0).endFill();
    }
    g.lineStyle(3, c, 0.95).moveTo(0, 0).lineTo(Math.cos(a) * R, Math.sin(a) * R);
  },
  lattice(g, p, R, c) {
    const hexPath = (r, rot) => {
      const pts = [];
      for (let i = 0; i < 6; i++) { const a = rot + (i * Math.PI) / 3; pts.push(Math.cos(a) * r, Math.sin(a) * r); }
      return pts;
    };
    for (let k = 0; k < 4; k++) {
      const q = p - k * 0.1;
      if (q <= 0 || q > 1) continue;
      g.lineStyle(k ? 1.5 : 3, c, (1 - q) * (k ? 0.5 : 0.95)).drawPolygon(hexPath(R * q, q * 0.6));
    }
    const front = R * Math.min(1, p);
    for (let i = 0; i < 6; i++) { const a = (i * Math.PI) / 3 + p * 0.6; g.lineStyle(1, c, 0.35 * (1 - p)).moveTo(0, 0).lineTo(Math.cos(a) * front, Math.sin(a) * front); }
  },
  static(g, p, R, c) {
    const r = R * Math.min(1, p), n = 56;
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.28) continue;
      const a0 = (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2) / n * 0.7, rr = Math.max(1, r + (Math.random() - 0.5) * 18);
      g.lineStyle(2 + Math.random() * 2, c, 0.5 + Math.random() * 0.5).moveTo(Math.cos(a0) * rr, Math.sin(a0) * rr).arc(0, 0, rr, a0, a1);
    }
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r;
      g.lineStyle(0).beginFill(c, 0.6 * (1 - p)).drawRect(Math.cos(a) * d, Math.sin(a) * d, 3, 3).endFill();
    }
  }
};

function drawArea(area, color) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  const pts = area.points;
  if (area.marker !== "reticle") {
    g.lineStyle(12, color, 0.18).drawPolygon(pts);
    g.lineStyle(3, color, 0.95).beginFill(color, area.resolved ? 0.12 : 0.05).drawPolygon(pts).endFill();
    if (!area.resolved) g.lineStyle(1, 0xffffff, 0.35).drawPolygon(pts);
  }
  c.addChild(g);
  let ret = null;
  if (area.marker !== "outline" || !area.resolved) {
    ret = new PIXI.Graphics();
    const s = 26, l = 10;
    ret.lineStyle(3, color, 0.95);
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) ret.moveTo(sx * s, sy * (s - l)).lineTo(sx * s, sy * s).lineTo(sx * (s - l), sy * s);
    ret.lineStyle(2, color, 0.8).drawCircle(0, 0, 4);
    ret.position.set(area.center.x, area.center.y);
    c.addChild(ret);
  }
  const T = TextCls();
  const name = new T(area.label.toUpperCase(), textStyle(22, color, true));
  name.anchor.set(0.5, 1);
  const top = Math.min(...pts.filter((_, i) => i % 2 === 1));
  name.position.set(area.center.x, Math.min(area.center.y - 34, top - 8));
  c.addChild(name);
  if (area.notes) {
    const notes = new T(area.notes, textStyle(15, 0xdce3e9));
    notes.anchor.set(0.5, 0);
    notes.position.set(area.center.x, name.y + 2);
    name.position.y -= notes.height + 2;
    notes.position.y = name.y + 2;
    c.addChild(notes);
  }
  c.alpha = 0;
  return { c, ret };
}

function drawContact(tok, color) {
  const c = new PIXI.Container();
  const g = new PIXI.Graphics();
  const pad = 6, l = Math.min(tok.w, tok.h) * 0.25;
  const x0 = tok.x - pad, y0 = tok.y - pad, x1 = tok.x + tok.w + pad, y1 = tok.y + tok.h + pad;
  g.lineStyle(3, color, 0.9);
  g.moveTo(x0, y0 + l).lineTo(x0, y0).lineTo(x0 + l, y0);
  g.moveTo(x1 - l, y0).lineTo(x1, y0).lineTo(x1, y0 + l);
  g.moveTo(x1, y1 - l).lineTo(x1, y1).lineTo(x1 - l, y1);
  g.moveTo(x0 + l, y1).lineTo(x0, y1).lineTo(x0, y1 - l);
  c.addChild(g);
  if (tok.tag) {
    const t = new (TextCls())(tok.tag.toUpperCase(), textStyle(14, color, true));
    t.anchor.set(0.5, 0); t.position.set((x0 + x1) / 2, y1 + 4);
    c.addChild(t);
  }
  c.alpha = 0;
  return c;
}

/** Plays a pulse result on the canvas. */
export function playPulse(result, { highlightSeconds = 10, sound = "" } = {}) {
  if (!canvas?.ready || canvas.scene?.id !== result.sceneId) return;
  const color = hex(result.color);
  const root = new PIXI.Container();
  root.eventMode = "none";
  layer().addChild(root);
  const wave = new PIXI.Graphics();
  wave.position.set(result.origin.x, result.origin.y);
  root.addChild(wave);
  const draw = STYLE_DRAW[result.style] ?? STYLE_DRAW.ripple;
  const R = result.rangePx;

  const ang = (x, y) => (Math.atan2(y - result.origin.y, x - result.origin.x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2); // 0 = north, clockwise
  const marks = [
    ...result.areas.map((a) => ({ dist: a.dist, angle: ang(a.center.x, a.center.y), ...drawArea(a, hex(a.color ?? color)) })),
    ...result.tokens.map((t) => ({ dist: t.dist, angle: ang(t.x + t.w / 2, t.y + t.h / 2), c: drawContact(t, color) }))
  ];
  const sweep = result.style === "sweep";
  for (const m of marks) root.addChild(m.c);
  if (sound) foundry.audio.AudioHelper.play({ src: sound, volume: 0.7 }, false);

  const start = performance.now(), hold = highlightSeconds * 1000, end = PULSE_MS + hold + 1000;
  const tick = () => {
    const t = performance.now() - start;
    if (t > end || root.destroyed) {
      canvas.app.ticker.remove(tick);
      if (!root.destroyed) root.destroy({ children: true });
      return;
    }
    const p = Math.min(1, t / PULSE_MS);
    wave.clear();
    if (t < PULSE_MS + 400) { draw(wave, p, R, color, t); wave.alpha = t > PULSE_MS ? 1 - (t - PULSE_MS) / 400 : 1; }
    const front = R * p;
    const fade = t > PULSE_MS + hold ? 1 - (t - PULSE_MS - hold) / 1000 : 1;
    for (const m of marks) {
      if (sweep ? p * Math.PI * 2 < m.angle && p < 1 : front < m.dist) continue;
      m.shown ??= t;
      const age = t - m.shown;
      const flicker = age < 300 ? (Math.random() < 0.5 ? 0.3 : 1) : 1;
      const breathe = 0.85 + 0.15 * Math.sin(t / 300);
      m.c.alpha = Math.max(0, fade * flicker * breathe);
      if (m.ret) m.ret.rotation = t / 900;
    }
  };
  canvas.app.ticker.add(tick);
  Hooks.once("canvasTearDown", () => { canvas.app?.ticker.remove(tick); if (!root.destroyed) root.destroy({ children: true }); });
}

/** Ping one point (datapad crosshair button). */
export function pingPoint(x, y, color) {
  playPulse({ sceneId: canvas.scene?.id, origin: { x, y }, rangePx: (canvas.grid?.size ?? 100) * 1.2, color, style: "ripple", areas: [], tokens: [] },
    { highlightSeconds: 0 });
}
