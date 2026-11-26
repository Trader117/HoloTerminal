export const MODULE_ID = "holo-terminal";
export const SOCKET = `module.${MODULE_ID}`;
export const COLLECTIONS = ["terminals", "shops", "bounties", "recordings", "missions", "contacts"];
export const CHANGED_HOOK = `${MODULE_ID}.changed`;

/* ---------- settings ---------- */
export function registerSettings() {
  for (const key of COLLECTIONS) {
    game.settings.register(MODULE_ID, key, {
      scope: "world", config: false, type: Array, default: [],
      onChange: () => Hooks.callAll(CHANGED_HOOK, key)
    });
  }
  game.settings.register(MODULE_ID, "creditsPath", {
    name: "Credits field", hint: "Actor data path holding credits. Leave on 'auto' to use SW5e credits (system.currency.gc) when the actor has them, else gold (system.currency.gp).",
    scope: "world", config: true, type: String, default: "auto"
  });
  game.settings.register(MODULE_ID, "sliceSkill", {
    name: "Slicing skill", hint: "Skill key rolled to boost slicing attempts. SW5e Technology is 'tec'.",
    scope: "world", config: true, type: String, default: game.system.id === "sw5e" ? "tec" : "inv"
  });
  game.settings.register(MODULE_ID, "bootSound", {
    name: "Boot sound", hint: "Audio played when a datapad opens.",
    scope: "world", config: true, type: String, default: "", filePicker: "audio"
  });
  game.settings.register(MODULE_ID, "tabletScale", {
    name: "Datapad & tablet size", hint: "Scales the datapad and the character sheet tablet on this screen.",
    scope: "client", config: true, type: Number, default: 0.85, range: { min: 0.6, max: 1.2, step: 0.05 },
    onChange: (scale) => {
      for (const app of foundry.applications.instances?.values() ?? []) {
        if (app.rendered && (app.id === "ht-datapad" || app.options.classes?.includes("holo-sheet"))) app.setPosition({ scale });
      }
    }
  });
  // where this player last left their datapad; null until they first drag it
  game.settings.register(MODULE_ID, "datapadPosition", { scope: "client", config: false, type: Object, default: null });
}

/* ---------- collections ---------- */
export const list = (key) => foundry.utils.deepClone(game.settings.get(MODULE_ID, key) ?? []);
export const find = (key, id) => list(key).find((x) => x.id === id);
export const findByName = (key, name) => list(key).find((x) => x.name === name || x.title === name);
export async function saveList(key, arr) { await game.settings.set(MODULE_ID, key, arr); }
export async function upsert(key, doc) {
  const arr = list(key);
  const i = arr.findIndex((x) => x.id === doc.id);
  if (i >= 0) arr[i] = doc; else arr.push(doc);
  await saveList(key, arr);
}
export async function remove(key, id) { await saveList(key, list(key).filter((x) => x.id !== id)); }

/** True when an entry is reachable on the given scene (empty scene list = everywhere). */
export function onScene(entry, sceneId = canvas.scene?.id) {
  return !entry.scenes?.length || entry.scenes.includes(sceneId);
}

/* ---------- credits ---------- */
/** Where this actor keeps its credits. The setting wins when the actor actually has that field; otherwise
 *  SW5e credits (gc, also with sw5e-module on dnd5e), a custom "cr" currency, then dnd5e gold. */
export function creditsPath(actor) {
  const has = (p) => foundry.utils.getProperty(actor ?? {}, p) !== undefined;
  const set = String(game.settings.get(MODULE_ID, "creditsPath") ?? "").trim();
  // the old default was gold; an SW5e actor's credits live in gc, so prefer that over a gp setting
  if (set === "system.currency.gp" && has("system.currency.gc")) return "system.currency.gc";
  if (set && set !== "auto" && has(set)) return set;
  return ["system.currency.gc", "system.currency.cr", "system.currency.gp"].find(has) ?? (set && set !== "auto" ? set : "system.currency.gp");
}
export function getCredits(actor) {
  const v = foundry.utils.getProperty(actor ?? {}, creditsPath(actor));
  return Number(typeof v === "object" ? v?.value : v) || 0;
}
export async function setCredits(actor, amount) {
  const path = creditsPath(actor);
  const cur = foundry.utils.getProperty(actor, path);
  await actor.update({ [typeof cur === "object" && cur !== null ? `${path}.value` : path]: Math.max(0, amount) });
}
export function itemPrice(item) {
  const p = item?.system?.price;
  return Number(typeof p === "object" ? p?.value : p) || 0;
}

/* ---------- GM request pipeline ---------- */
const handlers = {};
export function registerHandler(action, fn) { handlers[action] = fn; }

/** Runs a privileged action on the GM client (directly if we are the GM). */
export async function requestGM(action, payload = {}) {
  if (game.user.isGM) return runHandler(action, payload, game.user.id);
  if (!game.users.activeGM) return ui.notifications.warn("Holo-Terminal: no GM is connected.");
  game.socket.emit(SOCKET, { type: "request", action, payload, userId: game.user.id });
}

async function runHandler(action, payload, userId) {
  const fn = handlers[action];
  if (!fn) return;
  try { await fn(payload, game.users.get(userId)); }
  catch (err) { console.error(`${MODULE_ID} | ${action} failed`, err); notifyUser(userId, "error", err.message); }
}

export function notifyUser(userId, level, message) {
  if (userId === game.user.id) return ui.notifications[level](message);
  game.socket.emit(SOCKET, { type: "notify", userId, level, message });
}

export function initSocket(onOpen) {
  game.socket.on(SOCKET, async (msg) => {
    switch (msg.type) {
      case "request":
        if (game.user === game.users.activeGM) await runHandler(msg.action, msg.payload, msg.userId);
        break;
      case "notify":
        if (msg.userId === game.user.id) ui.notifications[msg.level](msg.message);
        break;
      case "open":
        if (!msg.userIds || msg.userIds.includes(game.user.id)) onOpen(msg.view, msg.id);
        break;
    }
  });
}
