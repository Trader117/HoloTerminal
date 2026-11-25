import { MODULE_ID } from "./store.mjs";

/* Starship import: builds working SW5e starships for Foundry v12 / dnd5e 4.x from the SW5e Database's Drake's Shipyard data.
   dnd5e 4.x has no starship actor, and the SW5E module for v12 (1.2.5) ships its starships as an actor type nothing defines.
   So each ship becomes a dnd5e "space" vehicle: abilities, AC, hull as hit points and shields as temporary hit points
   (damage takes shields first), plus HoloTerminal's own flag holding the Starships of the Galaxy numbers that dnd5e
   has no field for (tier, hull and shield dice, speeds, fuel, mod slots). HoloDock reads that flag. */

export const SHIP_FOLDER = "HoloDock Ships";

/** Starships of the Galaxy size table. Hull and shield dice: tier-0 count, dice added per tier, die size. */
export const SIZES = {
  tiny: { label: "Tiny", die: 4, t0: 1, perTier: 1, fuelCap: 5, fuelCost: 25, food: 0, modSlots: 10, suites: [0, 0], modCost: 1 },
  sm:   { label: "Small", die: 6, t0: 3, perTier: 1, fuelCap: 10, fuelCost: 50, food: 10, modSlots: 20, suites: [-1, 1], modCost: 1 },
  med:  { label: "Medium", die: 8, t0: 5, perTier: 1, fuelCap: 30, fuelCost: 100, food: 120, modSlots: 30, suites: [3, 1], modCost: 2 },
  lg:   { label: "Large", die: 10, t0: 7, perTier: 1, fuelCap: 300, fuelCost: 1000, food: 240000, modSlots: 50, suites: [3, 2], modCost: 5 },
  huge: { label: "Huge", die: 12, t0: 9, perTier: 2, fuelCap: 600, fuelCost: 10000, food: 9600000, modSlots: 60, suites: [6, 3], modCost: 50 },
  grg:  { label: "Gargantuan", die: 20, t0: 11, perTier: 2, fuelCap: 1800, fuelCost: 100000, food: 576000000, modSlots: 70, suites: [10, 4], modCost: 500 }
};

/** SW5e starship skills and the ship ability each one uses. */
export const SKILLS = {
  ast: { label: "Astrogation", ability: "int" }, bst: { label: "Boost", ability: "str" }, dat: { label: "Data", ability: "int" },
  hid: { label: "Hide", ability: "dex" }, imp: { label: "Impress", ability: "cha" }, inf: { label: "Interfere", ability: "cha" },
  man: { label: "Maneuvering", ability: "dex" }, men: { label: "Menace", ability: "cha" }, pat: { label: "Patch", ability: "con" },
  prb: { label: "Probe", ability: "int" }, ram: { label: "Ram", ability: "str" }, reg: { label: "Regulation", ability: "con" },
  scn: { label: "Scan", ability: "wis" }, swn: { label: "Swindle", ability: "cha" }
};

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const mod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);

let catalog = null;
/** The bundled ships (data/starships.json): { ships: [...], items: [...] }. */
export async function loadCatalog() {
  catalog ??= await fetch(`modules/${MODULE_ID}/data/starships.json`).then((r) => r.json())
    .catch((err) => { console.error(`${MODULE_ID} | starships.json`, err); return { ships: [], items: [] }; });
  return catalog;
}

/** Hull and shield dice for a size and tier. */
export function shipDice(size, tier) {
  const s = SIZES[size] ?? SIZES.med, t = Math.max(0, Math.min(5, Number(tier) || 0));
  return { die: s.die, count: s.t0 + s.perTier * t };
}

/** Rewrites the old SW5e roll references in an item, since a dnd5e vehicle has no starship skills, hull die or tier. */
function bakeItem(item, ctx) {
  let json = JSON.stringify(item);
  json = json.replace(/(\d*)@attributes\.hull\.die/g, (m, n) => `${n || 1}d${ctx.die}`)
    .replace(/(\d*)@attributes\.shld\.die/g, (m, n) => `${n || 1}d${ctx.die}`)
    .replace(/@skills\.(\w+)\.total/g, (m, k) => `@abilities.${SKILLS[k]?.ability ?? "dex"}.mod`)
    .replace(/@details\.tier/g, String(ctx.tier))
    .replace(/@strmod/g, "@abilities.str.mod");
  return JSON.parse(json);
}

const isArmor = (i) => i.type === "equipment" && i.system?.type?.value === "starship";
const isShield = (i) => i.type === "equipment" && i.system?.type?.value === "ssshield";

