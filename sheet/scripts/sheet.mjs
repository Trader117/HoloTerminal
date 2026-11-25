/**
 * Holo-Terminal Dossier: an original SW5e character sheet for Foundry VTT v12 and v13.
 * Works with the dnd5e system (4.x / 5.x) plus sw5e-module, and degrades gracefully without the module.
 */
const MODULE_ID = "holo-terminal"; // the sheet ships inside the Holo-Terminal module
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const THEMES = ["sw5e", "cyan", "amber", "red", "green"];
const INVENTORY_TYPES = ["weapon", "equipment", "consumable", "tool", "container", "loot"];
const FORCE_SCHOOLS = ["lgt", "uni", "drk"];
const TECH_SCHOOLS = ["tec"];
const TPL = (name) => `modules/${MODULE_ID}/sheet/templates/${name}.hbs`;

/* ---------- v12 / v13 compatibility ---------- */
const TextEditorImpl = () => foundry.applications.ux?.TextEditor?.implementation ?? TextEditor;
const FilePickerImpl = () => foundry.applications.apps?.FilePicker?.implementation ?? FilePicker;
const DragDropImpl = () => foundry.applications.ux?.DragDrop?.implementation ?? DragDrop;
const NEW_ROLL_API = () => foundry.utils.isNewerVersion(game.system.version, "4.0.99");
async function registerPartial(name, path) {
  const getTpl = foundry.applications.handlebars?.getTemplate ?? getTemplate;
  Handlebars.registerPartial(name, await getTpl(path));
}

/* ---------- small helpers ---------- */
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const signed = (v) => (num(v) >= 0 ? `+${num(v)}` : `${num(v)}`);
const pct = (v, m) => (m > 0 ? Math.clamp(Math.round((v / m) * 100), 0, 100) : 0);
const cfg = () => CONFIG.DND5E ?? {};
const loc = (s) => (s ? game.i18n.localize(s) : "");
const toArray = (v) => (v instanceof Set ? [...v] : Array.isArray(v) ? v : v ? [v] : []);

