import { MODULE_ID, registerSettings, initSocket, find, findByName, list } from "./store.mjs";
import { registerActions } from "./actions.mjs";
import { DatapadApp, PARTIAL_PATHS, NAMED_PARTIALS } from "./datapad.mjs";
import { ConsoleApp } from "./admin.mjs";
import { registerRegionBehavior } from "./regions.mjs";
import { registerScannerSettings, registerSignatureBehavior } from "./scanner.mjs";
import { initScanSocket, openScanner, runScan } from "./scan-wheel.mjs";
import { registerGalaxySettings } from "./galaxy.mjs";
import { registerDockSettings, registerDockHandlers } from "./holodock.mjs";
import { registerCommsSettings, registerCommsHandlers, initCommsSocket, send as commsSend, startCall } from "./comms.mjs";
import { HolocallApp } from "./holocall.mjs";
import { registerTradeSettings, registerTradeHandlers } from "./trade.mjs";
import { registerEventSettings, initEventSocket, maybeEvent } from "./jump-events.mjs";
import { registerBankSettings, registerBankHandlers } from "./bank.mjs";
import { registerBridgeHandlers } from "./bridge.mjs";
import { registerYardSettings, registerYardHandlers } from "./shipyard.mjs";
import { registerNewsSettings, post as postNews } from "./news.mjs";
import { GalaxyMapApp } from "./galaxy-app.mjs";
import { registerLootSetting, registerLootHandlers, registerLootHud } from "./loot.mjs";

const loadTpl = (paths) => (foundry.applications.handlebars?.loadTemplates ?? loadTemplates)(paths);
const datapad = (view, id) => DatapadApp.instance.show(view, id);
const resolve = (kind, ref) => find(kind, ref) ?? findByName(kind, ref);

Hooks.once("init", () => {
  registerSettings();
  registerLootSetting();
  registerLootHud();
  registerRegionBehavior((view, id) => (view === "galaxy" ? GalaxyMapApp.instance.render(true) : datapad(view, id)));
  registerScannerSettings();
  registerGalaxySettings();
  registerDockSettings();
  registerCommsSettings();
  registerTradeSettings();
  registerEventSettings();
  registerBankSettings();
  registerYardSettings();
  registerNewsSettings();
  registerSignatureBehavior();
  loadTpl([...PARTIAL_PATHS, ...Object.values(NAMED_PARTIALS)]);
  loadTpl(NAMED_PARTIALS); // also register the short names, e.g. {{> cryptEntry}}
  game.keybindings.register(MODULE_ID, "datapad", {
    name: "Open datapad", editable: [{ key: "KeyP", modifiers: ["Shift"] }],
    onDown: () => { datapad(); return true; }
  });
  game.keybindings.register(MODULE_ID, "scanner", {
    name: "Open Pulse Scanner", hint: "Players: the scanner wheel for your token. GM: the Scanners tab (or the wheel if a token is selected).",
    editable: [], onDown: () => { openScanner({ ConsoleApp }); return true; }
  });
});

Hooks.once("ready", () => {
  registerActions();
  registerLootHandlers();
  registerDockHandlers();
  registerCommsHandlers();
  registerTradeHandlers();
  initEventSocket();
  registerBankHandlers();
  registerBridgeHandlers();
  registerYardHandlers();
  initCommsSocket();
  HolocallApp.register();
  initSocket(datapad);
  initScanSocket();
  game.modules.get(MODULE_ID).api = {
    datapad: () => datapad("home"),
    console: () => game.user.isGM && ConsoleApp.instance.render(true),
    openTerminal: (ref) => { const t = resolve("terminals", ref); return t && datapad("terminal", t.id); },
    openShop: (ref) => { const s = resolve("shops", ref); return s && datapad("shop", s.id); },
    openBounties: () => datapad("bounties"),
    openSalvage: () => datapad("salvage"),
    openScanner: () => openScanner({ ConsoleApp }),
    openHoloDock: (actorId = null) => datapad("holodock", actorId),
    openComms: () => datapad("comms"),
    openTrade: () => datapad("trade"),
    openCredits: () => datapad("bank"),
    openBridge: () => datapad("bridge"),
    openShipyard: () => datapad("shipyard"),
    openNews: () => datapad("news"),
    /** GM: publish a HoloNet story { headline, body, source, tag }. */
    postNews: (story) => postNews(story),
    /** GM: roll on the hyperspace event table now. */
    jumpEvent: () => maybeEvent({ force: true }),
    /** Send a comms message: { fromId | anon + alias, to: actorId | "all", text }. */
    sendComms: (opts) => commsSend(opts),
    /** GM: holocall from an actor to some users (all players if none given). */
    holocall: (opts) => game.user.isGM && startCall(opts),
    galaxy: () => GalaxyMapApp.instance.render(true),
    scan: (actor, scannerId, opts) => runScan(actor, scannerId, opts),
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
  const scan = { name: "ht-scanner", title: "Pulse Scanner", icon: "fas fa-satellite-dish", button: true };
  const openScan = () => openScanner({ ConsoleApp });
  const gx = { name: "ht-galaxy", title: "Galaxy Map", icon: "fas fa-earth-americas", button: true };
  const openGx = () => GalaxyMapApp.instance.render(true);
  if (Array.isArray(controls)) { // v12
    const tools = controls.find((c) => c.name === "token")?.tools;
    tools?.push({ ...pad, onClick: openPad }, { ...scan, onClick: openScan }, { ...gx, onClick: openGx });
    if (game.user.isGM) tools?.push({ ...gm, onClick: openGM });
  } else if (controls.tokens) { // v13
    controls.tokens.tools["ht-datapad"] = { ...pad, onChange: openPad, order: 97 };
    controls.tokens.tools["ht-scanner"] = { ...scan, onChange: openScan, order: 98 };
    controls.tokens.tools["ht-galaxy"] = { ...gx, onChange: openGx, order: 99 };
    if (game.user.isGM) controls.tokens.tools["ht-console"] = { ...gm, onChange: openGM, order: 100 };
  }
});
