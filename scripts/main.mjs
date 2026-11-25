import { MODULE_ID, registerSettings, initSocket, find, findByName, list } from "./store.mjs";
import { registerActions } from "./actions.mjs";
import { DatapadApp, PARTIAL_PATHS } from "./datapad.mjs";
import { ConsoleApp } from "./admin.mjs";
import { registerLootSetting, registerLootHandlers, registerLootHud } from "./loot.mjs";

const loadTpl = (paths) => (foundry.applications.handlebars?.loadTemplates ?? loadTemplates)(paths);
const datapad = (view, id) => DatapadApp.instance.show(view, id);
const resolve = (kind, ref) => find(kind, ref) ?? findByName(kind, ref);

Hooks.once("init", () => {
  registerSettings();
  registerLootSetting();
  registerLootHud();
  loadTpl(PARTIAL_PATHS);
  game.keybindings.register(MODULE_ID, "datapad", {
    name: "Open datapad", editable: [{ key: "KeyP", modifiers: ["Shift"] }],
    onDown: () => { datapad(); return true; }
  });
});

Hooks.once("ready", () => {
  registerActions();
  registerLootHandlers();
  initSocket(datapad);
  game.modules.get(MODULE_ID).api = {
    datapad: () => datapad("home"),
    console: () => game.user.isGM && ConsoleApp.instance.render(true),
    openTerminal: (ref) => { const t = resolve("terminals", ref); return t && datapad("terminal", t.id); },
    openShop: (ref) => { const s = resolve("shops", ref); return s && datapad("shop", s.id); },
    openBounties: () => datapad("bounties"),
    openSalvage: () => datapad("salvage"),
    /** GM: push a view to every player's datapad. */
    showAll: (view, ref) => {
      const kind = { terminal: "terminals", shop: "shops" }[view];
      const id = kind ? resolve(kind, ref)?.id : null;
      game.socket.emit(`module.${MODULE_ID}`, { type: "open", view, id });
      return datapad(view, id);
    },
    list
  };
});

Hooks.on("getSceneControlButtons", (controls) => {
  const pad = { name: "ht-datapad", title: "Datapad", icon: "fas fa-tablet-screen-button", button: true };
  const gm = { name: "ht-console", title: "Holo-Terminal GM Console", icon: "fas fa-terminal", button: true };
  const openPad = () => datapad();
  const openGM = () => ConsoleApp.instance.render(true);
  if (Array.isArray(controls)) { // v12
    const tools = controls.find((c) => c.name === "token")?.tools;
    tools?.push({ ...pad, onClick: openPad });
    if (game.user.isGM) tools?.push({ ...gm, onClick: openGM });
  } else if (controls.tokens) { // v13
    controls.tokens.tools["ht-datapad"] = { ...pad, onChange: openPad, order: 98 };
    if (game.user.isGM) controls.tokens.tools["ht-console"] = { ...gm, onChange: openGM, order: 99 };
  }
});
