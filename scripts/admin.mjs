import { MODULE_ID, CHANGED_HOOK, list, find, upsert, remove, itemPrice, requestGM } from "./store.mjs";
import { DatapadApp } from "./datapad.mjs";
import { ShopEditorApp, importMejShops } from "./shop-editor.mjs";
import * as Scan from "./scanner.mjs";
import { runScan } from "./scan-wheel.mjs";
import { playPulse } from "./scan-fx.mjs";
import * as Dock from "./holodock.mjs";
import * as Comms from "./comms.mjs";
import * as JumpEvents from "./jump-events.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const getDragData = (event) =>
  (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);

export function blank(kind) {
  const id = foundry.utils.randomID();
  switch (kind) {
    case "terminals": return {
      id, name: "Security Node", theme: "cyan", hidden: false, scenes: [], password: "",
      slice: { game: "random", difficulty: "normal", dc: 15 }, // game: cipher, circuit, signal, firewall or random
      messages: [
        { from: "Duty Officer", subject: "Shift change", body: "Patrol rotates at 0300. Dock 7 unmonitored for ten minutes." },
        { from: "Unknown", subject: "Priority burst", body: "The shipment is a decoy. The real cargo moves through bay 12 at dawn.",
          encrypted: { dc: 15, key: "Code Cylinder", game: "signal" } } // remove "encrypted" for plain text
      ],
      files: [{ name: "manifest.dat", body: "12 crates logged. 1 crate unlisted." }],
      controls: [] // { "label": "Blast door", "type": "door", "id": "<wall id>" } or type "light" with an ambient light id
    };
    case "shops": return {
      id, name: "Outpost Supply", description: "Spare parts, med supplies, no questions.", img: "", hidden: false,
      scenes: [], markup: 1, items: [] // { name, uuid, img, price, stock } — stock -1 means unlimited
    };
    case "bounties": return {
      id, title: "Wanted: Rogue Droid", target: "IG-pattern assassin droid", location: "Lower city",
      reward: 2500, description: "Recover the droid's memory core intact.", img: "", hidden: false,
      status: "open", claimants: []
    };
  }
}

/** Opens the right editor for an entry: the visual one for markets, JSON for the rest. */
export function openEditor(kind, id) {
  return kind === "shops" ? new ShopEditorApp(id).render(true) : new EditorApp(kind, id).render(true);
}

const KIND_LABEL = { terminals: "Terminals", shops: "Markets", bounties: "Bounties" };
const OPEN_VIEW = { terminals: "terminal", shops: "shop", bounties: "bounties" };

