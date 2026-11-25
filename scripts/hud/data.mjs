/* Holo-Terminal Combat HUD: turns an actor into the plain data the HUD template draws. */

const esc = (s) => Handlebars.escapeExpression(String(s ?? ""));

/** The action-economy groups, in the order they appear on the bar. */
export const GROUPS = [
  { id: "action", label: "Action", icon: "fa-solid fa-circle",
    hint: "Your main move this turn: attack, use a power, Dash, Dodge and so on. You get one per turn." },
  { id: "bonus", label: "Bonus Action", icon: "fa-solid fa-play",
    hint: "A quick extra move. You only have options here if a feature, power or item says it takes a bonus action. One per turn." },
  { id: "reaction", label: "Reaction", icon: "fa-solid fa-rotate-left",
    hint: "An instant response, even on someone else's turn (an opportunity attack, for example). One per round, refreshed at the start of your turn." },
  { id: "other", label: "Free & Other", icon: "fa-solid fa-infinity", tracked: false,
    hint: "Things with no action cost or with special timing (1 minute, legendary actions and so on)." }
];

/** Common actions everyone can take, with plain-language rules text. */
export const BASIC = {
  dash: { group: "action", name: "Dash", icon: "fa-solid fa-person-running",
    text: "Gain extra movement equal to your speed for this turn." },
  disengage: { group: "action", name: "Disengage", icon: "fa-solid fa-person-walking-arrow-right",
    text: "Your movement doesn't provoke opportunity attacks for the rest of the turn." },
  dodge: { group: "action", name: "Dodge", icon: "fa-solid fa-shield-halved", status: "dodging",
    text: "Until your next turn, attacks against you have disadvantage (if you can see the attacker) and you make Dexterity saves with advantage." },
  help: { group: "action", name: "Help", icon: "fa-solid fa-handshake-angle",
    text: "Give an ally advantage on their next ability check, or on their next attack against a creature within 5 ft of you." },
  hide: { group: "action", name: "Hide", icon: "fa-solid fa-user-secret", skill: "ste",
    text: "Make a Stealth check to hide. Click to roll it." },
  search: { group: "action", name: "Search", icon: "fa-solid fa-magnifying-glass", skill: "prc",
    text: "Look for something hidden. Click to roll Perception." },
  grapple: { group: "action", name: "Grapple / Shove", icon: "fa-solid fa-hand-fist", skill: "ath",
    text: "Replace one attack to grab a creature or push it 5 ft / knock it prone. Click to roll Athletics; the target contests with Athletics or Acrobatics." },
  ready: { group: "action", name: "Ready", icon: "fa-solid fa-hourglass-half",
    text: "Pick a trigger and an action. When the trigger happens before your next turn, you can use your reaction to do it." },
  opportunity: { group: "reaction", name: "Opportunity Attack", icon: "fa-solid fa-bolt",
    text: "When an enemy you can see leaves your reach, make one melee attack against it. Use one of your weapons below to roll it." }
};

const ITEM_SECTIONS = [
  { id: "weapon", label: "Weapons" },
  { id: "power", label: "Powers" },
  { id: "feature", label: "Features" },
  { id: "item", label: "Items" }
];

/** Activation type of an item, across dnd5e 3.x (system.activation) and 4.x (activities). */
export function activationOf(item) {
  const acts = item.system.activities;
  const first = acts?.size ? acts.contents[0] : null;
  return first?.activation?.type ?? item.system.activation?.type ?? "";
}

export function groupOf(item) {
  const t = activationOf(item);
  if (["action", "bonus", "reaction"].includes(t)) return t;
  if (!t || t === "none") return item.type === "weapon" ? "action" : null; // passive: not on the bar
  return "other";
}

function sectionOf(item) {
  if (item.type === "weapon") return "weapon";
  if (item.type === "spell") return "power";
  if (item.type === "feat") return "feature";
  return "item";
}

function onBar(item, isChar) {
  const s = item.system;
  if (item.type === "weapon") return !isChar || s.equipped !== false;
  if (item.type === "equipment") return !isChar || s.equipped !== false;
  if (item.type === "spell") {
    const prep = s.preparation ?? {};
    return !isChar || s.level === 0 || prep.mode !== "prepared" || prep.prepared;
  }
  return ["feat", "consumable", "tool", "loot", "equipment"].includes(item.type);
}

function plainText(html, max = 260) {
  const div = document.createElement("div");
  div.innerHTML = html ?? "";
  let text = (div.textContent ?? "")
    .replace(/@\w+\[[^\]]*\](?:\{([^}]*)\})?/g, (_m, label) => label ?? "")
    .replace(/\[\[\/?\w*\s*([^\]]*)\]\]/g, "$1")
    .replace(/\s+/g, " ").trim();
  if (text.length > max) text = `${text.slice(0, max).replace(/\s\S*$/, "")}…`;
  return text;
}

