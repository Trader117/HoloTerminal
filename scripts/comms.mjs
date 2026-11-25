import { MODULE_ID, SOCKET, registerHandler, notifyUser, requestGM } from "./store.mjs";

/* Comms: in-character messages between characters, GM broadcasts and anonymous tips, plus holocalls.
   Messages live in a world setting that only the GM writes, so every send goes through the GM. */

export const COMMS_HOOK = `${MODULE_ID}.comms`;
export const CALL_HOOK = `${MODULE_ID}.holocall`;
const MAX = 600;
const MAX_LEN = 2000;

export function registerCommsSettings() {
  game.settings.register(MODULE_ID, "comms", { scope: "world", config: false, type: Array, default: [],
    onChange: () => Hooks.callAll(COMMS_HOOK) });
  game.settings.register(MODULE_ID, "commsGmRead", { name: "Comms: GM can read player messages",
    hint: "Shows every message between player characters in the GM console's Comms tab. Turn off to give players privacy (messages are still stored in the world).",
    scope: "world", config: true, type: Boolean, default: true, onChange: () => Hooks.callAll(COMMS_HOOK) });
  game.settings.register(MODULE_ID, "commsSound", { name: "Comms: message sound", hint: "Played for the recipient when a message arrives.",
    scope: "world", config: true, type: String, default: "", filePicker: "audio" });
}

/* ---------- reading ---------- */
export const messages = () => foundry.utils.deepClone(game.settings.get(MODULE_ID, "comms") ?? []);
const actorCard = (a) => (a ? { id: a.id, name: a.name, img: a.img } : null);