/** Turns one catalog entry ({ name, size, tier, abilities, hp, space, turn, cargo, fuel, items }) into actor data. */
export function buildActor(entry, items, { linked = false } = {}) {
  const size = SIZES[entry.size] ? entry.size : "med", sz = SIZES[size];
  const tier = Math.max(0, Math.min(5, Number(entry.tier) || 0));
  const { die, count } = shipDice(size, tier);
  const abil = Object.fromEntries(ABILITIES.map((k) => [k, Number(entry.abilities?.[k]) || 10]));
  const baked = items.map((i) => bakeItem(i, { die, tier }));

  // AC: armor base + Dexterity (capped by the armor) + the tier's AC upgrade (+1 at tier 2 up to +4 at tier 5).
  const armor = baked.find((i) => isArmor(i) && i.system?.equipped !== false);
  const dexCap = armor?.system?.armor?.dex;
  const dex = mod(abil.dex), dexPart = dexCap === 0 ? 0 : dexCap ? Math.min(dex, dexCap) : dex;
  const tierAC = tier >= 2 ? tier - 1 : 0;
  const ac = (Number(armor?.system?.armor?.value) || 10) + dexPart + tierAC;
  const dr = Number(armor?.system?.attributes?.dmgred?.value) || 0;
  const shield = baked.find((i) => isShield(i) && i.system?.equipped !== false);

  // Hull and shields from the source; fix the ones stored with no maximum or a shield maximum below the shields.
  const hp = entry.hp ?? {};
  const hullMax = Math.max(Number(hp.max) || 0, Number(hp.value) || 0) || (die + mod(abil.con)) + (count - 1) * (die / 2 + 1 + mod(abil.con));
  const shieldMax = shield ? Math.max(Number(hp.temp) || 0, Number(hp.tempmax) || 0) : 0;
  const fuelCap = sz.fuelCap, suites = Math.max(0, sz.suites[0] + sz.suites[1] * mod(abil.con));

  for (const i of baked) if (i.type === "loot") foundry.utils.setProperty(i, "system.identified", true);

  return {
    name: entry.name, type: "vehicle",
    system: {
      vehicleType: "space",
      abilities: Object.fromEntries(ABILITIES.map((k) => [k, { value: abil[k] }])),
      attributes: {
        ac: { flat: ac, motionless: "" },
        hp: { value: hullMax, max: hullMax, temp: shieldMax, tempmax: 0 },
        movement: { fly: Number(entry.space) || 0, walk: 0, units: "ft", hover: true },
        capacity: { cargo: Math.round(Number(entry.cargo) || 0) },
        actions: { stations: true, value: 0 }
      },
      traits: { size },
      source: { custom: entry.source ?? "Drake's Shipyard" }
    },
    prototypeToken: { actorLink: !!linked, bar1: { attribute: "attributes.hp" } },
    items: baked,
    flags: {
      [MODULE_ID]: {
        ship: {
          enabled: true, fuel: Math.min(fuelCap, Number(entry.fuel ?? fuelCap) || 0), routing: "none", systemDamage: 0,
          sw5e: {
            size, tier, hullDie: die, hullDice: count, shieldDie: die, shieldDice: count, shieldMax,
            shieldCapacity: Number(shield?.system?.attributes?.capx?.value) || (shield ? 1 : 0),
            shieldRegen: Number(shield?.system?.attributes?.regrateco?.value) || (shield ? 1 : 0),
            ac: { armor: armor?.name ?? null, base: Number(armor?.system?.armor?.value) || 10, dex: dexPart, tier: tierAC },
            dr, space: Number(entry.space) || 0, turn: Number(entry.turn) || 0,
            fuelCap, fuelCost: sz.fuelCost, cargoCap: Number(entry.cargo) || 0, foodCap: sz.food,
            modSlots: sz.modSlots, suites, modCostMult: sz.modCost, from: entry.source ?? "Drake's Shipyard"
          }
        }
      }
    }
  };
}

/** Reads a ship straight from SW5e Database JSON: a Drake's Shipyard entry ({ name, data }) or a bare actor ({ name, system, items }). */
export function entryFromRaw(raw) {
  const d = raw?.data?.system ? raw.data : raw;
  if (!d?.system) return null;
  const s = d.system, at = s.attributes ?? {}, mv = at.movement ?? {};
  return {
    entry: {
      name: d.name ?? raw.name ?? "Starship", size: s.traits?.size ?? "med", tier: s.details?.tier ?? 0,
      abilities: Object.fromEntries(ABILITIES.map((k) => [k, s.abilities?.[k]?.value ?? 10])),
      hp: at.hp ?? {}, space: mv.space ?? mv.fly ?? 0, turn: mv.turn ?? 0, cargo: at.capacity?.cargo ?? 0,
      fuel: at.fuel?.value, source: s.details?.source?.custom ?? s.source?.custom ?? "SW5e Database"
    },
    items: (d.items ?? []).map((i) => ({ name: i.name, type: i.type, img: i.img, system: i.system, flags: i.flags }))
      .map((i) => (i.type === "loot" ? foundry.utils.mergeObject(i, { "system.identified": true }) : i))
  };
}

