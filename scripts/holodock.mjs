import { MODULE_ID, getCredits, setCredits, registerHandler, notifyUser } from "./store.mjs";
import { GALAXY_HOOK } from "./galaxy.mjs";
import { record } from "./bank.mjs";
import { SIZES, SKILLS } from "./starship-import.mjs";

/* HoloDock: a ship registry for SW5e starships (and any actor the GM marks as a ship).
   Reads hull, shields, fuel, system damage and power routing from the SW5e starship data when it is there,
   and keeps its own extras (hyperdrive override, fuel capacity, cargo, location, notes) in an actor flag.
   Ships made by "Import ship" (starship-import.mjs) are dnd5e vehicles whose Starships of the Galaxy numbers
   (size, tier, hull and shield dice, speeds, fuel) live in that flag's "sw5e" key. */

const FLAG = "ship";
export const DOCK_HOOK = `${MODULE_ID}.dock`;
export const ROUTING = { none: "Balanced", engines: "Engines", shields: "Shields", weapons: "Weapons" };

export function registerDockSettings() {
  game.settings.register(MODULE_ID, "dockPartyShip", { scope: "world", config: false, type: String, default: "",
    onChange: () => { Hooks.callAll(DOCK_HOOK); Hooks.callAll(GALAXY_HOOK); } });
  game.settings.register(MODULE_ID, "dockFuelPerDay", { name: "HoloDock: fuel per day in hyperspace",
    hint: "Fuel units a ship burns for each day (or part of a day) of a hyperspace jump made from the galaxy map. 0 turns fuel use off.",
    scope: "world", config: true, type: Number, default: 1 });
  game.settings.register(MODULE_ID, "dockFuelPrice", { name: "HoloDock: fuel price",
    hint: "Credits per fuel unit when a ship has no SW5e size to take the price from.", scope: "world", config: true, type: Number, default: 50 });
}

/* ---------- reading ships ---------- */
const flagOf = (a) => foundry.utils.deepClone(a?.getFlag(MODULE_ID, FLAG) ?? {});
export const saveFlag = (a, data) => a.setFlag(MODULE_ID, FLAG, data);
export const isShip = (a) => !!a && (a.type === "starship" || !!a.getFlag(MODULE_ID, FLAG)?.enabled);
export const partyShip = () => game.actors.get(game.settings.get(MODULE_ID, "dockPartyShip")) ?? null;

/** Ships this user can see: every ship for the GM; for players, the party ship plus ships they have at least Limited rights on. */
export function shipActors(user = game.user) {
  const party = partyShip();
  return game.actors.filter((a) => isShip(a) && (user.isGM || a === party || a.testUserPermission(user, "LIMITED")))
    .sort((a, b) => (b === party) - (a === party) || a.name.localeCompare(b.name));
}

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const sizeItem = (a) => a.items.find((i) => i.type === "starshipsize");
/** SotG numbers for a ship: from an imported ship's flag, else the SW5e size item, else the actor's size. */
function sotg(a) {
  const f = a?.getFlag(MODULE_ID, FLAG)?.sw5e;
  if (f) return f;
  const it = sizeItem(a)?.system;
  if (it) return { fuelCap: num(it.fuelCap), fuelCost: num(it.fuelCost), cargoCap: num(it.cargoCap) };
  const sz = a?.type === "vehicle" && a.system?.vehicleType === "space" ? SIZES[a.system?.traits?.size] : null;
  return sz ? { size: a.system.traits.size, fuelCap: sz.fuelCap, fuelCost: sz.fuelCost } : {};
}

