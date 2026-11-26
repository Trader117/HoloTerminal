import { placeFrameless } from "./frameless.mjs";
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
import { entryHtml } from "./richtext.mjs";
import * as Cam from "./cameras.mjs";
import * as Scan from "./scanner.mjs";
import { runScan, lastPulse, PULSE_HOOK } from "./scan-wheel.mjs";
import { pingPoint } from "./scan-fx.mjs";
import { GalaxyMapApp } from "./galaxy-app.mjs";
import { rollSkill } from "./roll.mjs";
import * as Dock from "./holodock.mjs";
import * as StarshipImport from "./starship-import.mjs";
import * as Comms from "./comms.mjs";
import * as Trade from "./trade.mjs";
import * as Bank from "./bank.mjs";
import * as Bridge from "./bridge.mjs";
import * as Yard from "./shipyard.mjs";
import * as News from "./news.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const T = (v) => `modules/${MODULE_ID}/templates/views/${v}.hbs`;
export const VIEWS = ["home", "network", "terminal", "slice", "bounties", "shops", "shop", "salvage", "scanner", "holodock", "comms", "trade", "missions", "contacts", "bank", "bridge", "shipyard", "news"];
export const PARTIAL_PATHS = VIEWS.map(T);
/** Shared partials, registered under a short name. */
export const NAMED_PARTIALS = { cryptEntry: T("crypt-entry"), camFeed: T("cam-feed"), camerasTab: T("cameras-tab") };
const KICKER = { home: "Command Deck", network: "Local Net", terminal: "Remote Node", slice: "Intrusion Suite",
  bounties: "Contracts", shops: "Markets", shop: "Vendor", salvage: "Field Recovery", scanner: "Sensor Suite", holodock: "Starship", comms: "HoloNet Comms", trade: "Trade Exchange", missions: "Mission Log", contacts: "Contacts", bank: "Credit Account", bridge: "Starship", shipyard: "Starship", news: "HoloNet News" };
const PARENT = { terminal: "network", slice: "terminal", shop: "shops" };

function activeActor() {
  if (Crypt.test.on && Crypt.test.actor) return Crypt.test.actor;
  return canvas.tokens?.controlled[0]?.actor ?? game.user.character
    ?? game.actors.find((a) => a.type === "character" && a.isOwner && !game.user.isGM) ?? null;
}
const unlockedIds = () => Crypt.unlockedIds();
const unlock = (id) => Crypt.unlock(id);
/** True for a GM who isn't testing as a player: they skip every lock. */
const gmBypass = () => game.user.isGM && !Crypt.test.on;

