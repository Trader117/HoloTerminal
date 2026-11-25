/**
 * Holo-Terminal Dossier: an original SW5e character sheet for Foundry VTT v12 and v13.
 * Works with the dnd5e system (4.x / 5.x) plus sw5e-module, and degrades gracefully without the module.
 */
const MODULE_ID = "holo-terminal"; // the sheet ships inside the Holo-Terminal module
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const THEMES = ["cyan", "amber", "red", "green"];
const INVENTORY_TYPES = ["weapon", "equipment", "consumable", "tool", "container", "loot"];
/* v12 / v13 compatibility */
const TextEditorImpl = () => foundry.applications.ux?.TextEditor?.implementation ?? TextEditor;
const FilePickerImpl = () => foundry.applications.apps?.FilePicker?.implementation ?? FilePicker;
const DragDropImpl = () => foundry.applications.ux?.DragDrop?.implementation ?? DragDrop;
/** Register a named partial on both v12 and v13. */
async function registerPartial(name, path) {
  const getTpl = foundry.applications.handlebars?.getTemplate ?? getTemplate;
  Handlebars.registerPartial(name, await getTpl(path));
}
const NEW_ROLL_API = () => foundry.utils.isNewerVersion(game.system.version, "4.0.99");
const FORCE_SCHOOLS = ["lgt", "uni", "drk"];
const TECH_SCHOOLS = ["tec"];

/* ---------- small helpers ---------- */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const signed = (v) => (num(v) >= 0 ? `+${num(v)}` : `${num(v)}`);
const pct = (v, m) => (m > 0 ? Math.clamp(Math.round((v / m) * 100), 0, 100) : 0);
const cfg = () => CONFIG.DND5E ?? {};
const loc = (s) => (s ? game.i18n.localize(s) : "");

/** Find a points pool on the actor, returning its data and the update path. */
function pool(sys, castType) {
  if (sys.powercasting?.[castType]?.points) return { data: sys.powercasting[castType].points, path: `system.powercasting.${castType}.points.value` };
  if (sys.attributes?.[castType]?.points) return { data: sys.attributes[castType].points, path: `system.attributes.${castType}.points.value` };
  return { data: null, path: "" };
}

function resource(points) {
  const value = num(points?.value);
  const max = num(points?.max) + num(points?.tempmax);
  return { value, max, temp: num(points?.temp), pct: pct(value, max), show: max > 0 || value > 0 };
}

function itemUses(item) {
  const u = item.system.uses;
  if (!u || !num(u.max)) return null;
  return { value: num(u.value), max: num(u.max) };
}

function itemSummary(item) {
  const s = item.system, labels = item.labels ?? {};
  const bits = [];
  if (labels.toHit) bits.push(`${labels.toHit} hit`);
  const dmg = labels.damages ?? labels.damage;
  if (Array.isArray(dmg)) bits.push(dmg.map((d) => d.label ?? d.formula).filter(Boolean).join(" + "));
  else if (typeof dmg === "string" && dmg) bits.push(dmg);
  if (labels.save) bits.push(labels.save);
  if (s.range?.value) bits.push(`${s.range.value}${s.range.long ? "/" + s.range.long : ""} ${s.range.units ?? ""}`.trim());
  if (labels.activation && !bits.length) bits.push(labels.activation);
  return bits.filter(Boolean).join(" · ");
}

function itemRow(item) {
  const s = item.system;
  return {
    id: item.id, name: item.name, img: item.img, type: item.type,
    quantity: s.quantity ?? null,
    weight: num(s.weight?.value ?? s.weight),
    equipped: !!s.equipped, equippable: "equipped" in s,
    uses: itemUses(item), summary: itemSummary(item),
    activation: s.activation?.type ?? item.system.activities?.contents?.[0]?.activation?.type ?? ""
  };
}

