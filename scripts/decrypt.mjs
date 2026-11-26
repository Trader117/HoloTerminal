import { MODULE_ID } from "./store.mjs";

/* Encrypted terminal entries. An entry (message or file) opts in with
   "encrypted": { "dc": 15, "key": "Imperial Code Cylinder", "game": "signal", "difficulty": "normal" }
   (every field optional). Players see scrambled text until they decrypt it with a skill check,
   by carrying the key item, or by winning a slicing game. Progress is stored per user. */

const NOISE = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*/<>=+";
export const entryKey = (terminalId, kind, index) => `${terminalId}:${kind}:${index}`;

/** Deterministic garble: same input always scrambles the same way, spaces and punctuation kept. */
export function scramble(text, seed = 7) {
  let h = seed;
  return String(text ?? "").replace(/[A-Za-z0-9]/g, (ch, i) => {
    h = (h * 31 + ch.charCodeAt(0) + i) % 9973;
    return NOISE[h % NOISE.length];
  });
}
/** Scrambles the words of an HTML snippet but keeps its tags, so headings, lists and line breaks stay in place. */
export function scrambleHtml(html, seed = 7) {
  let n = seed;
  return String(html ?? "").split(/(<[^>]*>|&[#\w]+;)/g).map((part) => (part.startsWith("<") || /^&[#\w]+;$/.test(part) ? part : scramble(part, n++))).join("");
}
export const plainText = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/* GM "test as a player" session: while it's on, the GM sees terminals like a player would, and every
   unlock, decryption and failed check is kept in memory only, so nothing sticks once the test ends. */
export const test = { on: false, actor: null, unlocked: new Set(), decrypted: new Set(), decryptFailed: new Set() };
export function startTest(actor) { Object.assign(test, { on: true, actor: actor ?? null, unlocked: new Set(), decrypted: new Set(), decryptFailed: new Set() }); }
export function endTest() { Object.assign(test, { on: false, actor: null }); }

const flagList = (name) => (test.on ? test[name] : new Set(game.user.getFlag(MODULE_ID, name) ?? []));
const saveList = async (name, set) => { if (!test.on) await game.user.setFlag(MODULE_ID, name, [...set]); };
export const isDecrypted = (key) => (game.user.isGM && !test.on) || flagList("decrypted").has(key);
export const checkFailed = (key) => flagList("decryptFailed").has(key);
export async function markDecrypted(key) { const s = flagList("decrypted"); s.add(key); await saveList("decrypted", s); }
export async function markCheckFailed(key) { const s = flagList("decryptFailed"); s.add(key); await saveList("decryptFailed", s); }
export const unlockedIds = () => flagList("unlocked");
export async function unlock(id) { const s = flagList("unlocked"); s.add(id); await saveList("unlocked", s); }

export function hasKey(actor, keyName) {
  if (!actor || !keyName) return false;
  const want = keyName.trim().toLowerCase();
  return actor.items.some((i) => i.name.trim().toLowerCase() === want);
}

/** Plays a "letters locking in" effect over every text node inside an element. */
export function resolveAnimation(el, duration = 1100) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.trim()) nodes.push({ node: walker.currentNode, text: walker.currentNode.nodeValue });
  const total = nodes.reduce((n, x) => n + x.text.length, 0) || 1;
  const start = performance.now();
  const frame = (now) => {
    const done = Math.min(1, (now - start) / duration);
    let budget = Math.floor(done * total);
    for (const x of nodes) {
      const keep = Math.max(0, Math.min(x.text.length, budget));
      budget -= x.text.length;
      x.node.nodeValue = x.text.slice(0, keep) + x.text.slice(keep).replace(/[A-Za-z0-9]/g, () => NOISE[Math.floor(Math.random() * NOISE.length)]);
    }
    if (done < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
