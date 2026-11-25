import { MODULE_ID } from "./store.mjs";

/** Rolls a skill for an actor (dnd5e 3.x/4.x and SW5e), falling back to a plain d20. Returns the total, or null if cancelled. */
export async function rollSkill(actor, skill) {
  if (actor?.rollSkill) {
    try {
      const modern = game.system.id === "dnd5e" && foundry.utils.isNewerVersion(game.system.version, "4.0.99");
      let roll = modern ? await actor.rollSkill({ skill }) : await actor.rollSkill(skill);
      if (Array.isArray(roll)) roll = roll[0];
      if (roll?.total !== undefined) return roll.total;
      return null; // dialog cancelled
    } catch (err) { console.warn(`${MODULE_ID} | skill roll failed, falling back to d20`, err); }
  }
  const roll = await new Roll("1d20").evaluate();
  await roll.toMessage({ flavor: "Slicing check", speaker: ChatMessage.getSpeaker({ actor }) });
  return roll.total;
}
