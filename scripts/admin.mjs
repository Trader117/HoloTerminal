import { MODULE_ID, CHANGED_HOOK, list, find, upsert, remove, itemPrice } from "./store.mjs";
import { DatapadApp } from "./datapad.mjs";
import { ShopEditorApp, importMejShops } from "./shop-editor.mjs";
import * as Scan from "./scanner.mjs";
import { runScan } from "./scan-wheel.mjs";
import { playPulse } from "./scan-fx.mjs";

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
      tgEdit: ConsoleApp.#tgEdit
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
  }

  async _prepareContext() {
    const tabs = [...Object.entries(KIND_LABEL), ["scanners", "Scanners"]].map(([id, label]) => ({ id, label, active: id === this.tab }));
    if (this.tab === "scanners") return { tab: this.tab, tabs, isScanners: true, ...this.#scannerContext() };
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