export class DatapadApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static #instance;
  static get instance() { return (this.#instance ??= new DatapadApp()); }

  static DEFAULT_OPTIONS = {
    id: "ht-datapad", classes: ["ht-app"],
    window: { title: "Datapad", frame: false, positioned: true },
    position: { width: 430, height: 660 },
    actions: {
      home: DatapadApp.#home, close: DatapadApp.#closePad, console: DatapadApp.#console, forward: DatapadApp.#forward,
      go: DatapadApp.#go, back: DatapadApp.#back, switchTab: DatapadApp.#tab, pingBody: DatapadApp.#pingBody,
      login: DatapadApp.#login, testStart: DatapadApp.#testStart, testStop: DatapadApp.#testStop, control: DatapadApp.#control,
      sliceBoost: DatapadApp.#sliceBoost, sliceBegin: DatapadApp.#sliceBegin, glyph: DatapadApp.#glyph,
      glyphBack: DatapadApp.#glyphBack, transmit: DatapadApp.#transmit,
      decryptCheck: DatapadApp.#decryptCheck, decryptKey: DatapadApp.#decryptKey, decryptHack: DatapadApp.#decryptHack,
      camRecord: DatapadApp.#camRecord, camStop: DatapadApp.#camStop, recPlay: DatapadApp.#recPlay, recToggle: DatapadApp.#recToggle,
      recSpeed: DatapadApp.#recSpeed, recClose: DatapadApp.#recClose, recShare: DatapadApp.#recShare, recDelete: DatapadApp.#recDelete,
      rotateTile: DatapadApp.#rotateTile, lockIn: DatapadApp.#lockIn, fwMove: DatapadApp.#fwMove,
      claim: DatapadApp.#claim, complete: DatapadApp.#complete, edit: DatapadApp.#edit,
      del: DatapadApp.#del, post: DatapadApp.#post, buy: DatapadApp.#buy,
      lootItem: DatapadApp.#lootItem, lootCredits: DatapadApp.#lootCredits,
      galaxy: () => GalaxyMapApp.instance.render(true),
      scanPulse: DatapadApp.#scanPulse, scanMark: DatapadApp.#scanMark, scanRecharge: DatapadApp.#scanRecharge,
      dockRefuel: DatapadApp.#dockRefuel, dockCargoAdd: DatapadApp.#dockCargoAdd, dockCargoRemove: DatapadApp.#dockCargoRemove,
      dockParty: DatapadApp.#dockParty, dockSheet: DatapadApp.#dockSheet, dockSkill: DatapadApp.#dockSkill,
      commsSend: DatapadApp.#commsSend, commsOpen: DatapadApp.#commsOpen,
      newsPost: DatapadApp.#newsPost, newsApprove: DatapadApp.#newsApprove, newsDelete: DatapadApp.#newsDelete,
      yardRepair: DatapadApp.#yardRepair, yardBuy: DatapadApp.#yardBuy, yardTab: DatapadApp.#yardTab,
      bridgeView: DatapadApp.#bridgeView, bridgeClaim: DatapadApp.#bridgeClaim, bridgeUse: DatapadApp.#bridgeUse, bridgeRoute: DatapadApp.#bridgeRoute,
      bridgeClear: DatapadApp.#bridgeClear,
      bankSend: DatapadApp.#bankSend, bankGrant: DatapadApp.#bankGrant,
      missionObj: DatapadApp.#missionObj, missionStatus: DatapadApp.#missionStatus, contactStanding: DatapadApp.#contactStanding,
      tradeBuy: DatapadApp.#tradeBuy, tradeSell: DatapadApp.#tradeSell, tradeShift: DatapadApp.#tradeShift
    }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/datapad.hbs`, scrollable: [".ht-body"] } };

  history = [{ view: "home", id: null }]; hIndex = 0;
  view = "home"; viewId = null; tab = "messages"; denied = false; booting = true; puzzle = null; bonus = 0; game = null; #timer = null;
  /** Set when a slicing game is decrypting one entry instead of unlocking the whole terminal. */
  hackTarget = null; justDecrypted = null;
  /** Recording being watched: { id, t, playing, speed }. */
  tape = null; #tapeTimer = null;

  constructor(options) {
    super(options);
    Hooks.on(CHANGED_HOOK, () => this.rendered && this.render());
    Hooks.on(News.NEWS_HOOK, () => this.rendered && ["news", "home"].includes(this.view) && this.render());
    Hooks.on(Bank.BANK_HOOK, () => this.rendered && this.view === "bank" && this.render());
    Hooks.on(Comms.COMMS_HOOK, () => this.rendered && ["comms", "home"].includes(this.view) && this.render());
    Hooks.on(Dock.DOCK_HOOK, () => this.rendered && ["holodock", "trade", "bridge", "shipyard"].includes(this.view) && this.render());
    Hooks.on(PULSE_HOOK, () => this.rendered && this.view === "scanner" && this.render());
    for (const h of ["updateWall", "updateAmbientLight", "canvasReady", "controlToken", "updateActor", "updateToken",
      "createItem", "deleteItem", "updateItem", "updateDrawing", "updateRegion", "updateTile", "createToken", "deleteToken"])
      Hooks.on(h, () => this.rendered && this.render());
  }

  /** Opens the datapad on a given view (e.g. "terminal", id). */
  show(view = "home", id = null, { testActor } = {}) {
    if (testActor && game.user.isGM) { Crypt.startTest(testActor); this.denied = false; }
    else if (Crypt.test.on) Crypt.endTest();
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
    // open where this player last left it (clamped to the screen by setPosition), else centred over the canvas
    const scale = game.settings.get(MODULE_ID, "tabletScale") ?? 1;
    const saved = game.settings.get(MODULE_ID, "datapadPosition");
    const { width, height } = this.options.position;
    const sidebar = document.getElementById("sidebar")?.offsetWidth ?? 0;
    const left = Number.isFinite(saved?.left) ? saved.left : Math.max(0, (window.innerWidth - sidebar - width * scale) / 2);
    const top = Number.isFinite(saved?.top) ? saved.top : Math.max(0, (window.innerHeight - height * scale) / 2);
    this.setPosition({ left, top, scale });
  }
  /** Frameless window: drag it by the status bar. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const yq = this.element.querySelector("input[name=yard-q]");
    if (yq) yq.addEventListener("input", foundry.utils.debounce((ev) => { this.yardQuery = ev.target.value; this.render().then(() => {
      const n = this.element.querySelector("input[name=yard-q]"); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }); }, 300));
    if (this.view === "comms" && this.viewId) {
      const body = this.element.querySelector(".ht-body"); if (body) body.scrollTop = body.scrollHeight;
      this.element.querySelector("[name=comms-text]")?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); this.element.querySelector("[data-action=commsSend]")?.click(); }
      });
    }
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
      this.element.addEventListener("change", (ev) => {
        if (ev.target?.matches?.("[data-dock-routing]")) requestGM("dockRouting", { shipId: this.viewId, routing: ev.target.value });
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
    const device = this.element.querySelector(".ht-device");
    if (!device || device.dataset.drag) return;
    device.dataset.drag = "1";
    // grab it anywhere on the bezel or the screen's title bar; buttons, inputs and the screen body stay clickable
    device.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const t = ev.target;
      const onFrame = t === device || t.closest(".ht-bezel-top, .ht-rail, .ht-header, .ht-controls");
      if (!onFrame || t.closest("button, a, input, select, textarea, [data-action]")) return;
      ev.preventDefault();
      const at = placeFrameless(this);
      const start = { x: ev.clientX, y: ev.clientY, left: at.left, top: at.top };
      const move = (e) => this.setPosition({ left: start.left + e.clientX - start.x, top: start.top + e.clientY - start.y });
      const up = () => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
        const p = placeFrameless(this);
        game.settings.set(MODULE_ID, "datapadPosition", { left: p.left, top: p.top });
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }

  /** Foundry v12 doesn't place frameless windows, so we do (see frameless.mjs). */
  setPosition(position) {
    try { super.setPosition(position); } catch { /* frameless: Foundry may not handle it */ }
    return placeFrameless(this, position);
  }

  _onClose(options) { super._onClose(options); Crypt.endTest(); this.booting = true; this.#stopTimer(); this.#stopTape(true); }

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
    Object.assign(ctx, await this[`_ctx_${this.view}`]?.(ctx, actor));
    ctx.shipTabs = this.#shipTabs();
    return ctx;
  }

  _ctx_home() {
    const apps = [
      { view: "comms", icon: "fa-tower-broadcast", label: "Comms", tone: "green", count: Comms.unreadCount(activeActor()?.id) },
      { view: "news", icon: "fa-newspaper", label: "HoloNet News", tone: "blue", count: News.unread() },
      { view: "missions", icon: "fa-list-check", label: "Missions", tone: "gold" },
      { view: "contacts", icon: "fa-address-book", label: "Contacts", tone: "blue" },
      { view: "bank", icon: "fa-wallet", label: "Credits", tone: "green" },
      { view: "network", icon: "fa-network-wired", label: "Local Net", tone: "blue" },
      { view: "bounties", icon: "fa-crosshairs", label: "Bounty Board", tone: "red" },
      { view: "shops", icon: "fa-store", label: "Markets", tone: "gold" },
      { view: "salvage", icon: "fa-sack-dollar", label: "Salvage", tone: "green" },
      { view: "scanner", icon: "fa-satellite-dish", label: "Pulse Scanner", tone: "blue" },
      { action: "galaxy", icon: "fa-earth-americas", label: "Galaxy Map", tone: "gold" },
      { view: "holodock", id: Dock.partyShip()?.id, icon: "fa-shuttle-space", label: "Starship", tone: "red" }
    ];
    if (game.user.isGM) apps.push({ action: "console", icon: "fa-terminal", label: "GM Console", tone: "blue" });
    const latest = News.published()[0];
    return { title: "Apps", apps, ticker: latest ? `${latest.source.toUpperCase()}: ${latest.headline}` : null };
  }

  _ctx_network() {
    const ids = unlockedIds();
    const terms = list("terminals").filter((t) => game.user.isGM || (!t.hidden && onScene(t)))
      .map((t) => ({ ...t, secured: !!(t.password || t.slice) && !ids.has(t.id) }));
    return { title: "Local Net", terminals: terms };
  }

  async _ctx_terminal() {
    const t = find("terminals", this.viewId);
    if (!t) return { title: "NO SIGNAL", missing: true };
    const locked = !gmBypass() && !!(t.password || t.slice) && !unlockedIds().has(t.id);
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
      testing: Crypt.test.on, testName: Crypt.test.actor?.name ?? "a player", canTest: game.user.isGM && !Crypt.test.on && !!(t.password || t.slice || [...(t.messages ?? []), ...(t.files ?? [])].some((e) => e.encrypted)),
      hasPassword: !!t.password, slice: t.slice, tab: this.tab,
      messages: await this.#cryptEntries(t, "messages", (m) => `${m.from} ${m.subject}`),
      files: await this.#cryptEntries(t, "files", (f) => f.name),
      tabs: ["messages", "files", "controls", ...(cams.length ? ["cameras"] : [])]
        .map((id) => ({ id, active: id === this.tab, label: game.i18n.localize(`HT.${id}`) })),
      controls: (t.controls ?? []).map((c, i) => ({ ...c, index: i })).filter((c) => c.type !== "camera").map((c) => ({ ...c, ...state(c) })),
      cameras: cams.map((c) => ({ ...c, feed: Cam.feedData(c) })),
      recordings: Cam.recordingsFor(cams.map(Cam.cameraKey)).map((r) => ({ id: r.id, label: r.label, shared: r.shared, length: Cam.clock(r.duration ?? 0) })),
      tape: this.#tapeContext()
    };
  }

  /** Messages or files with their encryption state for this user. */
  async #cryptEntries(t, kind, titleOf) {
    const actor = activeActor();
    return Promise.all((t[kind] ?? []).map(async (e, index) => {
      const key = Crypt.entryKey(t.id, kind, index);
      const enc = e.encrypted ? (typeof e.encrypted === "object" ? e.encrypted : {}) : null;
      const open = !enc || Crypt.isDecrypted(key);
      const html = await entryHtml(e);
      return { ...e, index, key, kind, encrypted: !!enc, open, resolving: this.justDecrypted === key, html,
        scrambled: open ? null : Crypt.scrambleHtml(html, index + 3),
        dc: enc?.dc ?? 15, keyName: enc?.key, hasKey: Crypt.hasKey(actor, enc?.key),
        checkUsed: enc && Crypt.checkFailed(key), canHack: enc?.game !== "none", titleText: titleOf(e) };
    }));
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

  /** Salvage: click a body's portrait to ping and pan to it on the map. */
  static #pingBody(e, el) {
    const t = canvas.scene?.tokens.get(el.dataset.token);
    if (!t) return;
    const c = t.object?.center ?? { x: t.x + (t.width * canvas.grid.size) / 2, y: t.y + (t.height * canvas.grid.size) / 2 };
    canvas.animatePan({ x: c.x, y: c.y, duration: 500 });
    canvas.ping(c, { style: "pulse", color: game.user.color });
  }

  _ctx_salvage(ctx, actor) {
    const bodies = (canvas.scene?.tokens ?? []).filter((t) => isLootable(t)).map((t) => lootSummary(t, actor))
      .filter((b) => b.items.length || b.credits > 0)
      .sort((a, b) => Number(b.near) - Number(a.near));
    return { title: "Salvage", bodies, noActor: !actor };
  }

  _ctx_comms(ctx, actor) {
    if (!actor) return { title: "Comms", noActor: true };
    const me = actor.id, all = Comms.threads(me);
    const fmt = (ts) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    if (this.viewId) {
      let t = all.find((x) => x.key === this.viewId);
      if (!t) { const a = game.actors.get(this.viewId); t = { key: this.viewId, title: a?.name ?? "Unknown", img: a?.img, icon: "fa-user", messages: [], canReply: !!a, unread: 0 }; }
      if (t.unread) Comms.markRead(me, t.key);
      const thread = { ...t, messages: t.messages.map((m) => ({ text: m.text, time: fmt(m.ts), mine: m.from?.id === me, broadcast: m.to === "all",
        who: m.from?.name ?? m.from?.alias ?? "Unknown sender" })) };
      return { title: thread.title, thread };
    }
    const seen = new Set([me]), contacts = [];
    const npcContacts = list("contacts").filter((c) => !c.hidden && c.actorId).map((c) => game.actors.get(c.actorId)).filter(Boolean);
    for (const a of [...Comms.playerCharacters(), ...npcContacts, ...all.map((t) => game.actors.get(t.key)).filter(Boolean)])
      if (!seen.has(a.id)) { seen.add(a.id); contacts.push({ id: a.id, name: a.name }); }
    return { title: "Comms", threads: all, contacts };
  }

  _ctx_news() {
    const read = Number(game.user.getFlag(MODULE_ID, "newsRead")) || 0;
    const fmt = (ts) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const items = News.published().slice(0, 60).map((s) => ({ ...s, time: fmt(s.ts), fresh: s.ts > read, tagClass: s.tag.toLowerCase() }));
    if (items.some((i) => i.fresh)) News.markRead();
    return { title: "HoloNet", items, isGM: game.user.isGM, queue: game.user.isGM ? News.pending() : [], tags: News.TAGS };
  }

  yardCat = "weapons"; yardQuery = "";
  async _ctx_shipyard() {
    const ship = Dock.partyShip();
    if (!ship) return { title: "Shipyard", noShip: "No party ship. The GM can set one from the Fleet tab." };
    const planet = await Trade.dockedPlanet();
    if (!planet) return { title: "Shipyard", noShip: `${ship.name} isn't docked at a known world. Move it on the galaxy map.` };
    const rep = Yard.repairs(ship), cat = await Yard.loadCatalog();
    const q = this.yardQuery.trim().toLowerCase();
    const all = (cat[this.yardCat] ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q));
    const rows = all.slice(0, 40).map((r) => ({ ...r, price: Yard.priceFor(r, ship, this.yardCat) }));
    return { title: "Shipyard", planet, shipName: ship.name, ship: rep.info, rep, rows, more: Math.max(0, all.length - 40), query: this.yardQuery,
      noPacks: !Object.values(cat).some((l) => l.length),
      cats: Object.entries(Yard.CATEGORIES).map(([id, c]) => ({ id, label: c.label, active: id === this.yardCat })), catLabel: Yard.CATEGORIES[this.yardCat].label.toLowerCase() };
  }

  bridgeStation = null;
  _ctx_bridge(ctx, actor) {
    const ship = Dock.partyShip();
    if (!ship) return { title: "Bridge", noShip: "No party ship. The GM can set one from the Fleet tab." };
    const seats = Bridge.stationsOf(ship), mine = actor ? Bridge.stationFor(ship, actor.id) : null;
    const current = this.bridgeStation ?? mine ?? "pilot";
    const stations = Bridge.STATIONS.map((s) => ({ ...s, crewName: game.actors.get(seats[s.id])?.name, mine: s.id === mine, active: s.id === current }));
    return { title: ship.name, ship: Dock.shipInfo(ship), stations, station: Bridge.stationView(ship, current), owner: ship.isOwner,
      canClaim: !!actor, mineHere: mine === current };
  }

  _ctx_bank(ctx, actor) {
    const fmt = (ts) => new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const pcs = Comms.playerCharacters();
    const out = { title: "Credits", isGM: game.user.isGM, noActor: !actor && !game.user.isGM };
    if (actor) {
      const seen = new Set([actor.id]), payees = [];
      const npcs = list("contacts").filter((c) => !c.hidden && c.actorId).map((c) => game.actors.get(c.actorId)).filter(Boolean);
      for (const a of [...pcs, ...npcs]) if (!seen.has(a.id)) { seen.add(a.id); payees.push({ id: a.id, name: a.name }); }
      Object.assign(out, { actor: { id: actor.id, name: actor.name }, balance: getCredits(actor), payees });
    }
    const rows = game.user.isGM ? Bank.ledger().reverse().map((e) => ({ ...e, signed: e.amount, incoming: true }))
      : actor ? Bank.historyFor(actor.id).map((e) => ({ ...e, incoming: e.signed > 0 })) : [];
    out.history = rows.slice(0, 100).map((e) => ({ ...e, time: fmt(e.ts) }));
    if (game.user.isGM) out.pcs = pcs.map((a) => ({ id: a.id, name: a.name, credits: getCredits(a) }));
    return out;
  }

  _ctx_missions() {
    const all = list("missions").filter((m) => game.user.isGM || !m.hidden)
      .map((m) => ({ ...m, status: m.status ?? "active", objectives: m.objectives ?? [], doneCount: (m.objectives ?? []).filter((o) => o.done).length }));
    const groups = [["active", "Active"], ["done", "Completed"], ["failed", "Failed"]]
      .map(([k, label]) => ({ label, items: all.filter((m) => m.status === k) })).filter((g) => g.items.length);
    return { title: "Missions", groups };
  }
  _ctx_contacts() {
    const LABEL = { "-3": "Hostile", "-2": "Unfriendly", "-1": "Wary", 0: "Neutral", 1: "Friendly", 2: "Trusted", 3: "Ally" };
    const contacts = list("contacts").filter((c) => game.user.isGM || !c.hidden).sort((a, b) => a.name.localeCompare(b.name)).map((c) => {
      const st = Math.max(-3, Math.min(3, Math.round(Number(c.standing) || 0)));
      const pips = [-3, -2, -1, 0, 1, 2, 3].map((v) => (v === 0 ? "mid" : (v < 0 ? st <= v : st >= v) ? (v < 0 ? "bad on" : "good on") : (v < 0 ? "bad" : "good")));
      return { ...c, standing: st, pips, standingLabel: LABEL[st], standingTone: st < 0 ? "bad" : st > 0 ? "good" : "mid", canMessage: !!c.actorId && !!game.actors.get(c.actorId) };
    });
    return { title: "Contacts", contacts };
  }

  async _ctx_trade() {
    const ship = Dock.partyShip();
    if (!ship) return { title: "Trade", noShip: "No party ship. The GM can set one in the HoloDock." };
    const planet = await Trade.dockedPlanet();
    if (!planet) return { title: "Trade", noShip: `${ship.name} isn't docked at a known world. Move it on the galaxy map.` };
    const info = Dock.shipInfo(ship), held = new Map(info.cargo.filter((c) => c.good).map((c) => [c.good, c]));
    const goods = Trade.market(planet).map((g) => {
      const h = held.get(g.id), margin = h?.paid ? g.sell - h.paid : null;
      return { ...g, held: h?.qty ?? 0, paidTxt: h?.paid ? `paid ${h.paid}` : "",
        tag: g.factor < 0.85 ? "cheap" : g.factor > 1.2 ? "wanted" : g.restricted ? "restricted" : "", tagTone: g.factor < 0.85 ? "good" : g.factor > 1.2 ? "gold" : "red",
        margin };
    });
    const used = info.cargoUsed, cap = info.cargoCap;
    return { title: planet.name, planet, goods, shipName: ship.name, used, cap, pct: cap ? Math.min(100, Math.round((used / cap) * 100)) : 0,
      canTrade: game.user.isGM || info.party || ship.isOwner };
  }

  /** One Starship app: status, bridge, shipyard and the fleet list share a tab bar. */
  #shipTabs() {
    if (!["holodock", "bridge", "shipyard"].includes(this.view)) return null;
    const party = Dock.partyShip()?.id ?? null;
    const onParty = this.view === "holodock" && this.viewId && this.viewId === party;
    const tabs = [
      party && { view: "holodock", id: party, icon: "fa-gauge-high", label: "Status", active: onParty },
      party && { view: "bridge", icon: "fa-users-gear", label: "Bridge", active: this.view === "bridge" },
      party && { view: "shipyard", icon: "fa-screwdriver-wrench", label: "Shipyard", active: this.view === "shipyard" },
      { view: "holodock", id: "", icon: "fa-list", label: "Fleet", active: this.view === "holodock" && !onParty }
    ].filter(Boolean);
    return tabs.length > 1 ? tabs : null;
  }

  _ctx_holodock() {
    if (!this.viewId) return { title: "HoloDock", ships: Dock.shipActors().map((a) => Dock.shipInfo(a)) };
    const a = game.actors.get(this.viewId);
    if (!a || !Dock.shipActors().includes(a)) return { title: "NO SIGNAL", ships: [] };
    const ship = Dock.shipInfo(a);
    const room = ship.fuel.max ? Math.max(0, ship.fuel.max - ship.fuel.value) : 0;
    return { title: ship.name, ship, locked: !ship.observer, canCommand: game.user.isGM || ship.party || ship.owner, fillCost: room * ship.fuel.price };
  }

  _ctx_scanner(ctx, actor) {
    const SWEEP = 2.4, units = canvas.scene?.grid?.units ?? "";
    const scanners = Scan.scannersOf(actor).map((s) => {
      const sig = Scan.SIGNALS[s.signal] ?? Scan.SIGNALS.tech;
      return { ...s, sig, empty: s.limited && s.charges <= 0, canRecharge: s.limited && s.charges < s.max,
        pct: s.limited ? Math.round((s.charges / s.max) * 100) : 100, styleLabel: Scan.STYLES[s.style]?.split(" (")[0] };
    });
    const p = lastPulse?.sceneId === canvas.scene?.id ? lastPulse : null;
    let scan = null;
    if (p) {
      const hits = p.found.map((f, i) => ({ ...f, n: i + 1, units }));
      const blips = hits.map((h) => {
        const len = Math.hypot(h.dx, h.dy), k = len > 1 ? 1 / len : 1;
        const angle = (Math.atan2(h.dx, -h.dy) * 180 / Math.PI + 360) % 360;
        return { n: h.n, resolved: h.resolved, color: h.color, left: (50 + h.dx * k * 46).toFixed(1), top: (50 + h.dy * k * 46).toFixed(1),
          delay: ((angle / 360) * SWEEP).toFixed(2) };
      });
      scan = { hits, blips, color: p.color, name: p.scannerName, signal: Scan.SIGNALS[p.signal]?.label, total: p.total,
        contacts: p.tokens.length, range: `${p.range} ${units}`, origin: p.origin?.name, charges: p.charges };
    }
    return { title: "Pulse Scanner", sweep: SWEEP, scanners, scan, actorName: actor?.name, noActor: !actor,
      noToken: !!actor && !Scan.originToken(actor), units };
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
  static #go(e, el) { this.#navigate(el.dataset.view, el.dataset.id || null); this.render(); }
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

  /** GM: see this terminal as a player would (locks, encryption), without saving any progress. */
  static #testStart() {
    const actor = canvas.tokens?.controlled[0]?.actor ?? game.actors.find((a) => a.type === "character" && a.hasPlayerOwner) ?? null;
    Crypt.startTest(actor); this.denied = false; this.render();
  }
  /** GM override: stop testing and skip the security again. */
  static #testStop() { Crypt.endTest(); this.denied = false; this.hackTarget = null; this.render(); }

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
  static async #scanPulse(e, el) { await runScan(activeActor(), el.dataset.id); this.render(); }
  static async #commsSend(e, el) {
    const box = this.element.querySelector("[name=comms-text]"), text = box?.value.trim();
    if (!text) return;
    box.value = "";
    await Comms.send({ fromId: activeActor()?.id, to: el.dataset.to, text });
  }
  static #commsOpen() { const to = this.element.querySelector("[name=comms-to]")?.value; if (to) { this.#navigate("comms", to); this.render(); } }

  static async #newsPost() {
    const q = (n) => this.element.querySelector(`[name="news-${n}"]`);
    if (!q("headline")?.value.trim()) return ui.notifications.warn("Write a headline first.");
    await News.post({ headline: q("headline").value, body: q("body")?.value, source: q("source")?.value.trim(), tag: q("tag")?.value });
  }
  static async #newsApprove(e, el) { await News.approve(el.dataset.id); }
  static async #newsDelete(e, el) { await News.remove(el.dataset.id); }

  static async #yardRepair(e, el) { await requestGM("yardRepair", { kind: el.dataset.kind, points: Number(el.dataset.points) || 0, payerId: activeActor()?.id }); }
  static async #yardBuy(e, el) {
    const row = el.closest("li"), name = row?.querySelector("span")?.firstChild?.textContent?.trim() ?? "this", price = row?.querySelector(".ht-yard-price")?.textContent ?? "";
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Buy upgrade" }, content: `<p>Buy ${Handlebars.escapeExpression(name)} for ${Handlebars.escapeExpression(price)} and install it on the party ship?</p>` });
    if (ok) await requestGM("yardBuy", { uuid: el.dataset.uuid, cat: this.yardCat, payerId: activeActor()?.id });
  }
  static #yardTab(e, el) { this.yardCat = el.dataset.cat; this.yardQuery = ""; this.render(); }

  static #bridgeView(e, el) { this.bridgeStation = el.dataset.station; this.render(); }
  static async #bridgeClaim(e, el) { await requestGM("bridgeClaim", { actorId: activeActor()?.id, station: el.dataset.station || null }); }
  static async #bridgeUse(e, el) { await Bridge.useItem(Dock.partyShip(), el.dataset.item, activeActor()?.name); }
  static async #bridgeRoute(e, el) { await requestGM("dockRouting", { shipId: Dock.partyShip()?.id, routing: el.dataset.routing }); }
  static async #bridgeClear() { await requestGM("bridgeClear"); }

  static async #bankSend() {
    const q = (n) => this.element.querySelector(`[name="bank-${n}"]`);
    const amount = Number(q("amount")?.value), to = q("to")?.value;
    if (!to || !(amount > 0)) return ui.notifications.warn("Pick who to pay and an amount.");
    const name = game.actors.get(to)?.name ?? "them";
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Confirm transfer" }, content: `<p>Send ${Math.floor(amount)} cr to ${Handlebars.escapeExpression(name)}?</p>` });
    if (ok) await requestGM("bankSend", { fromId: activeActor()?.id, toId: to, amount, memo: q("memo")?.value.trim() });
  }
  static async #bankGrant() {
    const q = (n) => this.element.querySelector(`[name="bank-grant-${n}"]`);
    await requestGM("bankGrant", { toId: q("to")?.value, amount: q("amount")?.value, memo: q("memo")?.value.trim() });
  }

  static async #missionObj(e, el) {
    if (!game.user.isGM) return;
    const m = find("missions", el.dataset.id); const o = m?.objectives?.[Number(el.dataset.index)]; if (!o) return;
    o.done = !o.done; await upsert("missions", m);
  }
  static async #missionStatus(e, el) {
    if (!game.user.isGM) return;
    const m = find("missions", el.dataset.id); if (!m) return;
    m.status = el.dataset.status; await upsert("missions", m);
    if (m.status === "done") News.auto("mission", { title: m.title, giver: m.giver });
  }
  static async #contactStanding(e, el) {
    if (!game.user.isGM) return;
    const c = find("contacts", el.dataset.id); if (!c) return;
    c.standing = Math.max(-3, Math.min(3, (Number(c.standing) || 0) + Number(el.dataset.delta))); await upsert("contacts", c);
  }
  static async #tradeBuy(e, el) { await requestGM("tradeBuy", { goodId: el.dataset.good, tons: el.dataset.tons, payerId: activeActor()?.id }); }
  static async #tradeSell(e, el) { await requestGM("tradeSell", { goodId: el.dataset.good, tons: el.dataset.tons, payerId: activeActor()?.id }); }
  static async #tradeShift() { if (game.user.isGM) await game.settings.set(MODULE_ID, "tradeSeed", (game.settings.get(MODULE_ID, "tradeSeed") || 1) + 1); }

  static async #dockRefuel(e, el) {
    const ship = Dock.shipInfo(game.actors.get(this.viewId));
    const units = el.dataset.units === "fill" ? Math.max(0, (ship.fuel.max ?? 0) - ship.fuel.value) : Number(el.dataset.units) || 1;
    await requestGM("dockRefuel", { shipId: this.viewId, payerId: activeActor()?.id, units });
  }
  static async #dockCargoAdd() {
    const q = (n) => this.element.querySelector(`[name="dock-cargo-${n}"]`)?.value;
    if (!q("name")?.trim()) return ui.notifications.warn("Name the cargo first.");
    await requestGM("dockCargo", { shipId: this.viewId, op: "add", item: { name: q("name").trim(), qty: q("qty"), tons: q("tons") } });
  }
  static async #dockCargoRemove(e, el) { await requestGM("dockCargo", { shipId: this.viewId, op: "remove", cargoId: el.dataset.id }); }
  static async #dockParty(e, el) { if (game.user.isGM) await Dock.setPartyShip(el.dataset.id); }
  static #dockSheet() { game.actors.get(this.viewId)?.sheet?.render(true); }
  /** Starship skill check: d20 + the ship's ability modifier + the proficiency bonus of the character rolling, if they hold a bridge station. */
  static async #dockSkill() {
    const ship = game.actors.get(this.viewId), key = this.element.querySelector("[name=dock-skill]")?.value;
    const sk = StarshipImport.SKILLS[key]; if (!ship || !sk) return;
    const who = activeActor(), crew = who && Bridge.stationFor(ship, who.id);
    const prof = crew ? Number(who.system?.attributes?.prof) || 0 : 0;
    const roll = await new Roll("1d20 + @mod + @prof", { mod: ship.system?.abilities?.[sk.ability]?.mod ?? 0, prof }).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: ship }),
      flavor: `${sk.label} (${CONFIG.DND5E?.abilities?.[sk.ability]?.label ?? sk.ability}) check${crew ? `, ${who.name} at the helm` : ""}` });
  }
  static async #scanRecharge(e, el) { if (await Scan.recharge(activeActor(), el.dataset.id)) this.render(); }
  static #scanMark(e, el) {
    const h = lastPulse?.found?.[Number(el.dataset.index)];
    if (h) pingPoint(h.x, h.y, h.color);
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
