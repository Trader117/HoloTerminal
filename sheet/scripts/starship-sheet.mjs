/**
 * Holo-Terminal Starship: a vehicle sheet for SW5e starships on the same datapad tablet as the character and NPC sheets.
 * Built for ships made by HoloDock's Import ship (dnd5e "space" vehicles with HoloTerminal's sw5e flag), and works on any
 * vehicle: hull is hit points, shields are temporary hit points, and the Starships of the Galaxy numbers dnd5e has no
 * field for (tier, hull and shield dice, space and turning speed, fuel, mod slots) live in flags.holo-terminal.ship.
 */
import { HoloDossierSheet, TPL, num, signed, pct, loc, activationOf, rangeOf, rollOf, itemUses, recoveryOf } from "./sheet.mjs";
import { requestGM } from "../../scripts/store.mjs";
import * as Dock from "../../scripts/holodock.mjs";
import { STATIONS } from "../../scripts/bridge.mjs";
import { SIZES, SKILLS, shipDice } from "../../scripts/starship-import.mjs";

const MODULE_ID = "holo-terminal";
const SHIP_TPL = (name) => TPL(`ship/${name}`);
const FLAG = `flags.${MODULE_ID}.ship`;
const MOUNTS = { "primary (starship)": "Primary", "secondary (starship)": "Secondary", "tertiary (starship)": "Tertiary", "quaternary (starship)": "Quaternary" };
const SYSTEM_TYPES = [
  { key: "starship", label: "Armor" }, { key: "ssshield", label: "Shields" }, { key: "reactor", label: "Reactor" },
  { key: "powerc", label: "Power coupling" }, { key: "hyper", label: "Hyperdrive" }
];
const MOD_GROUPS = ["Engineering", "Operation", "Suite", "Universal", "Weapon"];
const ACTION_GROUPS = [
  { key: "pilot", label: "Pilot actions", icon: "fa-person-walking-arrow-right" },
  { key: "crew", label: "Crew actions", icon: "fa-users-gear" },
  { key: "passenger", label: "Passenger actions", icon: "fa-user" }
];
const TIER_AC = (t) => (t >= 2 ? t - 1 : 0);

/** The character a user rolls and crews as: their controlled token, then their assigned character. */
const myActor = () => canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character ?? null;

export class HoloStarshipSheet extends HoloDossierSheet {
  static DEFAULT_OPTIONS = {
    classes: ["holo-ship"],
    position: { width: 960, height: 820 },
    actions: {
      shipSkill: HoloStarshipSheet.#onSkill,
      shipRefuel: HoloStarshipSheet.#onRefuel,
      shipCargoAdd: HoloStarshipSheet.#onCargoAdd,
      shipCargoRemove: HoloStarshipSheet.#onCargoRemove,
      shipStationLeave: HoloStarshipSheet.#onStationLeave,
      shipStationsClear: HoloStarshipSheet.#onStationsClear,
      shipJump: HoloStarshipSheet.#onJump,
      shipDock: HoloStarshipSheet.#onDock,
      shipParty: HoloStarshipSheet.#onParty,
      shipEnable: HoloStarshipSheet.#onEnable,
      shipShieldsFull: HoloStarshipSheet.#onShieldsFull,
      shipSystemDamage: HoloStarshipSheet.#onSystemDamage,
      createShipItem: HoloStarshipSheet.#onCreateShipItem
    }
  };

  static PARTS = {
    header: { template: SHIP_TPL("header") },
    sidebar: { template: SHIP_TPL("sidebar") },
    nav: { template: SHIP_TPL("nav") },
    status: { template: SHIP_TPL("status") },
    arsenal: { template: SHIP_TPL("arsenal") },
    systems: { template: SHIP_TPL("systems") },
    crew: { template: SHIP_TPL("crew") },
    cargo: { template: SHIP_TPL("cargo") },
    effects: { template: TPL("effects") },
    notes: { template: TPL("npc/notes") }
  };

