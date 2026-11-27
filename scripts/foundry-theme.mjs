/**
 * Holo-Terminal look for the rest of Foundry: core windows and dialogs (Configure Settings, the Escape menu,
 * context menus, tooltips), dnd5e's own sheets and dialogs (item sheets, Long Rest, roll dialogs) and, optionally,
 * the sidebar, chat and hotbar. Colours come from styles/theme.css (SW5e Database scheme); the CSS is in
 * styles/foundry-theme.css and only applies to elements tagged here, so the stock look returns when it is off.
 *
 * Also registers "Holo-Terminal" item sheets: dnd5e's item sheets (every tab, activity and advancement still works)
 * that always wear the theme, so single items can be themed even with the global theme off.
 */
const MODULE_ID = "holo-terminal";
const THEMED = "ht-themed";
const FORCED_DARK = "ht-forced-dark";
/** Holo-Terminal's own windows already have their own look. */
const OWN = ".ht-app, .holo-sheet, .holo-npc, .holo-ship, .ht-frameless";
const MODES = ["off", "windows", "full"];

const mode = () => {
  try { return game.settings.get(MODULE_ID, "uiTheme"); } catch { return "windows"; }
};
const skipSelector = () => {
  try { return String(game.settings.get(MODULE_ID, "uiThemeSkip") ?? "").trim(); } catch { return ""; }
};
const elementOf = (app) => {
  const el = app?.element?.[0] ?? app?.element;
  return el instanceof HTMLElement ? el : null;
};
const matches = (el, sel) => {
  if (!sel) return false;
  try { return el.matches(sel); } catch { return false; } // a typo in the setting must not break rendering
};

/** A framed window or dialog (not the sidebar, hotbar, HUDs or other built-in UI). */
function isWindow(el) {
  if (el.matches(".window-app, .dialog")) return true;
  return el.matches(".application") && !!el.querySelector(":scope > .window-header");
}

/** Add or remove the theme on one rendered application. */
export function tagApp(app) {
  const el = elementOf(app);
  if (!el) return;
  const forced = el.classList.contains("holo-item"); // our item sheets are always themed
  const on = forced || (mode() !== "off" && isWindow(el) && !el.matches(OWN) && !matches(el, skipSelector()));
  el.classList.toggle(THEMED, on);
  // dnd5e sheets: switch on dnd5e's own dark styles too, then theme.css recolours them
  const dnd = el.classList.contains("dnd5e2");
  if (on && dnd && !el.classList.contains("dnd5e-theme-dark")) {
    el.classList.add("dnd5e-theme-dark", FORCED_DARK);
  } else if (!on && el.classList.contains(FORCED_DARK)) {
    el.classList.remove("dnd5e-theme-dark", FORCED_DARK);
  }
}

function openApps() {
  const v1 = Object.values(ui.windows ?? {});
  const v2 = [...(foundry.applications.instances?.values() ?? [])];
  return [...v1, ...v2];
}

/** Body classes for the parts of the UI that aren't windows (menus, tooltips, sidebar, chat). */
function applyBody() {
  const m = mode();
  document.body.classList.toggle("ht-ui-windows", m !== "off");
  document.body.classList.toggle("ht-ui-full", m === "full");
}

function refresh() {
  applyBody();
  for (const app of openApps()) tagApp(app);
}

function registerItemSheets() {
  const items = globalThis.dnd5e?.applications?.item;
  if (!items?.ItemSheet5e2) return;
  const DSC = foundry.applications.apps?.DocumentSheetConfig ?? DocumentSheetConfig;
  const holo = (Base) => class extends Base {
    static get defaultOptions() {
      const options = super.defaultOptions;
      options.classes = [...new Set([...(options.classes ?? []), THEMED, "holo-item"])];
      return options;
    }
  };
  const HoloItemSheet = holo(items.ItemSheet5e2);
  Object.defineProperty(HoloItemSheet, "name", { value: "HoloItemSheet" });
  const types = Object.keys(CONFIG.Item.dataModels ?? {}).filter((t) => t !== "container" && t !== "base");
  DSC.registerSheet(Item, MODULE_ID, HoloItemSheet, {
    types: types.length ? types : undefined, makeDefault: false, label: "HOLOTHEME.ItemSheet"
  });
  if (items.ContainerSheet2) {
    const HoloContainerSheet = holo(items.ContainerSheet2);
    Object.defineProperty(HoloContainerSheet, "name", { value: "HoloContainerSheet" });
    DSC.registerSheet(Item, MODULE_ID, HoloContainerSheet, {
      types: ["container"], makeDefault: false, label: "HOLOTHEME.ContainerSheet"
    });
  }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "uiTheme", {
    name: "HOLOTHEME.Setting.Name", hint: "HOLOTHEME.Setting.Hint",
    scope: "client", config: true, type: String, default: "windows",
    choices: Object.fromEntries(MODES.map((m) => [m, `HOLOTHEME.Setting.${m}`])),
    onChange: () => refresh()
  });
  game.settings.register(MODULE_ID, "uiThemeSkip", {
    name: "HOLOTHEME.Skip.Name", hint: "HOLOTHEME.Skip.Hint",
    scope: "client", config: true, type: String, default: ".monks-enhanced-journal",
    onChange: () => refresh()
  });
  applyBody();
  registerItemSheets();
});

Hooks.once("ready", () => refresh());
// v1 windows (most core config apps, dnd5e item sheets) and v2 windows (DialogV2, dnd5e's rest/roll dialogs)
Hooks.on("renderApplication", (app) => tagApp(app));
Hooks.on("renderApplicationV2", (app) => tagApp(app));
