import { MODULE_ID, registerHandler, notifyUser } from "./store.mjs";
import * as Dock from "./holodock.mjs";

/* Bridge: crew stations on the party ship for starship combat. Each character takes a station; each station shows
   the part of the ship it runs and the SW5e starship actions that belong to it. Owners of the ship use the actions
   directly; everyone else sends the order to chat for the GM to resolve. */

export const STATIONS = [
  { id: "pilot", label: "Pilot", icon: "fa-person-walking-arrow-right", actions: /^(fly|evade|dogfight|ram|attack run|harass)\b/i,
    help: "Moves the ship and keeps it alive. Evade and Dogfight are yours." },
  { id: "gunner", label: "Gunner", icon: "fa-crosshairs", actions: /^(fire|ready)\b/i, weapons: true,
    help: "Fires the ship's weapons. Pick a weapon to attack with it." },
  { id: "engineer", label: "Engineer", icon: "fa-screwdriver-wrench", actions: /^(patch|boost|regenerate)/i, power: true,
    help: "Routes power and patches the hull. Keep the shields up." },
  { id: "operator", label: "Operator", icon: "fa-satellite-dish", actions: /^(search|interfere|conceal|scan)\b/i,
    help: "Runs sensors and jamming: find the enemy, hide the ship." },
  { id: "captain", label: "Captain", icon: "fa-star", actions: /^(direct|inspire|order)\b/i,
    help: "Gives orders and helps the crew. Direct grants another station advantage." }
];
const BY_ID = new Map(STATIONS.map((s) => [s.id, s]));
const COMMON = /^(cast a power|use an object)\b/i;

export const stationsOf = (ship) => foundry.utils.deepClone(ship?.getFlag(MODULE_ID, "ship")?.stations ?? {});
export const stationFor = (ship, actorId) => Object.entries(stationsOf(ship)).find(([, id]) => id === actorId)?.[0] ?? null;

const isStarshipWeapon = (i) => i.type === "weapon" && /starship/i.test(i.system?.type?.value ?? "") || i.type === "starshipweapon";

/** What one station sees on the party ship. */
export function stationView(ship, stationId) {
  const st = BY_ID.get(stationId); if (!st || !ship) return null;
  const items = ship.items.contents ?? [...ship.items];
  const card = (i) => ({ id: i.id, name: i.name, img: i.img, cost: i.system?.activation?.cost ?? null, type: i.system?.activation?.type ?? "" });
  const actions = items.filter((i) => i.type === "feat" && (st.actions.test(i.name) || COMMON.test(i.name))).map(card)
    .sort((a, b) => COMMON.test(a.name) - COMMON.test(b.name) || a.name.localeCompare(b.name));
  const weapons = st.weapons ? items.filter(isStarshipWeapon).map((i) => ({ ...card(i), range: [i.system?.range?.value, i.system?.range?.long].filter(Boolean).join("/"),
    damage: (i.system?.damage?.parts ?? []).map((p) => p[0]).join(" + ") })) : [];
  return { ...st, actions, weapons, power: !!st.power };
}

/** Uses a ship item: directly if this user owns the ship, otherwise as an order in chat. */
export async function useItem(ship, itemId, who) {
  const item = ship?.items.get(itemId); if (!item) return;
  if (ship.isOwner) return item.use ? item.use() : item.roll?.();
  const esc = Handlebars.escapeExpression;
  ChatMessage.create({ content: `<p><i class="fas fa-shuttle-space"></i> <b>${esc(who ?? game.user.name)}</b> on the ${esc(ship.name)}: <b>${esc(item.name)}</b>.</p><p class="ht-dim">The GM resolves it (the player doesn't own the ship).</p>` });
}

export function registerBridgeHandlers() {
  registerHandler("bridgeClaim", async ({ actorId, station, shipId }, user) => {
    const ship = shipId ? game.actors.get(shipId) : Dock.partyShip(), actor = game.actors.get(actorId);
    if (!ship || !actor || (station && !BY_ID.has(station))) return;
    // a player seats their own character; the ship's owner (or the GM) can seat anyone
    const shipBoss = user.isGM || ship.testUserPermission(user, "OWNER");
    if (!shipBoss && !actor.testUserPermission(user, "OWNER")) return;
    const flag = foundry.utils.deepClone(ship.getFlag(MODULE_ID, "ship") ?? {}), s = flag.stations ?? {};
    const gone = Object.keys(s).filter((k) => s[k] === actorId);
    for (const k of gone) delete s[k];
    if (station) {
      if (s[station] && s[station] !== actorId && !shipBoss) return notifyUser(user.id, "warn", `${game.actors.get(s[station])?.name ?? "Someone"} already has that station.`);
      s[station] = actorId;
    }
    // a flag update merges, so a station someone left has to be deleted explicitly
    const path = `flags.${MODULE_ID}.ship.stations`;
    await ship.update({ [path]: s, ...Object.fromEntries(gone.filter((k) => k !== station).map((k) => [`${path}.-=${k}`, null])) });
  });
  registerHandler("bridgeClear", async ({ shipId } = {}, user) => {
    const ship = shipId ? game.actors.get(shipId) : Dock.partyShip(); if (!user.isGM || !ship) return;
    await ship.update({ [`flags.${MODULE_ID}.ship.-=stations`]: null });
  });
}