/** Hyperdrive class: GM override, then the best equipped "Hyperdrive, Class X" item, then any hyperdrive item. */
export function hyperClass(a) {
  const f = flagOf(a);
  if (num(f.hyperdrive)) return num(f.hyperdrive);
  const drives = a.items.filter((i) => i.system?.type?.value === "hyper" || /hyperdrive/i.test(i.name))
    .map((i) => ({ name: i.name, eq: i.system?.equipped !== false, cls: num(i.name.match(/class\s*([\d.]+)/i)?.[1]) }))
    .filter((d) => d.cls && !/backup/i.test(d.name ?? ""));
  const pick = (drives.filter((d) => d.eq).length ? drives.filter((d) => d.eq) : drives).sort((x, y) => x.cls - y.cls)[0];
  return pick?.cls ?? null;
}

function fuel(a) {
  const f = flagOf(a), sys = a.system?.attributes?.fuel;
  const onActor = sys && typeof sys === "object" && "value" in sys;
  const max = num(f.fuelMax) ?? num(sys?.max) ?? num(sys?.cap) ?? num(sotg(a).fuelCap);
  const value = onActor ? num(sys.value) ?? 0 : num(f.fuel) ?? max ?? 0;
  return { value, max, onActor, price: num(sotg(a).fuelCost) ?? game.settings.get(MODULE_ID, "dockFuelPrice") };
}
/** Update data that sets a ship's fuel, wherever it is kept. */
function fuelUpdate(a, value) {
  const fu = fuel(a), v = Math.max(0, fu.max ? Math.min(fu.max, value) : value);
  return fu.onActor ? { "system.attributes.fuel.value": v } : { [`flags.${MODULE_ID}.${FLAG}.fuel`]: v };
}

const bar = (value, max, tone) => {
  const v = num(value) ?? 0, m = num(max);
  return { value: v, max: m, tone, pct: m ? Math.max(0, Math.min(100, Math.round((v / m) * 100))) : v > 0 ? 100 : 0, low: m ? v / m <= 0.25 : false };
};

function crewOf(a) {
  const dep = a.system?.attributes?.deployment;
  if (!dep) return [];
  const name = (ref) => { if (!ref) return null; const d = typeof ref === "string" ? (fromUuidSync?.(ref) ?? game.actors.get(ref)) : ref; return d?.name ?? null; };
  const out = [];
  const pilot = name(dep.pilot?.value); if (pilot) out.push({ role: "Pilot", name: pilot });
  for (const r of dep.crew?.items ?? []) { const n = name(r); if (n) out.push({ role: "Crew", name: n }); }
  for (const r of dep.passenger?.items ?? []) { const n = name(r); if (n) out.push({ role: "Passenger", name: n }); }
  return out;
}

/** Everything the screens need about one ship. */
export function shipInfo(a, user = game.user) {
  const f = flagOf(a), at = a.system?.attributes ?? {}, hp = at.hp ?? {};
  const size = sizeItem(a), fu = fuel(a), party = partyShip() === a, ss = sotg(a);
  // Imported ships keep shield capacity in the flag (dnd5e adds hp.tempmax to max hit points, so it can't hold shields).
  const shieldMax = num(f.shieldMax) ?? num(ss.shieldMax) ?? (num(hp.tempmax) > 0 ? num(hp.tempmax) : null);
  const sizeLabel = size?.name?.replace(/\s*starship$/i, "") ?? SIZES[ss.size]?.label ?? (a.type === "vehicle" ? "Vehicle" : "");
  const cargo = (f.cargo ?? []).map((c) => ({ ...c }));
  const cargoUsed = cargo.reduce((s, c) => s + (num(c.tons) ?? 0) * (num(c.qty) ?? 1), 0);
  const routing = at.power?.routing ?? (ss.size ? f.routing ?? "none" : undefined);
  const abil = (k) => { const m = a.system?.abilities?.[k]?.mod; return m === undefined ? null : m; };
  const skills = ss.size ? Object.entries(SKILLS).map(([k, s]) => ({ k, label: s.label, ab: s.ability.toUpperCase(), mod: abil(s.ability) ?? 0 })) : null;
  return {
    id: a.id, uuid: a.uuid, name: a.name, img: a.img, party, native: a.type === "starship",
    owner: a.isOwner, observer: user.isGM || party || a.testUserPermission(user, "OBSERVER"),
    size: sizeLabel,
    tier: num(ss.tier), ac: num(at.ac?.value), dr: num(ss.dr), speed: num(ss.space) ? { space: ss.space, turn: ss.turn } : null,
    dice: num(ss.hullDice) ? `${ss.hullDice}d${ss.hullDie}` : null, skills,
    hull: bar(hp.value, hp.max, "hull"),
    shields: shieldMax || num(hp.temp) ? bar(hp.temp, shieldMax ?? hp.temp, "shields") : null,
    fuel: { ...bar(fu.value, fu.max, "fuel"), price: fu.price, onActor: fu.onActor },
    hyper: hyperClass(a),
    systemDamage: num(at.systemDamage) ?? (ss.size ? num(f.systemDamage) ?? 0 : null),
    routing: routing !== undefined ? { value: routing, label: ROUTING[routing] ?? routing,
      options: Object.entries(ROUTING).map(([v, l]) => ({ v, l, sel: v === routing })) } : null,
    crew: crewOf(a), cargo, cargoUsed: Math.round(cargoUsed * 100) / 100, cargoCap: num(f.cargoCap) ?? num(ss.cargoCap) ?? num(size?.system?.cargoCap),
    location: f.location ?? "", notes: f.notes ?? ""
  };
}