/* ---------- JSON editor (with item drag & drop for shops) ---------- */
export class EditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ht-app"], window: { title: "Holo-Terminal editor", resizable: true },
    position: { width: 600, height: 680 },
    actions: { save: EditorApp.#save, addScene: EditorApp.#addScene, linkSelected: EditorApp.#linkSelected }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/editor.hbs` } };

  constructor(kind, id, options) { super(options); this.kind = kind; this.docId = id; }
  get title() { return `Edit ${KIND_LABEL[this.kind]}: ${find(this.kind, this.docId)?.name ?? find(this.kind, this.docId)?.title ?? ""}`; }

  async _prepareContext() {
    return { kind: this.kind, isShop: this.kind === "shops", sceneName: canvas.scene?.name,
      json: JSON.stringify(find(this.kind, this.docId), null, 2) };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    if (this.kind !== "shops") return;
    const zone = this.element.querySelector(".ht-drop");
    zone?.addEventListener("dragover", (e) => e.preventDefault());
    zone?.addEventListener("drop", (e) => this.#onDrop(e));
  }

  #read() {
    try { return JSON.parse(this.element.querySelector("textarea").value); }
    catch (err) { ui.notifications.error(`Invalid JSON: ${err.message}`); return null; }
  }
  #write(doc) { this.element.querySelector("textarea").value = JSON.stringify(doc, null, 2); }

  async #onDrop(event) {
    event.preventDefault();
    const data = getDragData(event);
    if (data?.type !== "Item") return ui.notifications.warn("Drop an Item here.");
    const item = await fromUuid(data.uuid);
    const doc = this.#read();
    if (!item || !doc) return;
    doc.items ??= [];
    doc.items.push({ name: item.name, uuid: item.uuid, img: item.img, price: itemPrice(item), stock: -1 });
    this.#write(doc);
  }

  /** Adds the doors (Walls layer), lights (Lighting layer) and camera Regions the GM has selected on the map as terminal controls. */
  static #linkSelected() {
    const doc = this.#read();
    if (!doc || !canvas.scene) return;
    doc.controls ??= [];
    const have = new Set(doc.controls.map((c) => `${c.type}:${c.id}`));
    let doors = doc.controls.filter((c) => c.type === "door").length, lights = doc.controls.filter((c) => c.type === "light").length;
    let added = 0;
    for (const w of canvas.walls?.controlled ?? []) {
      if (!w.document.door || have.has(`door:${w.document.id}`)) continue;
      doc.controls.push({ label: `Door ${++doors}`, type: "door", id: w.document.id, scene: canvas.scene.id }); added++;
    }
    for (const l of canvas.lighting?.controlled ?? []) {
      if (have.has(`light:${l.document.id}`)) continue;
      doc.controls.push({ label: `Light ${++lights}`, type: "light", id: l.document.id, scene: canvas.scene.id }); added++;
    }
    let cams = doc.controls.filter((c) => c.type === "camera").length;
    for (const r of [...(canvas.regions?.controlled ?? []), ...(canvas.drawings?.controlled ?? [])]) {
      if (have.has(`camera:${r.document.id}`)) continue;
      const name = r.document.name && r.document.documentName === "Region" ? r.document.name : `Camera ${cams + 1}`;
      cams++;
      doc.controls.push({ label: name, type: "camera", id: r.document.id, scene: canvas.scene.id }); added++;
    }
    if (!added) return ui.notifications.warn("Select doors (Walls layer), lights (Lighting layer) or camera Regions (Regions layer) on the map first. Hold Shift to select several.");
    this.#write(doc);
    ui.notifications.info(`Linked ${added}. Rename them in "controls" (the "label" field), then Save.`);
  }

  static #addScene() {
    const doc = this.#read();
    if (!doc || !canvas.scene) return;
    doc.scenes ??= [];
    if (!doc.scenes.includes(canvas.scene.id)) doc.scenes.push(canvas.scene.id);
    this.#write(doc);
  }

  static async #save() {
    const doc = this.#read();
    if (!doc) return;
    doc.id = this.docId;
    await upsert(this.kind, doc);
    ui.notifications.info("Saved");
    this.close();
  }
}

