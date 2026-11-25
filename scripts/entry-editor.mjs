import { MODULE_ID, find, upsert } from "./store.mjs";
import { bodyToHtml, linkedJournal, looksLikeHtml } from "./richtext.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const getDragData = (event) =>
  (foundry.applications.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(event);
const FilePickerImpl = () => foundry.applications.apps?.FilePicker?.implementation ?? FilePicker;

const KIND_LABEL = { terminals: "terminal", bounties: "bounty", missions: "mission", contacts: "contact" };
const KIND_ICON = { terminals: "fas fa-terminal", bounties: "fas fa-crosshairs", missions: "fas fa-list-check", contacts: "fas fa-address-book" };

const opts = (pairs, current) => pairs.map(([value, label]) => ({ value, label, selected: String(value) === String(current ?? "") }));
const GAMES = [["random", "Random (players find out when they start)"], ["cipher", "Cipher Lock (guess the code)"],
  ["circuit", "Circuit Reroute (rotate tiles, timed)"], ["signal", "Signal Tuning (match the wave, timed)"], ["firewall", "Firewall Run (dodge the sentinels)"]];
const DIFFS = [["easy", "Easy"], ["normal", "Normal"], ["hard", "Hard"], ["elite", "Elite"]];
const THEMES = [["cyan", "Blue (default)"], ["amber", "Amber"], ["red", "Red"], ["green", "Green"]];
const STANDING = [[-3, "Hostile"], [-2, "Unfriendly"], [-1, "Wary"], [0, "Neutral"], [1, "Friendly"], [2, "Trusted"], [3, "Ally"]];
const BOUNTY_STATUS = [["open", "Open (anyone can take it)"], ["claimed", "Claimed (someone is on it)"], ["completed", "Completed (hidden from players)"]];
const MISSION_STATUS = [["active", "Active"], ["done", "Done"], ["failed", "Failed"]];
const CONTROL_TYPE = { door: { icon: "fa-door-closed", label: "Door" }, light: { icon: "fa-lightbulb", label: "Light" }, camera: { icon: "fa-video", label: "Camera" } };

/* The "Encrypted" switch and its settings, shared by message and file cards. */
const ENCRYPTED_PARTIAL = `
<div class="ht-enc-box">
  <label class="ht-switch"><input type="checkbox" data-toggle="{{kind}}" data-index="{{i}}" {{#if isEnc}}checked{{/if}}> <i class="fas fa-lock"></i> <b>Encrypted</b> <span class="ht-dim">players see scrambled text until they crack it</span></label>
  {{#if isEnc}}<div class="ht-form-grid ht-sub">
    <label>Decrypt check DC</label><div class="ht-inline"><input type="number" min="1" class="ht-num" data-path="{{kind}}.{{i}}.encrypted.dc" data-type="number" data-default="15" value="{{#if enc.dc}}{{enc.dc}}{{else}}15{{/if}}"> <span class="ht-dim">one try per player</span></div>
    <label>Key item</label><input type="text" data-path="{{kind}}.{{i}}.encrypted.key" data-optional value="{{enc.key}}" placeholder="Optional: an item name that opens it instantly, e.g. Code Cylinder">
    <label>Slicing game</label><select data-path="{{kind}}.{{i}}.encrypted.game" data-optional>{{#each encGameOpts}}<option value="{{value}}" {{#if selected}}selected{{/if}}>{{label}}</option>{{/each}}</select>
    <label>Game difficulty</label><select data-path="{{kind}}.{{i}}.encrypted.difficulty" data-optional>{{#each encDiffOpts}}<option value="{{value}}" {{#if selected}}selected{{/if}}>{{label}}</option>{{/each}}</select>
  </div>{{/if}}
</div>`;
if (!Handlebars.partials.htEncrypted) Handlebars.registerPartial("htEncrypted", ENCRYPTED_PARTIAL);

/* The text box of a message or file: formatting buttons, preview, or a linked Journal page instead. */
const BODY_PARTIAL = `
<div class="ht-body-box" data-body="{{kind}}.{{i}}">
  {{#if journal}}
  <div class="ht-journal-link{{#if journalMissing}} ht-missing{{/if}}">
    <i class="fas fa-book-open"></i>
    {{#if journalMissing}}<span class="ht-warn">The linked journal page was deleted. Unlink it, or drop another page here.</span>
    {{else}}<span>Shows the journal page <b>{{journalName}}</b>, with all its formatting. Edit the page to change the text.</span>{{/if}}
    {{#unless journalMissing}}<button type="button" data-action="openJournal" data-list="{{kind}}" data-index="{{i}}" title="Open the journal page"><i class="fas fa-up-right-from-square"></i></button>{{/unless}}
    <button type="button" data-action="unlinkJournal" data-list="{{kind}}" data-index="{{i}}" title="Stop using the journal page"><i class="fas fa-link-slash"></i></button>
  </div>
  {{else}}
  <div class="ht-fmt-bar">
    <button type="button" class="ht-primary" data-action="openBodyEditor" data-list="{{kind}}" data-index="{{i}}" title="Open a big editor with headings, lists, tables, bold, italic and more"><i class="fas fa-pen-to-square"></i> Open full editor</button>
    <span class="ht-dim">or drag a Journal page onto this card</span>
    <span class="ht-grow"></span>
    {{#unless isHtml}}<button type="button" data-action="togglePreview" data-key="{{kind}}.{{i}}" class="{{#if previewOn}}active{{/if}}" title="See it as players will"><i class="fas fa-eye"></i> Preview</button>{{/unless}}
  </div>
  {{#if isHtml}}<div class="ht-preview ht-rich" data-action="openBodyEditor" data-list="{{kind}}" data-index="{{i}}" title="Click to edit">{{{previewHtml}}}</div>
  {{else}}
  {{#if previewOn}}<div class="ht-preview ht-rich">{{{previewHtml}}}</div>{{/if}}
  <textarea rows="{{rows}}" data-path="{{kind}}.{{i}}.body" placeholder="{{placeholder}}" {{#if previewOn}}hidden{{/if}}>{{body}}</textarea>
  {{/if}}
  {{/if}}
</div>`;
if (!Handlebars.partials.htBody) Handlebars.registerPartial("htBody", BODY_PARTIAL);

/**
 * Plain-language form editor for terminals, bounties, missions and contacts.
 * Works on a copy of the entry; nothing is saved until Save. Fields it doesn't know about are kept as they are.
 * Every form field carries data-path (e.g. "messages.2.subject") and an optional data-type (number, bool, int-or-blank).
 */
export class EntryEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ht-app"], window: { title: "Holo-Terminal editor", resizable: true },
    position: { width: 720, height: 820 },
    actions: {
      save: EntryEditorApp.#save, cancel: EntryEditorApp.#cancel, addRow: EntryEditorApp.#addRow, removeRow: EntryEditorApp.#removeRow,
      moveRow: EntryEditorApp.#moveRow, linkSelected: EntryEditorApp.#linkSelected, thisScene: EntryEditorApp.#thisScene,
      pickImage: EntryEditorApp.#pickImage, useActor: EntryEditorApp.#useActor, removeClaimant: EntryEditorApp.#removeClaimant,
      openBodyEditor: EntryEditorApp.#openBodyEditor, togglePreview: EntryEditorApp.#togglePreview, openJournal: EntryEditorApp.#openJournal,
      unlinkJournal: EntryEditorApp.#unlinkJournal, showJson: EntryEditorApp.#showJson, showForm: EntryEditorApp.#showForm, pingControl: EntryEditorApp.#pingControl
    }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/editor.hbs`, scrollable: [".ht-fe-body"] } };

  constructor(kind, id, options = {}) {
    super(foundry.utils.mergeObject({ window: { icon: KIND_ICON[kind] },
      position: kind === "terminals" ? {} : { width: 560, height: 640 } }, options));
    this.kind = kind;
    this.docId = id;
    this.doc = foundry.utils.deepClone(find(kind, id) ?? { id });
    this.jsonMode = false;
    this._preview = new Set();
    this.#normalise();
  }
  /** Older entries may use "encrypted": true; give those an object so the form can fill it in. */
  #normalise() {
    const d = this.doc;
    if (this.kind !== "terminals") return;
    for (const key of ["messages", "files"]) for (const e of d[key] ?? []) if (e.encrypted && typeof e.encrypted !== "object") e.encrypted = {};
    this._pwOn = !!d.password;
  }
  get title() { return `Edit ${KIND_LABEL[this.kind] ?? "entry"}: ${this.doc?.name ?? this.doc?.title ?? ""}`; }

  async _prepareContext() {
    const d = this.doc, k = this.kind;
    const ctx = { doc: d, kind: k, jsonMode: this.jsonMode, isTerminal: k === "terminals", isBounty: k === "bounties",
      isMission: k === "missions", isContact: k === "contacts", label: KIND_LABEL[k] };
    if (this.jsonMode) return { ...ctx, json: JSON.stringify(d, null, 2) };
    if (k === "terminals") Object.assign(ctx, this.#terminalContext(d));
    if (k === "bounties") Object.assign(ctx, { statusOpts: opts(BOUNTY_STATUS, d.status ?? "open"), claimants: d.claimants ?? [] });
    if (k === "missions") Object.assign(ctx, { statusOpts: opts(MISSION_STATUS, d.status ?? "active"),
      objectives: (d.objectives ?? []).map((o, i, a) => ({ ...o, i, first: i === 0, last: i === a.length - 1 })) });
    if (k === "contacts") {
      const actor = d.actorId ? game.actors.get(d.actorId) : null;
      Object.assign(ctx, { standingOpts: opts(STANDING, Math.max(-3, Math.min(3, Math.round(Number(d.standing) || 0)))),
        actorOpts: [{ value: "", label: "Nobody (players can't message them)", selected: !d.actorId },
          ...game.actors.contents.slice().sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ value: a.id, label: a.name, selected: a.id === d.actorId }))],
        actorMissing: !!d.actorId && !actor, actorDiffers: !!actor && (actor.name !== d.name || actor.img !== d.img) });
    }
    return ctx;
  }

  #terminalContext(d) {
    const chosen = new Set(d.scenes ?? []);
    const rows = (key, extra) => (d[key] ?? []).map((e, i, a) => {
      const enc = e.encrypted ? (typeof e.encrypted === "object" ? e.encrypted : {}) : null;
      const jdoc = e.journal ? linkedJournal(e) : null, pkey = `${key}.${i}`;
      return { ...e, i, n: i + 1, journalName: jdoc?.name, journalMissing: !!e.journal && !jdoc,
        isHtml: looksLikeHtml(e.body), previewOn: this._preview.has(pkey), previewHtml: bodyToHtml(e.body),
        rows: Math.min(16, Math.max(6, String(e.body ?? "").split("\n").length + 1)), first: i === 0, last: i === a.length - 1, isEnc: !!enc, enc: enc ?? {},
        encGameOpts: opts([["", "Same as the terminal's slicing game"], ...GAMES, ["none", "Can't be sliced (check or key only)"]], enc?.game ?? ""),
        encDiffOpts: opts([["", "Same as the terminal"], ...DIFFS], enc?.difficulty ?? ""), ...extra?.(e) };
    });
    return {
      everywhere: !chosen.size && !this._scopeSome, sceneCount: chosen.size,
      scenes: game.scenes.contents.map((s) => ({ id: s.id, name: s.name, checked: chosen.has(s.id), current: s.id === canvas.scene?.id })),
      themeOpts: opts(THEMES, d.theme ?? "cyan"),
      hasPassword: this._pwOn,
      hasSlice: !!d.slice, slice: d.slice ?? this._lastSlice ?? { game: "random", difficulty: "normal", dc: 15 },
      gameOpts: opts(GAMES, (d.slice ?? this._lastSlice)?.game ?? "random"), diffOpts: opts(DIFFS, (d.slice ?? this._lastSlice)?.difficulty ?? "normal"),
      messages: rows("messages"), files: rows("files"),
      controls: (d.controls ?? []).map((c, i, a) => {
        const t = CONTROL_TYPE[c.type] ?? { icon: "fa-question", label: c.type ?? "?" };
        const scene = game.scenes.get(c.scene) ?? (c.scene ? null : canvas.scene);
        const found = !!scene && (c.type === "door" ? scene.walls?.get(c.id) : c.type === "light" ? scene.lights?.get(c.id)
          : scene.regions?.get(c.id) ?? scene.drawings?.get(c.id));
        return { ...c, i, first: i === 0, last: i === a.length - 1, icon: t.icon, typeLabel: t.label,
          sceneName: scene?.name ?? "unknown scene", missing: !found, here: scene?.id === canvas.scene?.id };
      })
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    if (!this._bound) {
      this._bound = true;
      el.addEventListener("change", (ev) => {
        if (this.jsonMode) return;
        const t = ev.target;
        if (t.name === "ht-scene") el.querySelector("[name=ht-scope][value=some]").checked = true;
        this.#sync();
        if (t.dataset.toggle) this.#toggle(t.dataset.toggle, t.checked, t.dataset.index);
        if (t.matches("[data-rerender], [name=ht-scope], [name=ht-scene]")) this.render();
      });
      el.addEventListener("input", (ev) => { // keep the window title in step with the name
        if (ev.target.dataset.path === "name" || ev.target.dataset.path === "title") {
          this.#sync();
          if (this.window?.title) this.window.title.textContent = this.title;
        }
      });
    }
    for (const card of el.querySelectorAll(".ht-fcard")) {
      card.addEventListener("dragover", (e) => { e.preventDefault(); card.classList.add("over"); });
      card.addEventListener("dragleave", (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove("over"); });
      card.addEventListener("drop", (e) => this.#onCardDrop(e, card));
    }
    const zone = el.querySelector(".ht-drop");
    zone?.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
    zone?.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone?.addEventListener("drop", (e) => this.#onDrop(e));
  }

  /** Copies every form field into the working copy. */
  #sync() {
    if (this.jsonMode || !this.element) return;
    const d = this.doc;
    for (const f of this.element.querySelectorAll("[data-path]")) {
      const type = f.dataset.type;
      let v = f.type === "checkbox" ? f.checked : f.value;
      if (type === "number") v = f.value === "" ? Number(f.dataset.default ?? 0) : Number(f.value);
      if (type === "bool") v = f.type === "checkbox" ? f.checked : f.value === "true";
      if (type === "trim") v = String(v).trim();
      if (f.dataset.optional !== undefined && v === "") { deletePath(d, f.dataset.path); continue; }
      foundry.utils.setProperty(d, f.dataset.path, v);
    }
    if (this.kind === "terminals") {
      const some = this.element.querySelector("[name=ht-scope][value=some]")?.checked;
      this._scopeSome = !!some;
      d.scenes = some ? [...this.element.querySelectorAll("[name=ht-scene]:checked")].map((c) => c.value) : [];
      if (!this._pwOn) d.password = "";
    }
  }

  /** Switches an optional block (password, slicing, encryption) on or off. */
  #toggle(what, on, index) {
    const d = this.doc;
    if (what === "password") { this._pwOn = on; if (!on) d.password = ""; }
    else if (what === "slice") {
      if (on) d.slice = this._lastSlice ?? { game: "random", difficulty: "normal", dc: 15 };
      else { this._lastSlice = d.slice; delete d.slice; }
    } else if (what === "messages" || what === "files") {
      const e = d[what]?.[Number(index)];
      if (!e) return;
      if (on) e.encrypted = e._enc ?? { dc: 15 };
      else { if (typeof e.encrypted === "object") Object.defineProperty(e, "_enc", { value: e.encrypted, enumerable: false, configurable: true, writable: true }); delete e.encrypted; }
    }
    this.render();
  }

  /** A Journal page (or entry) dropped on a message or file card becomes its text. */
  async #onCardDrop(event, card) {
    event.preventDefault(); event.stopPropagation();
    card.classList.remove("over");
    const data = getDragData(event);
    if (!["JournalEntryPage", "JournalEntry"].includes(data?.type)) return ui.notifications.warn("Drop a Journal page (or a whole Journal entry) here.");
    const doc = await fromUuid(data.uuid);
    if (!doc) return;
    if (doc.documentName === "JournalEntryPage" && doc.type !== "text") return ui.notifications.warn("Only text pages can be shown on a terminal.");
    const [kind, i] = card.querySelector("[data-body]")?.dataset.body.split(".") ?? [];
    this.#sync();
    const entry = this.doc[kind]?.[Number(i)];
    if (!entry) return;
    entry.journal = doc.uuid;
    if (kind === "files" && !entry.name) entry.name = `${doc.name}.txt`;
    if (kind === "messages" && !entry.subject) entry.subject = doc.name;
    ui.notifications.info(`This ${kind === "files" ? "file" : "message"} now shows the journal page "${doc.name}".`);
    this.render();
  }

  async #onDrop(event) {
    event.preventDefault();
    this.element.querySelector(".ht-drop")?.classList.remove("over");
    const data = getDragData(event);
    if (this.kind !== "contacts") return;
    if (data?.type !== "Actor") return ui.notifications.warn("Drop an Actor here.");
    const actor = await fromUuid(data.uuid);
    if (!actor) return;
    this.#sync();
    Object.assign(this.doc, { name: actor.name, img: actor.img, actorId: actor.id });
    this.render();
  }

  static #useActor() {
    this.#sync();
    const a = game.actors.get(this.doc.actorId);
    if (a) Object.assign(this.doc, { name: a.name, img: a.img });
    this.render();
  }

  static #addRow(e, el) {
    this.#sync();
    const list = el.dataset.list, d = this.doc;
    d[list] ??= [];
    if (list === "messages") d.messages.push({ from: "", subject: "", body: "" });
    if (list === "files") d.files.push({ name: "", body: "" });
    if (list === "objectives") d.objectives.push({ text: "", done: false });
    this.render().then?.(() => {
      const rows = this.element.querySelectorAll(`[data-list-row="${list}"]`);
      rows[rows.length - 1]?.querySelector("input, textarea")?.focus();
    });
  }
  static async #removeRow(e, el) {
    this.#sync();
    const list = this.doc[el.dataset.list], i = Number(el.dataset.index);
    if (!list?.[i]) return;
    const what = { messages: "message", files: "file", objectives: "objective", controls: "link" }[el.dataset.list] ?? "row";
    const named = list[i].subject || list[i].name || list[i].label || list[i].text;
    if (el.dataset.list !== "objectives" && named) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: `Remove ${what}?` },
        content: `<p>Remove <b>${Handlebars.escapeExpression(named)}</b>? Nothing is saved until you press Save.</p>` });
      if (!ok) return;
    }
    list.splice(i, 1);
    this.render();
  }
  static #moveRow(e, el) {
    this.#sync();
    const list = this.doc[el.dataset.list], i = Number(el.dataset.index), j = i + Number(el.dataset.dir);
    if (!list?.[i] || !list[j]) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.render();
  }
  static #removeClaimant(e, el) {
    this.#sync();
    this.doc.claimants = (this.doc.claimants ?? []).filter((_, i) => i !== Number(el.dataset.index));
    this.render();
  }
  static #thisScene() {
    this.#sync();
    if (canvas.scene) { this.doc.scenes = [canvas.scene.id]; this._scopeSome = true; }
    this.render();
  }
  static #pickImage() {
    this.#sync();
    new (FilePickerImpl())({ type: "image", current: this.doc.img, callback: (path) => { this.doc.img = path; this.render(); } }).browse();
  }
  /** Pans the map to a linked door, light or camera if it's on the current scene. */
  static #pingControl(e, el) {
    const c = this.doc.controls?.[Number(el.dataset.index)];
    if (!c || !canvas.scene || (c.scene && c.scene !== canvas.scene.id)) return ui.notifications.info("That one is on another scene.");
    const obj = c.type === "door" ? canvas.walls?.get(c.id) : c.type === "light" ? canvas.lighting?.get(c.id)
      : canvas.regions?.get(c.id) ?? canvas.drawings?.get(c.id);
    const p = obj?.center;
    if (!p) return ui.notifications.warn("Can't find it on this scene. It may have been deleted.");
    canvas.animatePan({ x: p.x, y: p.y });
    canvas.ping?.(p);
  }

  /** Adds the doors (Walls layer), lights (Lighting layer) and camera Regions the GM has selected on the map. */
  static #linkSelected() {
    this.#sync();
    const doc = this.doc;
    if (!canvas.scene) return;
    doc.controls ??= [];
    const have = new Set(doc.controls.map((c) => `${c.type}:${c.id}`));
    const count = (type) => doc.controls.filter((c) => c.type === type).length;
    let doors = count("door"), lights = count("light"), cams = count("camera"), added = 0;
    for (const w of canvas.walls?.controlled ?? []) {
      if (!w.document.door || have.has(`door:${w.document.id}`)) continue;
      doc.controls.push({ label: `Door ${++doors}`, type: "door", id: w.document.id, scene: canvas.scene.id }); added++;
    }
    for (const l of canvas.lighting?.controlled ?? []) {
      if (have.has(`light:${l.document.id}`)) continue;
      doc.controls.push({ label: `Light ${++lights}`, type: "light", id: l.document.id, scene: canvas.scene.id }); added++;
    }
    for (const r of [...(canvas.regions?.controlled ?? []), ...(canvas.drawings?.controlled ?? [])]) {
      if (have.has(`camera:${r.document.id}`)) continue;
      cams++;
      const name = r.document.name && r.document.documentName === "Region" ? r.document.name : `Camera ${cams}`;
      doc.controls.push({ label: name, type: "camera", id: r.document.id, scene: canvas.scene.id }); added++;
    }
    if (!added) return ui.notifications.warn("Select doors (Walls layer), lights (Lighting layer) or camera Regions (Regions layer) on the map first. Hold Shift to select several.");
    ui.notifications.info(`Linked ${added}. Give each one a name players will recognise, then Save.`);
    this.render();
  }

  /** Opens the big formatted-text editor for one message or file. */
  static #openBodyEditor(e, el) {
    this.#sync();
    const kind = el.dataset.list, i = Number(el.dataset.index), entry = this.doc[kind]?.[i];
    if (!entry) return;
    const title = kind === "files" ? entry.name || "file" : entry.subject || "message";
    new BodyEditorApp({ title, html: bodyToHtml(entry.body), onSave: (html) => { entry.body = html; this._preview.delete(`${kind}.${i}`); this.render(); } }).render(true);
  }
  static #togglePreview(e, el) {
    this.#sync();
    const k = el.dataset.key;
    if (this._preview.has(k)) this._preview.delete(k); else this._preview.add(k);
    this.render();
  }
  static #openJournal(e, el) {
    const entry = this.doc[el.dataset.list]?.[Number(el.dataset.index)];
    const doc = linkedJournal(entry);
    if (doc?.documentName === "JournalEntryPage") doc.parent?.sheet?.render(true, { pageId: doc.id });
    else doc?.sheet?.render(true);
  }
  static #unlinkJournal(e, el) {
    this.#sync();
    const entry = this.doc[el.dataset.list]?.[Number(el.dataset.index)];
    if (entry) delete entry.journal;
    this.render();
  }

  static #showJson() { this.#sync(); this.jsonMode = true; this.render(); }
  static #showForm() {
    const doc = this.#readJson();
    if (!doc) return;
    this.doc = doc; this.jsonMode = false; this.#normalise(); this.render();
  }
  #readJson() {
    try { const d = JSON.parse(this.element.querySelector("textarea.ht-json").value); d.id = this.docId; return d; }
    catch (err) { ui.notifications.error(`That JSON has a mistake in it: ${err.message}`); return null; }
  }

  static #cancel() { this.close(); }
  static async #save() {
    if (this.jsonMode) { const d = this.#readJson(); if (!d) return; this.doc = d; }
    else this.#sync();
    const d = this.doc;
    d.id = this.docId;
    if (this.kind === "terminals") {
      d.name = String(d.name ?? "").trim() || "Unnamed terminal";
      for (const key of ["messages", "files"]) for (const e of d[key] ?? []) {
        if (e.encrypted && typeof e.encrypted === "object") for (const [k, v] of Object.entries(e.encrypted)) if (v === "" || v === undefined) delete e.encrypted[k];
      }
      if (d.slice) d.slice.dc = Math.max(1, Number(d.slice.dc) || 15);
    }
    if (this.kind === "bounties" || this.kind === "missions") d.title = String(d.title ?? "").trim() || `Unnamed ${KIND_LABEL[this.kind]}`;
    if (this.kind === "contacts") { d.name = String(d.name ?? "").trim() || "Unnamed contact"; d.standing = Number(d.standing) || 0; }
    if (this.kind === "missions") d.objectives = (d.objectives ?? []).filter((o) => String(o.text ?? "").trim());
    await upsert(this.kind, d);
    ui.notifications.info(`Saved ${d.name ?? d.title}`);
    this.close();
  }
}

function deletePath(obj, path) {
  const parts = path.split("."), last = parts.pop();
  const parent = parts.reduce((o, k) => o?.[k], obj);
  if (parent && typeof parent === "object") delete parent[last];
}

/* ---------- big text editor: Foundry's journal editor (ProseMirror) in its own window ---------- */
export class BodyEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ht-app"], window: { title: "Edit text", icon: "fas fa-pen-to-square", resizable: true },
    position: { width: 760, height: 680 },
    actions: { saveBody: BodyEditorApp.#saveBody, cancelBody: BodyEditorApp.#cancelBody }
  };
  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/body-editor.hbs` } };

  constructor({ title, html, onSave }, options) {
    super(options);
    this.label = title; this.html = html ?? ""; this.onSave = onSave;
  }
  get title() { return `Edit text: ${this.label}`; }
  async _prepareContext() { return { html: this.html }; }

  async _onRender(context, options) {
    super._onRender?.(context, options);
    const target = this.element.querySelector(".ht-pm-target");
    if (!target || this.editor) return;
    const PM = globalThis.ProseMirror;
    const TE = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    try {
      const onSave = () => BodyEditorApp.#saveBody.call(this);
      const plugins = {
        menu: PM.ProseMirrorMenu.build(PM.defaultSchema, { compact: false, destroyOnSave: false, onSave }),
        keyMaps: PM.ProseMirrorKeyMaps.build(PM.defaultSchema, { onSave })
      };
      this.editor = await TE.create({ engine: "prosemirror", target, plugins }, this.html);
    } catch (err) {
      console.warn("Holo-Terminal | rich editor unavailable, using a plain text box", err);
      target.outerHTML = `<textarea class="ht-pm-fallback">${Handlebars.escapeExpression(this.html)}</textarea>`;
    }
  }

  #content() {
    if (this.editor?.view) return globalThis.ProseMirror.dom.serializeString(this.editor.view.state.doc.content);
    return this.element.querySelector(".ht-pm-fallback")?.value ?? this.html;
  }
  static #saveBody() {
    const html = this.#content();
    this.onSave?.(html);
    this.close();
  }
  static #cancelBody() { this.close(); }
  async close(options) {
    try { this.editor?.destroy?.(); } catch { /* already gone */ }
    this.editor = null;
    return super.close(options);
  }
}
