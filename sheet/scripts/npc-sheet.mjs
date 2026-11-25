/**
 * Holo-Terminal Stat Block: an NPC sheet on the same datapad tablet as the character sheet.
 * Reads like a printed stat block (abilities, properties, traits and actions with their text inline),
 * but every name, save and skill rolls, and HP, legendary actions and recharges are tracked in place.
 */
import {
  HoloDossierSheet, TPL, num, signed, pct, cfg, loc, traitList, activationOf, rangeOf, rollOf, itemUses, RECOVERY, TextEditorImpl
} from "./sheet.mjs";

const MODULE_ID = "holo-terminal";
const NPC_TPL = (name) => TPL(`npc/${name}`);
const ACTION_ITEM_TYPES = new Set(["feat", "weapon"]);
const SECTIONS = [
  { key: "trait", label: "Traits", always: true },
  { key: "action", label: "Actions", always: true },
  { key: "bonus", label: "Bonus Actions" },
  { key: "reaction", label: "Reactions" },
  { key: "legendary", label: "Legendary Actions" },
  { key: "lair", label: "Lair Actions" }
];
const CR_FRACTIONS = { 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" };
const crLabel = (cr) => (cr === null || cr === undefined || cr === "" ? "—" : CR_FRACTIONS[Number(cr)] ?? String(cr));

/** Recharge (dnd5e 4.x: a "recharge" recovery entry; 3.x: system.recharge). */
function rechargeOf(item) {
  const uses = item.system.uses ?? {};
  const rec = Array.isArray(uses.recovery) ? uses.recovery.find((r) => r.period === "recharge") : null;
  let formula = rec ? num(rec.formula, 6) : num(item.system.recharge?.value);
  if (!formula) return null;
  formula = Math.clamp(formula, 2, 6);
  const charged = rec ? num(uses.value) > 0 : !!item.system.recharge?.charged;
  const range = formula >= 6 ? "6" : `${formula}–6`;
  return { formula, charged, label: `Recharge ${range}`, short: range };
}

/** Open one of dnd5e's own config apps, whichever generation (AppV1 or AppV2) this version ships. */
function openConfig(actor, names, extra = {}) {
  const apps = globalThis.dnd5e?.applications?.actor ?? {};
  const Cls = names.map((n) => apps[n]).find(Boolean);
  if (!Cls) return false;
  const V2 = foundry.applications.api.ApplicationV2;
  const app = V2 && Cls.prototype instanceof V2 ? new Cls({ document: actor, ...extra }) : new Cls(actor, extra);
  app.render(true);
  return true;
}

export class HoloNpcSheet extends HoloDossierSheet {
  static DEFAULT_OPTIONS = {
    classes: ["holo-npc"],
    position: { width: 940, height: 820 },
    actions: {
      rollNpcHp: HoloNpcSheet.#onRollHp,
      rollRecharge: HoloNpcSheet.#onRollRecharge,
      setLegendary: HoloNpcSheet.#onSetLegendary,
      toggleAllSkills: HoloNpcSheet.#onToggleAllSkills,
      createNpcFeature: HoloNpcSheet.#onCreateFeature,
      npcConfig: HoloNpcSheet.#onConfig
    }
  };

  static PARTS = {
    header: { template: NPC_TPL("header") },
    sidebar: { template: NPC_TPL("sidebar") },
    nav: { template: NPC_TPL("nav") },
    statblock: { template: NPC_TPL("statblock") },
    powers: { template: TPL("powers") },
    gear: { template: TPL("gear") },
    effects: { template: TPL("effects") },
    notes: { template: NPC_TPL("notes") }
  };

  static TAB_LIST = {
    primary: {
      initial: "statblock",
      tabs: [
        { id: "statblock", icon: "fa-solid fa-scroll", label: "HOLOSHEET.Tab.StatBlock" },
        { id: "powers", icon: "fa-solid fa-atom", label: "HOLOSHEET.Tab.Powers" },
        { id: "gear", icon: "fa-solid fa-box-open", label: "HOLOSHEET.Tab.Gear" },
        { id: "effects", icon: "fa-solid fa-bolt", label: "HOLOSHEET.Tab.Effects" },
        { id: "notes", icon: "fa-solid fa-book", label: "HOLOSHEET.Tab.Notes" }
      ]
    }
  };

  _allSkills = false;

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const actor = this.actor, sys = actor.system, attr = sys.attributes ?? {}, details = sys.details ?? {};
    const C = cfg();

    /* identity */
    const type = details.type ?? {};
    const typeName = type.value === "custom" ? type.custom : loc(C.creatureTypes?.[type.value]?.label ?? C.creatureTypes?.[type.value]);
    ctx.creatureType = actor.labels?.creatureType
      || [ctx.size, typeName, type.subtype ? `(${type.subtype})` : ""].filter(Boolean).join(" ");
    if (ctx.size && ctx.creatureType && !ctx.creatureType.startsWith(ctx.size)) ctx.creatureType = `${ctx.size} ${ctx.creatureType}`;
    ctx.source = details.source?.book ? [details.source.book, details.source.page].filter(Boolean).join(" ") : "";
    const cr = details.cr;
    const xp = num(details.xp?.value) || num(C.CR_EXP_LEVELS?.[cr]);
    ctx.cr = { value: cr ?? "", label: crLabel(cr), xp: xp ? xp.toLocaleString() : "" };

    /* vitals */
    const hp = attr.hp ?? {};
    ctx.hp.formula = hp.formula ?? "";
    ctx.hp.baseMax = num(hp.max);
    const ac = attr.ac ?? {};
    ctx.acNote = loc(C.armorClasses?.[ac.calc]?.label);
    ctx.acEditable = ["flat", "natural"].includes(ac.calc);
    ctx.acFlat = ac.flat ?? "";

    /* properties block */
    const mv = attr.movement ?? {};
    const units = mv.units ?? "ft";
    ctx.speedLine = [
      num(mv.walk) ? `${num(mv.walk)} ${units}.` : "",
      ...["burrow", "climb", "fly", "swim"].filter((k) => num(mv[k])).map((k) => `${k} ${num(mv[k])} ${units}.${k === "fly" && mv.hover ? " (hover)" : ""}`)
    ].filter(Boolean).join(", ") || "—";
    ctx.saveLine = ctx.abilities.filter((a) => a.proficient).map((a) => ({ key: a.key, abbr: a.abbr[0] + a.abbr.slice(1).toLowerCase(), save: a.save }));
    ctx.profSkills = ctx.skills.filter((s) => s.proficient);
    ctx.showAllSkills = this._allSkills;
    const tr = sys.traits ?? {};
    ctx.sbTraits = [
      { label: "Damage Vulnerabilities", trait: "dv", values: traitList("dv", tr.dv) },
      { label: "Damage Resistances", trait: "dr", values: traitList("dr", tr.dr) },
      { label: "Damage Immunities", trait: "di", values: traitList("di", tr.di) },
      { label: "Condition Immunities", trait: "ci", values: traitList("ci", tr.ci) },
      { label: "Languages", trait: "languages", values: traitList("languages", tr.languages), always: true }
    ].filter((t) => t.values.length || t.always || ctx.editMode).map((t) => ({ ...t, join: t.values.join(", ") || "—" }));
    const senses = attr.senses ?? {};
    const senseBits = ["blindsight", "darkvision", "tremorsense", "truesight"]
      .filter((k) => num(senses[k])).map((k) => `${k} ${num(senses[k])} ${senses.units ?? "ft"}.`);
    if (senses.special) senseBits.push(senses.special);
    const passive = sys.skills?.prc?.passive;
    if (passive !== undefined) senseBits.push(`passive Perception ${passive}`);
    ctx.sensesLine = senseBits.join(", ") || "—";

    /* legendary resources */
    const res = sys.resources ?? {};
    ctx.legendary = [
      { key: "legact", label: "Legendary Actions" },
      { key: "legres", label: "Legendary Resistances" }
    ].map((l) => {
      const r = res[l.key] ?? {};
      const max = num(r.max);
      const value = "spent" in r ? Math.max(0, max - num(r.spent)) : num(r.value);
      return { ...l, max, value, pips: Array.from({ length: max }, (_, i) => ({ n: i + 1, on: i < value })) };
    }).filter((l) => l.max > 0 || (ctx.editMode && "max" in (res[l.key] ?? {})));

    /* stat block sections: traits, actions and the rest, each entry with its text inline */
    const secret = actor.isOwner;
    const entries = [];
    for (const item of actor.items) {
      if (!ACTION_ITEM_TYPES.has(item.type) && !item.type.endsWith("maneuver")) continue;
      entries.push(this.#entry(item, secret));
    }
    const all = await Promise.all(entries);
    const bySection = Object.fromEntries(SECTIONS.map((s) => [s.key, []]));
    for (const e of all) bySection[e.section].push(e);
    const order = (a, b) => (/multiattack/i.test(b.name) - /multiattack/i.test(a.name)) || (a.sort - b.sort) || a.name.localeCompare(b.name);
    const legMax = num(res.legact?.max);
    ctx.sections = SECTIONS.map((s) => ({
      label: s.label, activation: s.key === "trait" ? "" : s.key, items: bySection[s.key].sort(order),
      intro: s.key === "legendary" && legMax
        ? `Can take ${legMax} legendary action${legMax === 1 ? "" : "s"}, one at a time at the end of another creature's turn. Spent actions return at the start of its turn.`
        : s.key === "lair" && res.lair?.value
          ? `On initiative count ${num(res.lair.initiative, 20)} (losing ties), it takes a lair action.` : "",
      always: s.always
    })).filter((s) => s.items.length || s.always || ctx.editMode);
    ctx.quickAttacks = [...bySection.action, ...bySection.bonus].filter((e) => e.roll?.hit || e.roll?.dc).sort(order);
    return ctx;
  }

  async #entry(item, secrets) {
    const act = activationOf(item);
    let section = ["action", "bonus", "reaction", "legendary", "lair"].includes(act) ? act
      : act === "mythic" ? "legendary"
        : item.type === "weapon" ? "action" : "trait";
    const acts = item.system.activities?.contents ?? (item.system.activities ? [...item.system.activities] : []);
    const legCost = section === "legendary" ? num(item.system.activation?.cost ?? acts[0]?.activation?.value) : 0;
    const dmg = item.labels?.damages ?? item.labels?.damage;
    const recharge = rechargeOf(item);
    const uses = itemUses(item);
    const period = Array.isArray(item.system.uses?.recovery) ? item.system.uses.recovery[0]?.period : item.system.uses?.per;
    const desc = item.system.description?.value
      ? await TextEditorImpl().enrichHTML(item.system.description.value, { secrets, rollData: item.getRollData?.(), relativeTo: item })
      : "";
    return {
      id: item.id, name: item.name, img: item.img, sort: item.sort ?? 0, section,
      roll: rollOf(item), range: item.type === "weapon" || section === "action" ? rangeOf(item) : "",
      damage: Array.isArray(dmg) ? dmg.map((d) => d.label ?? d.formula).filter(Boolean).join(" + ") : (dmg || ""),
      recharge, uses, recovery: period && period !== "recharge" ? (RECOVERY[period] ?? "") : "",
      legCost: legCost > 1 ? legCost : 0,
      equippable: item.type === "weapon" && "equipped" in item.system, equipped: !!item.system.equipped,
      desc
    };
  }

  /** "1/8" style CR entries become numbers before the update. */
  _prepareSubmitData(event, form, formData) {
    const data = super._prepareSubmitData(event, form, formData);
    const cr = foundry.utils.getProperty(data, "system.details.cr");
    if (typeof cr === "string") {
      const [a, b] = cr.split("/").map(Number);
      foundry.utils.setProperty(data, "system.details.cr", b ? a / b : Number(cr) || 0);
    }
    return data;
  }

  /* ----- actions ----- */
  static #item(target) { return this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId); }

  static async #onRollHp() {
    const actor = this.actor;
    const formula = actor.system.attributes?.hp?.formula;
    if (!formula) return;
    let roll;
    if (typeof actor.rollNPCHitPoints === "function") roll = await actor.rollNPCHitPoints();
    else {
      roll = await new Roll(formula, actor.getRollData()).evaluate();
      await roll.toMessage({ flavor: `${actor.name}: Hit Points`, speaker: ChatMessage.getSpeaker({ actor }) });
    }
    if (!roll) return;
    const hp = Math.max(1, roll.total);
    return actor.update({ "system.attributes.hp.value": hp, "system.attributes.hp.max": hp });
  }

  static async #onRollRecharge(event, target) {
    const item = HoloNpcSheet.#item.call(this, target);
    if (!item) return;
    if (typeof item.system.uses?.rollRecharge === "function") return item.system.uses.rollRecharge();
    if (typeof item.rollRecharge === "function") return item.rollRecharge();
    const info = rechargeOf(item);
    if (!info) return;
    const roll = await new Roll("1d6").evaluate();
    const success = roll.total >= info.formula;
    await roll.toMessage({ flavor: `${item.name}: ${info.label} (${success ? "recharged" : "not recharged"})`, speaker: ChatMessage.getSpeaker({ actor: this.actor }) });
    if (success) return item.update(Array.isArray(item.system.uses?.recovery) ? { "system.uses.spent": 0 } : { "system.recharge.charged": true });
  }

  static #onSetLegendary(event, target) {
    const key = target.dataset.res;
    const r = this.actor.system.resources?.[key];
    if (!r) return;
    const max = num(r.max), n = num(target.dataset.n);
    const current = "spent" in r ? max - num(r.spent) : num(r.value);
    const next = current === n ? n - 1 : n;
    if ("spent" in r) return this.actor.update({ [`system.resources.${key}.spent`]: max - next });
    return this.actor.update({ [`system.resources.${key}.value`]: next });
  }

  static #onToggleAllSkills() { this._allSkills = !this._allSkills; this.render(); }

  static async #onCreateFeature(event, target) {
    const activation = target.dataset.activation ?? "";
    const label = { "": "Trait", action: "Action", bonus: "Bonus Action", reaction: "Reaction", legendary: "Legendary Action", lair: "Lair Action" }[activation] ?? "Feature";
    const data = { name: `New ${label}`, type: "feat", system: { type: { value: "monster" } } };
    if (activation) {
      const _id = foundry.utils.randomID();
      data.system.activities = { [_id]: { _id, type: "utility", activation: { type: activation, value: 1 } } };
      data.system.activation = { type: activation, cost: 1 }; // older dnd5e
    }
    const [item] = await this.actor.createEmbeddedDocuments("Item", [data]);
    return item?.sheet.render(true);
  }

  static #onConfig(event, target) {
    const actor = this.actor;
    const config = target.dataset.config;
    const opened = {
      type: () => openConfig(actor, ["CreatureTypeConfig", "ActorTypeConfig"]),
      movement: () => openConfig(actor, ["MovementSensesConfig", "ActorMovementConfig", "MovementConfig"], { type: "movement" }),
      senses: () => openConfig(actor, ["MovementSensesConfig", "ActorSensesConfig", "SensesConfig"], { type: "senses" }),
      ac: () => openConfig(actor, ["ArmorClassConfig", "ActorArmorConfig"])
    }[config]?.();
    if (!opened) ui.notifications.info("Edit this in the dnd5e sheet: gear button in the sheet header.");
  }
}

/* ---------- registration ---------- */
Hooks.once("init", () => {
  const sheetOpts = { types: ["npc"], makeDefault: false, label: "HOLOSHEET.NpcSheetLabel" };
  const DSC = foundry.applications.apps?.DocumentSheetConfig;
  if (DSC) DSC.registerSheet(Actor, `${MODULE_ID}-npc-sheet`, HoloNpcSheet, sheetOpts);
  else Actors.registerSheet(`${MODULE_ID}-npc-sheet`, HoloNpcSheet, sheetOpts);
  const getTpl = foundry.applications.handlebars?.getTemplate ?? getTemplate;
  getTpl(NPC_TPL("_entry")).then((t) => Handlebars.registerPartial("holo-terminal.npc-entry", t));
});
