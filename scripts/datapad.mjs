import { MODULE_ID, CHANGED_HOOK, list, find, onScene, requestGM, getCredits, remove, upsert } from "./store.mjs";
import { newPuzzle, submit, bonusFromRoll } from "./slicing.mjs";
import { openEditor, ConsoleApp, blank } from "./admin.mjs";
import { isLootable, lootSummary } from "./loot.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const T = (v) => `modules/${MODULE_ID}/templates/views/${v}.hbs`;
export const VIEWS = ["home", "network", "terminal", "slice", "bounties", "shops", "shop", "salvage"];
export const PARTIAL_PATHS = VIEWS.map(T);
const KICKER = { home: "Command Deck", network: "Local Net", terminal: "Remote Node", slice: "Intrusion Suite",
  bounties: "Contracts", shops: "Markets", shop: "Vendor", salvage: "Field Recovery" };
const PARENT = { terminal: "network", slice: "terminal", shop: "shops" };

function activeActor() {
  return canvas.tokens?.controlled[0]?.actor ?? game.user.character
    ?? game.actors.find((a) => a.type === "character" && a.isOwner && !game.user.isGM) ?? null;
}
const unlockedIds = () => new Set(game.user.getFlag(MODULE_ID, "unlocked") ?? []);
async function unlock(id) { const s = unlockedIds(); s.add(id); await game.user.setFlag(MODULE_ID, "unlocked", [...s]); }

async function rollSkill(actor, skill) {
  if (actor?.rollSkill) {
    try {
      const modern = game.system.id === "dnd5e" && foundry.utils.isNewerVersion(game.system.version, "4.0.99");
      let roll = modern ? await actor.rollSkill({ skill }) : await actor.rollSkill(skill);
      if (Array.isArray(roll)) roll = roll[0];
      if (roll?.total !== undefined) return roll.total;
      return null; // dialog cancelled
    } catch (err) { console.warn(`${MODULE_ID} | skill roll failed, falling back to d20`, err); }
  }
  const roll = await new Roll("1d20").evaluate();
  await roll.toMessage({ flavor: "Slicing check", speaker: ChatMessage.getSpeaker({ actor }) });
  return roll.total;
}

