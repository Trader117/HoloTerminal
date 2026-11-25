/* Formatting for terminal messages and files.
   A body can be plain text with simple marks (the editor's toolbar writes these):
     # Heading   ## Smaller heading   - bullet   1. numbered   --- divider   **bold**   *italic*
   Line breaks are kept. A body that is already HTML (pasted from a journal) is used as it is.
   An entry can also point at a Journal page ("journal": "<uuid>") and show that page's text. */

const HTML_RE = /<(p|div|br|ul|ol|li|h[1-6]|strong|em|b|i|u|span|hr|table|blockquote|section)\b[^>]*>/i;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const looksLikeHtml = (text) => HTML_RE.test(String(text ?? ""));

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)(.+?)(?<=\S)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?=\S)(.+?)(?<=\S)\*(?![*\w])/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_(?=\S)(.+?)(?<=\S)_(?![_\w])/g, "$1<em>$2</em>");
}

/** Turns plain text with simple marks into HTML. */
export function markdownToHtml(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [], list = null; // list: { tag, items }
  const flushPara = () => { if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); flushList(); out.push("<hr>"); continue; }
    if ((m = line.match(/^\s*(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const n = Math.min(6, m[1].length + 2); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { flushPara(); if (list?.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (list?.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; } list.items.push(m[1]); continue; }
    flushList();
    para.push(line);
  }
  flushPara(); flushList();
  return out.join("");
}

/** HTML for a body: HTML is passed through, anything else is formatted. */
export const bodyToHtml = (body) => (looksLikeHtml(body) ? String(body) : markdownToHtml(body));

/** The Journal page (or entry) an entry points at, if it still exists. */
export function linkedJournal(entry) {
  if (!entry?.journal) return null;
  try { return fromUuidSync(entry.journal) ?? null; } catch { return null; }
}

/** Raw HTML of a linked journal page, or of the first text page of a linked journal entry. */
function journalHtml(doc) {
  if (!doc) return null;
  if (doc.documentName === "JournalEntryPage") return doc.type === "text" ? doc.text?.content ?? "" : null;
  if (doc.documentName === "JournalEntry") return doc.pages?.contents?.filter((p) => p.type === "text").sort((a, b) => a.sort - b.sort)
    .map((p) => `<h3>${esc(p.name)}</h3>${p.text?.content ?? ""}`).join("") ?? null;
  return null;
}

/** Final HTML for a message or file on the datapad (journal links resolved and enriched). */
export async function entryHtml(entry) {
  const fromJournal = journalHtml(linkedJournal(entry));
  const html = fromJournal ?? bodyToHtml(entry?.body);
  if (fromJournal == null) return html;
  const TE = foundry.applications.ux?.TextEditor?.implementation ?? TextEditor;
  try { return await TE.enrichHTML(html, { async: true, secrets: game.user.isGM }); } catch { return html; }
}
