import { MODULE_ID } from "./store.mjs";

/* Pulse Scanner.
   The GM gives a character one or more scanners (stored on the actor, no item needed). Each scanner has a signal type,
   a range in scene units, optional charges, and a pulse style. A player picks one from the scanner wheel around their
   token; the pulse rolls out across the map and lights up matching targets inside its range.
   Targets are Scene Regions with the "Scan Signature" behaviour. Every shape in a Region is checked on its own, so
   three secret doors drawn in one Region light up separately. Disabling the behaviour marks the target resolved. */

export const SIGNATURE_TYPE = `${MODULE_ID}.scanSignature`;
const FLAG = "scanners";

export const SIGNALS = {
  tech:       { label: "Tech",       icon: "fa-microchip",        color: "#2aa3df", hint: "Devices, droids, transmitters, power cells, slicing ports." },
  force:      { label: "Force",      icon: "fa-hand-sparkles",    color: "#e69a28", hint: "Kyber, Force-imbued relics, Force users, dark-side echoes." },
  structural: { label: "Structural", icon: "fa-building-columns", color: "#a7b6c4", hint: "Hidden doors, crawlspaces, hull stress, weak bulkheads." },
  thermal:    { label: "Thermal",    icon: "fa-temperature-high", color: "#ff5146", hint: "Engines, reactors, warm bodies, recently fired blasters." },
  bio:        { label: "Bio-sign",   icon: "fa-dna",              color: "#4cc38a", hint: "Life signs, toxins, spores, organic matter." },
  trace:      { label: "Trace",      icon: "fa-fingerprint",      color: "#c38bff", hint: "Residue, blood, carbon scoring, tracks, evidence." }
};
export const STYLES = {
  ripple: "Ripple (expanding rings)",
  sweep: "Radar sweep",
  lattice: "Hex lattice",
  static: "Interference"
};

/* ---------- settings ---------- */
export function registerScannerSettings() {
  const sw = game.system.id === "sw5e";
  const reg = (key, data) => game.settings.register(MODULE_ID, key, { scope: "world", config: true, ...data });
  reg("scanPlayers", { name: "Pulse Scanner: players can scan", hint: "Turn off to pause scanning for everyone but the GM.", type: Boolean, default: true });
  reg("scanShare", { name: "Pulse Scanner: who sees a pulse", type: String, default: "self",
    choices: { self: "The scanning player (and the GM)", all: "Everyone on the scene" } });
  reg("scanTokens", { name: "Pulse Scanner: token contacts", hint: "Pulses bracket other tokens in range. Droids show on Tech pulses and Force users on Force pulses with a label.",
    type: String, default: "visible", choices: { visible: "Tokens the player can see", walls: "Through walls (not GM-hidden tokens)", off: "Off (targets only)" } });
  reg("scanHighlight", { name: "Pulse Scanner: highlight time", hint: "Seconds that highlights stay on the map.", type: Number, default: 10 });
  reg("scanRoll", { name: "Pulse Scanner: roll to resolve", hint: "Each pulse rolls a skill. Targets with a DC above the roll show only as an unresolved signal.",
    type: Boolean, default: false });
  reg("scanTechSkill", { name: "Pulse Scanner: Tech skill", hint: "Rolled for Tech pulses when rolling is on. SW5e Technology is 'tec'.", type: String, default: sw ? "tec" : "inv" });
  reg("scanForceSkill", { name: "Pulse Scanner: Force skill", hint: "Rolled for Force pulses when rolling is on.", type: String, default: "ins" });
  reg("scanOtherSkill", { name: "Pulse Scanner: other signals skill", hint: "Rolled for Structural, Thermal, Bio-sign and Trace pulses when rolling is on.", type: String, default: "prc" });
  reg("scanRechargeItem", { name: "Pulse Scanner: recharge item", hint: "Name of an item used up to recharge a scanner, e.g. 'Power Cell'. Leave blank for free recharges.", type: String, default: "" });
  reg("scanSound", { name: "Pulse Scanner: pulse sound", type: String, default: "", filePicker: "audio" });
}
const S = (k) => game.settings.get(MODULE_ID, k);

