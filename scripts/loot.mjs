import { MODULE_ID, registerHandler, notifyUser, getCredits, setCredits } from "./store.mjs";

/* Salvage: players take items and credits from defeated (0 HP) or GM-flagged tokens on the scene. */
export const LOOT_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];

export function isLootable(token) {
  const actor = token?.actor;
  if (!actor || actor.hasPlayerOwner) return false;
  if (token.getFlag?.(MODULE_ID, "lootable") === false) return false;
  if (token.getFlag?.(MODULE_ID, "lootable")) return true;
  const hp = actor.system?.attributes?.hp?.value;
  return typeof hp === "number" && hp <= 0;
}

/** Grid distance (in squares) between two token documents. */
function squaresBetween(a, b) {
  const g = a.parent?.grid?.size ?? canvas.grid.size;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / g;
}

export function inRange(tokenDoc, actor) {
  const reach = game.settings.get(MODULE_ID, "lootRange");
  if (!reach || reach <= 0) return true;
  const mine = tokenDoc.parent.tokens.filter((t) => t.actorId === actor?.id);
  return mine.some((t) => squaresBetween(t, tokenDoc) <= reach);
}

export function lootSummary(tokenDoc, actor) {
  const items = tokenDoc.actor.items.filter((i) => LOOT_TYPES.includes(i.type))
    .map((i) => ({ id: i.id, name: i.name, img: i.img, qty: (i.system?.quantity ?? 1) > 1 ? i.system.quantity : null }));
  return { id: tokenDoc.id, name: tokenDoc.name, img: tokenDoc.texture?.src, items,
    credits: getCredits(tokenDoc.actor), near: inRange(tokenDoc, actor) };
}

export function registerLootSetting() {
  game.settings.register(MODULE_ID, "lootRange", {
    name: "Salvage range", hint: "How many grid squares a player's token must be within to loot a body. 0 = anywhere on the scene.",
    scope: "world", config: true, type: Number, default: 2
  });
}

export function registerLootHandlers() {
  const resolve = async ({ sceneId, tokenId, actorUuid }, user) => {
    const tokenDoc = game.scenes.get(sceneId)?.tokens.get(tokenId);
    if (!tokenDoc || !isLootable(tokenDoc)) throw new Error("There's nothing to salvage there.");
    const actor = await fromUuid(actorUuid);
    if (!actor?.testUserPermission(user, "OWNER")) throw new Error("You don't own that character.");
    if (!user.isGM && !inRange(tokenDoc, actor)) throw new Error(`${actor.name} needs to be closer to ${tokenDoc.name}.`);
    return { tokenDoc, actor };
  };

  registerHandler("lootItem", async (payload, user) => {
    const { tokenDoc, actor } = await resolve(payload, user);
    const item = tokenDoc.actor.items.get(payload.itemId);
    if (!item || !LOOT_TYPES.includes(item.type)) throw new Error("That item is gone.");
    const data = item.toObject();
    delete data._id;
    await actor.createEmbeddedDocuments("Item", [data]);
    await item.delete();
    notifyUser(user.id, "info", `${actor.name} took ${item.name}.`);
    ChatMessage.create({ content: `<b>${actor.name}</b> salvaged <i>${item.name}</i> from ${tokenDoc.name}.`,
      speaker: ChatMessage.getSpeaker({ actor }) });
  });

  registerHandler("lootCredits", async (payload, user) => {
    const { tokenDoc, actor } = await resolve(payload, user);
    const amount = getCredits(tokenDoc.actor);
    if (amount <= 0) return;
    await setCredits(tokenDoc.actor, 0);
    await setCredits(actor, getCredits(actor) + amount);
    ChatMessage.create({ content: `<b>${actor.name}</b> pocketed ${amount} credits from ${tokenDoc.name}.`,
      speaker: ChatMessage.getSpeaker({ actor }) });
  });
}

/* GM: a token HUD button toggles salvage on any NPC token, dead or not. */
export function registerLootHud() {
  Hooks.on("renderTokenHUD", (hud, html) => {
    if (!game.user.isGM) return;
    const tokenDoc = hud.object?.document;
    if (!tokenDoc?.actor || tokenDoc.actor.hasPlayerOwner) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const col = root.querySelector(".col.right");
    if (!col) return;
    const on = isLootable(tokenDoc);
    const btn = document.createElement("div");
    btn.className = `control-icon${on ? " active" : ""}`;
    btn.title = on ? "Salvage: open (click to lock)" : "Salvage: locked (click to open)";
    btn.innerHTML = `<i class="fas fa-sack-dollar"></i>`;
    btn.addEventListener("click", async () => { await tokenDoc.setFlag(MODULE_ID, "lootable", !on); hud.render(); });
    col.append(btn);
  });
}