  static TAB_LIST = {
    primary: {
      initial: "status",
      tabs: [
        { id: "status", icon: "fa-solid fa-gauge-high", label: "HOLOSHEET.Tab.Status" },
        { id: "arsenal", icon: "fa-solid fa-crosshairs", label: "HOLOSHEET.Tab.Arsenal" },
        { id: "systems", icon: "fa-solid fa-microchip", label: "HOLOSHEET.Tab.Systems" },
        { id: "crew", icon: "fa-solid fa-users", label: "HOLOSHEET.Tab.Crew" },
        { id: "cargo", icon: "fa-solid fa-boxes-stacked", label: "HOLOSHEET.Tab.Cargo" },
        { id: "effects", icon: "fa-solid fa-bolt", label: "HOLOSHEET.Tab.Effects" },
        { id: "notes", icon: "fa-solid fa-book", label: "HOLOSHEET.Tab.Log" }
      ]
    }
  };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const actor = this.actor, sys = actor.system, attr = sys.attributes ?? {};
    const flag = actor.getFlag(MODULE_ID, "ship") ?? {}, ss = flag.sw5e ?? {};
    const info = Dock.shipInfo(actor);
    ctx.ship = { ...info, hyperOverride: flag.hyperdrive ?? "" };
    ctx.ss = ss;
    ctx.inDock = Dock.isShip(actor);
    ctx.isGM = game.user.isGM;
    ctx.canCommand = game.user.isGM || info.party || actor.isOwner;

    /* identity */
    const sizeKey = ss.size ?? sys.traits?.size;
    ctx.sizeLabel = SIZES[sizeKey]?.label ?? info.size ?? "";
    ctx.tier = num(ss.tier);
    ctx.hasTier = ss.tier !== undefined;
    ctx.tierOptions = [0, 1, 2, 3, 4, 5].map((t) => ({ t, sel: t === ctx.tier }));
    ctx.sizeOptions = Object.entries(SIZES).map(([k, s]) => ({ k, label: s.label, sel: k === sizeKey }));
    ctx.sourceLabel = sys.source?.custom || sys.source?.book || ss.from || "";
    ctx.subline = [ctx.sizeLabel && `${ctx.sizeLabel} starship`, ctx.hasTier && `Tier ${ctx.tier}`,
      info.hyper ? `Hyperdrive class ${info.hyper}` : "No hyperdrive", ctx.sourceLabel].filter(Boolean);

    /* vitals: hull, shields, fuel, AC */
    const hp = attr.hp ?? {};
    const hullMax = num(hp.max);
    ctx.hull = { value: num(hp.value), max: hullMax, pct: pct(num(hp.value), hullMax) };
    ctx.hull.level = ctx.hull.pct <= 25 ? "critical" : ctx.hull.pct <= 50 ? "hurt" : "ok";
    const shieldMax = num(info.shields?.max);
    ctx.shields = { value: num(hp.temp), max: shieldMax, pct: pct(num(hp.temp), shieldMax || num(hp.temp)), has: shieldMax > 0 || num(hp.temp) > 0,
      down: shieldMax > 0 && num(hp.temp) < shieldMax };
    ctx.fuel = info.fuel;
    ctx.acFlat = attr.ac?.flat ?? "";
    ctx.acParts = ss.ac ? [`${ss.ac.armor ?? "No armor"} ${ss.ac.base}`, ss.ac.dex ? `Dex ${signed(ss.ac.dex)}` : "", ss.ac.tier ? `tier ${signed(ss.ac.tier)}` : ""].filter(Boolean).join(", ") : "";
    ctx.speed = { space: num(ss.space) || num(attr.movement?.fly), turn: num(ss.turn) };
    ctx.sysDamage = { value: num(info.systemDamage), pips: [1, 2, 3, 4, 5, 6].map((n) => ({ n, on: n <= num(info.systemDamage) })) };

    /* starship skills */
    const who = myActor();
    const stationed = who && Object.values(flag.stations ?? {}).includes(who.id);
    ctx.crewProf = stationed ? num(who.system?.attributes?.prof) : 0;
    ctx.skillWho = stationed ? who.name : "";
    ctx.shipSkills = Object.entries(SKILLS).map(([k, s]) => {
      const mod = num(sys.abilities?.[s.ability]?.mod);
      return { key: k, label: s.label, ability: s.ability.toUpperCase(), total: signed(mod + ctx.crewProf) };
    });

