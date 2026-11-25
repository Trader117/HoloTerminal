import { MODULE_ID, find, upsert, list, itemPrice } from "./store.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const getDragData = (event) =>
  (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
const FilePickerImpl = () => foundry.applications.apps?.FilePicker?.implementation ?? FilePicker;

/* ---------- visual shop editor (GM) ---------- */
export class ShopEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ht-app"], window: { title: "Edit market", icon: "fas fa-store", resizable: true },
    position: { width: 620, height: 720 },
    actions: { save: ShopEditorApp.#save, cancel: ShopEditorApp.#cancel, removeItem: ShopEditorApp.#removeItem,
      pickImage: ShopEditorApp.#pickImage, thisScene: ShopEditorApp.#thisScene }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/shop-editor.hbs`, scrollable: [".ht-shop-items"] } };

  constructor(shopId, options) {
    super(options);
    this.shopId = shopId;
    this.doc = foundry.utils.deepClone(find("shops", shopId));
  }
  get title() { return `Edit market: ${this.doc?.name ?? ""}`; }

  async _prepareContext() {
    const d = this.doc;
    const chosen = new Set(d.scenes ?? []);
    return {
      doc: d, everywhere: !chosen.size, markupPct: Math.round((d.markup ?? 1) * 100),
      scenes: game.scenes.contents.map((s) => ({ id: s.id, name: s.name, checked: chosen.has(s.id), current: s.id === canvas.scene?.id })),
      items: (d.items ?? []).map((it, index) => ({ ...it, index, unlimited: it.stock == null || it.stock < 0,
        sell: Math.round((it.price ?? 0) * (d.markup ?? 1)), missing: !it.uuid && !it.data }))
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    if (!this._bound) {
      this._bound = true;
      el.addEventListener("change", (ev) => {
        if (ev.target.name === "scene") el.querySelector("#scope-some").checked = true;
        this.#sync();
      });
    }
    const zone = el.querySelector(".ht-drop");
    zone?.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
    zone?.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone?.addEventListener("drop", (e) => this.#onDrop(e));
  }

  /** Copies every form field into the working copy (nothing is saved until Save). */
  #sync() {
    const el = this.element, d = this.doc;
    const val = (n) => el.querySelector(`[name="${n}"]`);
    d.name = val("name").value.trim() || "Unnamed market";
    d.description = val("description").value;
    d.img = val("img").value.trim();
    d.markup = Math.max(0, Number(val("markup").value) / 100 || 0) || 1;
    d.hidden = val("hidden").checked;
    d.scenes = el.querySelector("#scope-some").checked
      ? [...el.querySelectorAll("[name=scene]:checked")].map((c) => c.value) : [];
    el.querySelectorAll("tr[data-index]").forEach((row) => {
      const it = d.items[Number(row.dataset.index)];
      if (!it) return;
      it.price = Math.max(0, Number(row.querySelector("[name=price]").value) || 0);
      const stock = row.querySelector("[name=stock]").value.trim();
      it.stock = stock === "" || Number(stock) < 0 ? -1 : Math.floor(Number(stock));
    });
  }

  async #onDrop(event) {
    event.preventDefault();
    this.element.querySelector(".ht-drop")?.classList.remove("over");
    const data = getDragData(event);
    this.#sync();
    const add = (item) => this.doc.items.push({ name: item.name, uuid: item.uuid, img: item.img, price: itemPrice(item), stock: -1 });
    if (data?.type === "Item") { const item = await fromUuid(data.uuid); if (item) add(item); }
    else if (data?.type === "Folder") {
      const folder = await fromUuid(data.uuid);
      for (const item of folder?.contents ?? []) if (item.documentName === "Item") add(item);
    } else return ui.notifications.warn("Drop Items (or a folder of Items) here.");
    this.render();
  }

  static #removeItem(e, el) { this.#sync(); this.doc.items.splice(Number(el.dataset.index), 1); this.render(); }
  static #thisScene() {
    this.#sync();
    if (canvas.scene) this.doc.scenes = [canvas.scene.id];
    this.render();
  }
  static #pickImage() {
    this.#sync();
    new (FilePickerImpl())({ type: "image", current: this.doc.img, callback: (path) => { this.doc.img = path; this.render(); } }).browse();
  }
  static #cancel() { this.close(); }
  static async #save() {
    this.#sync();
    await upsert("shops", this.doc);
    ui.notifications.info(`Saved ${this.doc.name}`);
    this.close();
  }
}

/* ---------- import shops from Monk's Enhanced Journal ---------- */
const MEJ = "monks-enhanced-journal";

function parsePrice(p) {
  if (p == null) return 0;
  if (typeof p === "number") return p;
  if (typeof p === "object") return Number(p.value) || 0;
  return parseFloat(String(p).replace(/,/g, "")) || 0;
}

function mejShopPages() {
  const pages = [];
  for (const entry of game.journal) {
    const entryType = entry.getFlag?.(MEJ, "type");
    for (const page of entry.pages ?? []) {
      const type = page.getFlag?.(MEJ, "type") ?? entryType;
      if (type === "shop") pages.push({ entry, page });
    }
  }
  return pages;
}

/** Creates or refreshes a Holo-Terminal market for every Monk's Enhanced Journal shop. Returns the count. */
export async function importMejShops() {
  const found = mejShopPages();
  if (!found.length) { ui.notifications.warn("No Monk's Enhanced Journal shops found in this world."); return 0; }
  const shops = list("shops");
  for (const { entry, page } of found) {
    const raw = page.getFlag(MEJ, "items") ?? entry.getFlag?.(MEJ, "items") ?? [];
    const items = (Array.isArray(raw) ? raw : Object.values(raw)).filter((it) => it?.name).map((it) => {
      const flags = it.flags?.[MEJ] ?? {};
      const qty = flags.quantity ?? flags.qty;
      const data = foundry.utils.deepClone(it);
      delete data._id;
      if (data.flags) delete data.flags[MEJ];
      return { name: it.name, img: it.img, price: parsePrice(flags.price ?? it.system?.price), data,
        stock: qty === undefined || qty === null || qty === "" ? -1 : Math.max(0, parseInt(qty) || 0) };
    });
    const existing = shops.find((s) => s.mejId === page.uuid);
    const shop = existing ?? { id: foundry.utils.randomID(), hidden: true, scenes: [], markup: 1, mejId: page.uuid };
    Object.assign(shop, { name: page.name || entry.name, img: page.src ?? entry.img ?? shop.img ?? "", items,
      description: shop.description ?? "" });
    if (!existing) shops.push(shop);
  }
  await game.settings.set(MODULE_ID, "shops", shops);
  ui.notifications.info(`Imported ${found.length} shop(s) from Monk's Enhanced Journal. They start hidden from players.`);
  return found.length;
}
