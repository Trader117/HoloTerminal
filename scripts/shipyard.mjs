import { MODULE_ID, registerHandler, notifyUser, getCredits, setCredits, itemPrice } from "./store.mjs";
import * as Dock from "./holodock.mjs";
import { dockedPlanet } from "./trade.mjs";
import { record } from "./bank.mjs";

/* Shipyard: wherever the party ship is docked, the crew can pay to repair hull, recharge shields and fix system damage,
   buy weapons, systems, ammunition and modifications (within the ship's mod slot and suite limits), and sell parts back.
   The parts catalog is data/shipyard.json, built from the SW5e Database (tools/build-starships.py), plus any SW5e
   starship compendium items that load in this version. */

export const CATEGORIES = {
  weapons: { label: "Weapons", pack: /starshipweapons$/, icon: "icons/svg/sword.svg" },
  equipment: { label: "Systems", pack: /starshipequipment$/, icon: "icons/svg/shield.svg" },
  ammo: { label: "Ammunition", pack: null, icon: "icons/svg/explosion.svg" },
  modifications: { label: "Modifications", pack: /starshipmodifications$/, icon: "icons/svg/upgrade.svg" }
};
/** SotG modification base cost by category (credits), multiplied by the size's modification cost modifier. */
export const MOD_BASE = { Engineering: 3500, Operation: 3500, Suite: 5000, Universal: 4000, Weapon: 3000 };
/** SotG: the DC to install a modification, by grade (rows) and ship tier (columns). */
const INSTALL_DC = [[10, 9, 8, 7, 6, 5], [17, 12, 11, 10, 9, 8], [24, 19, 14, 13, 12, 11], [31, 26, 21, 16, 15, 14], [38, 33, 28, 23, 18, 17], [45, 40, 35, 30, 25, 20]];
/** Ship systems a ship has one of: buying a new one replaces the old. */
export const SINGLE_SYSTEMS = { starship: "armor", ssshield: "shield", reactor: "reactor", powerc: "power coupling", hyper: "hyperdrive" };

export function registerYardSettings() {
  const num = (key, name, hint, def) => game.settings.register(MODULE_ID, key, { name, hint, scope: "world", config: true, type: Number, default: def });
  num("yardHullCost", "Shipyard: hull repair (cr per point)", "Credits to restore one hull point.", 25);
  num("yardShieldCost", "Shipyard: shield recharge (cr per point)", "Credits to restore one shield point.", 10);
  num("yardSystemCost", "Shipyard: system damage repair (cr per level)", "Credits to clear one level of system damage.", 500);
  num("yardModCost", "Shipyard: price of a modification with no category", "Modifications are priced by category (SotG: Engineering and Operation 3,500, Suite 5,000, Universal 4,000, Weapon 3,000) times the ship size's modification cost modifier. This price is used for a modification with no category.", 4000);
  num("yardMarkup", "Shipyard: price multiplier", "Multiplies every upgrade price. 1 is list price.", 1);
  num("yardResale", "Shipyard: resale value", "Share of the price paid back when the crew sells a part or a ship. 0.5 is half.", 0.5);
}

/* ---------- catalog ---------- */
let catalog = null;
const subOf = (d) => String(d?.system?.type?.value ?? "");
const SUB_LABEL = { starship: "Armor", ssshield: "Shield", reactor: "Reactor", powerc: "Power coupling", hyper: "Hyperdrive", ammo: "Ammunition" };
const subLabel = (d) => { const s = subOf(d); return SUB_LABEL[s] ?? s.replace(/\s*\(starship\)/i, "").replace(/^\w/, (c) => c.toUpperCase()); };

