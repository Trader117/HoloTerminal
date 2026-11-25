/* Holo-Terminal Combat HUD: an original, labeled action bar for dnd5e / SW5e. */
import { buildData } from "./data.mjs";
import { registerSaberSettings, saberState, toggleSaber } from "./saber.mjs";
import { useItem, useBasic, rollSkill, rollSave, rollCheck, rollTool, rollInitiative, endTurn } from "./actions.mjs";

// Work out our module id from where this file is served, so the HUD follows any rename.
const MODULE_ID = new URL(import.meta.url).pathname.split("/modules/")[1]?.split("/")[0] ?? "holo-terminal";
const TEMPLATE = `modules/${MODULE_ID}/templates/hud/hud.hbs`;
const renderTpl = (path, data) => (foundry.applications.handlebars?.renderTemplate ?? renderTemplate)(path, data);
const dragData = (event) => (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
const setting = (key) => game.settings.get(MODULE_ID, key);

class CombatHud {
  constructor() {
    this.el = null;
    this.actor = null;
    this.token = null;
    this.used = new Map();      // actorId -> Set of spent groups this turn
    this.drawer = false;
    this.help = false;
    this.render = foundry.utils.debounce(() => this._render(), 60);
  }

  /* ---------- which actor ---------- */
  pick() {
    const t = canvas?.tokens?.controlled?.find((c) => c.actor?.isOwner);
    if (t) return { actor: t.actor, token: t.document };
    const a = game.user.character;
    if (a && !game.user.isGM) return { actor: a, token: a.getActiveTokens()[0]?.document ?? null };
    return { actor: null, token: null };
  }

  visible() {
    const mode = setting("hudMode");
    if (mode === "off") return false;
    if (mode === "combat" && !game.combat?.started) return false;
    return !!this.actor;
  }

  usedFor(actor) {
    if (!this.used.has(actor.id)) this.used.set(actor.id, new Set());
    return this.used.get(actor.id);
  }

  macros(actor) {
    const all = game.user.getFlag(MODULE_ID, "hudMacros") ?? {};
    return (all[actor.id] ?? []).map((u) => fromUuidSync(u)).filter(Boolean);
  }

  async setMacros(actor, uuids) {
    await game.user.setFlag(MODULE_ID, "hudMacros", { [actor.id]: uuids });
  }

  /* ---------- drawing ---------- */
  async _render() {
    ({ actor: this.actor, token: this.token } = this.pick());
    if (!this.visible()) { this.el?.remove(); this.el = null; return; }
    const actor = this.actor;
    const data = buildData(actor, {
      used: this.usedFor(actor), macros: this.macros(actor), theme: "sw5e",
      showBasic: setting("hudBasicActions"), collapsed: setting("hudCollapsed"),
      drawer: this.drawer, help: this.help, saber: saberState(MODULE_ID, actor, this.token)
    });
    const html = await renderTpl(TEMPLATE, data);
    if (!this.el) {
      this.el = document.createElement("section");
      this.el.id = "htc-hud";
      document.body.append(this.el);
      this._listen();
    }
    const scroll = [...this.el.querySelectorAll(".htc-group-body, .htc-drawer-col")].map((e) => e.scrollTop);
    this.el.className = "htc-hud";
    this.el.style.setProperty("--htc-scale", setting("hudScale"));
    const pos = setting("hudPosition");
    this.el.style.left = `${pos.left}px`;
    this.el.style.bottom = `${pos.bottom}px`;
    this.el.innerHTML = html;
    this.el.querySelectorAll(".htc-group-body, .htc-drawer-col").forEach((e, i) => { e.scrollTop = scroll[i] ?? 0; });
  }

  /* ---------- input ---------- */
  _listen() {
    const el = this.el;
    el.addEventListener("click", (ev) => this._onClick(ev));
    el.addEventListener("contextmenu", (ev) => this._onRightClick(ev));
    el.addEventListener("dragover", (ev) => { if (ev.target.closest(".htc-macros")) ev.preventDefault(); });
    el.addEventListener("drop", (ev) => this._onDrop(ev));
    el.addEventListener("pointerdown", (ev) => { if (ev.target.closest(".htc-grip")) this._drag(ev); });
  }

  async _onClick(ev) {
    const btn = ev.target.closest("[data-action]");
    if (!btn || !this.actor) return;
    ev.preventDefault();
    const actor = this.actor;
    const { action, id } = btn.dataset;
    const spend = (g) => { if (g && g !== "other") { this.usedFor(actor).add(g); this.render(); } };
    switch (action) {
      case "item": {
        const item = actor.items.get(id);
        if (item) spend(await useItem(item, ev));
        break;
      }
      case "basic": spend(await useBasic(actor, this.token, id, ev)); break;
      case "macro": {
        const m = fromUuidSync(btn.dataset.uuid);
        m?.execute({ actor, token: this.token?.object ?? null });
        break;
      }
      case "toggle-used": {
        const set = this.usedFor(actor);
        set.has(id) ? set.delete(id) : set.add(id);
        this.render();
        break;
      }
      case "saber": toggleSaber(MODULE_ID, actor, this.token, ev); break;
      case "short-rest": actor.shortRest(); break;
      case "long-rest": actor.longRest(); break;
      case "death-save": actor.rollDeathSave({ event: ev }); break;
      case "initiative": rollInitiative(actor); break;
      case "end-turn": endTurn(); break;
      case "sheet": actor.sheet.render(true); break;
      case "drawer": this.drawer = !this.drawer; this.render(); break;
      case "help": this.help = !this.help; this.render(); break;
      case "collapse": await game.settings.set(MODULE_ID, "hudCollapsed", !setting("hudCollapsed")); break;
      case "save": rollSave(actor, id, ev); break;
      case "check": rollCheck(actor, id, ev); break;
      case "skill": rollSkill(actor, id, ev); break;
      case "tool": { const t = actor.items.get(id); if (t) rollTool(t, ev); break; }
    }
  }

  async _onRightClick(ev) {
    const btn = ev.target.closest("[data-action]");
    if (!btn || !this.actor) return;
    ev.preventDefault();
    const { action, id } = btn.dataset;
    if (action === "item" || action === "tool") this.actor.items.get(id)?.sheet.render(true);
    else if (action === "macro") {
      const keep = this.macros(this.actor).map((m) => m.uuid).filter((u) => u !== btn.dataset.uuid);
      await this.setMacros(this.actor, keep);
      this.render();
    }
  }

  async _onDrop(ev) {
    if (!ev.target.closest(".htc-macros") || !this.actor) return;
    ev.preventDefault();
    const data = dragData(ev);
    if (data?.type !== "Macro" || !data.uuid) return ui.notifications.info("Drop a macro from the hotbar or the Macro Directory here.");
    const list = this.macros(this.actor).map((m) => m.uuid);
    if (!list.includes(data.uuid)) list.push(data.uuid);
    await this.setMacros(this.actor, list);
    this.render();
  }

  _drag(ev) {
    ev.preventDefault();
    const start = { x: ev.clientX, y: ev.clientY, ...setting("hudPosition") };
    const move = (e) => {
      this.el.style.left = `${Math.max(0, start.left + e.clientX - start.x)}px`;
      this.el.style.bottom = `${Math.max(0, start.bottom - (e.clientY - start.y))}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      game.settings.set(MODULE_ID, "hudPosition", { left: parseInt(this.el.style.left), bottom: parseInt(this.el.style.bottom) });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** A new turn starts: refresh that combatant's action, bonus action and reaction. */
  onTurn(combat) {
    const actor = combat.combatant?.actor;
    if (actor) this.used.delete(actor.id);
    this.render();
  }
}

const hud = new CombatHud();

Hooks.once("init", () => {
  const rerender = () => hud.render();
  game.settings.register(MODULE_ID, "hudMode", {
    name: "Combat HUD: when to show", hint: "Show the action bar for your selected token or assigned character.",
    scope: "client", config: true, type: String, default: "always", onChange: rerender,
    choices: { always: "Always", combat: "Only during combat", off: "Never" }
  });
  game.settings.register(MODULE_ID, "hudScale", {
    name: "Combat HUD: size", scope: "client", config: true, type: Number, default: 0.85, onChange: rerender,
    range: { min: 0.6, max: 1.4, step: 0.05 }
  });
  game.settings.register(MODULE_ID, "hudBasicActions", {
    name: "Combat HUD: show common actions", hint: "Dash, Dodge, Hide, Help and the other actions anyone can take.",
    scope: "client", config: true, type: Boolean, default: true, onChange: rerender
  });
  registerSaberSettings(MODULE_ID);
  game.settings.register(MODULE_ID, "hudCollapsed", { scope: "client", config: false, type: Boolean, default: false, onChange: rerender });
  game.settings.register(MODULE_ID, "hudPosition", { scope: "client", config: false, type: Object, default: { left: 120, bottom: 80 } });
  game.keybindings.register(MODULE_ID, "hudToggle", {
    name: "Combat HUD: show / hide", editable: [{ key: "KeyH", modifiers: ["Alt"] }],
    onDown: () => { game.settings.set(MODULE_ID, "hudMode", setting("hudMode") === "off" ? "always" : "off"); return true; }
  });
  (foundry.applications.handlebars?.loadTemplates ?? loadTemplates)([TEMPLATE]);
});

Hooks.once("ready", () => {
  const rerender = () => hud.render();
  const mine = (doc) => { const a = doc?.actor ?? doc?.parent ?? doc; return !hud.actor || a?.id === hud.actor.id || a === hud.actor; };
  Hooks.on("controlToken", rerender);
  Hooks.on("canvasReady", rerender);
  Hooks.on("updateActor", (a) => mine(a) && rerender());
  Hooks.on("updateToken", (t) => mine(t) && rerender());
  for (const h of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "deleteActiveEffect"]) Hooks.on(h, (d) => mine(d) && rerender());
  Hooks.on("updateCombat", (combat, changes) => ("turn" in changes || "round" in changes) ? hud.onTurn(combat) : rerender());
  for (const h of ["createCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant"]) Hooks.on(h, rerender);
  game.modules.get(MODULE_ID).hud = { render: rerender, element: () => hud.el };
  hud.render();
});
