import { MODULE_ID } from "./store.mjs";
import * as Comms from "./comms.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* A floating hologram of whoever is calling. The GM sees the same window with a line box and End call. */
export class HolocallApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance;
  static get instance() { return (this.#instance ??= new HolocallApp()); }
  static DEFAULT_OPTIONS = {
    id: "ht-holocall", classes: ["ht-app"], window: { title: "Holocall", frame: false, positioned: true },
    position: { width: 340, height: "auto", top: 80 },
    actions: { hangUp: HolocallApp.#hangUp, say: HolocallApp.#say }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/holocall.hbs` } };
  call = null; owner = false;

  static register() {
    Hooks.on(Comms.CALL_HOOK, (call, owner) => {
      const app = HolocallApp.instance;
      if (!call.open) { if (app.call?.id === call.id) app.close(); return; }
      if (app.call?.id !== call.id) app.position.left = Math.round((window.innerWidth - 340) / 2);
      app.call = call; app.owner = owner && game.user.isGM;
      app.render({ force: true });
    });
  }

  async _prepareContext() {
    const c = this.call ?? { lines: [] };
    return { ...c, owner: this.owner, latest: c.lines.at(-1) ?? "", earlier: c.lines.slice(-4, -1) };
  }
  _onRender(ctx, opts) {
    super._onRender?.(ctx, opts);
    const input = this.element.querySelector("input[name=line]");
    input?.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); HolocallApp.#say.call(this); } });
    input?.focus();
    const handle = this.element.querySelector(".ht-call-head");
    if (handle && !handle.dataset.drag) {
      handle.dataset.drag = "1";
      handle.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0 || ev.target.closest("button")) return;
        const s = { x: ev.clientX, y: ev.clientY, left: this.position.left, top: this.position.top };
        const move = (e) => this.setPosition({ left: s.left + e.clientX - s.x, top: s.top + e.clientY - s.y });
        const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
        window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
      });
    }
  }
  static #hangUp() { if (this.owner && this.call) Comms.endCall(this.call); else this.close(); }
  static #say() {
    const input = this.element.querySelector("input[name=line]");
    if (!this.owner || !this.call || !input?.value.trim()) return;
    Comms.sayLine(this.call, input.value); input.value = "";
  }
}
