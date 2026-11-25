import { MODULE_ID, registerHandler, notifyUser, getCredits, setCredits } from "./store.mjs";
import * as G from "./galaxy.mjs";
import * as Dock from "./holodock.mjs";

/* Trade runs: every world prices a common list of cargo from what it is (terrain, climate, class) and where it is
   (Core to Rim). Prices drift when the GM shifts the markets. Buying and selling goes through the party ship's hold. */

export const GOODS = [
  { id: "food", name: "Foodstuffs", base: 60, supply: /plain|grass|farm|jungle|forest|savanna|meadow|ocean|agri/i, demand: /urban|city|desert|ice|tundra|barren|rock|asteroid/i, rim: -1 },
  { id: "water", name: "Water and ice", base: 40, supply: /ice|ocean|sea|swamp|lake|glacier|tundra|frozen/i, demand: /desert|arid|barren|volcan|rock/i, rim: 0 },
  { id: "ore", name: "Raw ore", base: 90, supply: /mountain|barren|rock|volcan|asteroid|crater|mine|canyon/i, demand: /urban|city|industrial/i, rim: -1 },
  { id: "metal", name: "Refined metals", base: 180, supply: /industrial|factory|urban|volcan/i, demand: /desert|jungle|forest|swamp|ice/i, rim: 1 },
  { id: "fuel", name: "Starship fuel", base: 120, supply: /gas giant|volcan|industrial|refiner/i, demand: /desert|ice|jungle|forest|barren/i, rim: 1 },
  { id: "textiles", name: "Textiles", base: 150, supply: /plain|forest|grass|farm/i, demand: /ice|tundra|urban|city/i, rim: 0 },
  { id: "droid", name: "Droid parts", base: 300, supply: /industrial|factory|urban|city/i, demand: /desert|swamp|jungle|ice|barren/i, rim: 1 },
  { id: "tech", name: "Electronics", base: 400, supply: /urban|city|industrial/i, demand: /desert|jungle|forest|swamp|ice|plain/i, rim: 2 },
  { id: "med", name: "Medical supplies", base: 500, supply: /urban|city|temperate/i, demand: /desert|jungle|swamp|volcan|toxic/i, rim: 2 },
  { id: "luxury", name: "Luxury goods", base: 650, supply: /jungle|forest|ocean|garden|resort|coral/i, demand: /urban|city/i, rim: -2 },
  { id: "weapons", name: "Weapons", base: 700, supply: /industrial|factory|military/i, demand: /desert|jungle|swamp|ice/i, rim: 2, restricted: true },
  { id: "spice", name: "Spice", base: 1200, supply: /desert|spice|mine|cave/i, demand: /urban|city/i, rim: -2, restricted: true }
];
const BY_ID = new Map(GOODS.map((g) => [g.id, g]));
const SPREAD = 0.08;

export function registerTradeSettings() {
  game.settings.register(MODULE_ID, "tradeSeed", { scope: "world", config: false, type: Number, default: 1, onChange: () => Hooks.callAll(Dock.DOCK_HOOK) });
  game.settings.register(MODULE_ID, "tradeRestricted", { name: "Trade: restricted goods", hint: "Lists weapons and spice on the markets. They fetch more but your table decides the risk.",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => Hooks.callAll(Dock.DOCK_HOOK) });
}

function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const noise = (s) => (hash(s) % 10000) / 10000;

/** Local price factors for a world: 1 is the galactic average. */
export function market(planet, seed = game.settings.get(MODULE_ID, "tradeSeed")) {
  const text = [planet.terrain, planet.climate, planet.cls, planet.name].filter(Boolean).join(" ");
  const ring = G.REGION_ORDER.indexOf(planet.region);
  const rimness = ring >= 0 ? (ring - 4) / 4 : 0; // Deep Core -1 ... Unknown Regions +1
  const restricted = game.settings.get(MODULE_ID, "tradeRestricted");
  return GOODS.filter((g) => restricted || !g.restricted).map((g) => {
    const supply = g.supply.test(text), demand = g.demand.test(text);
    let f = 1 + (demand ? 0.35 : 0) - (supply ? 0.35 : 0) + g.rim * 0.09 * rimness + (noise(`${planet.key}|${g.id}|${seed}`) - 0.5) * 0.3;
    f = Math.min(2.2, Math.max(0.45, f));
    const mid = g.base * f;
    return { ...g, factor: f, supply, demand, buy: Math.max(1, Math.round(mid * (1 + SPREAD))), sell: Math.max(1, Math.round(mid * (1 - SPREAD))),
      stocked: supply || f < 1.05 };
  });
}

