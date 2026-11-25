import { MODULE_ID, getCredits, setCredits, registerHandler, notifyUser } from "./store.mjs";
import { GALAXY_HOOK } from "./galaxy.mjs";
import { record } from "./bank.mjs";

/* HoloDock: a ship registry for SW5e starships (and any actor the GM marks as a ship).
   Reads hull, shields, fuel, system damage and power routing from the SW5e starship data when it is there,
   and keeps its own extras (hyperdrive override, fuel capacity, cargo, location, notes) in an actor flag. */

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
  const max = num(f.fuelMax) ?? num(sys?.max) ?? num(sys?.cap) ?? num(sizeItem(a)?.system?.fuelCap);
  const value = onActor ? num(sys.value) ?? 0 : num(f.fuel) ?? max ?? 0;
  return { value, max, onActor, price: num(sizeItem(a)?.system?.fuelCost) ?? game.settings.get(MODULE_ID, "dockFuelPrice") };
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
  const size = sizeItem(a), fu = fuel(a), party = partyShip() === a;
  const shieldMax = num(hp.tempmax) ?? num(f.shieldMax);
  const cargo = (f.cargo ?? []).map((c) => ({ ...c }));
  const cargoUsed = cargo.reduce((s, c) => s + (num(c.tons) ?? 0) * (num(c.qty) ?? 1), 0);
  const routing = at.power?.routing;
  return {
    id: a.id, uuid: a.uuid, name: a.name, img: a.img, party, native: a.type === "starship",
    owner: a.isOwner, observer: user.isGM || party || a.testUserPermission(user, "OBSERVER"),
    size: size?.name?.replace(/\s*starship$/i, "") ?? (a.type === "vehicle" ? "Vehicle" : ""),
    hull: bar(hp.value, hp.max, "hull"),
    shields: shieldMax || num(hp.temp) ? bar(hp.temp, shieldMax ?? hp.temp, "shields") : null,
    fuel: { ...bar(fu.value, fu.max, "fuel"), price: fu.price },
    hyper: hyperClass(a),
    systemDamage: num(at.systemDamage),
    routing: routing !== undefined ? { value: routing, label: ROUTING[routing] ?? routing,
      options: Object.entries(ROUTING).map(([v, l]) => ({ v, l, sel: v === routing })) } : null,
    crew: crewOf(a), cargo, cargoUsed: Math.round(cargoUsed * 100) / 100, cargoCap: num(f.cargoCap) ?? num(size?.system?.cargoCap),
    location: f.location ?? "", notes: f.notes ?? ""
  };
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
  registerHandler("dockRouting", async ({ shipId, routing }, user) => {
    const ship = game.actors.get(shipId);
    if (!ship || !ROUTING[routing] || !(user.isGM || ship === partyShip() || ship.testUserPermission(user, "OWNER"))) return;
    await ship.update({ "system.attributes.power.routing": routing });
  });
}
