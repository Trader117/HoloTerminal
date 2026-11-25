import { MODULE_ID } from "./store.mjs";

/* HoloNet news: a feed of headlines the GM writes, plus stories written automatically from what the crew does
   (big trades, jumps, hyperspace events, finished missions, cantina wins). Automatic stories wait for the GM's
   approval by default. */

export const NEWS_HOOK = `${MODULE_ID}.news`;
const MAX = 200;
export const TAGS = ["Galactic", "Local", "Trade", "Crime", "Politics", "Rumor", "Sport"];
const SOURCES = ["HoloNet Central", "Outer Rim Gazette", "Core Courier", "Spacer's Bulletin", "Trade Spine Report"];

export function registerNewsSettings() {
  game.settings.register(MODULE_ID, "news", { scope: "world", config: false, type: Array, default: [], onChange: () => Hooks.callAll(NEWS_HOOK) });
  game.settings.register(MODULE_ID, "newsAuto", { name: "HoloNet news: automatic stories",
    hint: "Stories written from what the crew does (big trades, jumps, hyperspace events, missions, cantina wins).",
    scope: "world", config: true, type: String, default: "queue",
    choices: { queue: "Write them, wait for GM approval", publish: "Publish straight away", off: "Off" } });
}

export const stories = () => foundry.utils.deepClone(game.settings.get(MODULE_ID, "news") ?? []);
export const published = () => stories().filter((s) => !s.pending).sort((a, b) => b.ts - a.ts);
export const pending = () => stories().filter((s) => s.pending).sort((a, b) => b.ts - a.ts);
const save = (list) => game.settings.set(MODULE_ID, "news", list.slice(-MAX));

const lastRead = () => Number(game.user.getFlag(MODULE_ID, "newsRead")) || 0;
export const unread = () => published().filter((s) => s.ts > lastRead()).length;
export const markRead = () => game.user.setFlag(MODULE_ID, "newsRead", Date.now());

/** GM: add a story. */
export async function post({ headline, body = "", source = "", tag = "Galactic", pending: wait = false, auto = false }) {
  if (!game.user.isGM || !headline?.trim()) return;
  const list = stories();
  list.push({ id: foundry.utils.randomID(), ts: Date.now(), headline: headline.trim().slice(0, 140), body: String(body).slice(0, 2000),
    source: source || SOURCES[Math.floor(Math.random() * SOURCES.length)], tag: TAGS.includes(tag) ? tag : "Galactic", pending: wait, auto });
  await save(list);
}
export async function approve(id) { const l = stories(); const s = l.find((x) => x.id === id); if (s) { s.pending = false; s.ts = Date.now(); await save(l); } }
export async function remove(id) { await save(stories().filter((x) => x.id !== id)); }
export async function edit(id, data) { const l = stories(); const s = l.find((x) => x.id === id); if (s) { Object.assign(s, data); await save(l); } }

/* ---------- automatic stories ---------- */
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const TEMPLATES = {
  sale: (d) => ({ tag: "Trade", headline: pick([`${d.good} prices wobble on ${d.planet} after unscheduled freighter sale`, `Independent hauler unloads ${d.tons} tons of ${d.good.toLowerCase()} at ${d.planet}`, `${d.planet} brokers report sudden ${d.good.toLowerCase()} surplus`]),
    body: pick([`Dockworkers at ${d.planet} say a lone freighter offloaded ${d.tons} tons of ${d.good.toLowerCase()} and was gone before the paperwork cleared.`, `Local traders were caught off guard as ${d.tons} tons of ${d.good.toLowerCase()} hit the ${d.planet} exchange in a single afternoon.`]) }),
  restricted: (d) => ({ tag: "Crime", headline: pick([`Authorities investigate ${d.good.toLowerCase()} shipment on ${d.planet}`, `Contraband ${d.good.toLowerCase()} turns up in ${d.planet} markets`]),
    body: `Sources on ${d.planet} report ${d.tons} tons of ${d.good.toLowerCase()} changing hands. Officials declined to comment.` }),
  arrival: (d) => ({ tag: "Local", headline: pick([`Traffic control logs arrival at ${d.planet}`, `${d.planet} spaceport reports busy shift`, `Unregistered freighter makes planetfall on ${d.planet}`]),
    body: `${d.planet} traffic control confirmed a light freighter dropping out of hyperspace after a ${d.time} run${d.from ? ` from ${d.from}` : ""}.` }),
  event: (d) => ({ tag: "Galactic", headline: pick([`Spacers warn of trouble near ${d.planet || "the Hydian Way"}: ${d.name.toLowerCase()}`, `${d.name} reported on hyperspace route${d.planet ? ` to ${d.planet}` : ""}`]),
    body: `Pilots on the lanes are passing word of an incident: ${d.text}` }),
  mission: (d) => ({ tag: "Rumor", headline: pick([`Word on the street: "${d.title}" is done`, `Cantina talk turns to a job well done`, `Unnamed crew credited with "${d.title}"`]),
    body: d.giver ? `Those close to ${d.giver} say the matter has been settled.` : "Nobody's saying who did it, but everyone's saying it was done." }),
  nova: (d) => ({ tag: "Sport", headline: pick([`Nova! Cantina gambler hits 23 against the house`, `House loses ${d.amount} credits on a single hand of Nova`]),
    body: `Regulars watched a stranger hit a perfect 23 and walk away ${d.amount} credits richer.` })
};

/** Called on the GM client when something newsworthy happens. */
export async function auto(kind, data) {
  if (!game.user.isGM) return;
  const mode = game.settings.get(MODULE_ID, "newsAuto");
  if (mode === "off" || !TEMPLATES[kind]) return;
  const s = TEMPLATES[kind](data);
  await post({ ...s, pending: mode === "queue", auto: true });
}