function damageText(labels) {
  if (typeof labels.damage === "string" && labels.damage) return labels.damage;
  if (Array.isArray(labels.damages)) return labels.damages.map((d) => d.label ?? d.formula).filter(Boolean).join(" + ");
  if (Array.isArray(labels.derivedDamage)) return labels.derivedDamage.map((d) => d.label ?? d.formula).filter(Boolean).join(" + ");
  return "";
}

function powerLevel(item) {
  const lvl = item.system.level ?? 0;
  return lvl === 0 ? "At-will" : `Level ${lvl}`;
}

function usesOf(item) {
  const u = item.system.uses ?? {};
  const max = Number(u.max) || 0;
  if (max) {
    const value = Number(u.value ?? max - (u.spent ?? 0));
    return { badge: `${value}/${max}`, left: value, text: `${value} of ${max} uses left` };
  }
  if (item.type === "consumable") {
    const q = Number(item.system.quantity ?? 1);
    return { badge: `×${q}`, left: q, text: `${q} left` };
  }
  return null;
}

function itemTile(item) {
  const labels = item.labels ?? {};
  const uses = usesOf(item);
  const meta = [];
  if (item.type === "spell") meta.push(powerLevel(item) + (labels.school ? ` ${labels.school}` : ""));
  if (labels.activation) meta.push(labels.activation);
  if (labels.range) meta.push(`Range ${labels.range}`);
  const toHit = typeof labels.toHit === "string" ? labels.toHit : (typeof labels.modifier === "string" ? labels.modifier : "");
  if (toHit) meta.push(`To hit ${toHit}`);
  const dmg = damageText(labels);
  if (dmg) meta.push(`Damage ${dmg}`);
  if (labels.save) meta.push(labels.save);
  if (uses) meta.push(uses.text);
  const desc = plainText(item.system.description?.value);
  const tooltip = `<div class="htc-tip"><h4>${esc(item.name)}</h4>`
    + (meta.length ? `<p class="htc-tip-meta">${meta.map(esc).join(" · ")}</p>` : "")
    + (desc ? `<p>${esc(desc)}</p>` : "")
    + `<p class="htc-tip-keys">Left-click to use · Right-click for full details</p></div>`;
  let badge = uses?.badge ?? "";
  if (!badge && item.type === "spell") badge = item.system.level ? `L${item.system.level}` : "";
  return {
    action: "item", id: item.id, name: item.name, img: item.img, badge, tooltip,
    depleted: uses ? uses.left <= 0 : false
  };
}

function basicTile(key) {
  const b = BASIC[key];
  const tooltip = `<div class="htc-tip"><h4>${esc(b.name)}</h4><p>${esc(b.text)}</p></div>`;
  return { action: "basic", id: key, name: b.name, icon: b.icon, tooltip };
}

function signed(n) { return n >= 0 ? `+${n}` : `${n}`; }