/* ---------- GM console ---------- */
export class ConsoleApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ht-console", classes: ["ht-app"], window: { title: "Holo-Terminal GM Console", icon: "fas fa-terminal" },
    position: { width: 540, height: 560 },
    actions: {
      tab: ConsoleApp.#tab, create: ConsoleApp.#create, open: ConsoleApp.#open, show: ConsoleApp.#show,
      edit: ConsoleApp.#edit, remove: ConsoleApp.#remove, toggle: ConsoleApp.#toggle, importMej: ConsoleApp.#importMej,
      scGive: ConsoleApp.#scGive, scPreviewForm: ConsoleApp.#scPreviewForm, scPreview: ConsoleApp.#scPreview, scEdit: ConsoleApp.#scEdit,
      scRecharge: ConsoleApp.#scRecharge, scDelete: ConsoleApp.#scDelete, tgToggle: ConsoleApp.#tgToggle, tgPreview: ConsoleApp.#tgPreview,
      tgEdit: ConsoleApp.#tgEdit,
      shipAdd: ConsoleApp.#shipAdd, shipParty: ConsoleApp.#shipParty, shipOpen: ConsoleApp.#shipOpen, shipShow: ConsoleApp.#shipShow,
      shipEdit: ConsoleApp.#shipEdit, shipRemove: ConsoleApp.#shipRemove,
      evToggle: ConsoleApp.#evToggle, evEdit: ConsoleApp.#evEdit, evDelete: ConsoleApp.#evDelete, evRoll: ConsoleApp.#evRoll, evReset: ConsoleApp.#evReset,
      cmSend: ConsoleApp.#cmSend, cmCall: ConsoleApp.#cmCall, cmDelete: ConsoleApp.#cmDelete, cmClear: ConsoleApp.#cmClear
    }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/console.hbs`, scrollable: [".ht-body"] } };
  tab = "terminals";
  static #instance;
  static get instance() { return (this.#instance ??= new ConsoleApp()); }

  constructor(o) {
    super(o);
    Hooks.on(CHANGED_HOOK, () => this.rendered && this.render());
    for (const h of ["updateActor", "createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior", "updateRegion", "canvasReady"])
      Hooks.on(h, () => this.rendered && this.tab === "scanners" && this.render());
    Hooks.on(Comms.COMMS_HOOK, () => this.rendered && this.tab === "comms" && this.render());
    for (const h of ["updateActor", "createActor", "deleteActor", Dock.DOCK_HOOK, JumpEvents.EVENTS_HOOK])
      Hooks.on(h, () => this.rendered && this.tab === "ships" && this.render());
  }

  async _prepareContext() {
    const tabs = [...Object.entries(KIND_LABEL), ["scanners", "Scanners"], ["ships", "Ships"], ["comms", "Comms"]].map(([id, label]) => ({ id, label, active: id === this.tab }));
    if (this.tab === "scanners") return { tab: this.tab, tabs, isScanners: true, ...this.#scannerContext() };
    if (this.tab === "comms") return { tab: this.tab, tabs, isComms: true, ...this.#commsContext() };
    if (this.tab === "ships") return { tab: this.tab, tabs, isShips: true, ships: Dock.shipActors().map((a) => Dock.shipInfo(a)),
      jumpEvents: JumpEvents.events(), eventChance: game.settings.get(MODULE_ID, "jumpEventChance"),
      candidates: game.actors.filter((a) => !Dock.isShip(a)).sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ id: a.id, name: `${a.name} (${a.type})` })) };
    return {
      tab: this.tab, isShops: this.tab === "shops",
      tabs,
      entries: list(this.tab).map((x) => ({
        id: x.id, name: x.name ?? x.title, hidden: x.hidden,
        detail: this.tab === "bounties" ? `${x.status ?? "open"} · ${x.reward} cr`
          : x.scenes?.length ? x.scenes.map((s) => game.scenes.get(s)?.name ?? "?").join(", ") : "All scenes"
      }))
    };
  }

  static #tab(e, el) { this.tab = el.dataset.tab; this.render(); }

  /* ---------- scanners tab ---------- */
  #scannerContext() {
    const units = canvas.scene?.grid?.units ?? "";
    const actors = Scan.scannerActors();
    const sigOpts = Object.entries(Scan.SIGNALS).map(([value, s]) => ({ value, label: s.label }));
    const styleOpts = Object.entries(Scan.STYLES).map(([value, label]) => ({ value, label }));
    const owners = actors.filter((a) => Scan.scannersOf(a).length).map((a) => ({ id: a.id, name: a.name, img: a.img,
      scanners: Scan.scannersOf(a).map((s) => ({ ...s, sig: Scan.SIGNALS[s.signal], styleLabel: Scan.STYLES[s.style]?.split(" (")[0],
        canRecharge: s.limited && s.charges < s.max })) }));
    const used = new Set(owners.flatMap((o) => o.scanners.map((s) => s.signal)));
    const targets = Scan.targets(canvas.scene, { includeResolved: true }).map((t) => ({ uuid: t.uuid, name: t.name, regionName: t.region.name,
      signal: Scan.SIGNALS[t.signal]?.label, color: t.color, resolved: t.resolved, areas: (t.region.shapes ?? []).filter((x) => !x.hole).length,
      unmatched: !used.has(t.signal) }));
    return { units, actors: actors.map((a) => ({ id: a.id, name: a.name })), sigOpts, styleOpts, owners, targets, sceneName: canvas.scene?.name };
  }
  #formScanner() {
    const q = (n) => this.element.querySelector(`[name="sc-${n}"]`);
    return { actor: game.actors.get(q("actor")?.value), data: Scan.newScanner({ name: q("name")?.value?.trim(), signal: q("signal")?.value,
      range: q("range")?.value, limited: q("limited")?.checked, max: q("max")?.value, style: q("style")?.value }) };
  }
  static async #scGive() {
    const { actor, data } = this.#formScanner();
    if (!actor) return ui.notifications.warn("Pick a character first.");
    await Scan.saveScanners(actor, [...Scan.scannersOf(actor), data]);
    ui.notifications.info(`Gave ${actor.name} a ${data.name}.`);
  }
  static #scPreviewForm() { const { actor, data } = this.#formScanner(); runScan(actor, null, { preview: true, scanner: data }); }
  #scAt(el) { const actor = game.actors.get(el.closest("[data-actor]")?.dataset.actor); return { actor, id: el.closest("[data-scanner]")?.dataset.scanner }; }
  static #scPreview(e, el) { const { actor, id } = this.#scAt(el); runScan(actor, id, { preview: true }); }
  static async #scRecharge(e, el) { const { actor, id } = this.#scAt(el); await Scan.recharge(actor, id); }
  static async #scDelete(e, el) {
    const { actor, id } = this.#scAt(el);
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Remove scanner?" }, content: "<p>Take this scanner away?</p>" });
    if (ok) await Scan.saveScanners(actor, Scan.scannersOf(actor).filter((s) => s.id !== id));
  }
  static async #scEdit(e, el) {
    const { actor, id } = this.#scAt(el);
    const list = Scan.scannersOf(actor), sc = list.find((s) => s.id === id);
    if (!sc) return;
    const opt = (obj, cur) => Object.entries(obj).map(([v, l]) => `<option value="${v}" ${v === cur ? "selected" : ""}>${typeof l === "string" ? l : l.label}</option>`).join("");
    const esc = (v) => String(v ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const content = `<div class="ht-sc-dialog">
      <label>Name <input name="name" type="text" value="${esc(sc.name)}"></label>
      <label>Signal <select name="signal">${opt(Scan.SIGNALS, sc.signal)}</select></label>
      <label>Range (${canvas.scene?.grid?.units ?? "units"}) <input name="range" type="number" min="1" value="${sc.range}"></label>
      <label>Pulse <select name="style">${opt(Scan.STYLES, sc.style)}</select></label>
      <label class="ht-check"><input name="limited" type="checkbox" ${sc.limited ? "checked" : ""}> Limited charges</label>
      <label>Capacity <input name="max" type="number" min="1" value="${sc.max}"></label>
      <label>Charges now <input name="charges" type="number" min="0" value="${sc.charges}"></label></div>`;
    const data = await foundry.applications.api.DialogV2.prompt({ window: { title: `Edit ${sc.name}` }, content,
      ok: { label: "Save", callback: (ev, btn) => Object.fromEntries(new FormData(btn.form)) } }).catch(() => null);
    if (!data) return;
    Object.assign(sc, { name: data.name || sc.name, signal: Scan.SIGNALS[data.signal] ? data.signal : sc.signal, range: Math.max(1, Number(data.range) || sc.range),
      style: Scan.STYLES[data.style] ? data.style : sc.style, limited: data.limited === "on", max: Math.max(1, Number(data.max) || sc.max) });
    sc.charges = Math.min(sc.max, Math.max(0, Number(data.charges) || 0));
    await Scan.saveScanners(actor, list);
  }
  static async #tgToggle(e, el) { const b = await fromUuid(el.dataset.uuid); await b?.update({ disabled: !b.disabled }); }
  static async #tgEdit(e, el) { (await fromUuid(el.dataset.uuid))?.sheet?.render(true); }
  /** Shows a target's areas on the GM's map, as a player would see them, ignoring range. */
  static async #tgPreview(e, el) {
    const t = Scan.targets(canvas.scene, { includeResolved: true }).find((x) => x.uuid === el.dataset.uuid);
    if (!t) return;
    const areas = (t.region.shapes ?? []).filter((x) => !x.hole).map(Scan.shapePolygon).filter(Boolean).map((points) => {
      let cx = 0, cy = 0; for (let i = 0; i < points.length; i += 2) { cx += points[i]; cy += points[i + 1]; }
      return { points, center: { x: cx / (points.length / 2), y: cy / (points.length / 2) }, dist: 0, color: t.color, marker: t.marker,
        resolved: true, label: t.name, notes: t.showNotes ? t.notes : "" };
    });
    const c = areas[0]?.center ?? { x: 0, y: 0 };
    playPulse({ sceneId: canvas.scene.id, origin: c, rangePx: 1, color: t.color, style: "ripple", areas, tokens: [] },
      { highlightSeconds: game.settings.get(MODULE_ID, "scanHighlight") });
  }
  /* ---------- comms tab ---------- */
  #commsContext() {
    const pcs = Comms.playerCharacters(), pcIds = new Set(pcs.map((a) => a.id));
    const others = game.actors.filter((a) => !pcIds.has(a.id)).sort((a, b) => a.name.localeCompare(b.name));
    const name = (id) => (id === "all" ? "Everyone" : game.actors.get(id)?.name ?? "?");
    const gmRead = game.settings.get(MODULE_ID, "commsGmRead");
    const log = Comms.gmLog().slice(0, 150).map((m) => ({ id: m.id, text: m.text, to: name(m.to),
      from: m.from?.name ?? (m.from?.alias ? `${m.from.alias} (anon)` : "Anonymous"), private: pcIds.has(m.from?.id) && pcIds.has(m.to),
      time: new Date(m.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) }));
    return { pcs: pcs.map((a) => ({ id: a.id, name: a.name })), others: others.map((a) => ({ id: a.id, name: a.name })), log, gmRead,
      players: game.users.filter((u) => !u.isGM).map((u) => ({ id: u.id, name: u.name, active: u.active })) };
  }
  static async #cmSend() {
    const q = (n) => this.element.querySelector(`[name="cm-${n}"]`);
    const from = q("from")?.value, text = q("text")?.value.trim();
    if (!text) return ui.notifications.warn("Write a message first.");
    await Comms.send({ fromId: from === "anon" ? null : from, anon: from === "anon", alias: q("alias")?.value.trim(), to: q("to")?.value, text });
    q("text").value = "";
  }
  static #cmCall() {
    const q = (n) => this.element.querySelector(`[name="cm-${n}"]`);
    const userIds = [...this.element.querySelectorAll("[name=cm-user]:checked")].map((b) => b.value);
    const actorId = q("caller")?.value;
    Comms.startCall({ actorId: actorId === "anon" ? null : actorId, name: q("callname")?.value.trim(), userIds, line: q("callline")?.value.trim() });
  }
  static async #cmDelete(e, el) { await requestGM("commsDelete", { id: el.dataset.id }); }
  static async #cmClear() {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Clear all comms?" }, content: "<p>Delete every message for everyone? This can't be undone.</p>" });
    if (ok) await requestGM("commsClear");
  }

  /* ---------- hyperspace events ---------- */
  static async #evToggle(e, el) { const l = JumpEvents.events(); const ev = l.find((x) => x.id === el.dataset.id); if (ev) { ev.enabled = !ev.enabled; await JumpEvents.saveEvents(l); } }
  static async #evDelete(e, el) { await JumpEvents.saveEvents(JumpEvents.events().filter((x) => x.id !== el.dataset.id)); }
  static #evRoll() { JumpEvents.maybeEvent({ force: true }); }
  static async #evReset() {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Restore default events?" }, content: "<p>Replace your event table with the built-in one?</p>" });
    if (ok) await JumpEvents.saveEvents(JumpEvents.DEFAULT_EVENTS.map((x, i) => ({ id: `default${i}`, enabled: true, ...x })));
  }
  static async #evEdit(e, el) {
    const l = JumpEvents.events(), ev = l.find((x) => x.id === el.dataset.id) ?? { id: foundry.utils.randomID(), enabled: true, name: "", text: "", weight: 1, fuel: 0 };
    const esc = (v) => String(v ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const content = `<div class="ht-sc-dialog">
      <label>Name <input name="name" type="text" value="${esc(ev.name)}"></label>
      <label>What happens <textarea name="text" rows="4">${esc(ev.text)}</textarea></label>
      <label>Weight (how often) <input name="weight" type="number" min="0" value="${ev.weight}"></label>
      <label>Extra fuel used <input name="fuel" type="number" min="0" value="${ev.fuel ?? 0}"></label></div>`;
    const data = await foundry.applications.api.DialogV2.prompt({ window: { title: ev.name ? `Edit ${ev.name}` : "New hyperspace event" }, content,
      ok: { label: "Save", callback: (ev2, btn) => Object.fromEntries(new FormData(btn.form)) } }).catch(() => null);
    if (!data?.name?.trim()) return;
    Object.assign(ev, { name: data.name.trim(), text: data.text ?? "", weight: Math.max(0, Number(data.weight) || 0), fuel: Math.max(0, Number(data.fuel) || 0) });
    if (!l.includes(ev)) l.push(ev);
    await JumpEvents.saveEvents(l);
  }

  /* ---------- ships tab ---------- */
  static async #shipAdd() {
    const a = game.actors.get(this.element.querySelector("[name=ship-actor]")?.value);
    if (a) await Dock.markShip(a, true);
  }
  static async #shipParty(e, el) { await Dock.setPartyShip(Dock.partyShip()?.id === el.dataset.id ? "" : el.dataset.id); }
  static #shipOpen(e, el) { DatapadApp.instance.show("holodock", el.dataset.id); }
  static #shipShow(e, el) {
    game.socket.emit(`module.${MODULE_ID}`, { type: "open", view: "holodock", id: el.dataset.id });
    DatapadApp.instance.show("holodock", el.dataset.id);
  }
  static async #shipRemove(e, el) {
    const a = game.actors.get(el.dataset.id); if (!a) return;
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Remove from HoloDock?" },
      content: `<p>Take ${a.name} off the ship registry? The actor itself is not deleted.</p>` });
    if (!ok) return;
    if (Dock.partyShip() === a) await Dock.setPartyShip("");
    await Dock.markShip(a, false);
  }
  static async #shipEdit(e, el) {
    const a = game.actors.get(el.dataset.id); if (!a) return;
    const f = a.getFlag(MODULE_ID, "ship") ?? {}, info = Dock.shipInfo(a);
    const esc = (v) => String(v ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const content = `<div class="ht-sc-dialog">
      <label>Hyperdrive class <input name="hyperdrive" type="number" min="0" step="0.25" value="${esc(f.hyperdrive)}" placeholder="${info.hyper ? `from items: ${info.hyper}` : "none"}"></label>
      <label>Fuel now <input name="fuel" type="number" min="0" value="${info.fuel.value}"></label>
      <label>Fuel capacity <input name="fuelMax" type="number" min="0" value="${esc(f.fuelMax)}" placeholder="${info.fuel.max ?? "unlimited"}"></label>
      <label>Shield capacity <input name="shieldMax" type="number" min="0" value="${esc(f.shieldMax)}" placeholder="${info.shields?.max ?? "from sheet"}"></label>
      <label>Cargo capacity (t) <input name="cargoCap" type="number" min="0" value="${esc(f.cargoCap)}" placeholder="${info.cargoCap ?? "none"}"></label>
      <label>Location <input name="location" type="text" value="${esc(f.location)}" placeholder="e.g. Docking bay 94, Mos Eisley"></label>
      <label>Log <textarea name="notes" rows="3">${esc(f.notes)}</textarea></label>
      <p class="ht-dim">Leave a box empty to use the value from the SW5e sheet.</p></div>`;
    const data = await foundry.applications.api.DialogV2.prompt({ window: { title: `HoloDock: ${a.name}` }, content,
      ok: { label: "Save", callback: (ev, btn) => Object.fromEntries(new FormData(btn.form)) } }).catch(() => null);
    if (!data) return;
    const opt = (v) => (v === "" || v === undefined ? null : Math.max(0, Number(v) || 0));
    await Dock.saveFlag(a, { ...f, hyperdrive: opt(data.hyperdrive), fuelMax: opt(data.fuelMax), shieldMax: opt(data.shieldMax),
      cargoCap: opt(data.cargoCap), location: data.location?.trim() ?? "", notes: data.notes ?? "" });
    if (Number(data.fuel) !== info.fuel.value) await Dock.setFuel(a, Number(data.fuel) || 0);
  }
  static async #create() { const d = blank(this.tab); await upsert(this.tab, d); openEditor(this.tab, d.id); }
  static #open(e, el) { DatapadApp.instance.show(OPEN_VIEW[this.tab], el.dataset.id); }
  static #show(e, el) {
    const view = OPEN_VIEW[this.tab], id = el.dataset.id;
    game.socket.emit(`module.${MODULE_ID}`, { type: "open", view, id });
    DatapadApp.instance.show(view, id);
  }
  static #edit(e, el) { openEditor(this.tab, el.dataset.id); }
  static async #importMej() { await importMejShops(); }
  static async #toggle(e, el) { const d = find(this.tab, el.dataset.id); d.hidden = !d.hidden; await upsert(this.tab, d); }
  static async #remove(e, el) {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete?" }, content: "<p>Delete this entry?</p>" });
    if (ok) await remove(this.tab, el.dataset.id);
  }
}
