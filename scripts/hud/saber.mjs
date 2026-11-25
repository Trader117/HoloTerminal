/* Holo-Terminal Combat HUD: lightsaber glow toggle for tokens whose actor carries a lightweapon. */

// Names SW5e uses for lightweapons (lightsaber, saberstaff, shoto, lightfoil, saberwhip, lightring...).
const SABER_NAME = /saber|lightfoil|shoto|lightring|lightclub|light ?whip|light ?baton|lightpike/i;

export const PALETTE = [
  { name: "Blue", hex: "#3aa0ff" }, { name: "Green", hex: "#33ff77" }, { name: "Red", hex: "#ff3a3a" },
  { name: "Purple", hex: "#b45bff" }, { name: "Yellow", hex: "#ffd23a" }, { name: "White", hex: "#f2f7ff" },
  { name: "Orange", hex: "#ff8a2a" }, { name: "Pink", hex: "#ff4fd8" }
];
const DEFAULT_COLOR = PALETTE[0].hex;

export function registerSaberSettings(moduleId) {
  game.settings.register(moduleId, "saberSoundOn", {
    name: "Lightsaber: ignite sound", hint: "Played for everyone when a lightsaber is switched on. Leave blank for none.",
    scope: "world", config: true, type: String, filePicker: "audio", default: "media/home/lightsaber-ignition.mp3"
  });
  game.settings.register(moduleId, "saberSoundOff", {
    name: "Lightsaber: switch-off sound", hint: "Played for everyone when a lightsaber is switched off. Leave blank for none.",
    scope: "world", config: true, type: String, filePicker: "audio", default: "media/home/lightsaber-deactivation.mp3"
  });
}

export function sabersOf(actor) {
  return actor.items.filter((i) => i.type === "weapon" && SABER_NAME.test(i.name));
}

/** What the HUD needs to draw the button, or null when the actor has no lightweapon. */
export function saberState(moduleId, actor, tokenDoc) {
  const sabers = sabersOf(actor);
  if (!sabers.length) return null;
  const on = !!tokenDoc?.getFlag(moduleId, "saberOn");
  const color = savedColor(moduleId, tokenDoc);
  return { on, color, name: sabers[0].name, noToken: !tokenDoc };
}

function savedColor(moduleId, tokenDoc) {
  return tokenDoc?.getFlag(moduleId, "saberColor") ?? tokenDoc?.getFlag("world", "saberGlowColor") ?? DEFAULT_COLOR;
}

function playSound(moduleId, key) {
  const src = game.settings.get(moduleId, key);
  if (!src) return;
  const helper = foundry.audio?.AudioHelper ?? AudioHelper;
  helper.play({ src, volume: 0.8, autoplay: true, loop: false }, true);
}

async function ignite(moduleId, tokenDoc, color) {
  // Remember the token's own light (torch, glow rod...) so switching off puts it back.
  const previous = tokenDoc.light.toObject();
  await tokenDoc.update({
    light: { dim: 5, bright: 0, color, alpha: 0.6, animation: { type: "pulse", speed: 3, intensity: 2 } },
    [`flags.${moduleId}`]: { saberOn: true, saberColor: color, saberPrevLight: previous }
  });
  playSound(moduleId, "saberSoundOn");
}

async function extinguish(moduleId, tokenDoc) {
  const previous = tokenDoc.getFlag(moduleId, "saberPrevLight")
    ?? { dim: 0, bright: 0, animation: { type: null } };
  await tokenDoc.update({ light: previous, [`flags.${moduleId}.saberOn`]: false });
  playSound(moduleId, "saberSoundOff");
}

function chooseColor(current, name, lit) {
  const options = PALETTE.map((c) => `<option value="${c.hex}" ${c.hex.toLowerCase() === current.toLowerCase() ? "selected" : ""}>${c.name}</option>`).join("");
  const content = `<form class="htc-saber-form"><div class="form-group"><label>Blade colour</label>
    <select name="color">${options}</select></div>
    <p class="notes">A normal click ignites in this colour from now on. Shift-click again to change it.</p></form>`;
  return new Promise((resolve) => {
    new Dialog({
      title: `${name}: blade colour`, content, default: "on",
      buttons: {
        on: { icon: '<i class="fa-solid fa-bolt"></i>', label: lit ? "Change colour" : "Ignite",
          callback: (html) => resolve(html[0].querySelector('[name="color"]').value) },
        cancel: { label: "Cancel", callback: () => resolve(null) }
      },
      close: () => resolve(null)
    }).render(true);
  });
}

/** Click: ignite in the last colour, or switch off. Shift-click: pick a colour (recolours a lit blade). */
export async function toggleSaber(moduleId, actor, tokenDoc, event) {
  if (!tokenDoc) return ui.notifications.warn("Place and select this character's token on the scene to light a lightsaber.");
  const lit = tokenDoc.getFlag(moduleId, "saberOn");
  if (!event?.shiftKey) return lit ? extinguish(moduleId, tokenDoc) : ignite(moduleId, tokenDoc, savedColor(moduleId, tokenDoc));
  const color = await chooseColor(savedColor(moduleId, tokenDoc), sabersOf(actor)[0]?.name ?? "lightsaber", lit);
  if (!color) return;
  if (!lit) return ignite(moduleId, tokenDoc, color);
  return tokenDoc.update({ "light.color": color, [`flags.${moduleId}.saberColor`]: color });
}
