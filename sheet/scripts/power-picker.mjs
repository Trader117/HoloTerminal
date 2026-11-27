/**
 * Holo-Terminal power picker: choose force or tech powers to learn from the compendiums.
 * SW5e classes have no power-choice advancement, so dnd5e's level-up never asks for powers.
 * The sheet opens this after a level-up when a character knows fewer powers than they may,
 * and the Powers tab has a Learn button for any time.
 */
const MODULE_ID = "holo-terminal";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
export const CAST_SCHOOLS = { force: ["lgt", "uni", "drk"], tech: ["tec"] };
const ORDINAL = ["At-will", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** What the actor may still learn of one cast type. known.max is from sw5e-module; older versions have none. */
export function powerAllowance(actor, castType) {
  const pc = actor.system.powercasting?.[castType] ?? {};
  const owned = (actor.itemTypes.spell ?? []).filter((p) => CAST_SCHOOLS[castType].includes(p.system.school)).length;
  const known = pc.known ?? {};
  const max = Number.isFinite(Number(known.max)) && known.max !== null && known.max !== "" ? Number(known.max) : null;
  const value = Number.isFinite(Number(known.value)) ? Number(known.value) : owned;
  const progressionKey = `${castType}Progression`;
  const caster = (actor.itemTypes.class ?? []).some((c) => {
    const p = c.system.spellcasting?.[progressionKey] ?? c.system.powercasting?.[castType]?.progression;
    return p && p !== "none";
  });
  // max power level: sw5e-module's figure when present, else the highest level the character could cast
  const maxLevel = num(pc.maxPowerLevel, caster ? 9 : 0);
  return { caster, value, max, remaining: max === null ? null : Math.max(0, max - value), maxLevel };
}

/** Index every power of a cast type in the world's Item compendiums, one entry per name. */
async function indexPowers(castType) {
  const schools = new Set(CAST_SCHOOLS[castType]);
  const byName = new Map();
  const packs = [...game.packs].filter((p) => p.documentName === "Item")
    // SW5e's own packs first, so their copy wins when another pack repeats a power
    .sort((a, b) => (b.metadata.packageName?.startsWith("sw5e") ? 1 : 0) - (a.metadata.packageName?.startsWith("sw5e") ? 1 : 0));
  for (const pack of packs) {
    let index;
    try { index = await pack.getIndex({ fields: ["system.level", "system.school"] }); } catch(err) { continue; }
    for (const e of index) {
      if (e.type !== "spell" || !schools.has(e.system?.school)) continue;
      const key = e.name.toLowerCase();
      if (byName.has(key)) continue;
      byName.set(key, { uuid: e.uuid ?? `Compendium.${pack.collection}.${e._id}`, name: e.name, img: e.img, level: num(e.system?.level), school: e.system.school, pack: pack.title });
    }
  }
  return [...byName.values()].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

export class HoloPowerPicker extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, castType, options = {}) {
    super(options);
    this.actor = actor;
    this.castType = castType;
  }

  static DEFAULT_OPTIONS = {
    // ht-themed: the Holo-Terminal window theme (styles/foundry-theme.css) frames it like Foundry's other windows
    classes: ["holo-picker", "ht-themed"],
    position: { width: 560, height: 680 },
    window: { resizable: true, icon: "fa-solid fa-atom" },
    actions: { learn: HoloPowerPicker.#onLearn, skip: HoloPowerPicker.#onSkip, preview: HoloPowerPicker.#onPreview }
  };

  static PARTS = { body: { template: `modules/${MODULE_ID}/sheet/templates/power-picker.hbs`, scrollable: [".holo-picker-list"] } };

  get title() { return `${this.actor.name}: learn ${this.castType} powers`; }

  /** Open one picker per actor and cast type. */
  static open(actor, castType) {
    const id = `holo-power-picker-${actor.id}-${castType}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) return existing.render({ force: true });
    return new HoloPowerPicker(actor, castType, { id }).render({ force: true });
  }

  async _prepareContext() {
    const allow = powerAllowance(this.actor, this.castType);
    const owned = new Set((this.actor.itemTypes.spell ?? []).map((p) => p.name.toLowerCase()));
    const schoolCfg = CONFIG.DND5E?.spellSchools ?? {};
    const powers = (await indexPowers(this.castType))
      .filter((p) => p.level <= allow.maxLevel && !owned.has(p.name.toLowerCase()))
      .map((p) => ({ ...p, search: p.name.toLowerCase(), schoolLabel: game.i18n.localize(schoolCfg[p.school]?.label ?? p.school) }));
    const levels = [...new Set(powers.map((p) => p.level))].map((l) => ({ level: l, label: ORDINAL[l] ?? `${l}th`, powers: powers.filter((p) => p.level === l) }));
    const label = this.castType === "tech" ? "Tech" : "Force";
    return {
      label, castType: this.castType, levels, empty: !powers.length, allow,
      limitText: allow.max === null ? "No powers-known limit found: pick what your class table allows."
        : allow.remaining ? `Choose up to ${allow.remaining} more (${allow.value} of ${allow.max} known).`
        : `You already know ${allow.value} of ${allow.max} powers.`
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    const el = this.element;
    const limit = context.allow.remaining || null; // already full: no cap, the count still shows
    const boxes = [...el.querySelectorAll("input.holo-pick")];
    const count = el.querySelector(".holo-picker-count");
    const learn = el.querySelector("[data-action=learn]");
    const sync = () => {
      const n = boxes.filter((b) => b.checked).length;
      count.textContent = limit === null ? `${n} selected` : `${n} / ${limit} selected`;
      learn.disabled = !n;
      if (limit !== null) boxes.forEach((b) => { b.disabled = !b.checked && n >= limit; });
    };
    boxes.forEach((b) => b.addEventListener("change", sync));
    // search and level filter only hide rows, so ticked powers stay ticked
    const search = el.querySelector(".holo-picker-search");
    let level = "all";
    const filter = () => {
      const q = search.value.trim().toLowerCase();
      el.querySelectorAll(".holo-picker-level").forEach((group) => {
        const show = level === "all" || group.dataset.level === level;
        let any = false;
        group.querySelectorAll(".holo-picker-row").forEach((row) => {
          const hit = show && (!q || row.dataset.name.includes(q));
          row.hidden = !hit; any ||= hit;
        });
        group.hidden = !any;
      });
    };
    search?.addEventListener("input", filter);
    el.querySelectorAll(".holo-picker-chip").forEach((chip) => chip.addEventListener("click", () => {
      level = chip.dataset.level;
      el.querySelectorAll(".holo-picker-chip").forEach((c) => c.classList.toggle("active", c === chip));
      filter();
    }));
    sync();
  }

  static async #onLearn() {
    const uuids = [...this.element.querySelectorAll("input.holo-pick:checked")].map((b) => b.value);
    if (!uuids.length) return;
    const docs = (await Promise.all(uuids.map((u) => fromUuid(u)))).filter(Boolean);
    const data = docs.map((d) => game.items.fromCompendium(d));
    await this.actor.createEmbeddedDocuments("Item", data);
    ui.notifications.info(`${this.actor.name} learned ${docs.map((d) => d.name).join(", ")}.`);
    return this.close();
  }

  static #onSkip() { return this.close(); }

  static async #onPreview(event, target) {
    const doc = await fromUuid(target.closest("[data-uuid]").dataset.uuid);
    doc?.sheet?.render(true);
  }
}