function crLabel(cr) {
  if (cr === undefined || cr === null) return "";
  return { 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" }[cr] ?? String(cr);
}

function subtitleOf(actor) {
  const d = actor.system.details ?? {};
  if (actor.type === "character") {
    const classes = Object.values(actor.classes ?? {}).map((c) => `${c.name} ${c.system.levels}`);
    return classes.length ? classes.join(" / ") : `Level ${d.level ?? 1}`;
  }
  const type = d.type?.value ? d.type.value[0].toUpperCase() + d.type.value.slice(1) : "";
  return [d.cr !== undefined ? `CR ${crLabel(d.cr)}` : "", type].filter(Boolean).join(" · ");
}

function rollLists(actor) {
  const abl = CONFIG.DND5E?.abilities ?? {};
  const skl = CONFIG.DND5E?.skills ?? {};
  const abilities = Object.entries(actor.system.abilities ?? {}).map(([id, a]) => {
    const save = typeof a.save === "object" ? a.save?.value : a.save;
    const label = abl[id]?.label ?? id.toUpperCase();
    return { id, label, check: signed(a.mod ?? 0), save: signed(save ?? a.mod ?? 0), proficient: !!a.proficient };
  });
  const skills = Object.entries(actor.system.skills ?? {})
    .map(([id, s]) => ({ id, label: skl[id]?.label ?? id, total: signed(s.total ?? s.mod ?? 0),
      ability: (s.ability ?? "").toUpperCase(), proficient: (s.value ?? s.proficient ?? 0) > 0 }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const tools = actor.items.filter((i) => i.type === "tool").map((i) => ({ id: i.id, label: i.name, img: i.img }));
  return { abilities, skills, tools };
}

/**
 * Build everything the HUD template needs.
 * @param {Actor} actor
 * @param {object} state  { used: Set<string>, macros: Macro[], showBasic, drawer, collapsed, help }
 */
export function buildData(actor, state) {
  const sys = actor.system;
  const attr = sys.attributes ?? {};
  const isChar = actor.type === "character";
  const hp = attr.hp ?? {};
  const hpMax = Number(hp.effectiveMax ?? hp.max) || 0;
  const hpVal = Number(hp.value) || 0;
  const pct = hpMax ? Math.clamp(Math.round((hpVal / hpMax) * 100), 0, 100) : 0;

  const combat = game.combat;
  const combatant = combat?.combatants.find((c) => c.actor?.id === actor.id || c.actorId === actor.id);
  const myTurn = !!(combat?.started && combat.combatant && combatant && combat.combatant.id === combatant.id);

  const groups = GROUPS.map((g) => ({
    ...g, tracked: g.tracked !== false, used: state.used.has(g.id),
    sections: ITEM_SECTIONS.map((s) => ({ ...s, tiles: [] }))
  }));
  const byId = Object.fromEntries(groups.map((g) => [g.id, g]));

  const items = actor.items.filter((i) => onBar(i, isChar)).sort((a, b) => {
    if (a.type === "spell" && b.type === "spell") return (a.system.level ?? 0) - (b.system.level ?? 0) || a.name.localeCompare(b.name);
    return (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name);
  });
  for (const item of items) {
    const g = groupOf(item);
    if (!g) continue;
    byId[g].sections.find((s) => s.id === sectionOf(item)).tiles.push(itemTile(item));
  }
  if (state.showBasic) {
    for (const key of Object.keys(BASIC)) {
      const g = byId[BASIC[key].group];
      (g.basic ??= []).push(basicTile(key));
    }
  }
  for (const g of groups) {
    g.sections = g.sections.filter((s) => s.tiles.length);
    if (g.basic?.length) g.sections.push({ id: "basic", label: "Anyone can", tiles: g.basic, basic: true });
    g.empty = !g.sections.length;
    // Columns of tiles: wide enough for the busiest section, capped at 4.
    g.cols = Math.clamp(Math.max(2, ...g.sections.map((s) => s.basic ? Math.ceil(s.tiles.length / 2) * 2 : s.tiles.length)), 2, 4);
  }

  const death = attr.death ?? {};
  const dying = isChar && hpVal <= 0 && hpMax > 0;
  const needsInit = !!(combatant && combatant.initiative === null);
  const canEndTurn = myTurn && !!combatant?.isOwner;
  const status = myTurn ? { kind: "turn", text: "YOUR TURN", tip: "It's your turn. Use the boxes above, then press End turn." }
    : combatant && combat?.started ? { kind: "wait", text: `ROUND ${combat.round}`, tip: `Waiting: ${combat.combatant?.name ?? "someone else"} is acting.` }
    : combatant ? { kind: "wait", text: "READY", tip: "In the encounter. Combat hasn't started yet." }
    : { kind: "idle", text: "STANDBY", tip: "Not in combat." };
  return {
    status,
    turnKeys: dying || needsInit || canEndTurn,
    theme: state.theme,
    collapsed: state.collapsed,
    help: state.help,
    drawer: state.drawer,
    saber: state.saber ?? null,
    actor: { id: actor.id, name: actor.name, img: actor.img, subtitle: subtitleOf(actor) },
    isChar,
    hp: { value: hpVal, max: hpMax, temp: Number(hp.temp) || 0, pct,
      level: pct <= 25 ? "crit" : pct <= 50 ? "hurt" : "ok" },
    ac: attr.ac?.value ?? "—",
    dc: attr.spelldc ?? null,
    speed: attr.movement?.walk ? `${attr.movement.walk} ${attr.movement.units ?? "ft"}` : null,
    dying: dying ? { success: death.success ?? 0, failure: death.failure ?? 0 } : null,
    inCombat: !!combatant,
    myTurn,
    needsInit,
    canEndTurn,
    groups: groups.filter((g) => !g.empty || g.tracked),
    macros: state.macros.map((m) => ({ uuid: m.uuid, name: m.name, img: m.img,
      tooltip: `<div class="htc-tip"><h4>${esc(m.name)}</h4><p class="htc-tip-keys">Left-click to run · Right-click to remove from this bar</p></div>` })),
    rolls: state.drawer ? rollLists(actor) : null
  };
}
