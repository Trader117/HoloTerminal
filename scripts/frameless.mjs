/* Position a frameless Holo-Terminal window (datapad, holocall) ourselves.
   Foundry v12 doesn't place ApplicationV2 windows that have no frame: left/top/scale from setPosition never
   reach the element, so the window sat in the page flow beside the sidebar and couldn't be dragged.
   This keeps our own position record and writes it straight onto the element. */
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function placeFrameless(app, patch = {}) {
  const p = (app._htPos ??= { width: app.options.position?.width, height: app.options.position?.height,
    left: app.options.position?.left, top: app.options.position?.top, scale: 1 });
  for (const [k, v] of Object.entries(patch ?? {})) if (v !== undefined && v !== null) p[k] = v;
  const el = app.element;
  if (!el) return p;
  const s = Number(p.scale) || 1;
  const w = Number(p.width) || el.offsetWidth, h = Number(p.height) || el.offsetHeight;
  if (!Number.isFinite(p.left)) p.left = (window.innerWidth - w * s) / 2;
  if (!Number.isFinite(p.top)) p.top = (window.innerHeight - h * s) / 2;
  p.left = Math.round(clamp(p.left, 0, window.innerWidth - w * s));
  p.top = Math.round(clamp(p.top, 0, window.innerHeight - h * s));
  Object.assign(el.style, {
    position: "fixed", margin: "0", left: `${p.left}px`, top: `${p.top}px`,
    width: Number(p.width) ? `${p.width}px` : "", height: Number(p.height) ? `${p.height}px` : "",
    transform: s !== 1 ? `scale(${s})` : "", transformOrigin: "top left"
  });
  return p;
}
