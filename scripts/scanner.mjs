import { MODULE_ID } from "./store.mjs";
import { regionBounds } from "./cameras.mjs";

/* Pulse Scanner. A player sends a Tech or Force pulse from their token. It finds:
   - Regions with the "Scan Signature" behaviour (GM-placed: a hidden terminal, a kyber crystal, a buried cache...).
   - Creatures, if the setting is on: droids answer a Tech pulse; creatures with Force powers answer a Force pulse.
   Each signature has a DC. Beat it and you get the name and details; miss by 5 or less and you see a faint blip. */

export const SIGNATURE_TYPE = `${MODULE_ID}.scanSignature`;
export const MODES = {
  tech: { label: "Tech pulse", icon: "fa-satellite-dish", hint: "Electronics, droids, power sources, hidden machinery." },
  force: { label: "Force pulse", icon: "fa-hand-sparkles", hint: "Force-imbued relics, kyber, Force users, dark-side echoes." }
};
const FORCE_SCHOOLS = ["lgt", "drk", "uni"];
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function registerScannerSettings() {
  const sw = game.system.id === "sw5e";
  game.settings.register(MODULE_ID, "scanRange", {
    name: "Pulse Scanner range", hint: "Radius of a pulse, in grid squares. 0 = the whole scene.",
    scope: "world", config: true, type: Number, default: 12
  });
  game.settings.register(MODULE_ID, "scanTechSkill", {
    name: "Tech pulse skill", hint: "Skill key rolled for a Tech pulse. SW5e Technology is 'tec'.",
    scope: "world", config: true, type: String, default: sw ? "tec" : "inv"
  });
  game.settings.register(MODULE_ID, "scanForceSkill", {
    name: "Force pulse skill", hint: "Skill key rolled for a Force pulse. Insight ('ins') by default.",
    scope: "world", config: true, type: String, default: "ins"
  });
  game.settings.register(MODULE_ID, "scanCreatures", {
    name: "Pulse Scanner finds creatures", hint: "Tech pulses find droids, Force pulses find creatures with Force powers. Hidden tokens are found too (DC +5).",
    scope: "world", config: true, type: Boolean, default: true
  });
}

/* ---------- Region behaviour ---------- */
export function registerSignatureBehavior() {
  const Base = foundry.data?.regionBehaviors?.RegionBehaviorType;
  if (!Base) return;
  const { StringField, NumberField } = foundry.data.fields;
  class ScanSignatureBehavior extends Base {
    static defineSchema() {
      return {
        kind: new StringField({ required: true, initial: "tech", choices: { tech: "Tech", force: "Force", both: "Tech and Force" },
          label: "Shows up on", hint: "Which pulse finds it." }),
        label: new StringField({ required: true, blank: true, initial: "", label: "Name",
          hint: "What the scanner calls it once resolved, e.g. 'Power cell cache'. Blank uses the Region's name." }),
        details: new StringField({ required: true, blank: true, initial: "", label: "Readout",
          hint: "Text the player reads when the pulse beats the DC." }),
        dc: new NumberField({ required: true, integer: true, min: 0, initial: 12, label: "DC",
          hint: "Pulse roll needed to resolve it. Missing by 5 or less still shows a faint blip." })
      };
    }
    static events = {};
  }
  CONFIG.RegionBehavior.dataModels[SIGNATURE_TYPE] = ScanSignatureBehavior;
  CONFIG.RegionBehavior.typeIcons[SIGNATURE_TYPE] = "fas fa-satellite-dish";
}

/* ---------- scanning ---------- */
const forceUser = (actor) => actor?.items?.some((i) => i.type === "spell" && FORCE_SCHOOLS.includes(i.system?.school));
const isDroid = (actor) => /droid/i.test(actor?.system?.details?.type?.value ?? actor?.system?.details?.type?.custom ?? "");

/** Every signature on a scene: { key, kind, name, details, dc, x, y } with x/y at its centre. */
export function signatures(scene) {
  const out = [];
  for (const region of scene?.regions ?? []) {
    const b = regionBounds(region);
    if (!b) continue;
    for (const beh of region.behaviors ?? []) {
      if (beh.type !== SIGNATURE_TYPE || beh.disabled) continue;
      const s = beh.system;
      out.push({ key: beh.uuid, source: "region", kind: s.kind, name: s.label || region.name || "Signature", details: s.details,
        dc: s.dc ?? 12, x: b.x + b.w / 2, y: b.y + b.h / 2 });
    }
  }
  if (game.settings.get(MODULE_ID, "scanCreatures")) {
    const g = scene?.grid?.size ?? 100;
    for (const t of scene?.tokens ?? []) {
      const a = t.actor;
      if (!a || a.hasPlayerOwner) continue;
      const kinds = [isDroid(a) && "tech", forceUser(a) && "force"].filter(Boolean);
      for (const kind of kinds) out.push({ key: `${t.uuid}:${kind}`, source: "token", kind,
        name: kind === "tech" ? "Droid" : "Force presence", details: t.hidden ? "Concealed." : t.name,
        dc: 10 + (t.hidden ? 5 : 0), x: t.x + (t.width ?? 1) * g / 2, y: t.y + (t.height ?? 1) * g / 2 });
    }
  }
  return out;
}

/** The pulse: which signatures this mode and roll pick up, relative to the origin point. */
export function pulse(scene, origin, mode, total) {
  const g = scene?.grid?.size ?? 100;
  const range = game.settings.get(MODULE_ID, "scanRange") || 0;
  const hits = [];
  for (const s of signatures(scene)) {
    if (s.kind !== mode && s.kind !== "both") continue;
    const dx = s.x - origin.x, dy = s.y - origin.y;
    const dist = Math.hypot(dx, dy) / g;
    if (range > 0 && dist > range) continue;
    const resolved = total >= s.dc, faint = !resolved && total >= s.dc - 5;
    if (!resolved && !faint) continue;
    const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360; // 0 = north (up), clockwise
    hits.push({ key: s.key, resolved, name: resolved ? s.name : "Faint signal", details: resolved ? s.details : "",
      dist: Math.round(dist), bearing: COMPASS[Math.round(angle / 45) % 8], angle, dx: dx / g, dy: dy / g, x: s.x, y: s.y });
  }
  hits.sort((a, b) => Number(b.resolved) - Number(a.resolved) || a.dist - b.dist);
  const reach = range > 0 ? range : Math.max(4, ...hits.map((h) => Math.hypot(h.dx, h.dy)));
  return { mode, total, range, reach, hits };
}

/** Blip positions on the radar (percent of the dish), and when the sweep reaches them. */
export function blips(result, sweepSeconds) {
  return result.hits.map((h, i) => {
    const r = Math.min(1, Math.hypot(h.dx, h.dy) / result.reach) * 46;
    const a = (h.angle - 90) * Math.PI / 180;
    return { n: i + 1, resolved: h.resolved, left: (50 + r * Math.cos(a)).toFixed(1), top: (50 + r * Math.sin(a)).toFixed(1),
      delay: ((h.angle / 360) * sweepSeconds).toFixed(2) };
  });
}

/** Local-only ping on the canvas (not broadcast), if the core supports it. */
export function markOnMap(x, y) {
  if (!canvas?.ready) return;
  try { canvas.controls?.drawPing?.({ x, y }, { style: "pulse", color: "#2aa3df", duration: 2500 }); }
  catch (err) { console.warn(`${MODULE_ID} | ping failed`, err); }
}