export async function loadCatalog() {
  if (catalog) return catalog;
  catalog = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, []]));
  let built = {};
  try { built = await (await fetch(`modules/${MODULE_ID}/data/shipyard.json`)).json(); }
  catch (err) { console.warn(`${MODULE_ID} | shipyard catalog missing`, err); }
  const seen = new Set();
  for (const cat of Object.keys(CATEGORIES)) for (const [i, d] of (built[cat] ?? []).entries()) {
    const mod = d.flags?.[MODULE_ID]?.mod;
    catalog[cat].push({ key: `${cat}:${i}`, cat, name: d.name, img: d.img || CATEGORIES[cat].icon, list: itemPrice(d),
      sub: mod ? mod.category : subLabel(d), system: subOf(d), category: mod?.category ?? null, grade: mod ? Number(mod.grade) || 0 : null,
      prereq: mod?.prereq ?? "", data: d });
    seen.add(`${cat}:${d.name.toLowerCase()}`);
  }
  // SW5e compendium items that are valid in this version (v12's SW5E packs also hold types dnd5e 4.x can't load).
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    if (!def.pack) continue;
    for (const p of game.packs.filter((pk) => pk.documentName === "Item" && def.pack.test(pk.metadata.name))) {
      const idx = await p.getIndex({ fields: ["type", "img", "system.price", "system.type"] });
      for (const e of idx) {
        if (!CONFIG.Item.dataModels?.[e.type] && !game.system.documentTypes?.Item?.[e.type]) continue;
        if (seen.has(`${cat}:${e.name.toLowerCase()}`)) continue;
        catalog[cat].push({ key: e.uuid ?? `Compendium.${p.collection}.Item.${e._id}`, uuid: e.uuid ?? `Compendium.${p.collection}.Item.${e._id}`, cat,
          name: e.name, img: e.img || def.icon, list: itemPrice(e), sub: subLabel(e), system: subOf(e), category: null, grade: null, prereq: "" });
      }
    }
  }
  for (const rows of Object.values(catalog)) rows.sort((a, b) => a.name.localeCompare(b.name));
  return catalog;
}
export async function findRow(key) {
  const cat = await loadCatalog();
  for (const rows of Object.values(cat)) { const r = rows.find((x) => x.key === key); if (r) return r; }
  return null;
}

/** The ship's modification cost modifier (SotG: Tiny ×0.5 … Gargantuan ×500). */
const modMult = (ship) => Number(ship?.items.find((i) => i.type === "starshipsize")?.system?.modCostMult)
  || Number(ship?.getFlag(MODULE_ID, "ship")?.sw5e?.modCostMult) || 1;
export function priceFor(row, ship) {
  const mult = Number(game.settings.get(MODULE_ID, "yardMarkup")) || 1;
  let base = row.list;
  if (!base && row.cat === "modifications") base = (MOD_BASE[row.category] ?? (Number(game.settings.get(MODULE_ID, "yardModCost")) || 0)) * modMult(ship);
  return Math.round(base * mult);
}
export const installDC = (grade, tier) => INSTALL_DC[Math.max(0, Math.min(5, grade ?? 0))]?.[Math.max(0, Math.min(5, tier ?? 0))] ?? null;

/** Mod slots and suites a ship uses and has. */
export function limits(ship) {
  const ss = ship?.getFlag(MODULE_ID, "ship")?.sw5e ?? {};
  const mods = ship?.items.filter((i) => i.type === "loot" && i.getFlag(MODULE_ID, "mod")) ?? [];
  const n = (v) => (v === undefined || v === null || v === "" ? null : Number(v));
  return { used: mods.length, slots: n(ss.modSlots), suites: mods.filter((i) => i.getFlag(MODULE_ID, "mod")?.category === "Suite").length,
    suiteMax: n(ss.suites), tier: Number(ss.tier) || 0 };
}
/** Why this row can't be installed on the ship, or "". */
export function blocker(row, ship, lim = limits(ship)) {
  if (row.cat !== "modifications") return "";
  if (lim.slots !== null && lim.used >= lim.slots) return `All ${lim.slots} modification slots are full`;
  if (row.category === "Suite" && lim.suiteMax !== null && lim.suites >= lim.suiteMax) return `The ship has its maximum of ${lim.suiteMax} suites`;
  return "";
}

