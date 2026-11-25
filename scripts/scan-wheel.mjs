import { MODULE_ID, SOCKET } from "./store.mjs";
import { rollSkill } from "./roll.mjs";
import * as Scan from "./scanner.mjs";
import { playPulse } from "./scan-fx.mjs";

/* Running a scan, sharing it, and the scanner wheel players pick from. */

export const PULSE_HOOK = `${MODULE_ID}.pulse`;
/** Last pulse this client sent, for the datapad readout. */
export let lastPulse = null;

const S = (k) => game.settings.get(MODULE_ID, k);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fxOpts = () => ({ highlightSeconds: S("scanHighlight"), sound: S("scanSound") });

export function initScanSocket() {
  game.socket.on(SOCKET, (msg) => {
    if (msg?.type !== "pulse" || msg.userId === game.user.id) return;
    if (game.user.isGM || S("scanShare") === "all") playPulse(msg.result, fxOpts());
  });
}

function skillFor(signal) {
  return S(signal === "tech" ? "scanTechSkill" : signal === "force" ? "scanForceSkill" : "scanOtherSkill");
}

/**
 * Scans with one of an actor's scanners. preview: GM test that is local, free and not rolled.
 * scanner may be passed directly (GM previewing unsaved settings).
 */
export async function runScan(actor, scannerId, { preview = false, scanner = null, token = null } = {}) {
  if (!canvas.scene) return;
  if (!game.user.isGM && !S("scanPlayers")) return ui.notifications.warn("Scanners are offline right now.");
  const tok = token ?? (preview ? canvas.tokens.controlled[0]?.document : Scan.originToken(actor));
  if (!tok) return ui.notifications.warn(preview ? "Select one token on the map to preview from." : "Select your token on this scene (just one) to scan.");
  const list = actor ? Scan.scannersOf(actor) : [];
  const sc = scanner ?? list.find((s) => s.id === scannerId);
  if (!sc) return;
  if (!preview && sc.limited && sc.charges <= 0) return ui.notifications.warn(`${sc.name} is out of charge.`);

  const total = !preview && S("scanRoll") ? await rollSkill(actor, skillFor(sc.signal)) : null;
  if (!preview && S("scanRoll") && total === null) return;
  const result = Scan.pulse(canvas.scene, Scan.tokenCenter(tok), sc, { total, excludeToken: tok.id });
  result.origin.name = tok.name;
  playPulse(result, fxOpts());
  if (preview) return result;

  if (sc.limited) { sc.charges -= 1; await Scan.saveScanners(actor, list.map((s) => (s.id === sc.id ? sc : s))); }
  lastPulse = { ...result, at: Date.now(), charges: sc.limited ? `${sc.charges}/${sc.max}` : null };
  Hooks.callAll(PULSE_HOOK, lastPulse);
  game.socket.emit(SOCKET, { type: "pulse", userId: game.user.id, result });
  if (!game.user.isGM) {
    const names = result.found.map((f) => `${f.name}${f.areas > 1 ? ` ×${f.areas}` : ""}`);
    ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id), speaker: ChatMessage.getSpeaker({ token: tok }),
      content: `<b>${sc.name}</b> (${Scan.SIGNALS[sc.signal].label}${total !== null ? `, rolled ${total}` : ""}) from ${tok.name}: ` +
        `${names.length ? names.join(", ") : "no targets"}${result.tokens.length ? `, ${result.tokens.length} contact(s)` : ""}.` });
  }
  return result;
}

/* ---------- the scanner wheel ---------- */
export class ScanWheel {
  static #el = null; static #state = null;

