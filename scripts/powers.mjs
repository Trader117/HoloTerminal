/* Holo-Terminal: cast SW5e force/tech powers straight from the HUD or the sheet.
   SW5e powers spend force/tech points, but dnd5e still looks for a spell slot, so its usage dialog
   warns "You have no available power slots" every time. When the caster has no slot for the power,
   we skip that dialog and cast at the power's own level without a slot; its points still get spent.
   Shift-click opens the full dialog (to change level or consumption). */

function hasSlotFor(actor, level) {
  if (level <= 0) return true;
  return Object.entries(actor?.system?.spells ?? {}).some(([key, s]) => {
    const slotLevel = num(s?.level) || num(/^spell(\d)$/.exec(key)?.[1]);
    return slotLevel >= level && num(s?.value) > 0;
  });
}
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function usePower(item, event) {
  const acts = item?.system?.activities;
  if (item?.type !== "spell" || !acts?.size || event?.shiftKey) return item.use({ event });
  const level = num(item.system.level);
  const mode = item.system.preparation?.mode;
  if (hasSlotFor(item.actor, level) || mode === "pact") return item.use({ event });
  // one activity: use it directly; several (e.g. attack + save): let dnd5e ask which, as before
  if (acts.size > 1) return item.use({ event });
  const activity = acts.contents?.[0] ?? [...acts][0];
  return activity.use({ event, consume: { spellSlot: false } }, { configure: false });
}
