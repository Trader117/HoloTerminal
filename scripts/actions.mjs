import { MODULE_ID, registerHandler, find, upsert, notifyUser, getCredits, setCredits } from "./store.mjs";
import * as ShipImport from "./starship-import.mjs";
import { record } from "./bank.mjs";

const ownsActor = (user, actor) => actor?.testUserPermission(user, "OWNER");
const gmWhisper = (content) => ChatMessage.create({ content, whisper: ChatMessage.getWhisperRecipients("GM") });

/* Terminal controls: doors (wall id) and lights (ambient light id) on a scene. */
export async function runControl(sceneId, control) {
  const scene = game.scenes.get(control.scene) ?? game.scenes.get(sceneId) ?? canvas.scene;
  if (control.type === "door") {
    const wall = scene?.walls.get(control.id);
    if (!wall) throw new Error(`Wall ${control.id} not found on this scene`);
    const { OPEN, CLOSED } = CONST.WALL_DOOR_STATES;
    await wall.update({ ds: wall.ds === OPEN ? CLOSED : OPEN });
  } else if (control.type === "light") {
    const light = scene?.lights.get(control.id);
    if (!light) throw new Error(`Light ${control.id} not found on this scene`);
    await light.update({ hidden: !light.hidden });
  }
}

export function registerActions() {
  registerHandler("control", async ({ terminalId, index, sceneId }, user) => {
    const t = find("terminals", terminalId);
    const control = t?.controls?.[index];
    if (!control) return;
    await runControl(sceneId, control);
    if (!user.isGM) gmWhisper(`<b>${user.name}</b> used <i>${control.label}</i> on ${t.name}.`);
  });

  registerHandler("sliceResult", async ({ terminalId, success, actorName, game }, user) => {
    const t = find("terminals", terminalId);
    gmWhisper(`<b>${actorName ?? user.name}</b> ${success ? "sliced into" : "<b>failed</b> to slice"} ${t?.name ?? "a terminal"}${game ? ` (${game})` : ""}.`);
  });

  registerHandler("sliceAlarm", async ({ terminalId, label, actorName, game, pushed }, user) => {
    const t = find("terminals", terminalId), who = `<b>${actorName ?? user.name}</b>`, what = label ? `<i>${label}</i> on ${t?.name ?? "a terminal"}` : t?.name ?? "a terminal";
    gmWhisper(pushed ? `&#128680; ${who} is forcing through the alarm on ${what}. Security is alerted.`
      : `&#128680; <b>Alarm tripped:</b> ${who} ran out of tries on ${what}${game ? ` (${game})` : ""}. They can push on or back out.`);
  });

  registerHandler("decryptResult", async ({ terminalId, label, success, how, actorName }, user) => {
    const t = find("terminals", terminalId);
    gmWhisper(`<b>${actorName ?? user.name}</b> ${success ? "decrypted" : "<b>failed</b> to decrypt"} <i>${label}</i> on ${t?.name ?? "a terminal"}${how ? ` (${how})` : ""}.`);
  });

  registerHandler("claimBounty", async ({ bountyId, actorName }, user) => {
    const b = find("bounties", bountyId);
    if (!b || b.status === "completed") return;
    b.claimants ??= [];
    const name = actorName || user.name;
    if (!b.claimants.includes(name)) b.claimants.push(name);
    b.status = "claimed";
    await upsert("bounties", b);
    gmWhisper(`<b>${name}</b> took the bounty <i>${b.title}</i>.`);
  });

  registerHandler("completeBounty", async ({ bountyId, payout }, user) => {
    if (!user.isGM) return;
    const b = find("bounties", bountyId);
    if (!b) return;
    b.status = "completed";
    await upsert("bounties", b);
    if (payout && b.reward > 0 && b.claimants?.length) {
      const actors = b.claimants.map((n) => game.actors.getName(n)).filter(Boolean);
      const share = Math.floor(b.reward / Math.max(actors.length, 1));
      for (const a of actors) await setCredits(a, getCredits(a) + share);
      ChatMessage.create({ content: `Bounty <b>${b.title}</b> complete. ${actors.map((a) => a.name).join(", ")} receive ${share} credits each.` });
    }
  });

  registerHandler("buy", async ({ shopId, index, actorUuid }, user) => {
    const shop = find("shops", shopId);
    const entry = shop?.items?.[index];
    if (!entry) throw new Error("That item is no longer for sale.");
    const actor = await fromUuid(actorUuid);
    if (!ownsActor(user, actor)) throw new Error("You don't own that character.");
    if (entry.stock === 0) throw new Error(`${entry.name} is out of stock.`);
    const price = Math.round(entry.price * (shop.markup ?? 1));
    const credits = getCredits(actor);
    if (credits < price) throw new Error(`${actor.name} needs ${price} credits but has ${credits}.`);

    if (entry.kind === "ship") return buyShip({ shop, entry, actor, user, price, credits });

    let data = entry.data ? foundry.utils.deepClone(entry.data) : null; // imported shops carry the item inline
    if (!data) {
      const source = entry.uuid ? await fromUuid(entry.uuid) : null;
      if (!source) throw new Error(`Item source for ${entry.name} is missing. Ask the GM to re-add it.`);
      data = source.toObject();
    }
    delete data._id;
    if (data.system && "quantity" in data.system) data.system.quantity = 1;
    await actor.createEmbeddedDocuments("Item", [data]);
    await setCredits(actor, credits - price);
    if (entry.stock > 0) { entry.stock -= 1; await upsert("shops", shop); }

    notifyUser(user.id, "info", `${actor.name} bought ${entry.name} for ${price} credits.`);
    ChatMessage.create({ content: `<b>${actor.name}</b> bought <i>${entry.name}</i> from ${shop.name} for ${price} credits.`,
      speaker: ChatMessage.getSpeaker({ actor }) });
  });
}