    /* stat tiles for the status screen */
    ctx.tiles = [
      { label: "Armor class", value: `${ctx.ac}`, extra: info.dr ? `DR ${info.dr}` : "", tip: ctx.acParts },
      { label: "Speed / turning", value: ctx.speed.space ? `${ctx.speed.space} / ${ctx.speed.turn || "—"} ft` : "—" },
      info.dice && { label: "Hull & shield dice", value: info.dice },
      { label: "Hyperdrive", value: info.hyper ? `Class ${info.hyper}` : "None" },
      { label: "Cargo", value: `${info.cargoUsed}${info.cargoCap ? ` / ${info.cargoCap}` : ""} t` },
      { label: "Fuel price", value: `${info.fuel.price} cr/unit` },
      ss.shieldCapacity && { label: "Shield capacity", value: `×${ss.shieldCapacity}`, extra: ss.shieldRegen ? `regen ×${ss.shieldRegen}` : "" },
      ss.modSlots && { label: "Mod slots / suites", value: `${ss.modSlots} / ${num(ss.suites)}` }
    ].filter(Boolean);

    /* items */
    const rowOf = (item) => {
      const dmg = item.labels?.damages ?? item.labels?.damage;
      return {
        id: item.id, name: item.name, img: item.img, type: item.type,
        roll: rollOf(item), range: rangeOf(item), uses: itemUses(item), recovery: recoveryOf(item),
        damage: Array.isArray(dmg) ? dmg.map((d) => d.label ?? d.formula).filter(Boolean).join(" + ") : (dmg || ""),
        activation: { action: "Action", bonus: "Bonus", reaction: "Reaction", none: "", special: "Special" }[activationOf(item)] ?? "",
        equipped: !!item.system.equipped, equippable: "equipped" in item.system, quantity: item.system.quantity
      };
    };
    const items = actor.items.contents ?? [...actor.items];
    const subOf = (i) => i.system.type?.value;
    ctx.weapons = items.filter((i) => i.type === "weapon").map((i) => ({ ...rowOf(i), mount: MOUNTS[subOf(i)] ?? "" }))
      .sort((a, b) => b.equipped - a.equipped || a.name.localeCompare(b.name));
    ctx.ammo = items.filter((i) => i.type === "consumable").map(rowOf);
    const actions = items.filter((i) => i.type === "feat" && subOf(i) === "starshipAction");
    ctx.actionGroups = ACTION_GROUPS.map((g) => ({ ...g, items: actions.filter((i) => (i.system.type?.subtype || "crew") === g.key).map(rowOf)
      .sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.items.length);
    ctx.features = items.filter((i) => i.type === "feat" && subOf(i) !== "starshipAction").map(rowOf);

    ctx.systems = SYSTEM_TYPES.map((t) => ({
      ...t, items: items.filter((i) => i.type === "equipment" && subOf(i) === t.key).map((i) => {
        const a = i.system.attributes ?? {}, bits = [];
        if (t.key === "starship") bits.push(`AC ${num(i.system.armor?.value, 10)}${i.system.armor?.dex === 0 ? "" : i.system.armor?.dex ? ` + Dex (max ${i.system.armor.dex})` : " + Dex"}`, num(a.dmgred?.value) ? `DR ${a.dmgred.value}` : "");
        if (t.key === "ssshield") bits.push(num(a.capx?.value) ? `capacity ×${a.capx.value}` : "", num(a.regrateco?.value) ? `regen ×${a.regrateco.value}` : "");
        if (t.key === "hyper" && num(a.hdclass?.value)) bits.push(`class ${a.hdclass.value}`);
        if (t.key === "powerc" && num(a.cscap?.value)) bits.push(`central capacity ${a.cscap.value}`);
        if (t.key === "reactor" && num(a.fuelcostsmod?.value)) bits.push(`fuel cost ×${a.fuelcostsmod.value}`);
        return { ...rowOf(i), stats: bits.filter(Boolean).join(" · ") };
      })
    })).filter((g) => g.items.length);
    const otherEquip = items.filter((i) => i.type === "equipment" && !SYSTEM_TYPES.some((t) => t.key === subOf(i))).map(rowOf);
    if (otherEquip.length) ctx.systems.push({ key: "other", label: "Other equipment", items: otherEquip });

    const mods = items.filter((i) => i.type === "loot").map((i) => {
      const m = i.getFlag?.(MODULE_ID, "mod") ?? {};
      return { ...rowOf(i), category: m.category || "Other", grade: num(m.grade) };
    });
    ctx.modGroups = [...MOD_GROUPS, "Other"].map((c) => ({ label: c, items: mods.filter((m) => m.category === c).sort((a, b) => a.name.localeCompare(b.name)) }))
      .filter((g) => g.items.length);
    const suites = mods.filter((m) => m.category === "Suite").length;
    ctx.modCount = { used: mods.length, slots: num(ss.modSlots), suites, suiteMax: num(ss.suites), over: ss.modSlots && mods.length > ss.modSlots, suitesOver: ss.suites !== undefined && suites > num(ss.suites) };

    /* crew stations */
    const seats = flag.stations ?? {};
    const boss = game.user.isGM || actor.isOwner;
    const pool = game.actors.filter((a) => ["character", "npc"].includes(a.type) && (boss || a.isOwner))
      .sort((a, b) => (b.hasPlayerOwner - a.hasPlayerOwner) || a.name.localeCompare(b.name));
    ctx.stations = STATIONS.map((s) => {
      const crew = game.actors.get(seats[s.id]);
      return { ...s, crew: crew ? { id: crew.id, name: crew.name, img: crew.img, prof: signed(crew.system?.attributes?.prof) } : null,
        canLeave: crew && (boss || crew.isOwner),
        options: pool.map((a) => ({ id: a.id, name: a.name, sel: a.id === crew?.id })) };
    });
    ctx.canSeat = pool.length > 0;
    ctx.passengers = info.crew.filter((c) => c.role === "Passenger");

    /* cargo */
    ctx.cargo = info.cargo;
    ctx.cargoPct = info.cargoCap ? pct(info.cargoUsed, info.cargoCap) : 0;
    ctx.shipLog = flag.notes ?? "";
    ctx.location = flag.location ?? "";
    return ctx;
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    // play-state controls that write through HoloDock (so players on the party ship can use them too)
    el.querySelector("select[data-ship-routing]")?.addEventListener("change", (ev) => {
      ev.stopPropagation();
      requestGM("dockRouting", { shipId: this.actor.id, routing: ev.target.value });
    });
    el.querySelectorAll("select[data-ship-station]").forEach((sel) => sel.addEventListener("change", (ev) => {
      ev.stopPropagation();
      if (ev.target.value) requestGM("bridgeClaim", { shipId: this.actor.id, actorId: ev.target.value, station: sel.dataset.shipStation });
    }));
    el.querySelectorAll("[data-ship-cargo]").forEach((i) => i.addEventListener("change", (ev) => ev.stopPropagation()));
  }

  /** Tier and size changes carry through to the hull and shield dice and the tier's AC upgrade. */
  _prepareSubmitData(event, form, formData) {
    const data = super._prepareSubmitData(event, form, formData);
    const get = (p) => foundry.utils.getProperty(data, p);
    const flag = this.actor.getFlag(MODULE_ID, "ship")?.sw5e;
    const newTier = get(`${FLAG}.sw5e.tier`), newSize = get("system.traits.size");
    if (flag && (newTier !== undefined || newSize !== undefined)) {
      const tier = Math.clamp(num(newTier ?? flag.tier), 0, 5), size = newSize ?? flag.size;
      const { die, count } = shipDice(size, tier);
      foundry.utils.setProperty(data, `${FLAG}.sw5e.tier`, tier);
      foundry.utils.setProperty(data, `${FLAG}.sw5e.size`, size);
      foundry.utils.mergeObject(foundry.utils.getProperty(data, `${FLAG}.sw5e`), { hullDie: die, hullDice: count, shieldDie: die, shieldDice: count });
      const oldTierAC = num(flag.ac?.tier), nextTierAC = TIER_AC(tier);
      if (oldTierAC !== nextTierAC && get("system.attributes.ac.flat") === undefined) {
        foundry.utils.setProperty(data, "system.attributes.ac.flat", num(this.actor.system.attributes?.ac?.flat) + nextTierAC - oldTierAC);
        foundry.utils.setProperty(data, `${FLAG}.sw5e.ac.tier`, nextTierAC);
      }
    }
    // space speed is also the vehicle's fly speed, so tokens move at it
    const space = get(`${FLAG}.sw5e.space`);
    if (space !== undefined) foundry.utils.setProperty(data, "system.attributes.movement.fly", num(space));
    return data;
  }

  /* ----- actions ----- */
  static #onSkill(event, target) { return Dock.rollShipSkill(this.actor, target.closest("[data-skill]")?.dataset.skill, myActor()); }
  static #onRefuel(event, target) {
    const fu = Dock.shipInfo(this.actor).fuel;
    const units = target.dataset.units === "fill" ? Math.max(0, num(fu.max) - fu.value) : num(target.dataset.units, 1);
    return requestGM("dockRefuel", { shipId: this.actor.id, payerId: myActor()?.id, units });
  }
  static #onCargoAdd() {
    const q = (n) => this.element.querySelector(`[data-ship-cargo="${n}"]`)?.value ?? "";
    if (!q("name").trim()) return ui.notifications.warn("Name the cargo first.");
    return requestGM("dockCargo", { shipId: this.actor.id, op: "add", item: { name: q("name").trim(), qty: q("qty"), tons: q("tons") } });
  }
  static #onCargoRemove(event, target) { return requestGM("dockCargo", { shipId: this.actor.id, op: "remove", cargoId: target.dataset.id }); }
  static #onStationLeave(event, target) { return requestGM("bridgeClaim", { shipId: this.actor.id, actorId: target.dataset.actorId, station: "" }); }
  static #onStationsClear() { return requestGM("bridgeClear", { shipId: this.actor.id }); }
  static #onJump() { return game.modules.get(MODULE_ID).api?.galaxy?.(); }
  static #onDock() { return game.modules.get(MODULE_ID).api?.openHoloDock?.(this.actor.id); }
  static #onParty() {
    if (!game.user.isGM) return;
    return Dock.setPartyShip(Dock.partyShip() === this.actor ? "" : this.actor.id);
  }
  /** Puts a plain vehicle on the HoloDock registry with the SotG numbers for its size, at tier 0. */
  static async #onEnable() {
    const size = SIZES[this.actor.system.traits?.size] ? this.actor.system.traits.size : "med", sz = SIZES[size];
    const { die, count } = shipDice(size, 0);
    const current = this.actor.getFlag(MODULE_ID, "ship") ?? {};
    await this.actor.update({ [FLAG]: { ...current, enabled: true, sw5e: current.sw5e ?? {
      size, tier: 0, hullDie: die, hullDice: count, shieldDie: die, shieldDice: count, shieldMax: num(this.actor.system.attributes?.hp?.temp),
      ac: { armor: null, base: num(this.actor.system.attributes?.ac?.flat, 10), dex: 0, tier: 0 }, dr: 0,
      space: num(this.actor.system.attributes?.movement?.fly), turn: 0, fuelCap: sz.fuelCap, fuelCost: sz.fuelCost,
      cargoCap: num(this.actor.system.attributes?.capacity?.cargo), foodCap: sz.food, modSlots: sz.modSlots,
      suites: Math.max(0, sz.suites[0] + sz.suites[1] * num(this.actor.system.abilities?.con?.mod)), modCostMult: sz.modCost } } });
  }
  static #onShieldsFull() {
    const max = num(Dock.shipInfo(this.actor).shields?.max);
    if (max) return this.actor.update({ "system.attributes.hp.temp": max });
  }
  static #onSystemDamage(event, target) {
    const n = num(target.dataset.n), current = num(this.actor.getFlag(MODULE_ID, "ship")?.systemDamage);
    const next = current === n ? n - 1 : n;
    if (this.actor.system.attributes && "systemDamage" in this.actor.system.attributes) return this.actor.update({ "system.attributes.systemDamage": next });
    return this.actor.update({ [`${FLAG}.systemDamage`]: next });
  }
  static #onCreateShipItem(event, target) {
    const kind = target.dataset.kind;
    const data = {
      weapon: { name: "New weapon", type: "weapon", system: { type: { value: "primary (starship)" }, equipped: true } },
      action: { name: "New action", type: "feat", system: { type: { value: "starshipAction", subtype: target.dataset.subtype || "crew" } } },
      feature: { name: "New feature", type: "feat", system: { type: { value: "starship" } } },
      equipment: { name: "New system", type: "equipment", system: { type: { value: target.dataset.subtype || "ssshield" }, equipped: true } },
      mod: { name: "New modification", type: "loot", system: { identified: true }, flags: { [MODULE_ID]: { mod: { category: target.dataset.subtype || "Universal", grade: 0 } } } }
    }[kind];
    if (!data) return;
    return this.actor.createEmbeddedDocuments("Item", [data]).then(([i]) => i?.sheet.render(true));
  }
}

/* ---------- registration ---------- */
Hooks.once("init", () => {
  const sheetOpts = { types: ["vehicle"], makeDefault: true, label: "HOLOSHEET.ShipSheetLabel" };
  const DSC = foundry.applications.apps?.DocumentSheetConfig;
  if (DSC) DSC.registerSheet(Actor, `${MODULE_ID}-starship-sheet`, HoloStarshipSheet, sheetOpts);
  else Actors.registerSheet(`${MODULE_ID}-starship-sheet`, HoloStarshipSheet, sheetOpts);
});