/* ---------- Region behaviour ---------- */
export function registerSignatureBehavior() {
  const Base = foundry.data?.regionBehaviors?.RegionBehaviorType;
  if (!Base) return;
  const { StringField, NumberField, BooleanField, ColorField } = foundry.data.fields;
  const signalChoices = Object.fromEntries(Object.entries(SIGNALS).map(([k, v]) => [k, v.label]));
  class ScanSignatureBehavior extends Base {
    static defineSchema() {
      return {
        signal: new StringField({ required: true, initial: "tech", choices: signalChoices, label: "Detected by", hint: "The scanner signal that finds this target." }),
        label: new StringField({ required: true, blank: true, initial: "", label: "Name", hint: "Shown on the map when found. Blank uses the Region's name." }),
        notes: new StringField({ required: true, blank: true, initial: "", label: "Notes", hint: "Extra readout under the name, e.g. 'Panel is loose. Power cell inside.'" }),
        showNotes: new BooleanField({ initial: true, label: "Show notes to players", hint: "Off: players see the name only. Still detected either way." }),
        marker: new StringField({ required: true, initial: "outline", choices: { outline: "Outline the area", reticle: "Target reticle", both: "Both" }, label: "Marker" }),
        color: new ColorField({ required: false, nullable: true, initial: null, label: "Colour", hint: "Blank uses the signal's colour." }),
        dc: new NumberField({ required: true, integer: true, min: 0, initial: 0, label: "DC", hint: "Only used when 'roll to resolve' is on. 0 = always resolves." })
      };
    }
    static events = {};
  }
  CONFIG.RegionBehavior.dataModels[SIGNATURE_TYPE] = ScanSignatureBehavior;
  CONFIG.RegionBehavior.typeIcons[SIGNATURE_TYPE] = "fas fa-satellite-dish";
}

/* ---------- scanners on actors ---------- */
export const scannersOf = (actor) => foundry.utils.deepClone(actor?.getFlag(MODULE_ID, FLAG) ?? []);
export const saveScanners = (actor, list) => actor.setFlag(MODULE_ID, FLAG, list);

export function newScanner(data = {}) {
  const signal = SIGNALS[data.signal] ? data.signal : "tech";
  const max = Math.max(1, Number(data.max) || 5);
  return { id: foundry.utils.randomID(), name: data.name || `${SIGNALS[signal].label} scanner`, signal,
    range: Math.max(1, Number(data.range) || 30), limited: !!data.limited, max, charges: max, style: STYLES[data.style] ? data.style : "ripple" };
}

/** Characters a GM can hand scanners to: player-owned or assigned to a user. */
export function scannerActors() {
  const assigned = new Set(game.users.map((u) => u.character?.id).filter(Boolean));
  return game.actors.filter((a) => a.type === "character" && (a.hasPlayerOwner || assigned.has(a.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function recharge(actor, scannerId) {
  const list = scannersOf(actor), sc = list.find((s) => s.id === scannerId);
  if (!sc?.limited || sc.charges >= sc.max) return false;
  const itemName = S("scanRechargeItem")?.trim();
  if (itemName && !game.user.isGM) {
    const item = actor.items.find((i) => i.name.toLowerCase() === itemName.toLowerCase());
    if (!item) { ui.notifications.warn(`You need a ${itemName} to recharge.`); return false; }
    const qty = item.system?.quantity ?? 1;
    if (qty > 1) await item.update({ "system.quantity": qty - 1 }); else await item.delete();
  }
  sc.charges = sc.max;
  await saveScanners(actor, list);
  ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }),
    content: `<b>${actor.name}</b> recharged <i>${sc.name}</i>${itemName && !game.user.isGM ? ` with a ${itemName}` : ""}.` });
  return true;
}

/* ---------- geometry ---------- */
function rotatePts(pts, cx, cy, deg) {
  if (!deg) return pts;
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const out = [];
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - cx, dy = pts[i + 1] - cy;
    out.push(cx + dx * c - dy * s, cy + dx * s + dy * c);
  }
  return out;
}
function ellipsePts(cx, cy, rx, ry, n = 32) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
  return out;
}
/** A Region shape as a flat polygon [x0,y0,x1,y1,...] in scene pixels. */
export function shapePolygon(sh) {
  switch (sh.type) {
    case "rectangle": {
      const { x, y, width: w, height: h } = sh;
      return rotatePts([x, y, x + w, y, x + w, y + h, x, y + h], x + w / 2, y + h / 2, sh.rotation);
    }
    case "circle": return ellipsePts(sh.x, sh.y, sh.radius, sh.radius);
    case "ellipse": return rotatePts(ellipsePts(sh.x, sh.y, sh.radiusX, sh.radiusY), sh.x, sh.y, sh.rotation);
    case "polygon": return [...sh.points];
    default: return null;
  }
}
function insidePoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
/** Pixel distance from a point to the nearest edge of a polygon (0 inside). */
export function polyDistance(pts, x, y) {
  if (insidePoly(pts, x, y)) return 0;
  let d = Infinity;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) d = Math.min(d, segDist(x, y, pts[j], pts[j + 1], pts[i], pts[i + 1]));
  return d;
}
function centroid(pts) {
  let x = 0, y = 0; const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; }
  return { x: x / n, y: y / n };
}