/** Where the party ship is docked, if at a known world. */
export async function dockedPlanet() {
  const key = G.state().ship?.key; if (!key) return null;
  const galaxy = await G.loadGalaxy();
  return galaxy.byKey.get(key) ?? G.state().custom.find((c) => c.key === key) ?? null;
}

/** Short summary for a planet card: cheapest exports, best imports. */
export function summary(planet) {
  const m = market(planet).sort((a, b) => a.factor - b.factor);
  return { exports: m.filter((g) => g.factor < 0.9).slice(0, 3).map((g) => g.name), imports: m.filter((g) => g.factor > 1.15).slice(-3).reverse().map((g) => g.name) };
}

const tonsUsed = (cargo) => cargo.reduce((s, c) => s + (Number(c.tons) || 0) * (Number(c.qty) || 1), 0);

export function registerTradeHandlers() {
  registerHandler("tradeBuy", async ({ goodId, tons, payerId }, user) => {
    const ship = Dock.partyShip(), planet = await dockedPlanet(), payer = game.actors.get(payerId);
    if (!ship || !planet) return notifyUser(user.id, "warn", "The party ship isn't docked at a world.");
    const g = market(planet).find((x) => x.id === goodId);
    if (!g?.stocked) return notifyUser(user.id, "warn", "That isn't for sale here.");
    const info = Dock.shipInfo(ship);
    let n = Math.max(1, Math.floor(Number(tons) || 1));
    if (info.cargoCap) n = Math.min(n, Math.floor(info.cargoCap - info.cargoUsed));
    if (n <= 0) return notifyUser(user.id, "warn", `${ship.name}'s hold is full.`);
    const cost = n * g.buy;
    if (!user.isGM) {
      if (!payer?.testUserPermission(user, "OWNER")) return notifyUser(user.id, "warn", "Pick your character first.");
      if (getCredits(payer) < cost) return notifyUser(user.id, "warn", `${payer.name} needs ${cost} cr for ${n} t of ${g.name}.`);
      await setCredits(payer, getCredits(payer) - cost);
    }
    await Dock.editCargo(ship, (list) => {
      const c = list.find((x) => x.good === g.id);
      if (c) { c.paid = Math.round(((c.paid ?? g.buy) * c.qty + g.buy * n) / (c.qty + n)); c.qty += n; }
      else list.push({ id: foundry.utils.randomID(), good: g.id, name: g.name, qty: n, tons: 1, paid: g.buy, from: planet.name });
      return list;
    });
    notifyUser(user.id, "info", `Loaded ${n} t of ${g.name} for ${cost} cr.`);
  });
  registerHandler("tradeSell", async ({ goodId, tons, payerId }, user) => {
    const ship = Dock.partyShip(), planet = await dockedPlanet(), payer = game.actors.get(payerId);
    if (!ship || !planet) return notifyUser(user.id, "warn", "The party ship isn't docked at a world.");
    const g = market(planet).find((x) => x.id === goodId);
    const cargo = Dock.shipInfo(ship).cargo.find((c) => c.good === goodId);
    if (!g || !cargo) return;
    const n = Math.min(cargo.qty, Math.max(1, Math.floor(Number(tons) || 1))), earn = n * g.sell;
    if (!user.isGM && !payer?.testUserPermission(user, "OWNER")) return notifyUser(user.id, "warn", "Pick your character first.");
    if (payer) await setCredits(payer, getCredits(payer) + earn);
    await Dock.editCargo(ship, (list) => list.map((c) => (c.good === goodId ? { ...c, qty: c.qty - n } : c)).filter((c) => c.qty > 0));
    const profit = earn - n * (cargo.paid ?? g.sell);
    notifyUser(user.id, "info", `Sold ${n} t of ${g.name} for ${earn} cr (${profit >= 0 ? "+" : ""}${profit} cr).`);
    const esc = Handlebars.escapeExpression;
    if (!user.isGM) ChatMessage.create({ content: `<p><b>${esc(payer?.name ?? "")}</b> sold ${n} t of ${g.name} at ${esc(planet.name)} for ${earn} cr.</p>`, whisper: game.users.filter((u) => u.isGM).map((u) => u.id) });
  });
}

export { tonsUsed, BY_ID };
