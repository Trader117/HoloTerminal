import { registerHandler, find, upsert, notifyUser, getCredits, setCredits } from "./store.mjs";

const ownsActor = (user, actor) => actor?.testUserPermission(user, "OWNER");
const gmWhisper = (content) => ChatMessage.create({ content, whisper: ChatMessage.getWhisperRecipients("GM") });

/* Terminal controls: doors (wall id) and lights (ambient light id) on a scene. */
export async function runControl(sceneId, control) {
  const scene = game.scenes.get(sceneId) ?? canvas.scene;
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

  registerHandler("sliceResult", async ({ terminalId, success, actorName }, user) => {
    const t = find("terminals", terminalId);
    gmWhisper(`<b>${actorName ?? user.name}</b> ${success ? "sliced into" : "<b>failed</b> to slice"} ${t?.name ?? "a terminal"}.`);
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
