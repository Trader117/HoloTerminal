import { MODULE_ID, registerHandler, notifyUser, getCredits, setCredits } from "./store.mjs";
import * as Dock from "./holodock.mjs";
import { dockedPlanet } from "./trade.mjs";
import { record } from "./bank.mjs";

/* Shipyard: wherever the party ship is docked, the crew can pay to repair hull, recharge shields, fix system damage,
   and buy SW5e starship weapons, equipment and modifications that get added to the ship. */

export const CATEGORIES = { weapons: { label: "Weapons", pack: /starshipweapons$/ }, equipment: { label: "Equipment", pack: /starshipequipment$/ },
  modifications: { label: "Modifications", pack: /starshipmodifications$/ } };

export function registerYardSettings() {
  const num = (key, name, hint, def) => game.settings.register(MODULE_ID, key, { name, hint, scope: "world", config: true, type: Number, default: def });
  num("yardHullCost", "Shipyard: hull repair (cr per point)", "Credits to restore one hull point.", 25);
  num("yardShieldCost", "Shipyard: shield recharge (cr per point)", "Credits to restore one shield point.", 10);
  num("yardSystemCost", "Shipyard: system damage repair (cr per level)", "Credits to clear one level of system damage.", 500);
  num("yardModCost", "Shipyard: modification price per grade", "SW5e modifications have no list price. They cost this much per grade (grade 0 counts as 1), times the ship size's modification multiplier.", 2000);
  num("yardMarkup", "Shipyard: price multiplier", "Multiplies every upgrade price. 1 is list price.", 1);
}

/* ---------- catalog ---------- */
let catalog = null;
export async function loadCatalog() {
  if (catalog) return catalog;
  catalog = {};
  for (const [cat, def] of Object.entries(CATEGORIES)) {
    const packs = game.packs.filter((p) => p.documentName === "Item" && def.pack.test(p.metadata.name));
    const rows = [];
    for (const p of packs) {
      const idx = await p.getIndex({ fields: ["type", "img", "system.price", "system.grade", "system.type"] });
      for (const e of idx) rows.push({ uuid: e.uuid ?? `Compendium.${p.collection}.Item.${e._id}`, name: e.name, img: e.img,
        list: Number(e.system?.price?.value ?? e.system?.price) || 0, grade: Number(e.system?.grade?.value ?? e.system?.grade) || 0,
        sub: String(e.system?.type?.value ?? "").replace(/\s*\(starship\)/i, "") });
    }
    catalog[cat] = rows.sort((a, b) => a.name.localeCompare(b.name));
  }
  return catalog;
}

const sizeOf = (ship) => ship?.items.find((i) => i.type === "starshipsize");
export function priceFor(row, ship, cat) {
  const mult = Number(game.settings.get(MODULE_ID, "yardMarkup")) || 1;
  let base = row.list;
  if (!base && cat === "modifications") {
    const sizeMult = Number(sizeOf(ship)?.system?.modCostMult) || Number(ship?.getFlag(MODULE_ID, "ship")?.sw5e?.modCostMult) || 1;
    base = Math.max(1, row.grade) * (Number(game.settings.get(MODULE_ID, "yardModCost")) || 0) * sizeMult;
  }
  return Math.round(base * mult);
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
async function charge(user, payer, cost, to, memo) {
  if (user.isGM) return true;
  if (!payer?.testUserPermission(user, "OWNER")) { notifyUser(user.id, "warn", "Pick your character first."); return false; }
  if (getCredits(payer) < cost) { notifyUser(user.id, "warn", `${payer.name} needs ${cost} cr.`); return false; }
  await setCredits(payer, getCredits(payer) - cost);
  await record({ from: payer, to, amount: cost, memo });
  return true;
}

export function registerYardHandlers() {
  registerHandler("yardRepair", async ({ kind, points, payerId }, user) => {
    const ship = Dock.partyShip(), planet = await dockedPlanet(), payer = game.actors.get(payerId);
    if (!ship || !planet) return notifyUser(user.id, "warn", "The party ship isn't docked at a world.");
    const r = repairs(ship)[kind]; if (!r?.missing) return notifyUser(user.id, "info", "Nothing to fix there.");
    const n = Math.min(r.missing, Math.max(1, Math.floor(Number(points) || r.missing))), cost = n * r.per;
    if (!await charge(user, payer, cost, `${planet.name} shipyard`, `${kind} repair ×${n} on ${ship.name}`)) return;
    const hp = ship.system.attributes.hp;
    const update = kind === "hull" ? { "system.attributes.hp.value": hp.value + n }
      : kind === "shields" ? { "system.attributes.hp.temp": (Number(hp.temp) || 0) + n }
      : { "system.attributes.systemDamage": Math.max(0, (Number(ship.system.attributes.systemDamage) || 0) - n) };
    await ship.update(update);
    notifyUser(user.id, "info", `${ship.name}: ${kind} repaired (${n}) for ${cost} cr.`);
  });
  registerHandler("yardBuy", async ({ uuid, cat, payerId }, user) => {
    const ship = Dock.partyShip(), planet = await dockedPlanet(), payer = game.actors.get(payerId);
    if (!ship || !planet) return notifyUser(user.id, "warn", "The party ship isn't docked at a world.");
    const row = (await loadCatalog())[cat]?.find((r) => r.uuid === uuid); if (!row) return;
    const item = await fromUuid(uuid); if (!item) return;
    const cost = priceFor(row, ship, cat);
    if (!await charge(user, payer, cost, `${planet.name} shipyard`, `${item.name} for ${ship.name}`)) return;
    const data = item.toObject(); delete data._id;
    await ship.createEmbeddedDocuments("Item", [data]);
    notifyUser(user.id, "info", `${item.name} installed on ${ship.name}${cost ? ` for ${cost} cr` : ""}.`);
    ChatMessage.create({ content: `<p><i class="fas fa-screwdriver-wrench"></i> ${Handlebars.escapeExpression(item.name)} installed on <b>${Handlebars.escapeExpression(ship.name)}</b> at ${Handlebars.escapeExpression(planet.name)}.</p>`, whisper: game.users.filter((u) => u.isGM).map((u) => u.id) });
  });
}
