import { MODULE_ID, registerHandler, notifyUser, getCredits, setCredits } from "./store.mjs";

/* Credit transfers: players send credits to each other or to NPC contacts, the GM grants or fines, and every
   movement (including fuel and trade) lands in one ledger. */

export const BANK_HOOK = `${MODULE_ID}.bank`;
const MAX = 800;

export function registerBankSettings() {
  game.settings.register(MODULE_ID, "ledger", { scope: "world", config: false, type: Array, default: [], onChange: () => Hooks.callAll(BANK_HOOK) });
}
export const ledger = () => foundry.utils.deepClone(game.settings.get(MODULE_ID, "ledger") ?? []);

/** GM side: record a movement. from/to are actors or plain labels; amount is positive. */
export async function record({ from = null, to = null, amount, memo = "" }) {
  if (!game.user.isGM) return;
  const who = (x) => (x && typeof x === "object" ? { id: x.id, name: x.name } : x ? { name: String(x) } : null);
  const all = ledger();
  all.push({ id: foundry.utils.randomID(), ts: Date.now(), from: who(from), to: who(to), amount: Math.round(Number(amount) || 0), memo: String(memo).slice(0, 120) });
  await game.settings.set(MODULE_ID, "ledger", all.slice(-MAX));
}

/** Entries that touch one actor, newest first, signed from their side. */
export function historyFor(actorId) {
  return ledger().filter((e) => e.from?.id === actorId || e.to?.id === actorId).reverse()
    .map((e) => ({ ...e, signed: e.to?.id === actorId ? e.amount : -e.amount, other: e.to?.id === actorId ? e.from?.name ?? "Unknown" : e.to?.name ?? "Unknown" }));
}

export function registerBankHandlers() {
  registerHandler("bankSend", async ({ fromId, toId, amount, memo }, user) => {
    const from = game.actors.get(fromId), to = game.actors.get(toId), n = Math.floor(Number(amount) || 0);
    if (!from || !to || from === to || n <= 0) return notifyUser(user.id, "warn", "Pick who to pay and an amount.");
    if (!user.isGM && !from.testUserPermission(user, "OWNER")) return;
    if (getCredits(from) < n) return notifyUser(user.id, "warn", `${from.name} only has ${getCredits(from)} cr.`);
    await setCredits(from, getCredits(from) - n);
    await setCredits(to, getCredits(to) + n);
    await record({ from, to, amount: n, memo });
    notifyUser(user.id, "info", `Sent ${n} cr to ${to.name}.`);
    for (const u of game.users) if (!u.isGM && u.id !== user.id && to.testUserPermission(u, "OWNER")) notifyUser(u.id, "info", `${to.name} received ${n} cr from ${from.name}.`);
  });
  registerHandler("bankGrant", async ({ toId, amount, memo }, user) => {
    if (!user.isGM) return;
    const to = game.actors.get(toId), n = Math.round(Number(amount) || 0);
    if (!to || !n) return;
    await setCredits(to, Math.max(0, getCredits(to) + n));
    await record(n > 0 ? { from: "GM", to, amount: n, memo } : { from: to, to: "GM", amount: -n, memo });
    for (const u of game.users) if (!u.isGM && to.testUserPermission(u, "OWNER")) notifyUser(u.id, "info", `${to.name}: ${n > 0 ? "+" : ""}${n} cr${memo ? ` (${memo})` : ""}.`);
  });
}