/** A starship from a market: a fresh copy of a Drake's Shipyard ship, or of a ship actor the GM dropped in the editor.
 *  The buyer's players own it, it joins the HoloDock, and it remembers what it cost so it can be sold back. */
async function buyShip({ shop, entry, actor, user, price, credits }) {
  let data = null;
  if (entry.catalog) {
    const cat = await ShipImport.loadCatalog(), e = cat.ships.find((s) => s.name === entry.catalog);
    if (e) data = ShipImport.buildActor(e, e.items.map((n) => cat.items[n]));
  } else if (entry.uuid) {
    const src = await fromUuid(entry.uuid);
    if (src?.documentName === "Actor") { data = src.toObject(); delete data._id; delete data.folder; }
  }
  if (!data) throw new Error(`${entry.name} is no longer available. Ask the GM to re-add it.`);
  const owners = game.users.filter((u) => !u.isGM && actor.testUserPermission(u, "OWNER"));
  data.ownership = { default: 0, ...Object.fromEntries(owners.map((u) => [u.id, 3])) };
  data.folder = (await ShipImport.shipFolder())?.id;
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.ship.enabled`, true);
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.ship.value`, price);
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.ship.boughtBy`, actor.name);
  for (const k of ["cargo", "stations", "soldBy", "location"]) delete data.flags?.[MODULE_ID]?.ship?.[k];   // a fresh ship: empty hold, no crew
  const ship = await Actor.create(data);
  await setCredits(actor, credits - price);
  await record({ from: actor, to: shop.name, amount: price, memo: `bought ${ship.name}` });
  if (entry.stock > 0) { entry.stock -= 1; await upsert("shops", shop); }
  notifyUser(user.id, "info", `${actor.name} bought the ${ship.name} for ${price} credits. It's in the HoloDock.`);
  ChatMessage.create({ content: `<b>${actor.name}</b> bought the starship <i>${ship.name}</i> from ${shop.name} for ${price} credits.`,
    speaker: ChatMessage.getSpeaker({ actor }) });
  gmWhisper(`<p>The <b>${ship.name}</b> is a new actor in the ${ShipImport.SHIP_FOLDER} folder. Set it as the party ship from the HoloDock's Fleet tab if the crew will fly it.</p>`);
}