/** Bounding box { x, y, w, h } of a Region's shapes (holes ignored). Used by cameras. */
export function regionBounds(region) {
  const pts = (region.shapes ?? []).filter((sh) => !sh.hole).map(shapePolygon).filter(Boolean).flat();
  if (!pts.length) return null;
  const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/* ---------- detection ---------- */
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const FORCE_SCHOOLS = ["lgt", "drk", "uni"];
const isForceUser = (a) => a?.items?.some((i) => i.type === "spell" && FORCE_SCHOOLS.includes(i.system?.school));
const isDroid = (a) => /droid/i.test(a?.system?.details?.type?.value ?? "") || /droid/i.test(a?.system?.details?.type?.custom ?? "");
const bearing = (dx, dy) => COMPASS[Math.round(((Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360) / 45) % 8];

/** Every active Scan Signature target on a scene. */
export function targets(scene, { includeResolved = false } = {}) {
  const out = [];
  for (const region of scene?.regions ?? []) for (const beh of region.behaviors ?? []) {
    if (beh.type !== SIGNATURE_TYPE || (beh.disabled && !includeResolved)) continue;
    const s = beh.system;
    out.push({ uuid: beh.uuid, regionId: region.id, region, behavior: beh, resolved: beh.disabled, signal: s.signal,
      name: s.label || region.name || "Signature", notes: s.notes, showNotes: s.showNotes, marker: s.marker,
      color: s.color?.css ?? (typeof s.color === "string" ? s.color : null) ?? SIGNALS[s.signal]?.color, dc: s.dc ?? 0 });
  }
  return out;
}

/**
 * Runs a pulse. origin: {x, y} in scene pixels. Returns everything the map effect and the datapad need:
 * areas (one per reached shape), tokens (contacts), and a per-target summary.
 */
export function pulse(scene, origin, scanner, { total = null, viewer = game.user, excludeToken = null } = {}) {
  const g = scene.grid?.size ?? 100, unit = scene.grid?.distance ?? 5;
  const rangePx = (scanner.range / unit) * g;
  const sig = SIGNALS[scanner.signal] ?? SIGNALS.tech;
  const areas = [], found = [];
  for (const t of targets(scene)) {
    if (t.signal !== scanner.signal) continue;
    const resolved = total === null || !S("scanRoll") || !t.dc || total >= t.dc;
    let reached = 0, nearest = Infinity, where = null;
    for (const sh of t.region.shapes ?? []) {
      if (sh.hole) continue;
      const pts = shapePolygon(sh);
      if (!pts) continue;
      const d = polyDistance(pts, origin.x, origin.y);
      if (d > rangePx) continue;
      reached++;
      const c = centroid(pts);
      if (d < nearest) { nearest = d; where = c; }
      areas.push({ points: pts, center: c, dist: d, color: t.color, marker: t.marker, resolved,
        label: resolved ? t.name : "Unresolved signal", notes: resolved && (t.showNotes || viewer.isGM) ? t.notes : "" });
    }
    if (reached) found.push({ uuid: t.uuid, name: resolved ? t.name : "Unresolved signal", notes: resolved && (t.showNotes || viewer.isGM) ? t.notes : "",
      resolved, areas: reached, dist: Math.round((nearest / g) * unit), bearing: bearing(where.x - origin.x, where.y - origin.y),
      dx: (where.x - origin.x) / rangePx, dy: (where.y - origin.y) / rangePx, x: where.x, y: where.y, color: t.color });
  }
  const tokens = [];
  const mode = S("scanTokens");
  if (mode !== "off") for (const tok of scene.tokens) {
    if (tok.id === excludeToken || tok.hidden) continue;
    if (mode === "visible" && scene === canvas.scene && tok.object && !tok.object.isVisible) continue;
    const w = (tok.width ?? 1) * g, h = (tok.height ?? 1) * g, cx = tok.x + w / 2, cy = tok.y + h / 2;
    const d = Math.max(0, Math.hypot(cx - origin.x, cy - origin.y) - Math.min(w, h) / 2);
    if (d > rangePx) continue;
    const a = tok.actor;
    const tag = scanner.signal === "tech" && isDroid(a) ? "Droid" : scanner.signal === "force" && isForceUser(a) ? "Force presence"
      : scanner.signal === "bio" && !isDroid(a) ? "Life sign" : scanner.signal === "thermal" ? "Heat signature" : "";
    tokens.push({ x: tok.x, y: tok.y, w, h, dist: d, tag });
  }
  found.sort((a, b) => Number(b.resolved) - Number(a.resolved) || a.dist - b.dist);
  return { origin, rangePx, range: scanner.range, units: scene.grid?.units ?? "", signal: scanner.signal, color: sig.color,
    style: scanner.style ?? "ripple", scannerName: scanner.name, total, areas, tokens, found, sceneId: scene.id };
}

/** Where a pulse starts for this user: a controlled token they own, else their character's only token on the scene. */
export function originToken(actor) {
  const ctrl = canvas.tokens?.controlled.filter((t) => t.document.isOwner);
  if (ctrl?.length === 1) return ctrl[0].document;
  if (ctrl?.length > 1) return null;
  const mine = canvas.scene?.tokens.filter((t) => t.actorId === (actor ?? game.user.character)?.id) ?? [];
  return mine.length === 1 ? mine[0] : null;
}
export function tokenCenter(tok) {
  const g = tok.parent?.grid?.size ?? 100;
  return { x: tok.x + (tok.width ?? 1) * g / 2, y: tok.y + (tok.height ?? 1) * g / 2 };
}