export class DatapadApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance;
  static get instance() { return (this.#instance ??= new DatapadApp()); }

  static DEFAULT_OPTIONS = {
    id: "ht-datapad", classes: ["ht-app"],
    window: { title: "Datapad", frame: false, positioned: true },
    position: { width: 470, height: 720 },
    actions: {
      home: DatapadApp.#home, close: DatapadApp.#closePad, console: DatapadApp.#console, forward: DatapadApp.#forward,
      go: DatapadApp.#go, back: DatapadApp.#back, tab: DatapadApp.#tab,
      login: DatapadApp.#login, control: DatapadApp.#control,
      sliceBoost: DatapadApp.#sliceBoost, sliceBegin: DatapadApp.#sliceBegin, glyph: DatapadApp.#glyph,
      glyphBack: DatapadApp.#glyphBack, transmit: DatapadApp.#transmit,
      claim: DatapadApp.#claim, complete: DatapadApp.#complete, edit: DatapadApp.#edit,
      del: DatapadApp.#del, post: DatapadApp.#post, buy: DatapadApp.#buy,
      lootItem: DatapadApp.#lootItem, lootCredits: DatapadApp.#lootCredits
    }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/datapad.hbs`, scrollable: [".ht-body"] } };

  history = [{ view: "home", id: null }]; hIndex = 0;
  view = "home"; viewId = null; tab = "messages"; denied = false; booting = true; puzzle = null; bonus = 0;

  constructor(options) {
    super(options);
    Hooks.on(CHANGED_HOOK, () => this.rendered && this.render());
    for (const h of ["updateWall", "updateAmbientLight", "canvasReady", "controlToken", "updateActor", "updateToken",
      "createItem", "deleteItem", "updateItem"])
      Hooks.on(h, () => this.rendered && this.render());
  }

  /** Opens the datapad on a given view (e.g. "terminal", id). */
  show(view = "home", id = null) {
    if (view !== this.view || id !== this.viewId) this.#navigate(view, id);
    if (!this.rendered) this.booting = true;
    return this.render({ force: true });
  }

  #navigate(view, id = this.viewId, record = true) {
    if (record && (view !== this.view || id !== this.viewId)) {
      this.history = this.history.slice(0, this.hIndex + 1);
      this.history.push({ view, id });
      if (this.history.length > 30) this.history.shift();
      this.hIndex = this.history.length - 1;
    }
    this.view = view; this.viewId = id; this.denied = false;
    if (view === "terminal") this.tab = "messages";
    if (view !== "slice") this.puzzle = null;
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const sound = game.settings.get(MODULE_ID, "bootSound");
    if (sound) foundry.audio.AudioHelper.play({ src: sound, volume: 0.6 }, false);
    setTimeout(() => { this.booting = false; this.render(); }, 1200);
  }
  /** Frameless window: drag it by the status bar. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const handle = this.element.querySelector(".ht-bezel-top");
    if (!handle || handle.dataset.drag) return;
    handle.dataset.drag = "1";
    handle.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const start = { x: ev.clientX, y: ev.clientY, left: this.position.left, top: this.position.top };
      const move = (e) => this.setPosition({ left: start.left + e.clientX - start.x, top: start.top + e.clientY - start.y });
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  _onClose(options) { super._onClose(options); this.booting = true; }

  async _prepareContext() {
    const actor = activeActor();
    const ctx = {
      view: this.view, viewId: this.viewId, partial: T(this.view), kicker: KICKER[this.view],
      clock: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      canForward: this.hIndex < this.history.length - 1,
      booting: this.booting, isGM: game.user.isGM, theme: "cyan",
      actorName: actor?.name, credits: actor ? getCredits(actor) : null, canBack: this.view !== "home" || this.hIndex > 0,
      bootText: ["DATAPAD OS 4.2", "Linking to local net...", `Node: ${canvas.scene?.name ?? "deep space"}`, "READY"].join("\n")
    };
    return Object.assign(ctx, await this[`_ctx_${this.view}`]?.(ctx, actor));
  }

  _ctx_home() {
    const apps = [
      { view: "network", icon: "fa-network-wired", label: "Local Net", tone: "blue" },
      { view: "bounties", icon: "fa-crosshairs", label: "Bounty Board", tone: "red" },
      { view: "shops", icon: "fa-store", label: "Markets", tone: "gold" },
      { view: "salvage", icon: "fa-sack-dollar", label: "Salvage", tone: "green" }
    ];
    if (game.user.isGM) apps.push({ action: "console", icon: "fa-terminal", label: "GM Console", tone: "blue" });
    return { title: "Apps", apps };
  }

  _ctx_network() {
    const ids = unlockedIds();
    const terms = list("terminals").filter((t) => game.user.isGM || (!t.hidden && onScene(t)))
      .map((t) => ({ ...t, secured: !!(t.password || t.slice) && !ids.has(t.id) }));
    return { title: "Local Net", terminals: terms };
  }

  _ctx_terminal() {
    const t = find("terminals", this.viewId);
    if (!t) return { title: "NO SIGNAL", missing: true };
    const locked = !game.user.isGM && !!(t.password || t.slice) && !unlockedIds().has(t.id);
    const scene = canvas.scene;
    const state = (c) => {
      if (c.type === "door") { const w = scene?.walls.get(c.id); return w ? (w.ds === CONST.WALL_DOOR_STATES.OPEN ? "OPEN" : "SEALED") : "OFFLINE"; }
      if (c.type === "light") { const l = scene?.lights.get(c.id); return l ? (l.hidden ? "OFF" : "ON") : "OFFLINE"; }
      return "?";
    };
    return {
      title: t.name, terminal: t, theme: t.theme ?? "cyan", locked, denied: this.denied,
      hasPassword: !!t.password, slice: t.slice, tab: this.tab,
      tabs: ["messages", "files", "controls"].map((id) => ({ id, active: id === this.tab, label: game.i18n.localize(`HT.${id}`) })),
      controls: (t.controls ?? []).map((c, i) => ({ ...c, index: i, state: state(c) }))
    };
  }

  _ctx_slice() {
    const t = find("terminals", this.viewId);
    const p = this.puzzle;
    return {
      title: `Slicing: ${t?.name ?? "?"}`, theme: "green", difficulty: t?.slice?.difficulty ?? "normal",
      dc: t?.slice?.dc ?? 15, bonus: this.bonus, puzzle: p, ready: !p,
      slots: p ? Array.from({ length: p.length }, (_, i) => p.current[i] ?? "_") : [],
      remaining: p ? p.attempts - p.guesses.length : 0
    };
  }

  _ctx_bounties(ctx, actor) {
    const order = { open: 0, claimed: 1, completed: 2 };
    const bounties = list("bounties").filter((b) => game.user.isGM || (!b.hidden && b.status !== "completed"))
      .sort((a, b) => order[a.status ?? "open"] - order[b.status ?? "open"])
      .map((b) => ({ ...b, status: b.status ?? "open", claimed: (b.claimants ?? []).includes(actor?.name ?? game.user.name) }));
    return { title: "Bounty Board", bounties };
  }

  _ctx_shops() {
    const shops = list("shops").filter((s) => game.user.isGM || (!s.hidden && onScene(s)));
    return { title: "Markets", shops, sceneName: canvas.scene?.name };
  }

  _ctx_salvage(ctx, actor) {
    const bodies = (canvas.scene?.tokens ?? []).filter((t) => isLootable(t)).map((t) => lootSummary(t, actor))
      .filter((b) => b.items.length || b.credits > 0)
      .sort((a, b) => Number(b.near) - Number(a.near));
    return { title: "Salvage", bodies, noActor: !actor };
  }

  _ctx_shop(ctx) {
    const s = find("shops", this.viewId);
    if (!s) return { title: "Closed", missing: true };
    const items = (s.items ?? []).map((it, index) => {
      const price = Math.round((it.price ?? 0) * (s.markup ?? 1));
      const soldOut = it.stock === 0;
      return { ...it, index, price, soldOut, infinite: it.stock == null || it.stock < 0,
        affordable: !soldOut && ctx.credits !== null && ctx.credits >= price };
    });
    return { title: s.name, shop: s, items };
  }

  /* ---------- actions ---------- */
  static #home() { this.#navigate("home"); this.render(); }
  static #closePad() { this.close(); }
  static #console() { ConsoleApp.instance.render(true); }
  static #go(e, el) { this.#navigate(el.dataset.view, el.dataset.id ?? null); this.render(); }
  static #back() {
    if (this.hIndex > 0) { const h = this.history[--this.hIndex]; this.#navigate(h.view, h.id, false); }
    else this.#navigate(PARENT[this.view] ?? "home");
    this.render();
  }
  static #forward() {
    if (this.hIndex >= this.history.length - 1) return;
    const h = this.history[++this.hIndex]; this.#navigate(h.view, h.id, false); this.render();
  }
  static #tab(e, el) { this.tab = el.dataset.tab; this.render(); }

  static async #login() {
    const t = find("terminals", this.viewId);
    const value = this.element.querySelector("input[name=password]")?.value;
    if (t?.password && value === t.password) { this.denied = false; await unlock(t.id); }
    else this.denied = true;
    this.render();
  }

  static #control(e, el) {
    requestGM("control", { terminalId: this.viewId, index: Number(el.dataset.index), sceneId: canvas.scene?.id });
  }

  static async #sliceBoost() {
    const t = find("terminals", this.viewId);
    const total = await rollSkill(activeActor(), game.settings.get(MODULE_ID, "sliceSkill"));
    if (total === null) return;
    this.bonus = bonusFromRoll(total, t?.slice?.dc ?? 15);
    DatapadApp.#sliceBegin.call(this);
  }
  static #sliceBegin() {
    const t = find("terminals", this.viewId);
    this.puzzle = newPuzzle(t?.slice?.difficulty ?? "normal", this.bonus);
    this.render();
  }
  static #glyph(e, el) {
    const p = this.puzzle;
    if (p?.state === "playing" && p.current.length < p.length) { p.current.push(el.dataset.glyph); this.render(); }
  }
  static #glyphBack() { this.puzzle?.current.pop(); this.render(); }
  static async #transmit() {
    const p = submit(this.puzzle);
    if (p.state !== "playing") {
      const success = p.state === "won";
      requestGM("sliceResult", { terminalId: this.viewId, success, actorName: activeActor()?.name });
      if (success) await unlock(this.viewId);
      this.bonus = 0;
    }
    this.render();
  }

  static #claim(e, el) { requestGM("claimBounty", { bountyId: el.dataset.id, actorName: activeActor()?.name }); }
  static #complete(e, el) { requestGM("completeBounty", { bountyId: el.dataset.id, payout: el.dataset.payout === "true" }); }
  static #edit(e, el) { openEditor(el.dataset.kind, el.dataset.id); }
  static async #del(e, el) {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete?" }, content: "<p>Delete this entry?</p>" });
    if (ok) await remove(el.dataset.kind, el.dataset.id);
  }
  static async #post(e, el) {
    const doc = blank(el.dataset.kind);
    await upsert(el.dataset.kind, doc);
    openEditor(el.dataset.kind, doc.id);
  }
  static #lootItem(e, el) {
    const actor = activeActor();
    if (!actor) return ui.notifications.warn("Select or assign a character first.");
    requestGM("lootItem", { sceneId: canvas.scene.id, tokenId: el.dataset.token, itemId: el.dataset.item, actorUuid: actor.uuid });
  }
  static #lootCredits(e, el) {
    const actor = activeActor();
    if (!actor) return ui.notifications.warn("Select or assign a character first.");
    requestGM("lootCredits", { sceneId: canvas.scene.id, tokenId: el.dataset.token, actorUuid: actor.uuid });
  }
  static #buy(e, el) {
    const actor = activeActor();
    if (!actor) return ui.notifications.warn("Select or assign a character first.");
    requestGM("buy", { shopId: this.viewId, index: Number(el.dataset.index), actorUuid: actor.uuid });
  }
}
