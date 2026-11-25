import { MODULE_ID, registerHandler, notifyUser, getCredits, setCredits } from "./store.mjs";
import { record } from "./bank.mjs";

/* Nova: an original cantina card game against the house.
   Four suits of 1-11; Voids count negative. Three rounds to get your total closest to 23.
   Each round: draw a card (5 max), swap one of yours for the top discard, or hold. Between rounds the
   flux die is rolled; on a 6 every hand loses its biggest card and draws a fresh one. Winning on exactly 23 is a
   Nova (pays 3x). The house plays last and takes ties. */

export const TARGET = 23;
export const SUITS = {
  sun: { name: "Suns", icon: "fa-sun", sign: 1 },
  moon: { name: "Moons", icon: "fa-moon", sign: 1 },
  comet: { name: "Comets", icon: "fa-meteor", sign: 1 },
  void: { name: "Voids", icon: "fa-circle-half-stroke", sign: -1 }
};
const MAX_CARDS = 5;

export function registerCantinaSettings() {
  game.settings.register(MODULE_ID, "cantinaMaxBet", { name: "Cantina: table limit", hint: "Largest stake a player can put on one hand of Nova.",
    scope: "world", config: true, type: Number, default: 500 });
}

const value = (c) => c.rank * SUITS[c.suit].sign;
export const total = (hand) => hand.reduce((s, c) => s + value(c), 0);
const dist = (hand) => Math.abs(TARGET - total(hand));

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function newDeck() {
  const d = [];
  for (const suit of Object.keys(SUITS)) for (let rank = 1; rank <= 11; rank++) d.push({ suit, rank });
  return shuffle(d);
}
function draw(g) {
  if (!g.deck.length) { g.deck = shuffle(g.discard.splice(0, g.discard.length - 1)); }
  return g.deck.pop();
}

export function newGame(stake) {
  const g = { deck: newDeck(), discard: [], player: [], house: [], round: 1, phase: "play", stake, log: [], flux: null, result: null };
  g.player.push(draw(g), draw(g)); g.house.push(draw(g), draw(g)); g.discard.push(draw(g));
  return g;
}

/** Player move, then the house, then the flux die or the showdown. */
export function play(g, move, index = 0) {
  if (g.phase !== "play") return g;
  act(g, "You", g.player, move, index);
  houseTurn(g);
  if (g.round < 3) { flux(g); g.round++; } else showdown(g);
  return g;
}

function act(g, who, hand, move, index) {
  if (move === "draw" && hand.length < MAX_CARDS) { const c = draw(g); hand.push(c); g.log.push(`${who} drew a card.`); }
  else if (move === "swap" && g.discard.length && hand[index]) {
    const top = g.discard.pop(); g.discard.push(hand[index]); hand[index] = top; g.log.push(`${who} swapped for the ${label(top)}.`);
  } else g.log.push(`${who} held.`);
}

function houseTurn(g) {
  const h = g.house, now = dist(h), top = g.discard.at(-1);
  // Best swap with the top discard.
  let best = null;
  if (top) h.forEach((c, i) => { const t = [...h]; t[i] = top; const d = dist(t); if (d < now && (!best || d < best.d)) best = { i, d }; });
  // Last round: the house acts after seeing how close you are, like a dealer.
  if (g.round === 3) {
    const you = dist(g.player);
    if (now <= you) return act(g, "The house", h, "hold");
    if (best && best.d <= you) return act(g, "The house", h, "swap", best.i);
    if (h.length < MAX_CARDS) return act(g, "The house", h, "draw");
  }
  if (best && (now - best.d >= 2 || now <= 4)) return act(g, "The house", h, "swap", best.i);
  if (now >= 4 && h.length < MAX_CARDS) return act(g, "The house", h, "draw");
  act(g, "The house", h, "hold");
}

function flux(g) {
  const roll = 1 + Math.floor(Math.random() * 6);
  g.flux = roll;
  if (roll !== 6) { g.log.push(`Flux die: ${roll}. Nothing shifts.`); return; }
  for (const hand of [g.player, g.house]) {
    let i = 0; hand.forEach((c, j) => { if (Math.abs(value(c)) > Math.abs(value(hand[i]))) i = j; });
    g.discard.push(hand[i]); hand[i] = draw(g);
  }
  g.log.push("Flux die: 6! Every hand loses its biggest card and draws a new one.");
}

function showdown(g) {
  const p = dist(g.player), h = dist(g.house), nova = total(g.player) === TARGET;
  g.phase = "done";
  if (p < h) g.result = { outcome: nova ? "nova" : "win", payout: g.stake * (nova ? 3 : 2) };
  else g.result = { outcome: "lose", payout: 0, tie: p === h }; // the house takes ties
  g.log.push(`Showdown: you ${total(g.player)}, the house ${total(g.house)}.`);
}

export const label = (c) => `${c.rank} of ${SUITS[c.suit].name}`;
export const cardView = (c) => ({ ...c, value: value(c), icon: SUITS[c.suit].icon, neg: SUITS[c.suit].sign < 0, name: label(c) });

/* ---------- money, on the GM side ---------- */
const open = new Map(); // betId -> { actorId, stake }
export function registerCantinaHandlers() {
  registerHandler("cantinaBet", async ({ actorId, stake, betId }, user) => {
    const a = game.actors.get(actorId), n = Math.floor(Number(stake) || 0), max = game.settings.get(MODULE_ID, "cantinaMaxBet");
    if (!a || !a.testUserPermission(user, "OWNER") || n <= 0) return;
    if (n > max) return notifyUser(user.id, "warn", `The table limit is ${max} cr.`);
    if (getCredits(a) < n) return notifyUser(user.id, "warn", `${a.name} doesn't have ${n} cr.`);
    await setCredits(a, getCredits(a) - n);
    await record({ from: a, to: "Cantina table", amount: n, memo: "Nova stake" });
    open.set(betId, { actorId, stake: n, userId: user.id });
  });
  registerHandler("cantinaSettle", async ({ betId, outcome }, user) => {
    const bet = open.get(betId); open.delete(betId);
    if (!bet || bet.userId !== user.id) return;
    const mult = { nova: 3, win: 2 }[outcome] ?? 0, a = game.actors.get(bet.actorId);
    if (a && mult) {
      await setCredits(a, getCredits(a) + bet.stake * mult);
      await record({ from: "Cantina table", to: a, amount: bet.stake * mult, memo: outcome === "nova" ? "Nova!" : "Nova winnings" });
    }
    const verb = { nova: "hit a Nova and won", win: "won", lose: "lost" }[outcome] ?? "played for";
    const n = outcome === "lose" ? bet.stake : bet.stake * (mult - 1);
    ChatMessage.create({ content: `<p><i class="fas fa-dice"></i> <b>${Handlebars.escapeExpression(a?.name ?? "Someone")}</b> ${verb} ${n} cr at Nova.</p>` });
  });
}