/** Starship skill check: d20 + the ship's ability modifier, plus the roller's proficiency bonus if they hold a bridge station on this ship. */
export async function rollShipSkill(ship, key, who = null) {
  const sk = SKILLS[key]; if (!ship || !sk) return null;
  const crew = who && Object.values(flagOf(ship).stations ?? {}).includes(who.id);
  const prof = crew ? Number(who.system?.attributes?.prof) || 0 : 0;
  const roll = await new Roll("1d20 + @mod + @prof", { mod: ship.system?.abilities?.[sk.ability]?.mod ?? 0, prof }).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor: ship }),
    flavor: `${sk.label} (${game.i18n.localize(CONFIG.DND5E?.abilities?.[sk.ability]?.label ?? sk.ability)}) check${crew ? `, ${who.name} crewing` : ""}` });
  return roll;
}

/* ---------- changes ---------- */
/** Fuel for one hyperspace trip of the given length. */
export function fuelForHours(hours) {
  const per = Number(game.settings.get(MODULE_ID, "dockFuelPerDay")) || 0;
  return per > 0 ? Math.max(1, Math.ceil(hours / 24)) * per : 0;
}
export async function burnFuel(a, units) { if (units > 0) await a.update(fuelUpdate(a, fuel(a).value - units)); }
export async function setFuel(a, value) { await a.update(fuelUpdate(a, value)); }

export async function setPartyShip(id) { await game.settings.set(MODULE_ID, "dockPartyShip", id ?? ""); }
export async function markShip(a, enabled = true) { await saveFlag(a, { ...flagOf(a), enabled }); }

export async function editCargo(a, fn) { const f = flagOf(a); f.cargo = fn(f.cargo ?? []); await saveFlag(a, f); }

/** Weight of one of this item in tons (dnd5e 4.x keeps weight as { value, units }). */
export function itemTons(item) {
  const w = item?.system?.weight, v = Number(typeof w === "object" ? w?.value : w) || 0;
  const units = (typeof w === "object" && w?.units) || "lb";
  const t = units === "tn" ? v : units === "kg" ? v / 1000 : units === "Mg" ? v : v / 2000;
  return Math.round(t * 10000) / 10000;
}
/** Items a character can stow in a ship's hold. */
export const STOWABLE = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];
export const canWorkShip = (user, ship) => user.isGM || ship === partyShip() || ship.testUserPermission(user, "OWNER");
/** What a ship sells for: the resale share of the price it was bought for (or the value the GM set on the sheet). */
export function shipValue(a) {
  const v = num(flagOf(a).value) ?? 0;
  return { value: v, resale: Math.floor(v * (Number(game.settings.get(MODULE_ID, "yardResale")) || 0)) };
}

