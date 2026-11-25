import { MODULE_ID, CHANGED_HOOK, list, find, upsert, remove, itemPrice } from "./store.mjs";
import { DatapadApp } from "./datapad.mjs";
import { ShopEditorApp, importMejShops } from "./shop-editor.mjs";

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

  /** Adds the doors (Walls layer) and lights (Lighting layer) the GM has selected on the map as terminal controls. */
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
    if (!added) return ui.notifications.warn("Select one or more doors (Walls layer) or lights (Lighting layer) on the map first. Hold Shift to select several.");
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
      edit: ConsoleApp.#edit, remove: ConsoleApp.#remove, toggle: ConsoleApp.#toggle, importMej: ConsoleApp.#importMej
    }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/console.hbs`, scrollable: [".ht-body"] } };
  tab = "terminals";
  static #instance;
  static get instance() { return (this.#instance ??= new ConsoleApp()); }

  constructor(o) { super(o); Hooks.on(CHANGED_HOOK, () => this.rendered && this.render()); }

  async _prepareContext() {
    return {
      tab: this.tab, isShops: this.tab === "shops",
      tabs: Object.entries(KIND_LABEL).map(([id, label]) => ({ id, label, active: id === this.tab })),
      entries: list(this.tab).map((x) => ({
        id: x.id, name: x.name ?? x.title, hidden: x.hidden,
        detail: this.tab === "bounties" ? `${x.status ?? "open"} · ${x.reward} cr`
          : x.scenes?.length ? x.scenes.map((s) => game.scenes.get(s)?.name ?? "?").join(", ") : "All scenes"
      }))
    };
  }

  static #tab(e, el) { this.tab = el.dataset.tab; this.render(); }
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
