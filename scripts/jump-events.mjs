import { MODULE_ID, SOCKET } from "./store.mjs";
import * as Dock from "./holodock.mjs";
import * as News from "./news.mjs";

/* Hyperspace events: when the GM makes a jump on the galaxy map there's a chance something happens on the way.
   The GM keeps a weighted table, sees the result first, and chooses whether the players see it. */

export const EVENTS_HOOK = `${MODULE_ID}.jumpEvents`;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const DEFAULT_EVENTS = [
  { name: "Pirate ambush", text: "Raiders were waiting at the reversion point. Three light fighters break from an asteroid's shadow and demand the cargo.", weight: 3, fuel: 0 },
  { name: "Hyperdrive stutter", text: "The motivator coughs mid-jump. The ship drops out early and burns extra fuel limping the rest of the way.", weight: 3, fuel: 2 },
  { name: "Distress beacon", text: "A looping distress call from a freighter adrift nearby. Its lights are on, but nobody answers.", weight: 2, fuel: 0 },
  { name: "Customs patrol", text: "A patrol cruiser hails on arrival and orders the ship to hold for inspection. Anything restricted had better be well hidden.", weight: 3, fuel: 0 },
  { name: "Nav computer drift", text: "Bad coordinates. The ship arrives a few hours off course and has to backtrack.", weight: 2, fuel: 1 },
  { name: "Hull parasites", text: "Something latched on while the ship was in the gravity well. Power flickers as it chews on the cables.", weight: 2, fuel: 0 },
  { name: "Gravity shadow", text: "An uncharted mass yanks the ship out of hyperspace in deep space. Sensors show a derelict station nearby.", weight: 1, fuel: 1 },
  { name: "Drifting cache", text: "Sensors ping an abandoned cargo pod tumbling near the arrival point. Its seals look intact.", weight: 1, fuel: 0 },
  { name: "Stowaway", text: "A noise in the cargo hold. Someone slipped aboard at the last port.", weight: 1, fuel: 0 }
];

export function registerEventSettings() {
  game.settings.register(MODULE_ID, "jumpEvents", { scope: "world", config: false, type: Array,
    default: DEFAULT_EVENTS.map((e, i) => ({ id: `default${i}`, enabled: true, ...e })), onChange: () => Hooks.callAll(EVENTS_HOOK) });
  game.settings.register(MODULE_ID, "jumpEventChance", { name: "Hyperspace events: chance per jump (%)",
    hint: "Chance that Make the jump rolls on the GM's event table. 0 turns events off.", scope: "world", config: true, type: Number, default: 30 });
}

export const events = () => foundry.utils.deepClone(game.settings.get(MODULE_ID, "jumpEvents") ?? []);
export const saveEvents = (list) => game.settings.set(MODULE_ID, "jumpEvents", list);

/** Weighted pick from the enabled events. */
export function pick() {
  const list = events().filter((e) => e.enabled && (Number(e.weight) || 0) > 0);
  const total = list.reduce((s, e) => s + Number(e.weight), 0);
  let r = Math.random() * total;
  for (const e of list) { r -= Number(e.weight); if (r <= 0) return e; }
  return list.at(-1) ?? null;
}

/** Called after a jump. Rolls the chance unless forced, then lets the GM decide what the players see. */
export async function maybeEvent({ force = false, where = "" } = {}) {
  if (!game.user.isGM) return;
  const chance = Number(game.settings.get(MODULE_ID, "jumpEventChance")) || 0;
  if (!force && Math.random() * 100 >= chance) return;
  let ev = pick();
  if (!ev) return force && ui.notifications.warn("The event table is empty.");
  for (;;) {
    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: "Hyperspace event", icon: "fas fa-meteor" },
      content: `<div class="ht-ev-dialog"><h3>${esc(ev.name)}</h3><p>${esc(ev.text)}</p>${ev.fuel ? `<p class="ht-warn">Costs ${Number(ev.fuel)} extra fuel.</p>` : ""}</div>`,
      buttons: [
        { action: "show", label: "Show players", icon: "fas fa-bullhorn", default: true },
        { action: "keep", label: "Keep it to me", icon: "fas fa-eye-slash" },
        { action: "reroll", label: "Reroll", icon: "fas fa-dice" },
        { action: "skip", label: "Nothing happens", icon: "fas fa-xmark" }
      ], rejectClose: false
    }).catch(() => "skip");
    if (choice === "reroll") { ev = pick(); continue; }
    if (!choice || choice === "skip") return;
    const ship = Dock.partyShip();
    if (ev.fuel && ship) await Dock.burnFuel(ship, Number(ev.fuel));
    const content = `<div class="ht-ev-card"><div class="ht-ev-kicker">Hyperspace event${where ? ` · ${esc(where)}` : ""}</div><h3>${esc(ev.name)}</h3><p>${esc(ev.text)}</p></div>`;
    if (choice === "show") {
      ChatMessage.create({ content });
      game.socket.emit(SOCKET, { type: "jumpAlert", name: ev.name });
      alert(ev.name);
      News.auto("event", { name: ev.name, text: ev.text, planet: where });
    } else ChatMessage.create({ content, whisper: game.users.filter((u) => u.isGM).map((u) => u.id) });
    return;
  }
}

/** Red banner across the screen for a moment. */
export function alert(name) {
  document.querySelector(".ht-ev-banner")?.remove();
  const el = document.createElement("div");
  el.className = "ht-ev-banner";
  el.innerHTML = `<i class="fas fa-triangle-exclamation"></i><span>Reverting from hyperspace</span><b>${esc(name)}</b>`;
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
}

export function initEventSocket() {
  game.socket.on(SOCKET, (msg) => { if (msg.type === "jumpAlert") alert(msg.name); });
}
