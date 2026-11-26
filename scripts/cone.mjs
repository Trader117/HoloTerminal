import { MODULE_ID } from "./store.mjs";

/* "Camera cone" tool on the Regions layer: click where the camera sits, drag toward what it watches, let go.
   It creates a Region with one cone-shaped polygon, ready to link to a terminal as a camera.
   The cone's width is remembered per GM (client setting "coneAngle"). */

const state = { active: false, origin: null, preview: null, panel: null };
const SETTING = "coneAngle";

export function registerConeSetting() {
  game.settings.register(MODULE_ID, SETTING, { scope: "client", config: false, type: Number, default: 90 });
}
const coneAngle = () => Math.min(360, Math.max(10, Number(game.settings.get(MODULE_ID, SETTING)) || 90));

/** Points of a cone from origin toward target, `angle` degrees wide, as a flat [x, y, x, y...] list. */
export function conePoints(origin, target, angle) {
  const r = Math.hypot(target.x - origin.x, target.y - origin.y);
  const dir = Math.atan2(target.y - origin.y, target.x - origin.x);
  const half = (angle * Math.PI) / 360;
  const steps = Math.max(4, Math.ceil(angle / 6));
  const pts = angle >= 360 ? [] : [origin.x, origin.y];
  for (let i = 0; i <= steps; i++) {
    if (angle >= 360 && i === steps) break;
    const a = dir - half + (2 * half * i) / steps;
    pts.push(Math.round(origin.x + r * Math.cos(a)), Math.round(origin.y + r * Math.sin(a)));
  }
  return pts;
}

function toCanvas(ev) {
  if (canvas.canvasCoordinatesFromClient) return canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY });
  const rect = canvas.app.view.getBoundingClientRect();
  return canvas.stage.worldTransform.applyInverse(new PIXI.Point(ev.clientX - rect.left, ev.clientY - rect.top));
}

function drawPreview(target) {
  const g = state.preview;
  if (!g || !state.origin) return;
  g.clear();
  const pts = conePoints(state.origin, target, coneAngle());
  const color = Number(`0x${(game.user.color?.css ?? "#2aa3df").replace("#", "")}`) || 0x2aa3df;
  g.lineStyle(3, color, 0.9).beginFill(color, 0.2).drawPolygon(pts).endFill();
  g.beginFill(color, 1).drawCircle(state.origin.x, state.origin.y, 6).endFill();
}

function onDown(ev) {
  if (!state.active || ev.button !== 0 || ev.target !== canvas.app?.view) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  state.origin = toCanvas(ev);
  state.preview = new PIXI.Graphics();
  (canvas.controls ?? canvas.stage).addChild(state.preview);
}
function onMove(ev) {
  if (!state.active || !state.origin) return;
  ev.stopImmediatePropagation();
  drawPreview(toCanvas(ev));
}
async function onUp(ev) {
  if (!state.active || !state.origin) return;
  ev.stopImmediatePropagation(); ev.preventDefault();
  const origin = state.origin, target = toCanvas(ev);
  state.origin = null;
  state.preview?.destroy(); state.preview = null;
  if (Math.hypot(target.x - origin.x, target.y - origin.y) < (canvas.grid?.size ?? 100) / 4)
    return ui.notifications.info("Drag from the camera toward what it watches to draw a cone.");
  const n = (canvas.scene.regions?.filter((r) => /^Camera \d+$/.test(r.name)).length ?? 0) + 1;
  const [region] = await canvas.scene.createEmbeddedDocuments("Region", [{
    name: `Camera ${n}`, color: game.user.color?.css ?? "#2aa3df",
    shapes: [{ type: "polygon", points: conePoints(origin, target, coneAngle()), hole: false }],
    visibility: CONST.REGION_VISIBILITY?.LAYER ?? 0
  }]);
  if (region) {
    canvas.regions?.get(region.id)?.control({ releaseOthers: true });
    ui.notifications.info(`Drew ${region.name}. With it selected, press "Add selected" in a terminal's editor to link it as a camera.`);
  }
}
function onKey(ev) {
  if (!state.active) return;
  if (ev.key === "Escape" && state.origin) { ev.stopImmediatePropagation(); state.origin = null; state.preview?.destroy(); state.preview = null; }
}

function showPanel() {
  state.panel?.remove();
  const el = document.createElement("div");
  el.className = "ht-cone-panel";
  el.innerHTML = `<b><i class="fas fa-video"></i> Camera cone</b>
    <span>Click where the camera is, drag toward what it sees, let go.</span>
    <label>Width <input type="range" min="10" max="360" step="5" value="${coneAngle()}"> <output>${coneAngle()}°</output></label>`;
  const input = el.querySelector("input"), out = el.querySelector("output");
  input.addEventListener("input", () => { out.textContent = `${input.value}°`; game.settings.set(MODULE_ID, SETTING, Number(input.value)); });
  document.body.append(el);
  state.panel = el;
}

/** Turns the cone tool on or off. */
export function setConeTool(on) {
  on = !!on && game.user.isGM;
  if (on === state.active) return;
  state.active = on;
  const opts = { capture: true };
  if (on) {
    window.addEventListener("pointerdown", onDown, opts);
    window.addEventListener("pointermove", onMove, opts);
    window.addEventListener("pointerup", onUp, opts);
    window.addEventListener("keydown", onKey, opts);
    showPanel();
  } else {
    window.removeEventListener("pointerdown", onDown, opts);
    window.removeEventListener("pointermove", onMove, opts);
    window.removeEventListener("pointerup", onUp, opts);
    window.removeEventListener("keydown", onKey, opts);
    state.origin = null; state.preview?.destroy(); state.preview = null;
    state.panel?.remove(); state.panel = null;
  }
}

/** Adds the tool to the Regions controls (v12 array form and v13 object form). */
export function addConeTool(controls) {
  if (!game.user.isGM) return;
  const tool = { name: "ht-cone", title: "Camera cone (Holo-Terminal): drag out a cone-shaped Region for a security camera", icon: "fas fa-video" };
  if (Array.isArray(controls)) {
    const regions = controls.find((c) => c.name === "regions");
    if (!regions) return;
    regions.tools.push({ ...tool, toggle: true, active: state.active, onClick: (toggled) => setConeTool(toggled) });
  } else if (controls.regions) {
    controls.regions.tools["ht-cone"] = { ...tool, toggle: true, active: state.active, order: 99, onChange: (event, active) => setConeTool(active) };
  }
}

/* Leaving the Regions layer or the scene turns the tool off. */
Hooks.on("renderSceneControls", (app) => {
  const layer = app.activeControl ?? app.control?.name;
  if (state.active && layer && layer !== "regions") setConeTool(false);
});
Hooks.on("canvasTearDown", () => setConeTool(false));
