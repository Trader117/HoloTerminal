import { MODULE_ID, list, saveList } from "./store.mjs";

/* Security cameras. A camera is a rectangle Drawing on a scene, linked to a terminal as a control
   { type: "camera", id: <drawing id>, scene: <scene id>, label }. The feed is rebuilt from scene data
   (background, tiles, visible tokens), so it works for any scene, not just the one on screen.
   Recordings capture token positions inside the camera's area over time and are stored in the
   "recordings" world setting: { id, cameraKey, label, started, shared, frames: [{ t, tokens: [...] }] }. */

export const FEED_WIDTH = 390;
const MAX_FRAMES = 3000;
export const cameraKey = (c) => `${c.scene}:${c.id}`;

export function cameraRect(c) {
  const d = game.scenes.get(c.scene)?.drawings.get(c.id);
  if (!d) return null;
  const w = Math.abs(d.shape?.width ?? 0), h = Math.abs(d.shape?.height ?? 0);
  return w > 10 && h > 10 ? { x: d.x, y: d.y, w, h } : null;
}

const inside = (r, x, y, w, h) => x + w > r.x && y + h > r.y && x < r.x + r.w && y < r.y + r.h;

/** Visible tokens overlapping the rectangle, positioned relative to it. */
export function tokensIn(scene, r, { includeHidden = false } = {}) {
  const g = scene.grid?.size ?? 100;
  return scene.tokens.filter((t) => includeHidden || !t.hidden).map((t) => ({
    id: t.id, name: t.name, img: t.texture?.src, x: t.x - r.x, y: t.y - r.y,
    w: (t.width ?? 1) * g, h: (t.height ?? 1) * g, rot: t.rotation ?? 0
  })).filter((t) => inside({ x: 0, y: 0, w: r.w, h: r.h }, t.x, t.y, t.w, t.h));
}

/** Everything needed to draw a feed: scale, background placement, tiles and tokens. */
export function feedData(c) {
  const scene = game.scenes.get(c.scene);
  const r = cameraRect(c);
  if (!scene || !r) return null;
  const s = FEED_WIDTH / r.w;
  const dims = scene.dimensions ?? {};
  const bg = scene.background?.src;
  const tiles = scene.tiles.filter((t) => !t.hidden && t.texture?.src && inside(r, t.x, t.y, t.width, t.height))
    .map((t) => ({ img: t.texture.src, x: t.x - r.x, y: t.y - r.y, w: t.width, h: t.height, rot: t.rotation ?? 0 }));
  return { key: cameraKey(c), label: c.label, sceneName: scene.name, w: r.w, h: r.h, scale: s, height: Math.round(r.h * s),
    bg, bgX: (dims.sceneX ?? 0) - r.x, bgY: (dims.sceneY ?? 0) - r.y, bgW: dims.sceneWidth ?? scene.width, bgH: dims.sceneHeight ?? scene.height,
    tiles, tokens: tokensIn(scene, r), recording: Recorder.isRecording(cameraKey(c)) };
}

/* ---------- recording (runs on the GM's client) ---------- */
export const Recorder = {
  active: new Map(), // cameraKey -> { rec, camera, hook }
  isRecording: (key) => Recorder.active.has(key),

  start(camera) {
    if (!game.user.isGM) return;
    const key = cameraKey(camera);
    if (this.active.has(key)) return;
    const scene = game.scenes.get(camera.scene), r = cameraRect(camera);
    if (!scene || !r) return ui.notifications.warn("That camera's rectangle is missing.");
    const started = Date.now();
    const rec = { id: foundry.utils.randomID(), cameraKey: key, label: `${camera.label} ${new Date(started).toLocaleString()}`,
      sceneId: scene.id, started, shared: false, rect: r, frames: [] };
    const snap = () => {
      const rect = cameraRect(camera) ?? r;
      if (rec.frames.length < MAX_FRAMES) rec.frames.push({ t: Date.now() - started, tokens: tokensIn(scene, rect) });
    };
    snap();
    const onChange = (doc) => { if (doc.parent?.id === scene.id) snap(); };
    const hooks = ["updateToken", "createToken", "deleteToken"].map((h) => [h, Hooks.on(h, onChange)]);
    this.active.set(key, { rec, camera, hooks });
    Hooks.callAll(`${MODULE_ID}.changed`, "recordings");
  },

  async stop(camera) {
    const key = cameraKey(camera);
    const entry = this.active.get(key);
    if (!entry) return;
    entry.hooks.forEach(([h, id]) => Hooks.off(h, id));
    this.active.delete(key);
    const rec = entry.rec;
    rec.frames.push({ t: Date.now() - rec.started, tokens: rec.frames.at(-1)?.tokens ?? [] }); // mark the end time
    rec.duration = rec.frames.at(-1).t;
    const all = list("recordings"); all.push(rec);
    await saveList("recordings", all);
    ui.notifications.info(`Saved recording: ${rec.label}`);
  }
};

/** Token positions at time t (ms): the last frame at or before t. */
export function frameAt(rec, t) {
  let f = rec.frames[0];
  for (const fr of rec.frames) { if (fr.t <= t) f = fr; else break; }
  return f;
}

export function recordingsFor(keys, { gm = game.user.isGM } = {}) {
  return list("recordings").filter((r) => keys.includes(r.cameraKey) && (gm || r.shared))
    .sort((a, b) => b.started - a.started);
}

/* ---------- playback helpers (DOM) ---------- */
export const tokenStyle = (t) => `left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;transform:rotate(${t.rot}deg)`;

/** Moves, adds and removes token images in a feed so movement animates between frames. */
export function applyFrame(layer, tokens) {
  if (!layer) return;
  const seen = new Set();
  for (const t of tokens) {
    seen.add(t.id);
    let img = layer.querySelector(`[data-token="${t.id}"]`);
    if (!img) {
      img = document.createElement("img");
      img.className = "ht-feed-token"; img.dataset.token = t.id; img.src = t.img ?? ""; img.alt = t.name ?? "";
      layer.append(img);
    }
    img.setAttribute("style", tokenStyle(t));
  }
  layer.querySelectorAll("[data-token]").forEach((el) => { if (!seen.has(el.dataset.token)) el.remove(); });
}

export const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Feed data for a recording (background from its scene, tokens from the frame at time t). */
export function recordingFeed(rec, t) {
  const scene = game.scenes.get(rec.sceneId);
  const r = rec.rect;
  const s = FEED_WIDTH / r.w;
  const dims = scene?.dimensions ?? {};
  const tiles = (scene?.tiles ?? []).filter((x) => !x.hidden && x.texture?.src && inside(r, x.x, x.y, x.width, x.height))
    .map((x) => ({ img: x.texture.src, x: x.x - r.x, y: x.y - r.y, w: x.width, h: x.height, rot: x.rotation ?? 0 }));
  return { key: rec.id, label: rec.label, sceneName: scene?.name ?? "archived", w: r.w, h: r.h, scale: s, height: Math.round(r.h * s),
    bg: scene?.background?.src, bgX: (dims.sceneX ?? 0) - r.x, bgY: (dims.sceneY ?? 0) - r.y,
    bgW: dims.sceneWidth ?? scene?.width, bgH: dims.sceneHeight ?? scene?.height, tiles,
    tokens: frameAt(rec, t)?.tokens ?? [], playback: true };
}