async function shipFolder() {
  return game.folders.find((f) => f.type === "Actor" && f.name === SHIP_FOLDER)
    ?? Folder.create({ name: SHIP_FOLDER, type: "Actor", color: "#2aa3df" });
}

/** Creates a ship actor. */
export async function createShip(entry, items, opts = {}) {
  const data = buildActor(entry, items, opts);
  data.folder = (await shipFolder())?.id;
  return Actor.create(data);
}

/** GM dialog: pick a Drake's Shipyard ship, or load a JSON file from the SW5e Database. Returns the new actor, if any. */
export async function importDialog() {
  if (!game.user.isGM) return null;
  const cat = await loadCatalog();
  const esc = foundry.utils.escapeHTML ?? ((s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`));
  const opts = cat.ships.map((s) => `<option value="${esc(s.name)}">${esc(SIZES[s.size]?.label ?? s.size)} · tier ${s.tier}</option>`).join("");
  const content = `<div class="ht-sc-dialog ht-ship-import">
    <label>Drake's Shipyard ship <input name="ship" type="text" list="ht-ship-catalog" placeholder="Start typing, e.g. B-wing or YT-1300" autofocus></label>
    <datalist id="ht-ship-catalog">${opts}</datalist>
    <label>Or a ship file from the SW5e Database <input name="file" type="file" accept=".json,application/json"></label>
    <label class="ht-check"><input name="party" type="checkbox"> Party ship (linked token, set as the party ship)</label>
    <p class="ht-dim">The ship becomes a dnd5e space vehicle in the "${SHIP_FOLDER}" folder. Hull is its hit points and shields its temporary hit points, so damage takes the shields first. Tier, hull and shield dice, speeds and fuel go to the HoloDock.</p>
  </div>`;
  const data = await foundry.applications.api.DialogV2.prompt({
    window: { title: "Import a starship" }, content, position: { width: 460 },
    ok: { label: "Import", icon: "fas fa-file-import", callback: (ev, btn) => {
      const fd = new FormData(btn.form);
      return { ship: String(fd.get("ship") ?? "").trim(), file: fd.get("file"), party: fd.get("party") === "on" };
    } }
  }).catch(() => null);
  if (!data) return null;

  let picks = [];
  if (data.file && data.file.size) {
    let json;
    try { json = JSON.parse(await data.file.text()); } catch { ui.notifications.error("That file isn't valid JSON."); return null; }
    if (Array.isArray(json?.ships) && Array.isArray(json?.items)) picks = json.ships.map((e) => ({ entry: e, items: e.items.map((n) => json.items[n]) }));
    else picks = (Array.isArray(json) ? json : [json]).map(entryFromRaw).filter(Boolean);
    if (data.ship) picks = picks.filter((p) => p.entry.name.toLowerCase() === data.ship.toLowerCase());
    if (picks.length > 1) {
      const names = picks.map((p) => p.entry.name);
      const pick = await foundry.applications.api.DialogV2.prompt({ window: { title: "Which ship?" },
        content: `<div class="ht-sc-dialog"><label>Ship <select name="n">${names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join("")}</select></label>
          <label class="ht-check"><input name="all" type="checkbox"> Import all ${names.length}</label></div>`,
        ok: { label: "Import", callback: (ev, btn) => Object.fromEntries(new FormData(btn.form)) } }).catch(() => null);
      if (!pick) return null;
      if (pick.all !== "on") picks = [picks[Number(pick.n) || 0]];
    }
  } else if (data.ship) {
    const want = data.ship.toLowerCase();
    const e = cat.ships.find((s) => s.name.toLowerCase() === want) ?? cat.ships.find((s) => s.name.toLowerCase().includes(want));
    if (e) picks = [{ entry: e, items: e.items.map((n) => cat.items[n]) }];
  }
  if (!picks.length) { ui.notifications.warn("No ship found. Pick one from the list or choose a file."); return null; }

  let last = null;
  for (const p of picks) last = await createShip(p.entry, p.items, { linked: data.party });
  if (data.party && last && picks.length === 1) await game.settings.set(MODULE_ID, "dockPartyShip", last.id);
  ui.notifications.info(picks.length === 1 ? `${last?.name} is in the HoloDock.` : `${picks.length} ships imported to the HoloDock.`);
  return last;
}
