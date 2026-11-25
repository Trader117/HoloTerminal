import { MODULE_ID, CHANGED_HOOK, list, find, onScene, requestGM, getCredits, remove, upsert } from "./store.mjs";
import { newPuzzle, submit, bonusFromRoll } from "./slicing.mjs";
import * as Circuit from "./hacks/circuit.mjs";
import * as Signal from "./hacks/signal.mjs";
import * as Firewall from "./hacks/firewall.mjs";

/* Slicing games a terminal can use. "random" picks one each attempt. */
export const HACKS = {
  cipher: { name: "Cipher Lock", rules: "Crack the hidden glyph code. LOCK means right glyph, right slot. DRIFT means right glyph, wrong slot.",
    boost: "extra attempts", make: (d, b) => newPuzzle(d, b) },
  circuit: { name: "Circuit Reroute", rules: "Click tiles to rotate them and route power from the source on the left to the core on the right before time runs out.",
    boost: "extra time", make: (d, b) => Circuit.newCircuit(d, b), timed: true },
  signal: { name: "Signal Tuning", rules: "Turn the frequency, amplitude and phase dials until your carrier (blue) sits exactly on the intercepted signal (red), then lock in. A wrong lock costs 5 seconds.",
    boost: "extra time", make: (d, b) => Signal.newSignal(d, b), timed: true },
  firewall: { name: "Firewall Run", rules: "Move your probe to the data core. Every move, the trace sentinels step along their lines. Get caught or run out of moves and you're locked out. Cells a sentinel will reach next glow.",
    boost: "extra moves", make: (d, b) => Firewall.newFirewall(d, b) }
};
import { openEditor, ConsoleApp, blank } from "./admin.mjs";
import { isLootable, lootSummary } from "./loot.mjs";
import * as Crypt from "./decrypt.mjs";
import * as Cam from "./cameras.mjs";
import * as Scan from "./scanner.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const T = (v) => `modules/${MODULE_ID}/templates/views/${v}.hbs`;
export const VIEWS = ["home", "network", "terminal", "slice", "bounties", "shops", "shop", "salvage", "scanner"];
export const PARTIAL_PATHS = VIEWS.map(T);
/** Shared partials, registered under a short name. */
export const NAMED_PARTIALS = { cryptEntry: T("crypt-entry"), camFeed: T("cam-feed"), camerasTab: T("cameras-tab") };
const KICKER = { home: "Command Deck", network: "Local Net", terminal: "Remote Node", slice: "Intrusion Suite",
  bounties: "Contracts", shops: "Markets", shop: "Vendor", salvage: "Field Recovery", scanner: "Sensor Suite" };
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
      decryptCheck: DatapadApp.#decryptCheck, decryptKey: DatapadApp.#decryptKey, decryptHack: DatapadApp.#decryptHack,
      camRecord: DatapadApp.#camRecord, camStop: DatapadApp.#camStop, recPlay: DatapadApp.#recPlay, recToggle: DatapadApp.#recToggle,
      recSpeed: DatapadApp.#recSpeed, recClose: DatapadApp.#recClose, recShare: DatapadApp.#recShare, recDelete: DatapadApp.#recDelete,
      rotateTile: DatapadApp.#rotateTile, lockIn: DatapadApp.#lockIn, fwMove: DatapadApp.#fwMove,
      claim: DatapadApp.#claim, complete: DatapadApp.#complete, edit: DatapadApp.#edit,
      del: DatapadApp.#del, post: DatapadApp.#post, buy: DatapadApp.#buy,
      lootItem: DatapadApp.#lootItem, lootCredits: DatapadApp.#lootCredits,
      scanPulse: DatapadApp.#scanPulse, scanMark: DatapadApp.#scanMark
    }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/datapad.hbs`, scrollable: [".ht-body"] } };

  history = [{ view: "home", id: null }]; hIndex = 0;
  view = "home"; viewId = null; tab = "messages"; denied = false; booting = true; puzzle = null; bonus = 0; game = null; #timer = null;
  /** Set when a slicing game is decrypting one entry instead of unlocking the whole terminal. */
  hackTarget = null; justDecrypted = null;
  /** Recording being watched: { id, t, playing, speed }. */
  tape = null; #tapeTimer = null;
  /** Last Pulse Scanner result for this client. */
  scan = null;

  constructor(options) {
    super(options);
    Hooks.on(CHANGED_HOOK, () => this.rendered && this.render());
    for (const h of ["updateWall", "updateAmbientLight", "canvasReady", "controlToken", "updateActor", "updateToken",
      "createItem", "deleteItem", "updateItem", "updateDrawing", "updateRegion", "updateTile", "createToken", "deleteToken"])
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
    if (view !== "slice") { this.puzzle = null; this.game = null; this.#stopTimer(); }
    if (view === "terminal" && this.hackTarget) this.tab = this.hackTarget.tab;
    if (view !== "slice") this.hackTarget = null;
    this.#stopTape(true);
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
    if (!this._hackBound) {
      this._hackBound = true;
      this.element.addEventListener("input", (ev) => {
        if (ev.target?.dataset && "scrub" in ev.target.dataset && this.tape) {
          this.tape.t = Number(ev.target.value);
          const rec = list("recordings").find((r) => r.id === this.tape.id);
          if (rec) this.#paintTape(rec);
          return;
        }
        const key = ev.target?.dataset?.dial;
        if (!key || this.game !== "signal" || !this.puzzle) return;
        Signal.setDial(this.puzzle, key, ev.target.value);
        this.element.querySelector(".ht-wave-player")?.setAttribute("d", Signal.wavePath(this.puzzle.dials));
        const out = this.element.querySelector(`[data-dial-out="${key}"]`); if (out) out.textContent = this.puzzle.dials[key];
        const sy = this.element.querySelector(".ht-sync"); if (sy) sy.textContent = `${Signal.sync(this.puzzle)}%`;
      });
      this.element.addEventListener("keydown", (ev) => {
        const dir = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[ev.key];
        if (!dir || this.game !== "firewall") return;
        ev.preventDefault();
        this.#firewallStep(dir);
      });
    }
    if (this.justDecrypted && this.view === "terminal") {
      const target = this.element.querySelector(`[data-crypt="${this.justDecrypted}"] .ht-text`);
      if (target) { target.closest("details")?.setAttribute("open", ""); Crypt.resolveAnimation(target); }
      this.justDecrypted = null;
    }
    if (this.game === "firewall" && this.puzzle?.state === "playing") this.element.querySelector(".ht-fw-grid")?.focus();
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

  _onClose(options) { super._onClose(options); this.booting = true; this.#stopTimer(); this.#stopTape(true); }

  #stopTimer() { if (this.#timer) clearInterval(this.#timer); this.#timer = null; }
  #startTimer() {
    this.#stopTimer();
    this.#timer = setInterval(() => {
      const p = this.puzzle;
      if (!p || p.state !== "playing") return this.#stopTimer();
      p.time = Math.max(0, p.time - 1);
      const el = this.element?.querySelector(".ht-timer");
      if (el) { el.textContent = `${p.time}s`; el.classList.toggle("low", p.time <= 10); }
      if (p.time <= 0) { p.state = "lost"; this.#finishHack(); }
    }, 1000);
  }
  /** Reports the result once a game ends and unlocks the terminal on a win. */
  async #finishHack() {
    this.#stopTimer();
    const success = this.puzzle?.state === "won";
    const target = this.hackTarget;
    if (target) {
      requestGM("decryptResult", { terminalId: this.viewId, label: target.label, success, how: HACKS[this.game]?.name, actorName: activeActor()?.name });
      if (success) { await Crypt.markDecrypted(target.key); this.justDecrypted = target.key; this.tab = target.tab; }
    } else {
      requestGM("sliceResult", { terminalId: this.viewId, success, actorName: activeActor()?.name, game: HACKS[this.game]?.name });
      if (success) await unlock(this.viewId);
    }
    this.bonus = 0;
    this.render();
  }

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
      { view: "salvage", icon: "fa-sack-dollar", label: "Salvage", tone: "green" },
      { view: "scanner", icon: "fa-satellite-dish", label: "Pulse Scanner", tone: "blue" }
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
    const cams = (t.controls ?? []).map((c, i) => ({ ...c, index: i })).filter((c) => c.type === "camera");
    const state = (c) => {
      const scene = game.scenes.get(c.scene) ?? canvas.scene;
      if (c.type === "door") {
        const w = scene?.walls.get(c.id);
        if (!w) return { state: "OFFLINE", tone: "off", icon: "fa-door-closed" };
        const { OPEN, LOCKED } = CONST.WALL_DOOR_STATES;
        if (w.ds === OPEN) return { state: "OPEN", tone: "good", icon: "fa-door-open" };
        if (w.ds === LOCKED) return { state: "LOCKED", tone: "gold", icon: "fa-lock" };
        return { state: "SEALED", tone: "red", icon: "fa-door-closed" };
      }
      if (c.type === "light") {
        const l = scene?.lights.get(c.id);
        if (!l) return { state: "OFFLINE", tone: "off", icon: "fa-lightbulb" };
        return l.hidden ? { state: "OFF", tone: "dim", icon: "fa-lightbulb" } : { state: "ON", tone: "blue", icon: "fa-lightbulb" };
      }
      return { state: "?", tone: "off", icon: "fa-question" };
    };
    return {
      title: t.name, terminal: t, theme: t.theme ?? "cyan", locked, denied: this.denied,
      hasPassword: !!t.password, slice: t.slice, tab: this.tab,
      messages: this.#cryptEntries(t, "messages", (m) => `${m.from} ${m.subject}`),
      files: this.#cryptEntries(t, "files", (f) => f.name),
      tabs: ["messages", "files", "controls", ...(cams.length ? ["cameras"] : [])]
        .map((id) => ({ id, active: id === this.tab, label: game.i18n.localize(`HT.${id}`) })),
      controls: (t.controls ?? []).map((c, i) => ({ ...c, index: i })).filter((c) => c.type !== "camera").map((c) => ({ ...c, ...state(c) })),
      cameras: cams.map((c) => ({ ...c, feed: Cam.feedData(c) })),
      recordings: Cam.recordingsFor(cams.map(Cam.cameraKey)).map((r) => ({ id: r.id, label: r.label, shared: r.shared, length: Cam.clock(r.duration ?? 0) })),
      tape: this.#tapeContext()
    };
  }

  /** Messages or files with their encryption state for this user. */
  #cryptEntries(t, kind, titleOf) {
    const actor = activeActor();
    return (t[kind] ?? []).map((e, index) => {
      const key = Crypt.entryKey(t.id, kind, index);
      const enc = e.encrypted ? (typeof e.encrypted === "object" ? e.encrypted : {}) : null;
      const open = !enc || Crypt.isDecrypted(key);
      return { ...e, index, key, kind, encrypted: !!enc, open, resolving: this.justDecrypted === key,
        scrambled: open ? null : Crypt.scramble(Crypt.plainText(e.body), index + 3),
        dc: enc?.dc ?? 15, keyName: enc?.key, hasKey: Crypt.hasKey(actor, enc?.key),
        checkUsed: enc && Crypt.checkFailed(key), canHack: enc?.game !== "none", titleText: titleOf(e) };
    });
  }

  _ctx_slice() {
    const t = find("terminals", this.viewId);
    const cfg = this.hackTarget?.cfg ?? t?.slice ?? {};
    const p = this.puzzle;
    const chosen = cfg.game && cfg.game !== "random" ? cfg.game : null;
    const game = this.game ?? chosen;
    const info = HACKS[game];
    const ctx = {
      title: this.hackTarget ? `Decrypt: ${this.hackTarget.label}` : t?.name ?? "?", theme: "green", decrypting: !!this.hackTarget, difficulty: cfg.difficulty ?? "normal", dc: cfg.dc ?? 15,
      game, gameName: info?.name ?? "Unknown system", rules: info?.rules ?? "The security system is shifting. You won't know which countermeasure you face until you're in.",
      boostText: info?.boost ?? "an edge", timed: !!info?.timed, bonus: this.bonus, puzzle: p, ready: !p,
      playing: p?.state === "playing", won: p?.state === "won", lost: p?.state === "lost", time: p?.time, timeLow: p?.time <= 10,
    };
    if (!p) return ctx;
    if (game === "cipher") Object.assign(ctx, {
      slots: Array.from({ length: p.length }, (_, i) => p.current[i] ?? "_"), remaining: p.attempts - p.guesses.length });
    if (game === "circuit") {
      const lit = Circuit.powered(p);
      Object.assign(ctx, { size: p.size, sourceRow: Math.floor(p.source / p.size) + 1, sinkRow: Math.floor(p.sink / p.size) + 1,
        tiles: p.tiles.map((m, i) => ({ i, svg: Circuit.tileSvg(m, lit.has(i) || p.state === "won") })) });
    }
    if (game === "signal") Object.assign(ctx, {
      targetPath: Signal.wavePath(p.target, p.noise, p.seed), playerPath: Signal.wavePath(p.dials), sync: Signal.sync(p),
      dials: Object.entries(Signal.RANGES).map(([key, [min, max]]) => ({ key, min, max, value: p.dials[key],
        label: { freq: "Frequency", amp: "Amplitude", phase: "Phase" }[key] })) });
    if (game === "firewall") Object.assign(ctx, { size: p.size, cells: Firewall.cells(p), movesLeft: p.movesLeft });
    return ctx;
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

  _ctx_scanner(ctx, actor) {
    const SWEEP = 2.4;
    const scan = this.scan?.sceneId === canvas.scene?.id ? this.scan : null;
    return { title: "Pulse Scanner", noOrigin: !this.#scanOrigin(actor), sweep: SWEEP,
      modes: Object.entries(Scan.MODES).map(([key, m]) => ({ key, ...m, active: scan?.mode === key })),
      scan: scan && { ...scan, modeLabel: Scan.MODES[scan.mode].label, blips: Scan.blips(scan, SWEEP),
        hits: scan.hits.map((h, i) => ({ ...h, n: i + 1 })), rangeLabel: scan.range > 0 ? `${scan.range} sq` : "full scene" } };
  }

  /** Where a pulse starts: the selected token, else the active character's token on this scene. */
  #scanOrigin(actor) {
    const scene = canvas.scene;
    if (!scene) return null;
    const g = scene.grid?.size ?? 100;
    const tok = canvas.tokens?.controlled[0]?.document ?? scene.tokens.find((t) => t.actorId === actor?.id);
    if (tok) return { x: tok.x + (tok.width ?? 1) * g / 2, y: tok.y + (tok.height ?? 1) * g / 2, name: tok.name };
    return null;
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
    const cfg = this.hackTarget?.cfg ?? find("terminals", this.viewId)?.slice ?? {};
    const total = await rollSkill(activeActor(), game.settings.get(MODULE_ID, "sliceSkill"));
    if (total === null) return;
    this.bonus = bonusFromRoll(total, cfg.dc ?? 15);
    DatapadApp.#sliceBegin.call(this);
  }
  static #sliceBegin() {
    const cfg = this.hackTarget?.cfg ?? find("terminals", this.viewId)?.slice ?? {};
    let game = cfg.game && HACKS[cfg.game] ? cfg.game : "cipher";
    if (cfg.game === "random") { const keys = Object.keys(HACKS); game = keys[Math.floor(Math.random() * keys.length)]; }
    this.game = game;
    this.puzzle = HACKS[game].make(cfg.difficulty ?? "normal", this.bonus);
    if (HACKS[game].timed) this.#startTimer();
    this.render();
  }
  /* ---------- pulse scanner ---------- */
  static async #scanPulse(e, el) {
    const mode = el.dataset.mode, actor = activeActor(), origin = this.#scanOrigin(actor);
    if (!origin || !Scan.MODES[mode]) return ui.notifications.warn("Select your token on this scene to send a pulse.");
    const skill = game.settings.get(MODULE_ID, mode === "force" ? "scanForceSkill" : "scanTechSkill");
    const total = await rollSkill(actor, skill);
    if (total === null) return;
    const result = Scan.pulse(canvas.scene, origin, mode, total);
    this.scan = { ...result, sceneId: canvas.scene.id, origin: origin.name, at: Date.now() };
    const found = result.hits.filter((h) => h.resolved).map((h) => h.name);
    ChatMessage.create({ whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<b>${Scan.MODES[mode].label}</b> (${total}) from ${origin.name}: ${found.length ? found.join(", ") : "nothing resolved"}` +
        `${result.hits.length > found.length ? `, ${result.hits.length - found.length} faint` : ""}.` });
    this.render();
  }
  static #scanMark(e, el) {
    const h = this.scan?.hits?.[Number(el.dataset.index)];
    if (h) Scan.markOnMap(h.x, h.y);
  }

  /* ---------- cameras ---------- */
  #camAt(el) { return find("terminals", this.viewId)?.controls?.[Number(el.dataset.index)]; }
  static #camRecord(e, el) { const c = this.#camAt(el); if (c) { Cam.Recorder.start(c); this.render(); } }
  static async #camStop(e, el) { const c = this.#camAt(el); if (c) { await Cam.Recorder.stop(c); this.render(); } }
  static #recPlay(e, el) { this.tape = { id: el.dataset.id, t: 0, playing: true, speed: 1 }; this.#runTape(); this.render(); }
  static #recToggle() {
    if (!this.tape) return;
    const rec = list("recordings").find((r) => r.id === this.tape.id);
    if (!this.tape.playing && rec && this.tape.t >= (rec.duration ?? 0)) this.tape.t = 0; // replay from the start
    this.tape.playing = !this.tape.playing;
    if (this.tape.playing) this.#runTape(); else this.#stopTape();
    this.render();
  }
  static #recSpeed() { if (this.tape) { const order = [1, 2, 4, 8]; this.tape.speed = order[(order.indexOf(this.tape.speed) + 1) % order.length]; this.render(); } }
  static #recClose() { this.#stopTape(true); this.render(); }
  static async #recShare(e, el) {
    const all = list("recordings"); const r = all.find((x) => x.id === el.dataset.id);
    if (r) { r.shared = !r.shared; await game.settings.set(MODULE_ID, "recordings", all); }
  }
  static async #recDelete(e, el) {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete recording?" }, content: "<p>Delete this recording?</p>" });
    if (ok) await game.settings.set(MODULE_ID, "recordings", list("recordings").filter((x) => x.id !== el.dataset.id));
  }
  #tapeContext() {
    if (!this.tape) return null;
    const rec = list("recordings").find((r) => r.id === this.tape.id);
    if (!rec) return null;
    return { ...this.tape, duration: rec.duration ?? 0, clock: Cam.clock(this.tape.t), total: Cam.clock(rec.duration ?? 0),
      feed: Cam.recordingFeed(rec, this.tape.t) };
  }
  #stopTape(clear = false) { if (this.#tapeTimer) clearInterval(this.#tapeTimer); this.#tapeTimer = null; if (clear) this.tape = null; }
  #runTape() {
    this.#stopTape();
    this.#tapeTimer = setInterval(() => {
      const rec = this.tape && list("recordings").find((r) => r.id === this.tape.id);
      if (!rec) return this.#stopTape(true);
      this.tape.t = Math.min(rec.duration ?? 0, this.tape.t + 100 * this.tape.speed);
      this.#paintTape(rec);
      if (this.tape.t >= (rec.duration ?? 0)) { this.tape.playing = false; this.#stopTape(); this.render(); }
    }, 100);
  }
  /** Updates the playing feed in place, without a full re-render. */
  #paintTape(rec) {
    const root = this.element?.querySelector(".ht-tape");
    if (!root) return;
    Cam.applyFrame(root.querySelector(".ht-feed-tokens"), Cam.frameAt(rec, this.tape.t)?.tokens ?? []);
    const scrub = root.querySelector("[data-scrub]"); if (scrub) scrub.value = this.tape.t;
    const time = root.querySelector(".ht-tape-time"); if (time) time.textContent = `${Cam.clock(this.tape.t)} / ${Cam.clock(rec.duration ?? 0)}`;
  }

  #cryptTarget(el) {
    const t = find("terminals", this.viewId);
    const kind = el.dataset.kind, index = Number(el.dataset.index);
    const entry = t?.[kind]?.[index];
    if (!entry?.encrypted) return null;
    const enc = typeof entry.encrypted === "object" ? entry.encrypted : {};
    return { t, entry, enc, kind, index, key: Crypt.entryKey(t.id, kind, index), label: kind === "files" ? entry.name : entry.subject ?? "message" };
  }
  static async #decryptCheck(e, el) {
    const c = this.#cryptTarget(el);
    if (!c || Crypt.checkFailed(c.key)) return;
    const total = await rollSkill(activeActor(), game.settings.get(MODULE_ID, "sliceSkill"));
    if (total === null) return;
    const success = total >= (c.enc.dc ?? 15);
    requestGM("decryptResult", { terminalId: c.t.id, label: c.label, success, how: `check ${total} vs DC ${c.enc.dc ?? 15}`, actorName: activeActor()?.name });
    if (success) { await Crypt.markDecrypted(c.key); this.justDecrypted = c.key; }
    else { await Crypt.markCheckFailed(c.key); ui.notifications.warn("Decryption failed. You'll need the key or a slice to crack this one."); }
    this.render();
  }
  static async #decryptKey(e, el) {
    const c = this.#cryptTarget(el);
    if (!c || !Crypt.hasKey(activeActor(), c.enc.key)) return;
    requestGM("decryptResult", { terminalId: c.t.id, label: c.label, success: true, how: c.enc.key, actorName: activeActor()?.name });
    await Crypt.markDecrypted(c.key);
    this.justDecrypted = c.key;
    this.render();
  }
  static #decryptHack(e, el) {
    const c = this.#cryptTarget(el);
    if (!c) return;
    const base = c.t.slice ?? {};
    this.hackTarget = { key: c.key, label: c.label, tab: c.kind,
      cfg: { game: c.enc.game ?? base.game ?? "random", difficulty: c.enc.difficulty ?? base.difficulty ?? "normal", dc: c.enc.dc ?? base.dc ?? 15 } };
    this.#navigate("slice", this.viewId);
    this.render();
  }

  static #rotateTile(e, el) {
    if (this.game !== "circuit") return;
    Circuit.rotateTile(this.puzzle, Number(el.dataset.i));
    if (this.puzzle.state !== "playing") return this.#finishHack();
    this.render();
  }
  static #lockIn() {
    if (this.game !== "signal") return;
    Signal.lockIn(this.puzzle);
    if (this.puzzle.state !== "playing") return this.#finishHack();
    this.render();
  }
  static #fwMove(e, el) { this.#firewallStep(el.dataset.dir); }
  #firewallStep(dir) {
    if (this.game !== "firewall" || this.puzzle?.state !== "playing") return;
    Firewall.move(this.puzzle, dir);
    if (this.puzzle.state !== "playing") return this.#finishHack();
    this.render();
  }
  static #glyph(e, el) {
    const p = this.puzzle;
    if (p?.state === "playing" && p.current.length < p.length) { p.current.push(el.dataset.glyph); this.render(); }
  }
  static #glyphBack() { this.puzzle?.current.pop(); this.render(); }
  static async #transmit() {
    const p = submit(this.puzzle);
    if (p.state !== "playing") return this.#finishHack();
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
