# Holo-Terminal (v0.3.0)

An original sci-fi datapad for Foundry VTT. Targets **Foundry v12.343** with **dnd5e 4.3.9**, and also works with the SW5e system.

## Install
**Manifest URL** (Foundry's *Install Module* dialog, or your host's module installer such as Sqyre):
```
https://github.com/Trader117/HoloTerminal/releases/latest/download/module.json
```
This works once a GitHub release exists. Publishing a release tagged like `v0.3.0` makes the included workflow build `holo-terminal.zip` and attach it.

**Manual:** zip this repo's contents so that `module.json` sits inside a `holo-terminal/` folder, then upload that folder to `Data/modules/`. Enable **Holo-Terminal** in your world.

## Players: the datapad
Open it from the **tablet icon** in Token controls, or press **Shift+P**. It uses your selected token, or your assigned character if none is selected, and shows that character's credits in the header.
- **Local Net**: terminals on this scene. Each has messages, files and controls (doors and lights). Secured terminals need an access code, or you can **slice in** with the Cipher Lock minigame.
- **Bounties**: open contracts. Press *Take contract* to sign on.
- **Markets**: shops on this scene. *Buy* takes credits, adds the item to the character and lowers the stock.

- **Salvage**: bodies on this scene. Any NPC token at 0 HP can be looted, and the GM can open or lock a body with the sack icon on its token HUD. Players take items one at a time and pocket the credits. By default their token has to be within 2 squares (setting: *Salvage range*).

## GM: the console
Open it from the **terminal icon** in Token controls. It has tabs for Terminals, Markets and Bounties. On each entry you can:
- toggle whether players can see it (eye),
- open it yourself,
- push it to every player's datapad (people icon),
- edit it, or delete it.

The editor is JSON for now. For shops, drag Items from the sidebar or a compendium onto the drop zone to stock them. Prices come from the item. Set `stock` to -1 for unlimited and `markup` to change prices (1.2 = +20%). Use *Limit to current scene* to tie a terminal or shop to the map you're on. An empty `scenes` list means it shows up everywhere.

Bounties: *Complete & pay* splits `reward` between the hunters who took the contract and adds it to their credits. It matches hunters to actors by name.

## Cipher Lock (slicing)
A hidden glyph code. Each guess reports **LOCK** (right glyph, right slot) and **DRIFT** (right glyph, wrong slot). Before starting, a player can roll the slicing skill against the terminal's DC:
- a success gives +1 attempt, plus 1 more for every 5 points over the DC (up to +3),
- a failure costs 1 attempt.

Difficulties are `easy` (3 slots, 5 glyphs), `normal` (4, 6), `hard` (5, 7) and `elite` (5, 8). The GM gets a whisper for every success, failure and terminal control used.

## Character sheet (SW5e)
Holo-Terminal also includes an original holo-datapad **character sheet** for dnd5e characters, built for SW5e (`sw5e-module`). It does not replace your sheet until you choose it: open a character, click **Sheet** in the window header and pick **Holo-Terminal Dossier (SW5e)**. Tick *default* there to use it for every character.
- **Header:** HP bar with temp HP, AC, initiative (click to roll), proficiency, speed, hit dice, inspiration, and Force Point, Tech Point and Superiority Dice pools. Short/long rest buttons. Death saves show at 0 HP.
- **Tabs:** Dossier (abilities, saves, SW5e skills), Combat (weapons, actions, maneuvers), Powers (Force and Tech side by side, with DC and attack per school and point costs), Gear (credits, load, inventory), Features, Bio.
- Number fields accept relative edits: `-7` in HP takes 7 damage, `+250` in credits adds 250.
- Click an item's icon to use it, its name to show its description. Drag items in from compendiums; classes, species and backgrounds still run the dnd5e level-up flow.
- Themes (Holo Cyan, Amber, Sith Red, Green) can be set per character from the header dropdown, with a default in module settings.

## Settings
- **Credits field**: actor data path for credits. Default `system.currency.gp` on dnd5e, `system.currency.gc` on the SW5e system. If your SW5e content tracks credits elsewhere, point this at that field.
- **Slicing skill**: default `inv` (Investigation) on dnd5e, `tec` (Technology) on the SW5e system. Any skill key the system knows works.
- **Look**: colours come from `styles/theme.css` (the SW5e Database scheme). Every part of the module reads its `--ht-*` variables, so you can change the palette in that one file.
- **Boot sound**: optional audio played when the datapad opens.

## Macro / Region API
```js
const api = game.modules.get("holo-terminal").api;
api.datapad();                         // open home screen
api.openTerminal("Security Node");     // by name or id
api.openShop("Outpost Supply");
api.openBounties();
api.showAll("shop", "Outpost Supply"); // GM: push to every player
```
Add a Region behavior **Execute Script** on token enter that calls `api.openShop(...)` so a shop pops up when players walk up to the counter.

## Known limits (prototype)
- Not yet tested inside a live Foundry world.
- Other modules (such as the combat HUD) live in their own folders under `scripts/`, `templates/` and `styles/`.
- Editing uses JSON. A visual editor is planned.
- Players can see every entry's data in the world settings if they go digging, so don't put true secrets there yet.