  static open(actor = null) {
    actor ??= Scan.originToken()?.actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character;
    if (!actor) return ui.notifications.warn("Select your token to open your scanners.");
    const scanners = Scan.scannersOf(actor);
    if (!scanners.length) return ui.notifications.info(`${actor.name} has no scanners. The GM can give one from the GM Console.`);
    this.close();
    this.#state = { actor, scanners, sel: 0 };
    const el = document.createElement("div");
    el.id = "ht-scan-wheel";
    document.body.append(el);
    this.#el = el;
    this.#render();
    this.#place();
    el.addEventListener("click", (ev) => this.#onClick(ev));
    el.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.close(); });
    el.addEventListener("mouseover", (ev) => { const b = ev.target.closest("[data-slot]"); if (b) { this.#state.sel = Number(b.dataset.slot); this.#render(); } });
    this._key = (ev) => this.#onKey(ev);
    this._out = (ev) => { if (this.#el && !this.#el.contains(ev.target)) this.close(); };
    document.addEventListener("keydown", this._key, true);
    setTimeout(() => document.addEventListener("pointerdown", this._out, true), 0);
  }

  static close() {
    this.#el?.remove(); this.#el = null; this.#state = null;
    document.removeEventListener("keydown", this._key, true);
    document.removeEventListener("pointerdown", this._out, true);
  }

  static #place() {
    const tok = Scan.originToken(this.#state.actor);
    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    if (tok?.object && canvas.stage) {
      const p = canvas.stage.worldTransform.apply(Scan.tokenCenter(tok));
      x = p.x; y = p.y;
    }
    const r = 170;
    this.#el.style.left = `${Math.min(window.innerWidth - r, Math.max(r, x))}px`;
    this.#el.style.top = `${Math.min(window.innerHeight - r, Math.max(r, y))}px`;
  }

  static #render() {
    const { scanners, sel, actor } = this.#state;
    const n = scanners.length, radius = n === 1 ? 0 : 118;
    const slots = scanners.map((s, i) => {
      const sig = Scan.SIGNALS[s.signal], a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
      const empty = s.limited && s.charges <= 0;
      const pips = s.limited ? `<span class="ht-w-pips">${Array.from({ length: Math.min(s.max, 10) }, (_, k) =>
        `<i class="${k < Math.round((s.charges / s.max) * Math.min(s.max, 10)) ? "on" : ""}"></i>`).join("")}</span>` : "";
      return `<button type="button" class="ht-w-slot${i === sel ? " ht-sel" : ""}${empty ? " ht-empty" : ""}" data-slot="${i}"
        style="--x:${x}px;--y:${y}px;--sig:${sig.color}" title="${esc(s.name)}">
        <span class="ht-w-num">${i + 1}</span><i class="fas ${sig.icon}"></i><span class="ht-w-name">${esc(s.name)}</span>${pips}</button>`;
    }).join("");
    const s = scanners[sel], sig = Scan.SIGNALS[s.signal];
    const units = canvas.scene?.grid?.units ?? "";
    const canRecharge = s.limited && s.charges < s.max;
    const core = `<div class="ht-w-core${n === 1 ? " ht-solo" : ""}" style="--sig:${sig.color}">
      <div class="ht-w-actor">${esc(actor.name)}</div>
      <div class="ht-w-title">${esc(s.name)}</div>
      <div class="ht-w-meta">${sig.label} &middot; ${s.range} ${units} &middot; ${Scan.STYLES[s.style]?.split(" (")[0] ?? ""}</div>
      <div class="ht-w-charge">${s.limited ? (s.charges > 0 ? `${s.charges}/${s.max} charges` : "Out of charge") : "Unlimited"}</div>
      ${n === 1 ? `<button type="button" class="ht-w-scan" data-slot="0" ${s.limited && s.charges <= 0 ? "disabled" : ""}><i class="fas fa-satellite-dish"></i> Scan</button>` : ""}
      ${canRecharge ? `<button type="button" class="ht-w-recharge" data-recharge="1"><i class="fas fa-battery-half"></i> Recharge</button>`
        : s.limited ? `<div class="ht-w-full">Fully charged</div>` : ""}
    </div>`;
    this.#el.innerHTML = `<div class="ht-w-ring${n === 1 ? " ht-solo" : ""}">${n === 1 ? "" : slots}${core}</div>`;
  }

  static async #onClick(ev) {
    if (ev.target.closest("[data-recharge]")) {
      const { actor, scanners, sel } = this.#state;
      if (await Scan.recharge(actor, scanners[sel].id)) { this.#state.scanners = Scan.scannersOf(actor); this.#render(); }
      return;
    }
    const b = ev.target.closest("[data-slot]");
    if (b) this.#activate(Number(b.dataset.slot));
  }

  static #activate(i) {
    const { actor, scanners } = this.#state, s = scanners[i];
    if (!s) return;
    this.#state.sel = i;
    if (s.limited && s.charges <= 0) { this.#render(); return ui.notifications.warn(`${s.name} is out of charge. Recharge it in the middle of the wheel.`); }
    this.close();
    runScan(actor, s.id);
  }

  static #onKey(ev) {
    if (!this.#el) return;
    const n = this.#state.scanners.length;
    const k = ev.key;
    if (k === "Escape") { this.close(); }
    else if (k === "ArrowRight" || k === "ArrowDown") { this.#state.sel = (this.#state.sel + 1) % n; this.#render(); }
    else if (k === "ArrowLeft" || k === "ArrowUp") { this.#state.sel = (this.#state.sel - 1 + n) % n; this.#render(); }
    else if (k === "Enter" || k === " ") this.#activate(this.#state.sel);
    else if (/^[1-9]$/.test(k) && Number(k) <= n) this.#activate(Number(k) - 1);
    else return;
    ev.preventDefault(); ev.stopPropagation();
  }
}

/** Keybinding / scene control / macro entry point: wheel for players, scanners tab for GMs. */
export function openScanner({ ConsoleApp } = {}) {
  if (game.user.isGM && ConsoleApp && !canvas.tokens?.controlled.length) {
    const c = ConsoleApp.instance; c.tab = "scanners"; return c.render(true);
  }
  ScanWheel.open();
}
