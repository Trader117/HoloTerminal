/* Holo-Terminal Combat HUD: what happens when a player clicks something. */
import { BASIC, groupOf } from "./data.mjs";
import { usePower } from "../powers.mjs";

/** dnd5e 4.1 moved rolls to a (config, dialog, message) signature. */
const modernRolls = () => foundry.utils.isNewerVersion(game.system.version, "4.0.99");

export function rollSkill(actor, skill, event) {
  return modernRolls() ? actor.rollSkill({ skill, event }) : actor.rollSkill(skill, { event });
}
export function rollSave(actor, ability, event) {
  if (modernRolls() && actor.rollSavingThrow) return actor.rollSavingThrow({ ability, event });
  return actor.rollAbilitySave(ability, { event });
}
export function rollCheck(actor, ability, event) {
  if (modernRolls() && actor.rollAbilityCheck) return actor.rollAbilityCheck({ ability, event });
  return actor.rollAbilityTest(ability, { event });
}
export function rollTool(item, event) {
  if (item.system.activities?.size) return item.use({ event });
  if (item.rollToolCheck) return item.rollToolCheck({ event });
  return item.use?.({ event });
}

/** Use an item. Returns the action-economy group it spent, if any. */
export async function useItem(item, event) {
  const result = await usePower(item, event);
  return result ? groupOf(item) : null; // cancelled dialogs return nothing
}

async function postAction(actor, token, b) {
  const content = `<div class="htc-chat"><p><b>${Handlebars.escapeExpression(actor.name)}</b> takes the <b>${b.name}</b> action.</p>`
    + `<p class="htc-chat-rule">${Handlebars.escapeExpression(b.text)}</p></div>`;
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor, token }), content });
}

/** One of the "anyone can" actions. Returns its group. */
export async function useBasic(actor, token, key, event) {
  const b = BASIC[key];
  if (!b) return null;
  await postAction(actor, token, b);
  if (b.status && CONFIG.statusEffects.some((s) => s.id === b.status) && actor.toggleStatusEffect) {
    if (!actor.statuses?.has(b.status)) await actor.toggleStatusEffect(b.status, { active: true });
  }
  if (b.skill && actor.system.skills?.[b.skill]) await rollSkill(actor, b.skill, event);
  return b.group;
}

export async function rollInitiative(actor) {
  return actor.rollInitiative({ createCombatants: false });
}

export async function endTurn() {
  try { await game.combat?.nextTurn(); }
  catch (err) { ui.notifications.warn("Only the GM can end the turn here."); console.warn(err); }
}