/** GM-side handlers, so players can buy fuel or stow cargo on ships they don't own outright (the party ship). */
export function registerDockHandlers() {
  registerHandler("dockRefuel", async ({ shipId, payerId, units }, user) => {
    const ship = game.actors.get(shipId), payer = game.actors.get(payerId);
    if (!ship || !isShip(ship)) return;
    if (!(user.isGM || ship === partyShip() || ship.testUserPermission(user, "OWNER"))) return notifyUser(user.id, "warn", "You can't refuel that ship.");
    const fu = fuel(ship);
    const want = Math.max(0, Math.floor(Number(units) || 0)), room = fu.max ? Math.max(0, fu.max - fu.value) : want;
    const n = Math.min(want, room);
    if (!n) return notifyUser(user.id, "info", `${ship.name}'s tanks are already full.`);
    const cost = n * fu.price;
    if (payer && !user.isGM) {
      if (!payer.testUserPermission(user, "OWNER")) return;
      if (getCredits(payer) < cost) return notifyUser(user.id, "warn", `${payer.name} needs ${cost} cr for ${n} fuel.`);
      await setCredits(payer, getCredits(payer) - cost);
      await record({ from: payer, to: "Fuel depot", amount: cost, memo: `${n} fuel for ${ship.name}` });
    }
    await ship.update(fuelUpdate(ship, fu.value + n));
    notifyUser(user.id, "info", `${ship.name}: +${n} fuel${payer && !user.isGM ? ` for ${cost} cr` : ""}.`);
  });
  registerHandler("dockCargo", async ({ shipId, op, item, cargoId }, user) => {
    const ship = game.actors.get(shipId);
    if (!ship || !(user.isGM || ship === partyShip() || ship.testUserPermission(user, "OWNER"))) return;
    await editCargo(ship, (list) => {
      if (op === "add" && item?.name) list.push({ id: foundry.utils.randomID(), name: String(item.name).slice(0, 80),
        qty: Math.max(1, Number(item.qty) || 1), tons: Math.max(0, Number(item.tons) || 0) });
      if (op === "remove") return list.filter((c) => c.id !== cargoId);
      return list;
    });
  });
  /** Moves items from a character's inventory into the ship's hold, keeping the item so it can be unloaded again. */
  registerHandler("dockStow", async ({ shipId, actorId, itemId, qty }, user) => {
    const ship = game.actors.get(shipId), actor = game.actors.get(actorId), item = actor?.items.get(itemId);
    if (!ship || !item || !STOWABLE.includes(item.type)) return;
    if (!canWorkShip(user, ship) || !actor.testUserPermission(user, "OWNER")) return notifyUser(user.id, "warn", "You can't load that.");
    const have = Number(item.system.quantity) || 1, n = Math.min(have, Math.max(1, Math.floor(Number(qty) || have)));
    const info = shipInfo(ship), tons = itemTons(item);
    if (!user.isGM && info.cargoCap && info.cargoUsed + tons * n > info.cargoCap + 1e-9)
      return notifyUser(user.id, "warn", `${ship.name}'s hold has ${Math.max(0, Math.round((info.cargoCap - info.cargoUsed) * 100) / 100)} t free.`);
    const data = item.toObject(); delete data._id;
    if ("quantity" in data.system) data.system.quantity = 1;
    if ("equipped" in data.system) data.system.equipped = false;
    await editCargo(ship, (list) => {
      const same = list.find((c) => c.data && c.name === item.name && c.data.type === item.type);
      if (same) same.qty = (Number(same.qty) || 1) + n;
      else list.push({ id: foundry.utils.randomID(), name: item.name, img: item.img, qty: n, tons, data, from: actor.name });
      return list;
    });
    if (n >= have) await item.delete(); else await item.update({ "system.quantity": have - n });
    notifyUser(user.id, "info", `${actor.name} loaded ${n > 1 ? `${n}× ` : ""}${item.name} onto ${ship.name}.`);
  });
  /** Takes stowed items out of the hold and into a character's inventory. */
  registerHandler("dockUnload", async ({ shipId, cargoId, actorId, qty }, user) => {
    const ship = game.actors.get(shipId), actor = game.actors.get(actorId);
    const entry = (flagOf(ship).cargo ?? []).find((c) => c.id === cargoId);
    if (!ship || !actor || !entry?.data) return;
    if (!canWorkShip(user, ship) || !actor.testUserPermission(user, "OWNER")) return notifyUser(user.id, "warn", "You can't unload that.");
    const have = Number(entry.qty) || 1, n = Math.min(have, Math.max(1, Math.floor(Number(qty) || have)));
    const data = foundry.utils.deepClone(entry.data);
    const stack = "quantity" in (data.system ?? {}) ? actor.items.find((i) => i.name === data.name && i.type === data.type && "quantity" in i.system) : null;
    if (stack) await stack.update({ "system.quantity": (Number(stack.system.quantity) || 0) + n });
    else if ("quantity" in (data.system ?? {})) { data.system.quantity = n; await actor.createEmbeddedDocuments("Item", [data]); }
    else await actor.createEmbeddedDocuments("Item", Array.from({ length: n }, () => foundry.utils.deepClone(data)));
    await editCargo(ship, (list) => n >= have ? list.filter((c) => c.id !== cargoId) : list.map((c) => (c.id === cargoId ? { ...c, qty: have - n } : c)));
    notifyUser(user.id, "info", `${actor.name} took ${n > 1 ? `${n}× ` : ""}${entry.name} from ${ship.name}.`);
  });
  /** Sells a ship back to the shipyard: the seller gets the resale value and the players lose access (the GM keeps the actor). */
  registerHandler("shipSell", async ({ shipId, payerId }, user) => {
    const ship = game.actors.get(shipId), payer = game.actors.get(payerId);
    if (!ship || !isShip(ship)) return;
    if (!(user.isGM || ship.testUserPermission(user, "OWNER"))) return notifyUser(user.id, "warn", "Only the ship's owner can sell it.");
    if (!user.isGM && !payer?.testUserPermission(user, "OWNER")) return notifyUser(user.id, "warn", "Pick your character first: the credits go to them.");
    const { resale } = shipValue(ship);
    if (!resale) return notifyUser(user.id, "warn", `${ship.name} has no value set. The GM can set one on its sheet.`);
    if (partyShip() === ship) await setPartyShip("");
    const ownership = { default: 0 };
    for (const u of game.users) if (u.isGM) ownership[u.id] = 3;
    await ship.update({ ownership, [`flags.${MODULE_ID}.${FLAG}.enabled`]: false, [`flags.${MODULE_ID}.${FLAG}.soldBy`]: payer?.name ?? user.name });
    if (payer) {
      await setCredits(payer, getCredits(payer) + resale);
      await record({ from: "Shipyard", to: payer, amount: resale, memo: `sold ${ship.name}` });
    }
    notifyUser(user.id, "info", `${ship.name} sold for ${resale} cr${payer ? ` to ${payer.name}` : ""}.`);
    ChatMessage.create({ content: `<p><i class="fas fa-shuttle-space"></i> <b>${Handlebars.escapeExpression(ship.name)}</b> was sold for ${resale} cr.</p>`,
      whisper: game.users.filter((u) => u.isGM).map((u) => u.id) });
  });
  registerHandler("dockRouting", async ({ shipId, routing }, user) => {
    const ship = game.actors.get(shipId);
    if (!ship || !ROUTING[routing] || !(user.isGM || ship === partyShip() || ship.testUserPermission(user, "OWNER"))) return;
    if (ship.system?.attributes?.power) await ship.update({ "system.attributes.power.routing": routing });
    else await saveFlag(ship, { ...flagOf(ship), routing });
  });
}