/** Characters that belong to players: the usual people to message. */
export function playerCharacters() {
  return game.actors.filter((a) => a.type === "character" && game.users.some((u) => !u.isGM && a.testUserPermission(u, "OWNER")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Key of the conversation a message belongs to, seen from one character. */
export function threadKey(m, meId) {
  if (m.to === "all") return "all";
  if (m.from?.id === meId) return m.to;
  return m.anon ? `anon:${m.id}` : m.from?.id ?? "unknown";
}

/** Is this message visible to a character? */
export const involves = (m, meId) => m.to === "all" || m.to === meId || m.from?.id === meId;

const lastRead = () => game.user.getFlag(MODULE_ID, "commsRead") ?? {};
export async function markRead(meId, key) {
  const r = lastRead(); r[`${meId}|${key}`] = Date.now();
  await game.user.setFlag(MODULE_ID, "commsRead", r);
}

/** Conversations for one character, newest first, with unread counts. */
export function threads(meId) {
  const read = lastRead(), map = new Map();
  for (const m of messages()) {
    if (!involves(m, meId)) continue;
    const key = threadKey(m, meId);
    const t = map.get(key) ?? { key, messages: [], unread: 0 };
    t.messages.push(m);
    if (m.from?.id !== meId && m.ts > (read[`${meId}|${key}`] ?? 0)) t.unread++;
    map.set(key, t);
  }
  return [...map.values()].map((t) => {
    const last = t.messages.at(-1), other = otherParty(t.key, last);
    return { ...t, ...other, last, preview: last.text.slice(0, 80), canReply: !t.key.startsWith("anon:") && t.key !== "unknown" && (t.key !== "all" || game.user.isGM) };
  }).sort((a, b) => b.last.ts - a.last.ts);
}
function otherParty(key, last) {
  if (key === "all") return { title: "Broadcasts", img: null, icon: "fa-tower-broadcast" };
  if (key.startsWith("anon:") || key === "unknown") return { title: last.from?.alias || "Unknown sender", img: null, icon: "fa-user-secret" };
  const a = game.actors.get(key);
  return { title: a?.name ?? last.from?.name ?? "Lost contact", img: a?.img ?? null, icon: "fa-user" };
}
export const unreadCount = (meId) => (meId ? threads(meId).reduce((s, t) => s + t.unread, 0) : 0);

/** Every message, for the GM log. */
export function gmLog({ includePrivate = game.settings.get(MODULE_ID, "commsGmRead") } = {}) {
  const pcs = new Set(playerCharacters().map((a) => a.id));
  return messages().filter((m) => includePrivate || m.gm || m.to === "all" || !(pcs.has(m.from?.id) && pcs.has(m.to))).reverse();
}

/* ---------- sending ---------- */
/** Sends from a character (players) or, for the GM, as any actor, an alias, or anonymously. */
export function send({ fromId = null, to, text, anon = false, alias = "" }) {
  text = String(text ?? "").trim();
  if (!text) return;
  return requestGM("commsSend", { fromId, to, text, anon, alias });
}

export function registerCommsHandlers() {
  registerHandler("commsSend", async ({ fromId, to, text, anon, alias }, user) => {
    const from = game.actors.get(fromId);
    if (!user.isGM) {
      if (!from || !from.testUserPermission(user, "OWNER")) return notifyUser(user.id, "warn", "Pick your character before sending.");
      if (to === "all" || anon) return;
    }
    if (to !== "all" && !game.actors.get(to)) return notifyUser(user.id, "warn", "No one at that comm code.");
    const m = { id: foundry.utils.randomID(), ts: Date.now(), to, text: String(text).slice(0, MAX_LEN),
      from: anon ? (alias ? { alias: String(alias).slice(0, 60) } : null) : actorCard(from) ?? { alias: String(alias || "Command").slice(0, 60) },
      anon: !!anon || !from, gm: user.isGM };
    const all = messages(); all.push(m);
    await game.settings.set(MODULE_ID, "comms", all.slice(-MAX));
    game.socket.emit(SOCKET, { type: "commsPing", to, fromName: m.from?.name ?? m.from?.alias ?? "Unknown" });
    ping(to, m.from?.name ?? m.from?.alias ?? "Unknown");
    // A player writing to an NPC: tell the GM so they can answer in character.
    if (!user.isGM && to !== "all" && !playerCharacters().some((a) => a.id === to))
      ui.notifications.info(`Comms: ${m.from?.name} wrote to ${game.actors.get(to)?.name}. Reply from the GM console's Comms tab.`);
  });
  registerHandler("commsClear", async (p, user) => { if (user.isGM) await game.settings.set(MODULE_ID, "comms", []); });
  registerHandler("commsDelete", async ({ id }, user) => {
    if (user.isGM) await game.settings.set(MODULE_ID, "comms", messages().filter((m) => m.id !== id));
  });
}

/** Toast and sound for whoever the message is meant for (runs on every client). */
export function ping(to, fromName) {
  const mine = to === "all" ? !game.user.isGM : game.actors.get(to)?.testUserPermission(game.user, "OWNER") && !game.user.isGM;
  if (!mine) return;
  ui.notifications.info(`Incoming transmission from ${fromName}.`);
  const src = game.settings.get(MODULE_ID, "commsSound");
  if (src) foundry.audio.AudioHelper.play({ src, volume: 0.6 }, false);
}

/* ---------- holocalls ---------- */
/** GM: open a call to some users (all players when userIds is empty). */
export function startCall({ actorId, name, img, userIds = [], line = "" }) {
  const a = game.actors.get(actorId);
  const call = { id: foundry.utils.randomID(), name: name || a?.name || "Unknown caller", img: img || a?.img || "icons/svg/mystery-man.svg",
    userIds, lines: line ? [line] : [], open: true };
  game.socket.emit(SOCKET, { type: "holocall", call });
  Hooks.callAll(CALL_HOOK, call, true);
  return call;
}
export function sayLine(call, line) {
  if (!line?.trim()) return;
  call.lines.push(line.trim());
  game.socket.emit(SOCKET, { type: "holocall", call });
  Hooks.callAll(CALL_HOOK, call, true);
}
export function endCall(call) {
  call.open = false;
  game.socket.emit(SOCKET, { type: "holocall", call });
  Hooks.callAll(CALL_HOOK, call, true);
}

export function initCommsSocket() {
  game.socket.on(SOCKET, (msg) => {
    if (msg.type === "commsPing") ping(msg.to, msg.fromName);
    if (msg.type === "holocall" && (!msg.call.userIds?.length || msg.call.userIds.includes(game.user.id))) Hooks.callAll(CALL_HOOK, msg.call, false);
  });
}