/** Label for a trait key (language, weapon, armor, tool, damage type, condition) using dnd5e's own lookup. */
function traitLabel(trait, key) {
  try {
    const label = globalThis.dnd5e?.documents?.Trait?.keyLabel?.(key, { trait });
    if (label) return label;
  } catch { /* fall through */ }
  const C = cfg();
  const pools = { dr: C.damageTypes, di: C.damageTypes, dv: C.damageTypes, ci: C.conditionTypes, languages: C.languages };
  const found = findLabel(pools[trait], key);
  return found ?? key.replace(/^.*:/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
function findLabel(tree, key) {
  if (!tree) return null;
  for (const [k, v] of Object.entries(tree)) {
    if (k === key) return loc(typeof v === "string" ? v : v.label);
    if (v?.children) { const f = findLabel(v.children, key); if (f) return f; }
  }
  return null;
}
function traitList(trait, data) {
  if (!data) return [];
  const list = toArray(data.value).map((k) => traitLabel(trait, k));
  if (data.custom) list.push(...String(data.custom).split(";").map((s) => s.trim()).filter(Boolean));
  return list;
}

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
const ACT_ABBR = { action: "A", bonus: "BA", reaction: "R", minute: "1m", hour: "1h", day: "1d", special: "S", legendary: "L", crew: "C" };
const ACT_LABEL = { action: "Action", bonus: "Bonus Action", reaction: "Reaction", minute: "1 Minute", hour: "1 Hour", special: "Special", legendary: "Legendary" };
const RECOVERY = { sr: "SR", lr: "LR", day: "Day", dawn: "Dawn", dusk: "Dusk", charges: "Charges", turn: "Turn", round: "Round" };
const activities = (item) => item.system.activities?.contents ?? (item.system.activities ? [...item.system.activities] : []);
function activationOf(item) {
  return item.system.activation?.type || activities(item)[0]?.activation?.type || "";
}
function rangeOf(item) {
  const labels = item.labels ?? {};
  if (labels.range) return labels.range;
  const r = item.system.range ?? activities(item)[0]?.range ?? {};
  if (num(r.value)) return `${r.value}${num(r.long) ? "/" + r.long : ""} ${r.units ?? "ft"}`;
  return { self: "Self", touch: "Touch", spec: "Special", any: "Any" }[r.units] ?? "";
}
function rollOf(item) {
  const labels = item.labels ?? {};
  const acts = activities(item);
  const toHit = labels.toHit || acts.find((a) => a.type === "attack")?.labels?.toHit;
  if (toHit) return { hit: toHit };
  const save = acts.find((a) => a.type === "save");
  if (save) {
    const ability = [...(save.save?.ability ?? [])][0] ?? "";
    return { ability: ability.toUpperCase(), dc: save.save?.dc?.value ?? save.labels?.save ?? "" };
  }
  if (labels.save) return { text: labels.save };
  return null;
}
function recoveryOf(item) {
  const r = item.system.uses?.recovery;
  const period = Array.isArray(r) ? r[0]?.period : item.system.uses?.per;
  return RECOVERY[period] ?? (period ? String(period).toUpperCase() : "");
}
function typeLabelOf(item) {
  const s = item.system, C = cfg();
  if (s.type?.label) return s.type.label;
  const pools = { weapon: C.weaponTypes, equipment: C.equipmentTypes, consumable: C.consumableTypes, loot: C.lootTypes, feat: C.featureTypes, tool: C.toolTypes, container: null };
  const found = pools[item.type]?.[s.type?.value];
  return loc(found?.label ?? found) || "";
}

function itemPrice(item) {
  const p = item.system.price;
  if (!p || !num(p.value)) return "";
  return `${num(p.value).toLocaleString()} cr`;
}

/* ---------- the sheet ---------- */
export class HoloDossierSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["holo-sheet", "ht-frameless"],
    // the sheet lives on a Holo-Terminal tablet; the bezel moves it. Foundry's window frame is kept but hidden
    // (ht-frameless CSS) because v12 document sheets expect it to exist and fail to open without one.
    position: { width: 960, height: 820 },
    window: { frame: true, positioned: true, resizable: false },
    form: { submitOnChange: true },
    actions: {
      rollAbility: HoloDossierSheet.#onRollAbility,
      rollSave: HoloDossierSheet.#onRollSave,
      rollSkill: HoloDossierSheet.#onRollSkill,
      rollTool: HoloDossierSheet.#onRollTool,
      rollInit: HoloDossierSheet.#onRollInit,
      rollHitDie: HoloDossierSheet.#onRollHitDie,
      deathSave: HoloDossierSheet.#onDeathSave,
      rest: HoloDossierSheet.#onRest,
      useItem: HoloDossierSheet.#onUseItem,
      editItem: HoloDossierSheet.#onEditItem,
      deleteItem: HoloDossierSheet.#onDeleteItem,
      toggleEquip: HoloDossierSheet.#onToggleEquip,
      adjustQty: HoloDossierSheet.#onAdjustQty,
      toggleFavorite: HoloDossierSheet.#onToggleFavorite,
      expandItem: HoloDossierSheet.#onExpandItem,
      toggleContainer: HoloDossierSheet.#onToggleContainer,
      createItem: HoloDossierSheet.#onCreateItem,
      editImage: HoloDossierSheet.#onEditImage,
      toggleInspiration: HoloDossierSheet.#onToggleInspiration,
      toggleMode: HoloDossierSheet.#onToggleMode,
      toggleCondition: HoloDossierSheet.#onToggleCondition,
      setExhaustion: HoloDossierSheet.#onSetExhaustion,
      createEffect: HoloDossierSheet.#onCreateEffect,
      editEffect: HoloDossierSheet.#onEditEffect,
      toggleEffect: HoloDossierSheet.#onToggleEffect,
      deleteEffect: HoloDossierSheet.#onDeleteEffect,
      editTraits: HoloDossierSheet.#onEditTraits,
      holoTab: HoloDossierSheet.#onTab,
      closeSheet: HoloDossierSheet.#onCloseSheet,
      configureSheet: HoloDossierSheet.#onConfigureSheet,
      configurePrototypeToken: HoloDossierSheet.#onConfigureToken
    }
  };

  static PARTS = {
    header: { template: TPL("header") },
    sidebar: { template: TPL("sidebar") },
    nav: { template: TPL("nav") },
    overview: { template: TPL("overview") },
    combat: { template: TPL("combat") },
    powers: { template: TPL("powers") },
    gear: { template: TPL("gear") },
    features: { template: TPL("features") },
    effects: { template: TPL("effects") },
    bio: { template: TPL("bio") }
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
        { id: "effects", icon: "fa-solid fa-bolt", label: "HOLOSHEET.Tab.Effects" },
        { id: "bio", icon: "fa-solid fa-book", label: "HOLOSHEET.Tab.Bio" }
      ]
    }
  };

  /** Play mode locks scores and names; Edit mode unlocks them. */
  _editMode = false;
  /** Containers the user has opened, and the current inventory filter. */
  _openContainers = new Set();
  _search = {};
  #dragDrop = null;

  get title() { return this.actor.name; }

  /* ----- context ----- */
  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const actor = this.actor, sys = actor.system, attr = sys.attributes ?? {};
    const C = cfg();
    ctx.editable ??= this.isEditable;
    ctx.editMode = this._editMode && ctx.editable;
    ctx.actor = actor;
    ctx.system = sys;
    ctx.tabs = this.#prepareTabs("primary");
    const theme = game.settings.get(MODULE_ID, "sheetTheme");
    ctx.theme = THEMES.includes(theme) ? theme : "sw5e";

    /* identity */
    const classes = actor.itemTypes.class ?? [];
    const subclasses = actor.itemTypes.subclass ?? [];
    ctx.classLine = classes.map((c) => {
      const sub = subclasses.find((s) => s.system.classIdentifier === c.system.identifier);
      return `${c.name}${sub ? ` (${sub.name})` : ""} ${c.system.levels ?? ""}`.trim();
    }).join(" / ");
    ctx.species = (actor.itemTypes.race ?? actor.itemTypes.species ?? [])[0]?.name ?? "";
    ctx.background = (actor.itemTypes.background ?? [])[0]?.name ?? "";
    ctx.level = num(sys.details?.level);
    const xp = sys.details?.xp ?? {};
    ctx.xp = { value: num(xp.value), max: num(xp.max), pct: num(xp.pct, pct(num(xp.value) - num(xp.min), num(xp.max) - num(xp.min))) };
    ctx.alignment = sys.details?.alignment ?? "";

    /* vitals */
    const hp = attr.hp ?? {};
    const hpMax = num(hp.max) + num(hp.tempmax);
    ctx.hp = { value: num(hp.value), max: hpMax, temp: num(hp.temp), pct: pct(num(hp.value), hpMax), tempPct: pct(num(hp.temp), hpMax) };
    ctx.hp.state = ctx.hp.pct <= 25 ? "critical" : ctx.hp.pct <= 50 ? "hurt" : "ok";
    ctx.ac = attr.ac?.value ?? "—";
    ctx.init = signed(attr.init?.total ?? attr.init?.mod);
    ctx.prof = signed(attr.prof);
    const mv = attr.movement ?? {};
    ctx.speed = `${num(mv.walk)} ${mv.units ?? "ft"}`;
    const fastest = ["walk", "fly", "swim", "climb", "burrow"].reduce((best, k) => (num(mv[k]) > num(mv[best]) && k !== "walk" && !num(mv.walk) ? k : best), "walk");
    ctx.speedValue = num(mv[fastest]);
    ctx.speedLabel = fastest === "walk" ? "Walk" : fastest[0].toUpperCase() + fastest.slice(1);
    ctx.otherSpeeds = ["fly", "swim", "climb", "burrow"].filter((k) => num(mv[k])).map((k) => `${k} ${num(mv[k])}`).join(", ");
    ctx.death = { success: num(attr.death?.success), failure: num(attr.death?.failure), show: ctx.hp.value <= 0 && ctx.hp.max > 0 };
    ctx.death.successPips = [1, 2, 3].map((n) => n <= ctx.death.success);
    ctx.death.failurePips = [1, 2, 3].map((n) => n <= ctx.death.failure);
    ctx.inspiration = !!attr.inspiration;
    const exh = num(attr.exhaustion);
    ctx.exhaustion = { level: exh, pips: Array.from({ length: 6 }, (_, i) => ({ n: i + 1, on: i < exh })) };

    /* hit dice per class */
    ctx.hitDice = classes.map((c) => {
      const hd = c.system.hd ?? {};
      const denom = hd.denomination ?? c.system.hitDice ?? "d8";
      const max = num(hd.max, num(c.system.levels));
      const spent = num(hd.spent ?? c.system.hitDiceUsed);
      return { denom, value: Math.max(0, max - spent), max };
    }).filter((h) => h.max > 0);
    const hdValue = ctx.hitDice.reduce((t, h) => t + h.value, 0), hdMax = ctx.hitDice.reduce((t, h) => t + h.max, 0);
    const nextDie = [...ctx.hitDice].filter((h) => h.value > 0).sort((a, b) => num(b.denom.slice(1)) - num(a.denom.slice(1)))[0];
    ctx.hd = { value: hdValue, max: hdMax, pct: pct(hdValue, hdMax), denom: nextDie?.denom ?? "", show: hdMax > 0,
      tip: ctx.hitDice.map((h) => `${h.value}/${h.max} ${h.denom}`).join(", ") };

    /* abilities + saves */
    ctx.abilities = Object.entries(sys.abilities ?? {}).map(([k, a]) => {
      const save = typeof a.save === "object" ? a.save?.value : a.save;
      return {
        key: k, value: a.value, mod: signed(a.mod), save: signed(save), proficient: num(a.proficient) > 0,
        label: loc(C.abilities?.[k]?.label) || k, abbr: (loc(C.abilities?.[k]?.abbreviation) || k).toUpperCase()
      };
    });

    ctx.saves = ctx.abilities.map((a) => ({ key: a.key, label: a.label, save: a.save, proficient: a.proficient }));

    /* skills and tools (sw5e-module rewrites CONFIG.DND5E.skills to the SW5e list) */
    const profIcons = { 0: "fa-regular fa-circle", 0.5: "fa-solid fa-circle-half-stroke", 1: "fa-solid fa-circle", 2: "fa-solid fa-circle-dot" };
    const profTips = { 0: "Not proficient", 0.5: "Half proficiency", 1: "Proficient", 2: "Expertise" };
    ctx.skills = Object.entries(sys.skills ?? {})
      .filter(([k]) => !C.skills || k in C.skills)
      .map(([k, s]) => ({
        key: k, label: loc(C.skills?.[k]?.label) || k, total: signed(s.total ?? s.mod), passive: s.passive,
        ability: (s.ability ?? "").toUpperCase(), icon: profIcons[num(s.value)] ?? profIcons[0], tip: profTips[num(s.value)] ?? "",
        proficient: num(s.value) > 0
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    ctx.tools = Object.entries(sys.tools ?? {}).map(([k, t]) => ({
      key: k, label: traitLabel("tool", k), total: signed(t.total ?? t.mod ?? 0),
      ability: (t.ability ?? "").toUpperCase(), icon: profIcons[num(t.value)] ?? profIcons[0]
    })).sort((a, b) => a.label.localeCompare(b.label));

    /* traits for the sidebar */
    const senses = attr.senses ?? {};
    const senseList = ["darkvision", "blindsight", "tremorsense", "truesight"]
      .filter((k) => num(senses[k])).map((k) => `${k[0].toUpperCase()}${k.slice(1)} ${num(senses[k])} ${senses.units ?? "ft"}`);
    if (senses.special) senseList.push(senses.special);
    const tr = sys.traits ?? {};
    ctx.traits = [
      { label: "Senses", icon: "fa-solid fa-eye", trait: "senses", values: senseList },
      { label: "Armor", icon: "fa-solid fa-shield-halved", trait: "armor", values: traitList("armor", tr.armorProf) },
      { label: "Weapons", icon: "fa-solid fa-khanda", trait: "weapon", values: traitList("weapon", tr.weaponProf) },
      { label: "Languages", icon: "fa-solid fa-flag", trait: "languages", values: traitList("languages", tr.languages) },
      { label: "Resistances", icon: "fa-solid fa-shield-heart", trait: "dr", values: traitList("dr", tr.dr) },
      { label: "Immunities", icon: "fa-solid fa-shield", trait: "di", values: [...traitList("di", tr.di), ...traitList("ci", tr.ci)] },
      { label: "Vulnerabilities", icon: "fa-solid fa-heart-crack", trait: "dv", values: traitList("dv", tr.dv) }
    ].filter((t) => t.values.length);
    ctx.size = loc(C.actorSizes?.[tr.size]?.label ?? C.actorSizes?.[tr.size]) || "";
    const speciesItem = (actor.itemTypes.race ?? actor.itemTypes.species ?? [])[0];
    const bgItem = (actor.itemTypes.background ?? [])[0];
    ctx.identityCards = [
      speciesItem && { id: speciesItem.id, img: speciesItem.img, name: speciesItem.name, sub: ["Species", ctx.size].filter(Boolean).join(" · ") },
      bgItem && { id: bgItem.id, img: bgItem.img, name: bgItem.name, sub: "Background" }
    ].filter(Boolean);
    ctx.classCards = classes.map((c) => {
      const sub = subclasses.find((x) => x.system.classIdentifier === c.system.identifier);
      return { id: c.id, img: c.img, subImg: sub?.img, name: c.name, sub: sub?.name ?? "", levels: c.system.levels };
    });

    /* conditions */
    const statuses = actor.statuses ?? new Set();
    ctx.conditions = (CONFIG.statusEffects ?? [])
      .filter((s) => s.id !== "dead" && s.id !== "exhaustion" && (s.name || s.label))
      .map((s) => ({ id: s.id, name: loc(s.name ?? s.label), img: s.img ?? s.icon, active: statuses.has(s.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    ctx.activeConditions = ctx.conditions.filter((c) => c.active);

    /* resources */
    const fp = pool(sys, "force"), tp = pool(sys, "tech");
    ctx.force = { ...resource(fp.data), path: fp.path };
    ctx.tech = { ...resource(tp.data), path: tp.path };
    ctx.superiority = sys.superiority ? { ...resource(sys.superiority.dice), die: sys.superiority.die ? `d${sys.superiority.die}` : "" } : { show: false };
    ctx.hasSW5e = !!(fp.data || tp.data);

    /* favourites (dnd5e stores these on system.favorites as relative item uuids) */
    const favIds = new Set();
    const favs = [];
    for (const f of sys.favorites ?? []) {
      if (f.type !== "item") continue;
      const id = String(f.id).split(".").pop();
      const item = actor.items.get(id);
      if (item) { favIds.add(id); favs.push(item); }
    }
    const row = (item) => this.#itemRow(item, favIds);
    ctx.favorites = favs.map(row);
    ctx.canFavorite = typeof sys.addFavorite === "function";

    /* powers */
    const spells = actor.itemTypes.spell ?? [];
    const schoolCfg = C.spellSchools ?? {};
    const groupPowers = (list, castType) => {
      const levels = new Map();
      for (const p of list.sort((a, b) => (a.system.level - b.system.level) || a.name.localeCompare(b.name))) {
        const lvl = num(p.system.level);
        if (!levels.has(lvl)) levels.set(lvl, { level: lvl, label: lvl === 0 ? loc("HOLOSHEET.AtWill") : `${loc("HOLOSHEET.Level")} ${lvl}`, powers: [] });
        const school = p.system.school ?? "";
        levels.get(lvl).powers.push({
          ...row(p), school, schoolLabel: loc(schoolCfg[school]?.label) || school,
          cost: castType && lvl > 0 ? lvl + 1 : 0, concentration: p.system.properties?.has?.("concentration") ?? false
        });
      }
      return [...levels.values()];
    };
    const pc = sys.powercasting ?? {};
    const schoolInfo = (castType, keys) => keys
      .filter((k) => pc[castType]?.schools?.[k])
      .map((k) => {
        const s = pc[castType].schools[k];
        return { key: k, label: loc(schoolCfg[k]?.label) || k, dc: s.dc ?? "—", attack: s.attr ? signed(sys.abilities?.[s.attr]?.attack) : "—",
          mod: s.attr ? signed(sys.abilities?.[s.attr]?.mod) : "—", attr: (s.attr ?? "").toUpperCase() };
      });
    ctx.forcePowers = groupPowers(spells.filter((p) => FORCE_SCHOOLS.includes(p.system.school)), "force");
    ctx.techPowers = groupPowers(spells.filter((p) => TECH_SCHOOLS.includes(p.system.school)), "tech");
    ctx.otherPowers = groupPowers(spells.filter((p) => ![...FORCE_SCHOOLS, ...TECH_SCHOOLS].includes(p.system.school)), null);
    ctx.forceSchools = schoolInfo("force", FORCE_SCHOOLS);
    ctx.techSchools = schoolInfo("tech", TECH_SCHOOLS);
    // only show the casting a character actually uses: points to spend or powers of that kind
    const usesForce = ctx.force.max > 0 || ctx.forcePowers.length > 0, usesTech = ctx.tech.max > 0 || ctx.techPowers.length > 0;
    ctx.castCards = [
      usesForce && ctx.forceSchools.length && { label: "Forcecasting", cls: "holo-force", points: ctx.force, schools: ctx.forceSchools },
      usesTech && ctx.techSchools.length && { label: "Techcasting", cls: "holo-tech", points: ctx.tech, schools: ctx.techSchools }
    ].filter(Boolean);
    ctx.powerCount = spells.length;

    /* combat */
    ctx.weapons = (actor.itemTypes.weapon ?? []).map(row).sort((a, b) => b.equipped - a.equipped);
    const actionTypes = new Set(["action", "bonus", "reaction"]);
    const feats = actor.itemTypes.feat ?? [];
    const actionRows = feats.map(row).filter((f) => actionTypes.has(f.activation));
    ctx.actionGroups = [
      { label: "Actions", items: actionRows.filter((f) => f.activation === "action") },
      { label: "Bonus Actions", items: actionRows.filter((f) => f.activation === "bonus") },
      { label: "Reactions", items: actionRows.filter((f) => f.activation === "reaction") }
    ].filter((g) => g.items.length);
    ctx.maneuvers = actor.items.filter((i) => i.type.endsWith("maneuver")).map(row);

    /* gear */
    ctx.credits = sys.currency?.gc ?? sys.currency?.gp ?? 0;
    ctx.creditsKey = sys.currency && "gc" in sys.currency ? "gc" : "gp";
    const contents = (containerId) => actor.items.filter((i) => i.system.container === containerId).map(row);
    ctx.gear = INVENTORY_TYPES.map((type) => ({
      type, label: loc(CONFIG.Item.typeLabels?.[type]) || type,
      items: (actor.itemTypes[type] ?? []).filter((i) => !i.system.container).map((i) => {
        const r = row(i);
        if (i.type === "container") {
          r.isContainer = true;
          r.open = this._openContainers.has(i.id);
          r.contents = contents(i.id);
          r.count = r.contents.length;
        }
        return r;
      })
    }));
    const enc = attr.encumbrance ?? {};
    ctx.encumbrance = { value: Math.round(num(enc.value) * 10) / 10, max: num(enc.max), pct: num(enc.pct, pct(num(enc.value), num(enc.max))) };
    ctx.encumbrance.state = ctx.encumbrance.pct >= 100 ? "critical" : ctx.encumbrance.pct >= 66 ? "hurt" : "ok";
    ctx.search = this._search;

    /* features */
    const featGroups = { class: [], race: [], background: [], feat: [], other: [] };
    for (const f of feats) {
      const t = f.system.type?.value;
      (featGroups[t === "species" ? "race" : t] ?? featGroups.other).push(row(f));
    }
    ctx.featureGroups = [
      { label: "Class Features", items: featGroups.class },
      { label: "Species Traits", items: featGroups.race },
      { label: "Background", items: featGroups.background },
      { label: "Feats", items: featGroups.feat },
      { label: "Other", items: featGroups.other }
    ].filter((g) => g.items.length);
    ctx.identityItems = [...classes, ...subclasses, ...(actor.itemTypes.race ?? []), ...(actor.itemTypes.background ?? [])].map(row);

    /* effects */
    const allEffects = actor.allApplicableEffects ? [...actor.allApplicableEffects()] : [...actor.effects];
    const fx = allEffects.filter((e) => !e.statuses?.size || e.statuses.size > 1 || !ctx.conditions.some((c) => e.statuses.has(c.id)))
      .map((e) => ({
        uuid: e.uuid, name: e.name ?? e.label, img: e.img ?? e.icon, disabled: e.disabled,
        source: e.parent && e.parent !== actor ? e.parent.name : "", duration: e.duration?.label ?? "",
        temporary: e.isTemporary
      }));
    ctx.effectGroups = [
      { label: "Temporary", type: "temporary", items: fx.filter((e) => e.temporary && !e.disabled) },
      { label: "Passive", type: "passive", items: fx.filter((e) => !e.temporary && !e.disabled) },
      { label: "Inactive", type: "inactive", items: fx.filter((e) => e.disabled) }
    ];

    /* bio */
    const details = sys.details ?? {};
    const bio = details.biography?.value ?? "";
    ctx.bioValue = bio;
    ctx.bioHTML = await TextEditorImpl().enrichHTML(bio, { secrets: actor.isOwner, rollData: actor.getRollData(), relativeTo: actor });
    ctx.personality = [
      { key: "trait", label: "Personality", value: details.trait ?? "" },
      { key: "ideal", label: "Ideal", value: details.ideal ?? "" },
      { key: "bond", label: "Bond", value: details.bond ?? "" },
      { key: "flaw", label: "Flaw", value: details.flaw ?? "" }
    ];
    ctx.appearance = details.appearance ?? "";
    return ctx;
  }

  #itemRow(item, favIds) {
    const s = item.system;
    const act = activationOf(item);
    const typeLabel = typeLabelOf(item);
    const uses = itemUses(item);
    return {
      subtitle: [typeLabel, ACT_LABEL[act]].filter(Boolean).join(" · "),
      time: ACT_ABBR[act] ?? "", range: rangeOf(item), roll: rollOf(item), recovery: recoveryOf(item),
      damage: (() => { const d = item.labels?.damages ?? item.labels?.damage; return Array.isArray(d) ? d.map((x) => x.label ?? x.formula).filter(Boolean).join(" + ") : (d || ""); })(),
      id: item.id, name: item.name, img: item.img, type: item.type,
      quantity: s.quantity ?? null, hasQty: Number.isFinite(s.quantity),
      weight: num(s.weight?.value ?? s.weight) || "",
      price: itemPrice(item).replace(" cr", ""),
      equipped: !!s.equipped, equippable: "equipped" in s,
      uses: itemUses(item), summary: itemSummary(item),
      favorite: favIds.has(item.id),
      activation: act
    };
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

  /**
   * Parts render as siblings; this moves them into the tablet: header, sidebar and tab bodies go on
   * the screen, and the nav part becomes the key row under it. Re-renders replace parts in place.
   */
  _replaceHTML(result, content, options) {
    super._replaceHTML(result, content, options);
    let device = content.querySelector(":scope > .ht-device");
    if (!device) {
      device = document.createElement("div");
      device.className = "ht-device holo-device";
      device.innerHTML = `<div class="ht-bezel-top" title="Drag to move"></div>
        <span class="ht-rail ht-rail-l"></span><span class="ht-rail ht-rail-r"></span>
        <div class="ht-screen holo-screen"></div>
        <span class="holo-grip" title="Drag to resize"></span>`;
      content.prepend(device);
    }
    const screen = device.querySelector(".holo-screen");
    for (const part of content.querySelectorAll(":scope > [data-application-part]")) {
      if (part.dataset.applicationPart === "nav") screen.after(part);
      else screen.append(part);
    }
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    const drag = (handle, apply) => handle?.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const start = { x: ev.clientX, y: ev.clientY, ...this.position };
      const move = (e) => this.setPosition(apply(start, e.clientX - start.x, e.clientY - start.y));
      const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    drag(this.element.querySelector(".ht-bezel-top"), (s, dx, dy) => ({ left: s.left + dx, top: s.top + dy }));
    drag(this.element.querySelector(".holo-grip"), (s, dx, dy) => ({
      width: Math.max(720, s.width + dx / (s.scale || 1)), height: Math.max(560, s.height + dy / (s.scale || 1)) }));
    // shrink the whole tablet with the "Datapad & tablet size" setting, and never let it run off the bottom of the screen
    const scale = game.settings.get(MODULE_ID, "tabletScale") ?? 1;
    const fitH = Math.floor((window.innerHeight - 16) / scale);
    const height = Math.max(560, Math.min(this.position.height, fitH));
    const top = Math.max(8, Math.min(this.position.top ?? 8, window.innerHeight - height * scale - 8));
    this.setPosition({ scale, height, top });
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    el.classList.remove(...THEMES.map((t) => `holo-theme-${t}`));
    el.classList.add(`holo-theme-${context.theme}`);
    el.classList.toggle("holo-edit", context.editMode);
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

    // relative entries like "-7" or "+3" in number fields
    el.querySelectorAll("input[data-delta]").forEach((input) => {
      input.addEventListener("change", () => {
        const v = input.value.trim();
        if (/^[+-]\d+$/.test(v)) input.value = num(input.dataset.current) + Number(v);
      });
      input.addEventListener("focus", () => input.select());
    });
    // inline item fields (quantity, uses) edit the item, not the actor
    el.querySelectorAll("input[data-item-field]").forEach((input) => {
      input.addEventListener("change", async (ev) => {
        ev.stopPropagation();
        const item = this.actor.items.get(input.closest("[data-item-id]")?.dataset.itemId);
        if (!item) return;
        const field = input.dataset.itemField;
        let value = input.value.trim();
        const current = num(foundry.utils.getProperty(item, field));
        value = /^[+-]\d+$/.test(value) ? current + Number(value) : num(value, current);
        if (field === "system.uses.value") return item.update({ "system.uses.spent": num(item.system.uses?.max) - value });
        return item.update({ [field]: value });
      });
      input.addEventListener("focus", () => input.select());
    });
    // list search boxes (gear, powers, features), filtered in place
    el.querySelectorAll("input.holo-search").forEach((search) => {
      const scope = search.dataset.scope;
      const section = search.closest("section.tab");
      const apply = () => {
        const q = search.value.trim().toLowerCase();
        this._search[scope] = search.value;
        section.querySelectorAll(".holo-item").forEach((li) => {
          const name = li.querySelector(".holo-item-name")?.textContent.toLowerCase() ?? "";
          li.hidden = !!q && !name.includes(q) && !li.querySelector(".holo-contents")?.textContent.toLowerCase().includes(q);
        });
      };
      search.addEventListener("input", apply);
      search.addEventListener("change", (ev) => ev.stopPropagation());
      apply();
    });
  }

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
    if (!this.isEditable) return;
    if (data?.type === "ActiveEffect") {
      const effect = await ActiveEffect.implementation.fromDropData(data);
      if (effect && effect.parent !== this.actor) return this.actor.createEmbeddedDocuments("ActiveEffect", [effect.toObject()]);
      return;
    }
    if (data?.type !== "Item") return;
    const item = await Item.implementation.fromDropData(data);
    if (!item) return;
    // dropping onto a container moves the item into it
    const containerId = event.target.closest?.("[data-container-id]")?.dataset.containerId;
    if (item.parent === this.actor) {
      if (containerId !== undefined && containerId !== item.id && item.system.container !== (containerId || null)) {
        return item.update({ "system.container": containerId || null });
      }
      return;
    }
    // SW5e class/species/background items run dnd5e advancement (level-up) when dropped.
    const AM = globalThis.dnd5e?.applications?.advancement?.AdvancementManager;
    const advTypes = ["class", "subclass", "background", "race", "species"];
    if (AM && advTypes.includes(item.type) && item.system.advancement?.length) {
      const manager = AM.forNewItem(this.actor, item.toObject());
      if (manager?.steps?.length) return manager.render(true);
    }
    const itemData = item.toObject();
    delete itemData._id;
    if (containerId) foundry.utils.setProperty(itemData, "system.container", containerId);
    return this.actor.createEmbeddedDocuments("Item", [itemData]);
  }

  /* ----- action handlers ----- */
  static #item(target) { return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId); }
  static #effect(target) { return fromUuidSync(target.closest("[data-effect-uuid]")?.dataset.effectUuid); }

  static #onTab(event, target) {
    const group = target.dataset.group ?? "primary";
    this.changeTab(target.dataset.tab, group, { event });
    // the tablet keys sit outside Foundry's usual nav lookup, so mark the lit key here too
    this.element.querySelectorAll(`.ht-key[data-group="${group}"]`).forEach((k) => k.classList.toggle("active", k.dataset.tab === target.dataset.tab));
  }
  static #onCloseSheet() { return this.close(); }
  /* the frameless tablet has no window header, so its Sheet and Token buttons live in the sheet header */
  static #onConfigureSheet() {
    if (game.release.generation >= 13) return new foundry.applications.apps.DocumentSheetConfig({ document: this.document }).render({ force: true });
    return new DocumentSheetConfig(this.document).render(true);
  }
  static #onConfigureToken() {
    if (this.token) return this.token.sheet.render(true);
    const Cls = CONFIG.Token.prototypeSheetClass;
    if (game.release.generation >= 13) return new Cls({ prototype: this.actor.prototypeToken }).render({ force: true });
    return new Cls(this.actor.prototypeToken).render(true);
  }
  static #onToggleMode() { this._editMode = !this._editMode; this.render(); }

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
  static #onRollTool(event, target) {
    const tool = target.closest("[data-tool]").dataset.tool;
    return NEW_ROLL_API() ? this.actor.rollToolCheck?.({ tool, event }) : this.actor.rollToolCheck?.(tool, { event });
  }
  static #onRollInit(event) { return this.actor.rollInitiativeDialog?.({ event }) ?? this.actor.rollInitiative({ createCombatants: true }); }
  static #onRollHitDie(event, target) {
    const denomination = target.dataset.denom;
    return NEW_ROLL_API() ? this.actor.rollHitDie({ denomination }) : this.actor.rollHitDie(denomination);
  }
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
  static #onAdjustQty(event, target) {
    const item = HoloDossierSheet.#item.call(this, target);
    if (!item) return;
    return item.update({ "system.quantity": Math.max(0, num(item.system.quantity) + num(target.dataset.step)) });
  }
  static async #onToggleFavorite(event, target) {
    const item = HoloDossierSheet.#item.call(this, target);
    const sys = this.actor.system;
    if (!item || typeof sys.addFavorite !== "function") return;
    const id = item.getRelativeUUID ? item.getRelativeUUID(this.actor) : `.Item.${item.id}`;
    return sys.hasFavorite?.(id) ? sys.removeFavorite(id) : sys.addFavorite({ type: "item", id });
  }
  static async #onExpandItem(event, target) {
    const row = target.closest("[data-item-id]");
    const existing = row.querySelector(":scope > .holo-desc");
    if (existing) return existing.remove();
    const item = this.actor.items.get(row.dataset.itemId);
    const html = await TextEditorImpl().enrichHTML(item.system.description?.value ?? "", {
      secrets: item.isOwner, rollData: item.getRollData?.(), relativeTo: item
    });
    const div = document.createElement("div");
    div.className = "holo-desc";
    div.innerHTML = html || "<em>No description.</em>";
    row.querySelector(":scope > .holo-item-row").after(div);
  }
  static #onToggleContainer(event, target) {
    const id = target.closest("[data-item-id]").dataset.itemId;
    if (this._openContainers.has(id)) this._openContainers.delete(id); else this._openContainers.add(id);
    this.render();
  }
  static #onCreateItem(event, target) {
    const type = target.dataset.type;
    const data = { name: `New ${loc(CONFIG.Item.typeLabels?.[type]) || type}`, type };
    if (target.dataset.school) data.system = { school: target.dataset.school, level: 0 };
    return this.actor.createEmbeddedDocuments("Item", [data]).then(([i]) => i?.sheet.render(true));
  }
  static #onEditImage() {
    if (!this.isEditable) return;
    const FP = FilePickerImpl();
    return new FP({ type: "image", current: this.actor.img, callback: (path) => this.actor.update({ img: path }) }).browse();
  }
  static #onToggleInspiration() { return this.actor.update({ "system.attributes.inspiration": !this.actor.system.attributes.inspiration }); }
  static #onToggleCondition(event, target) { return this.actor.toggleStatusEffect?.(target.dataset.conditionId); }
  static #onSetExhaustion(event, target) {
    const n = num(target.dataset.level);
    const current = num(this.actor.system.attributes.exhaustion);
    return this.actor.update({ "system.attributes.exhaustion": current === n ? n - 1 : n });
  }
  static #onCreateEffect(event, target) {
    const type = target.dataset.type;
    const data = { name: "New Effect", img: "icons/svg/aura.svg", origin: this.actor.uuid, disabled: type === "inactive" };
    if (type === "temporary") data.duration = { rounds: 1 };
    return this.actor.createEmbeddedDocuments("ActiveEffect", [data]).then(([e]) => e?.sheet.render(true));
  }
  static #onEditEffect(event, target) { return HoloDossierSheet.#effect.call(this, target)?.sheet.render(true); }
  static #onToggleEffect(event, target) {
    const effect = HoloDossierSheet.#effect.call(this, target);
    return effect?.update({ disabled: !effect.disabled });
  }
  static async #onDeleteEffect(event, target) {
    const effect = HoloDossierSheet.#effect.call(this, target);
    if (!effect) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: effect.name }, content: `<p>${game.i18n.format("HOLOSHEET.ConfirmDelete", { name: effect.name })}</p>`
    });
    if (ok) await effect.delete();
  }
  /** Open dnd5e's own trait editor (languages, proficiencies, resistances) when it is available. */
  static #onEditTraits(event, target) {
    const trait = target.dataset.trait;
    const apps = globalThis.dnd5e?.applications?.actor;
    const Config = apps?.TraitsConfig ?? apps?.TraitSelector;
    if (trait === "senses" && apps?.SensesConfig) return new apps.SensesConfig({ document: this.actor }).render(true);
    if (Config && trait !== "senses") {
      try { return new Config({ document: this.actor, trait }).render(true); } catch { return new Config(this.actor, { trait }).render(true); }
    }
    ui.notifications.info("Edit this in the dnd5e sheet: Sheet button in the window header.");
  }
}

/* ---------- registration ---------- */
Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "sheetTheme", {
    name: "Character sheet theme", hint: "SW5e Database matches the rest of Holo-Terminal; the holo styles are alternates.",
    scope: "client", config: true, type: String, default: "sw5e",
    choices: Object.fromEntries(THEMES.map((t) => [t, `HOLOSHEET.Theme.${t}`])),
    onChange: () => [...foundry.applications.instances.values()]
      .filter((a) => a instanceof HoloDossierSheet).forEach((a) => a.render())
  });

  const sheetOpts = { types: ["character"], makeDefault: false, label: "HOLOSHEET.SheetLabel" };
  const DSC = foundry.applications.apps?.DocumentSheetConfig;
  if (DSC) DSC.registerSheet(Actor, `${MODULE_ID}-sheet`, HoloDossierSheet, sheetOpts);
  else Actors.registerSheet(`${MODULE_ID}-sheet`, HoloDossierSheet, sheetOpts);

  registerPartial("holo-terminal.sheet-row", TPL("_row"));
});