/* ---------- the sheet ---------- */
export class HoloDossierSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["holo-sheet"],
    position: { width: 820, height: 760 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      rollAbility: HoloDossierSheet.#onRollAbility,
      rollSave: HoloDossierSheet.#onRollSave,
      rollSkill: HoloDossierSheet.#onRollSkill,
      rollInit: HoloDossierSheet.#onRollInit,
      deathSave: HoloDossierSheet.#onDeathSave,
      rest: HoloDossierSheet.#onRest,
      useItem: HoloDossierSheet.#onUseItem,
      editItem: HoloDossierSheet.#onEditItem,
      deleteItem: HoloDossierSheet.#onDeleteItem,
      toggleEquip: HoloDossierSheet.#onToggleEquip,
      expandItem: HoloDossierSheet.#onExpandItem,
      createItem: HoloDossierSheet.#onCreateItem,
      editImage: HoloDossierSheet.#onEditImage,
      toggleInspiration: HoloDossierSheet.#onToggleInspiration,
      holoTab: HoloDossierSheet.#onTab
    }
  };

  static PARTS = {
    header: { template: `modules/${MODULE_ID}/sheet/templates/header.hbs` },
    nav: { template: `modules/${MODULE_ID}/sheet/templates/nav.hbs` },
    overview: { template: `modules/${MODULE_ID}/sheet/templates/overview.hbs` },
    combat: { template: `modules/${MODULE_ID}/sheet/templates/combat.hbs` },
    powers: { template: `modules/${MODULE_ID}/sheet/templates/powers.hbs` },
    gear: { template: `modules/${MODULE_ID}/sheet/templates/gear.hbs` },
    features: { template: `modules/${MODULE_ID}/sheet/templates/features.hbs` },
    bio: { template: `modules/${MODULE_ID}/sheet/templates/bio.hbs` }
  };

  static TAB_LIST = {
    primary: {
      initial: "overview",
      tabs: [
        { id: "overview", icon: "fa-solid fa-id-card", label: "HOLOSHEET.Tab.Overview" },
        { id: "combat", icon: "fa-solid fa-crosshairs", label: "HOLOSHEET.Tab.Combat" },
        { id: "powers", icon: "fa-solid fa-atom", label: "HOLOSHEET.Tab.Powers" },
        { id: "gear", icon: "fa-solid fa-box-open", label: "HOLOSHEET.Tab.Gear" },
        { id: "features", icon: "fa-solid fa-dna", label: "HOLOSHEET.Tab.Features" },
        { id: "bio", icon: "fa-solid fa-book", label: "HOLOSHEET.Tab.Bio" }
      ]
    }
  };

  get title() { return this.actor.name; }

  /* ----- context ----- */
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const actor = this.actor, sys = actor.system, attr = sys.attributes ?? {};
    const C = cfg();
    ctx.editable ??= this.isEditable;
    const theme = actor.getFlag(MODULE_ID, "sheetTheme") ?? game.settings.get(MODULE_ID, "sheetTheme");

    ctx.actor = actor;
    ctx.system = sys;
    ctx.tabs = this.#prepareTabs("primary");
    ctx.theme = THEMES.includes(theme) ? theme : "cyan";
    ctx.themes = THEMES.map((t) => ({ id: t, label: loc(`HOLOSHEET.Theme.${t}`), selected: t === ctx.theme }));

    // identity
    const classes = actor.itemTypes.class ?? [];
    const subclasses = actor.itemTypes.subclass ?? [];
    ctx.classLine = classes.map((c) => {
      const sub = subclasses.find((s) => s.system.classIdentifier === c.system.identifier);
      return `${c.name}${sub ? ` (${sub.name})` : ""} ${c.system.levels ?? ""}`.trim();
    }).join(" / ");
    ctx.species = (actor.itemTypes.race ?? actor.itemTypes.species ?? [])[0]?.name ?? "";
    ctx.background = (actor.itemTypes.background ?? [])[0]?.name ?? "";
    ctx.level = num(sys.details?.level);
    ctx.xp = sys.details?.xp ?? {};

    // vitals
    const hp = attr.hp ?? {};
    const hpMax = num(hp.max) + num(hp.tempmax);
    ctx.hp = { value: num(hp.value), max: hpMax, temp: num(hp.temp), pct: pct(num(hp.value), hpMax) };
    ctx.ac = attr.ac?.value ?? "—";
    ctx.init = signed(attr.init?.total ?? attr.init?.mod);
    ctx.prof = signed(attr.prof);
    ctx.speed = `${num(attr.movement?.walk)} ${attr.movement?.units ?? "ft"}`;
    ctx.hd = attr.hd ? { value: num(attr.hd.value), max: num(attr.hd.max) } : null;
    ctx.death = { success: num(attr.death?.success), failure: num(attr.death?.failure), show: ctx.hp.value <= 0 };
    ctx.inspiration = !!attr.inspiration;
    ctx.exhaustion = num(attr.exhaustion);

    // abilities + saves
    ctx.abilities = Object.entries(sys.abilities ?? {}).map(([k, a]) => {
      const save = typeof a.save === "object" ? a.save?.value : a.save;
      return {
        key: k, value: a.value, mod: signed(a.mod), save: signed(save), proficient: num(a.proficient) > 0,
        label: loc(C.abilities?.[k]?.label) || k, abbr: (loc(C.abilities?.[k]?.abbreviation) || k).toUpperCase()
      };
    });

    // skills (sw5e-module rewrites CONFIG.DND5E.skills to the SW5e list)
    const profIcons = { 0: "fa-regular fa-circle", 0.5: "fa-solid fa-circle-half-stroke", 1: "fa-solid fa-circle", 2: "fa-solid fa-circle-dot" };
    ctx.skills = Object.entries(sys.skills ?? {})
      .filter(([k]) => !C.skills || k in C.skills)
      .map(([k, s]) => ({
        key: k, label: loc(C.skills?.[k]?.label) || k, total: signed(s.total ?? s.mod),
        passive: s.passive, ability: (s.ability ?? "").toUpperCase(), icon: profIcons[num(s.value)] ?? profIcons[0]
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    // resources
    const pc = sys.powercasting ?? {};
    const fp = pool(sys, "force"), tp = pool(sys, "tech");
    ctx.force = { ...resource(fp.data), path: fp.path };
    ctx.tech = { ...resource(tp.data), path: tp.path };
    ctx.superiority = sys.superiority ? { ...resource(sys.superiority.dice), die: sys.superiority.die ? `d${sys.superiority.die}` : "" } : { show: false };
    ctx.hasSW5e = !!(fp.data || tp.data);

    // powers
    const spells = actor.itemTypes.spell ?? [];
    const schoolCfg = C.spellSchools ?? {};
    const groupPowers = (list, castType) => {
      const levels = new Map();
      for (const p of list.sort((a, b) => (a.system.level - b.system.level) || a.name.localeCompare(b.name))) {
        const lvl = num(p.system.level);
        if (!levels.has(lvl)) levels.set(lvl, { level: lvl, label: lvl === 0 ? loc("HOLOSHEET.AtWill") : `${loc("HOLOSHEET.Level")} ${lvl}`, powers: [] });
        const school = p.system.school ?? "";
        levels.get(lvl).powers.push({
          ...itemRow(p), school, schoolLabel: loc(schoolCfg[school]?.label) || school,
          cost: castType && lvl > 0 ? lvl + 1 : 0, concentration: p.system.properties?.has?.("concentration") ?? false
        });
      }
      return [...levels.values()];
    };
    const schoolInfo = (castType, keys) => keys
      .filter((k) => pc[castType]?.schools?.[k])
      .map((k) => {
        const s = pc[castType].schools[k];
        return { key: k, label: loc(schoolCfg[k]?.label) || k, dc: s.dc ?? "—", attack: s.attr ? signed(sys.abilities?.[s.attr]?.attack) : "—", attr: (s.attr ?? "").toUpperCase() };
      });
    ctx.forcePowers = groupPowers(spells.filter((p) => FORCE_SCHOOLS.includes(p.system.school)), "force");
    ctx.techPowers = groupPowers(spells.filter((p) => TECH_SCHOOLS.includes(p.system.school)), "tech");
    ctx.otherPowers = groupPowers(spells.filter((p) => ![...FORCE_SCHOOLS, ...TECH_SCHOOLS].includes(p.system.school)), null);
    ctx.forceSchools = schoolInfo("force", FORCE_SCHOOLS);
    ctx.techSchools = schoolInfo("tech", TECH_SCHOOLS);

    // combat
    const weapons = (actor.itemTypes.weapon ?? []).map(itemRow).sort((a, b) => b.equipped - a.equipped);
    ctx.weapons = weapons;
    const actionTypes = new Set(["action", "bonus", "reaction"]);
    const feats = actor.itemTypes.feat ?? [];
    ctx.actions = feats.map(itemRow).filter((f) => actionTypes.has(f.activation));
    ctx.maneuvers = actor.items.filter((i) => i.type.endsWith("maneuver")).map(itemRow);

    // gear
    ctx.credits = sys.currency?.gc ?? sys.currency?.gp ?? 0;
    ctx.creditsKey = sys.currency && "gc" in sys.currency ? "gc" : "gp";
    ctx.gear = INVENTORY_TYPES.map((type) => ({
      type, label: loc(CONFIG.Item.typeLabels?.[type]) || type,
      items: (actor.itemTypes[type] ?? []).filter((i) => !i.system.container).map(itemRow)
    }));
    const enc = attr.encumbrance ?? {};
    ctx.encumbrance = { value: Math.round(num(enc.value) * 10) / 10, max: num(enc.max), pct: num(enc.pct, pct(num(enc.value), num(enc.max))) };

    // features
    const featGroups = { class: [], race: [], background: [], feat: [], other: [] };
    for (const f of feats) {
      const t = f.system.type?.value;
      (featGroups[t === "species" ? "race" : t] ?? featGroups.other).push(itemRow(f));
    }
    ctx.featureGroups = [
      { label: "Class Features", items: featGroups.class },
      { label: "Species Traits", items: featGroups.race },
      { label: "Background", items: featGroups.background },
      { label: "Feats", items: featGroups.feat },
      { label: "Other", items: featGroups.other }
    ].filter((g) => g.items.length);

    // bio
    const bio = sys.details?.biography?.value ?? "";
    ctx.bioValue = bio;
    ctx.bioHTML = await TextEditorImpl().enrichHTML(bio, { secrets: actor.isOwner, rollData: actor.getRollData(), relativeTo: actor });
    return ctx;
  }

  #prepareTabs(group) {
    const def = this.constructor.TAB_LIST[group];
    this.tabGroups[group] ??= def.initial;
    const active = this.tabGroups[group];
    return Object.fromEntries(def.tabs.map((t) => [t.id, { ...t, group, active: t.id === active, cssClass: t.id === active ? "active" : "" }]));
  }

  async _preparePartContext(partId, ctx) {
    ctx = await super._preparePartContext(partId, ctx);
    if (ctx.tabs?.[partId]) ctx.tab = ctx.tabs[partId];
    return ctx;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    el.classList.remove(...THEMES.map((t) => `holo-theme-${t}`));
    el.classList.add(`holo-theme-${context.theme}`);
    // relative entries like "-7" or "+3" in number fields
    this.#renderBio(el.querySelector(".holo-bio-editor"), context);
    if (!this.#dragDrop) {
      const DD = DragDropImpl();
      this.#dragDrop = new DD({
        dragSelector: ".holo-item[data-item-id]", dropSelector: null,
        permissions: { dragstart: () => this.isEditable, drop: () => this.isEditable },
        callbacks: { dragstart: this.#onDragStart.bind(this), drop: this.#onDropData.bind(this) }
      });
    }
    this.#dragDrop.bind(el);
    el.querySelectorAll("input[data-delta]").forEach((input) => {
      input.addEventListener("change", () => {
        const v = input.value.trim();
        if (/^[+-]\d+$/.test(v)) input.value = num(input.dataset.current) + Number(v);
      });
      input.addEventListener("focus", () => input.select());
    });
  }

  #dragDrop = null;

  /** Rich-text bio: ProseMirror element when available, plain textarea otherwise. */
  #renderBio(host, context) {
    if (!host) return;
    const PM = foundry.applications.elements?.HTMLProseMirrorElement;
    const name = "system.details.biography.value";
    if (PM?.create && this.isEditable) {
      host.replaceChildren(PM.create({ name, value: context.bioValue, enriched: context.bioHTML, toggled: true }));
    } else if (this.isEditable) {
      const view = document.createElement("div");
      view.className = "holo-bio-view";
      view.innerHTML = context.bioHTML || "<em>No biography yet. Click Edit.</em>";
      const btn = document.createElement("button");
      btn.type = "button"; btn.innerHTML = '<i class="fa-solid fa-pen"></i> Edit';
      btn.addEventListener("click", () => {
        const ta = document.createElement("textarea");
        ta.name = name; ta.value = context.bioValue; ta.rows = 18;
        host.replaceChildren(ta); ta.focus();
      });
      host.replaceChildren(btn, view);
    } else host.innerHTML = context.bioHTML;
  }

  #onDragStart(event) {
    const item = this.actor.items.get(event.currentTarget.dataset.itemId);
    if (item) event.dataTransfer.setData("text/plain", JSON.stringify(item.toDragData()));
  }

  async #onDropData(event) {
    const data = TextEditorImpl().getDragEventData(event);
    if (data?.type !== "Item" || !this.isEditable) return;
    const item = await Item.implementation.fromDropData(data);
    if (!item || item.parent === this.actor) return;
    // SW5e class/species/background items run dnd5e advancement (level-up) when dropped.
    const AM = globalThis.dnd5e?.applications?.advancement?.AdvancementManager;
    const advTypes = ["class", "subclass", "background", "race", "species"];
    if (AM && advTypes.includes(item.type) && item.system.advancement?.length) {
      const manager = AM.forNewItem(this.actor, item.toObject());
      if (manager?.steps?.length) return manager.render(true);
    }
    const itemData = item.toObject();
    delete itemData._id;
    return this.actor.createEmbeddedDocuments("Item", [itemData]);
  }

  /* ----- action handlers ----- */
  static #item(target) { return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId); }

  static #onTab(event, target) {
    this.changeTab(target.dataset.tab, target.dataset.group ?? "primary", { event });
  }
  static #onRollAbility(event, target) {
    const ability = target.closest("[data-ability]").dataset.ability;
    if (this.actor.rollAbilityCheck) return this.actor.rollAbilityCheck({ ability, event });
    return this.actor.rollAbilityTest?.(ability, { event });
  }
  static #onRollSave(event, target) {
    const ability = target.closest("[data-ability]").dataset.ability;
    if (this.actor.rollSavingThrow) return this.actor.rollSavingThrow({ ability, event });
    return this.actor.rollAbilitySave?.(ability, { event });
  }
  static #onRollSkill(event, target) {
    const skill = target.closest("[data-skill]").dataset.skill;
    return NEW_ROLL_API() ? this.actor.rollSkill({ skill, event }) : this.actor.rollSkill(skill, { event });
  }
  static #onRollInit(event) { return this.actor.rollInitiativeDialog?.({ event }) ?? this.actor.rollInitiative({ createCombatants: true }); }
  static #onDeathSave(event) { return this.actor.rollDeathSave?.({ event }); }
  static #onRest(event, target) { return target.dataset.type === "long" ? this.actor.longRest() : this.actor.shortRest(); }
  static #onUseItem(event, target) { return HoloDossierSheet.#item.call(this, target)?.use({ event }); }
  static #onEditItem(event, target) { return HoloDossierSheet.#item.call(this, target)?.sheet.render(true); }
  static async #onDeleteItem(event, target) {
    const item = HoloDossierSheet.#item.call(this, target);
    if (!item) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: item.name }, content: `<p>${game.i18n.format("HOLOSHEET.ConfirmDelete", { name: item.name })}</p>`
    });
    if (ok) await item.delete();
  }
  static #onToggleEquip(event, target) {
    const item = HoloDossierSheet.#item.call(this, target);
    return item?.update({ "system.equipped": !item.system.equipped });
  }
  static async #onExpandItem(event, target) {
    const row = target.closest("[data-item-id]");
    const existing = row.querySelector(".holo-desc");
    if (existing) return existing.remove();
    const item = this.actor.items.get(row.dataset.itemId);
    const html = await TextEditorImpl().enrichHTML(item.system.description?.value ?? "", {
      secrets: item.isOwner, rollData: item.getRollData?.(), relativeTo: item
    });
    const div = document.createElement("div");
    div.className = "holo-desc";
    div.innerHTML = html || "<em>—</em>";
    row.append(div);
  }
  static #onCreateItem(event, target) {
    const type = target.dataset.type;
    const data = { name: `New ${loc(CONFIG.Item.typeLabels?.[type]) || type}`, type };
    if (target.dataset.school) data.system = { school: target.dataset.school, level: 0 };
    return this.actor.createEmbeddedDocuments("Item", [data]).then(([i]) => i?.sheet.render(true));
  }
  static #onEditImage(event, target) {
    if (!this.isEditable) return;
    const FP = FilePickerImpl();
    return new FP({ type: "image", current: this.actor.img, callback: (path) => this.actor.update({ img: path }) }).browse();
  }
  static #onToggleInspiration() { return this.actor.update({ "system.attributes.inspiration": !this.actor.system.attributes.inspiration }); }
}

/* ---------- registration ---------- */
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "sheetTheme", {
    name: "Character sheet theme", hint: "Each sheet can override this from its header.",
    scope: "client", config: true, type: String, default: "cyan",
    choices: Object.fromEntries(THEMES.map((t) => [t, `HOLOSHEET.Theme.${t}`])),
    onChange: () => [...foundry.applications.instances.values()]
      .filter((a) => a instanceof HoloDossierSheet).forEach((a) => a.render())
  });

  const sheetOpts = { types: ["character"], makeDefault: false, label: "HOLOSHEET.SheetLabel" };
  const DSC = foundry.applications.apps?.DocumentSheetConfig;
  if (DSC) DSC.registerSheet(Actor, `${MODULE_ID}-sheet`, HoloDossierSheet, sheetOpts);
  else Actors.registerSheet(`${MODULE_ID}-sheet`, HoloDossierSheet, sheetOpts);

  registerPartial("holo-terminal.sheet-item", `modules/${MODULE_ID}/sheet/templates/_item.hbs`);
});