/** Parts on the ship the crew can sell, with what the shipyard pays for each. */
export async function installed(ship) {
  const cat = await loadCatalog(), resale = Number(game.settings.get(MODULE_ID, "yardResale")) || 0;
  const all = Object.values(cat).flat();
  const kindOf = (i) => (i.type === "weapon" && /\(starship\)/.test(subOf(i)) ? "weapons" : i.type === "equipment" && SINGLE_SYSTEMS[subOf(i)] ? "equipment"
    : i.type === "consumable" && subOf(i) === "ammo" ? "ammo" : i.type === "loot" && i.getFlag(MODULE_ID, "mod") ? "modifications" : null);
  return ship.items.filter(kindOf).map((i) => {
    const paid = Number(i.getFlag(MODULE_ID, "paid"));
    const row = all.find((r) => r.cat === kindOf(i) && r.name.toLowerCase() === i.name.toLowerCase());
    const mod = i.getFlag(MODULE_ID, "mod");
    const worth = paid || (row ? priceFor(row, ship) : itemPrice(i)) || (mod ? priceFor({ cat: "modifications", list: 0, category: mod.category }, ship) : 0);
    return { id: i.id, name: i.name, img: i.img, kind: kindOf(i), label: CATEGORIES[kindOf(i)].label, sub: mod?.category ?? subLabel(i),
      qty: i.type === "consumable" ? i.system.quantity : null, value: Math.floor(worth * resale) };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

/** What needs fixing and what it costs. */
export function repairs(ship) {
  const info = Dock.shipInfo(ship);
  const hullMissing = info.hull.max ? Math.max(0, info.hull.max - info.hull.value) : 0;
  const shieldMissing = info.shields?.max ? Math.max(0, info.shields.max - info.shields.value) : 0;
  const sys = info.systemDamage ?? 0;
  const g = (k) => Number(game.settings.get(MODULE_ID, k)) || 0;
  return { info, hull: { missing: hullMissing, per: g("yardHullCost"), cost: hullMissing * g("yardHullCost") },
    shields: { missing: shieldMissing, per: g("yardShieldCost"), cost: shieldMissing * g("yardShieldCost") },
    systems: { missing: sys, per: g("yardSystemCost"), cost: sys * g("yardSystemCost") } };
}

/* ---------- GM side ---------- */
export async function charge(user, payer, cost, to, memo) {
  if (user.isGM || !cost) return true;
  if (!payer?.testUserPermission(user, "OWNER")) { notifyUser(user.id, "warn", "Pick your character first."); return false; }
  if (getCredits(payer) < cost) { notifyUser(user.id, "warn", `${payer.name} needs ${cost} cr but has ${getCredits(payer)}.`); return false; }
  await setCredits(payer, getCredits(payer) - cost);
  await record({ from: payer, to, amount: cost, memo });
  return true;
}
export async function pay(user, payee, amount, from, memo) {
  if (!payee || !amount) return;
  await setCredits(payee, getCredits(payee) + amount);
  await record({ from, to: payee, amount, memo });
}
const gmWhisper = (html) => ChatMessage.create({ content: html, whisper: game.users.filter((u) => u.isGM).map((u) => u.id) });
const esc = (s) => Handlebars.escapeExpression(s);
const canWork = (user, ship) => user.isGM || ship === Dock.partyShip() || ship.testUserPermission(user, "OWNER");

export function registerYardHandlers() {
  registerHandler("yardRepair", async ({ kind, points, payerId }, user) => {
    const ship = Dock.partyShip(), planet = await dockedPlanet(), payer = game.actors.get(payerId);
    if (!ship || !planet) return notifyUser(user.id, "warn", "The party ship isn't docked at a world.");
    const r = repairs(ship)[kind]; if (!r?.missing) return notifyUser(user.id, "info", "Nothing to fix there.");
    const n = Math.min(r.missing, Math.max(1, Math.floor(Number(points) || r.missing))), cost = n * r.per;
    if (!await charge(user, payer, cost, `${planet.name} shipyard`, `${kind} repair ×${n} on ${ship.name}`)) return;
    const hp = ship.system.attributes.hp, ff = `flags.${MODULE_ID}.ship.systemDamage`;
    const sysOnActor = "systemDamage" in (ship.system.attributes ?? {});
    const update = kind === "hull" ? { "system.attributes.hp.value": hp.value + n }
      : kind === "shields" ? { "system.attributes.hp.temp": (Number(hp.temp) || 0) + n }
      : sysOnActor ? { "system.attributes.systemDamage": Math.max(0, (Number(ship.system.attributes.systemDamage) || 0) - n) }
      : { [ff]: Math.max(0, (Number(ship.getFlag(MODULE_ID, "ship")?.systemDamage) || 0) - n) };
    await ship.update(update);
    notifyUser(user.id, "info", `${ship.name}: ${kind} repaired (${n}) for ${cost} cr.`);
  });

  registerHandler("yardBuy", async ({ key, payerId, qty }, user) => {
    const ship = Dock.partyShip(), planet = await dockedPlanet(), payer = game.actors.get(payerId);
    if (!ship || !planet) return notifyUser(user.id, "warn", "The party ship isn't docked at a world.");
    const row = await findRow(key); if (!row) return notifyUser(user.id, "warn", "That part is no longer listed.");
    const why = blocker(row, ship);
    if (why && !user.isGM) return notifyUser(user.id, "warn", `${why}. Sell a modification first.`);
    const n = row.cat === "ammo" ? Math.max(1, Math.floor(Number(qty) || 1)) : 1;
    const each = priceFor(row, ship), cost = each * n;
    let data = row.data ? foundry.utils.deepClone(row.data) : (await fromUuid(row.uuid))?.toObject();
    if (!data) return notifyUser(user.id, "warn", `${row.name} couldn't be loaded.`);
    if (!await charge(user, payer, cost, `${planet.name} shipyard`, `${row.name}${n > 1 ? ` ×${n}` : ""} for ${ship.name}`)) return;
    delete data._id;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.paid`, each);
    if (row.cat === "ammo") {
      const have = ship.items.find((i) => i.type === "consumable" && i.name === row.name);
      if (have) { await have.update({ "system.quantity": (Number(have.system.quantity) || 0) + n }); return notifyUser(user.id, "info", `${n} ${row.name} loaded on ${ship.name} for ${cost} cr.`); }
      data.system.quantity = n;
    }
    // One armor, shield, reactor, power coupling and hyperdrive: the old one comes out (and is sold back).
    let swapped = "";
    if (row.cat === "equipment" && SINGLE_SYSTEMS[row.system]) {
      const old = ship.items.filter((i) => i.type === "equipment" && subOf(i) === row.system);
      if (old.length) {
        const credit = (await installed(ship)).filter((p) => old.some((o) => o.id === p.id)).reduce((s, p) => s + p.value, 0);
        await ship.deleteEmbeddedDocuments("Item", old.map((o) => o.id));
        if (credit && payer) await pay(user, payer, credit, `${planet.name} shipyard`, `trade-in: ${old.map((o) => o.name).join(", ")}`);
        swapped = ` (replaced ${old.map((o) => o.name).join(", ")}${credit ? `, ${credit} cr trade-in` : ""})`;
      }
      data.system.equipped = true;
    }
    await ship.createEmbeddedDocuments("Item", [data]);
    const dc = row.cat === "modifications" ? installDC(row.grade, limits(ship).tier) : null;
    notifyUser(user.id, "info", `${row.name} installed on ${ship.name}${cost ? ` for ${cost} cr` : ""}${swapped}.`);
    gmWhisper(`<p><i class="fas fa-screwdriver-wrench"></i> ${esc(row.name)} installed on <b>${esc(ship.name)}</b> at ${esc(planet.name)}${dc ? ` (SotG install DC ${dc})` : ""}${esc(swapped)}.</p>${why ? `<p><b>Over the limit:</b> ${esc(why)}.</p>` : ""}`);
  });

  registerHandler("yardSell", async ({ itemId, payerId, qty }, user) => {
    const ship = Dock.partyShip(), planet = await dockedPlanet(), payer = game.actors.get(payerId);
    if (!ship || !planet) return notifyUser(user.id, "warn", "The party ship isn't docked at a world.");
    if (!canWork(user, ship)) return;
    const part = (await installed(ship)).find((p) => p.id === itemId), item = ship.items.get(itemId);
    if (!part || !item) return;
    if (!user.isGM && !payer?.testUserPermission(user, "OWNER")) return notifyUser(user.id, "warn", "Pick your character first: the credits go to them.");
    const n = part.qty ? Math.min(part.qty, Math.max(1, Math.floor(Number(qty) || part.qty))) : 1, total = part.value * n;
    if (part.qty && n < part.qty) await item.update({ "system.quantity": part.qty - n });
    else await item.delete();
    if (payer) await pay(user, payer, total, `${planet.name} shipyard`, `sold ${item.name}${n > 1 ? ` ×${n}` : ""} from ${ship.name}`);
    notifyUser(user.id, "info", `Sold ${item.name}${n > 1 ? ` ×${n}` : ""} for ${total} cr${payer ? ` to ${payer.name}` : ""}.`);
    gmWhisper(`<p><i class="fas fa-hand-holding-dollar"></i> ${esc(item.name)}${n > 1 ? ` ×${n}` : ""} sold from <b>${esc(ship.name)}</b> for ${total} cr.</p>`);
  });
}
