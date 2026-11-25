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

**Markets** have their own editor. You can set the name, description, picture and price level (120% = 20% dearer), and hide the market from players. You can also pick which scenes it opens on. To stock it, drag Items, or a whole folder of Items, from the sidebar or a compendium onto the drop zone. Then set each item's price and stock (leave stock blank for unlimited).

**Moving from Monk's Enhanced Journal:** in the console's Markets tab, press *Import Monk's shops*. Every Monk's shop is copied in with its items, prices and quantities, and starts hidden so you can check it first. Importing again refreshes the copies.

**Linking doors and lights to a terminal:** open the terminal's editor. On the map, select one or more doors (Walls layer) or lights (Lighting layer), holding Shift to pick several, and press *Add selected*. Each one is added under `controls` with a placeholder name. Change its `label`, then Save. Linked controls remember their scene, so a terminal can open a door on another map. On the datapad they show colour-coded states: SEALED, OPEN, LOCKED, ON, OFF, or OFFLINE if the door or light was deleted.

Terminals and bounties still use the JSON editor. Use *Limit to current scene* to tie one to the map you're on. An empty `scenes` list means it shows up everywhere.

Bounties: *Complete & pay* splits `reward` between the hunters who took the contract and adds it to their credits. It matches hunters to actors by name.

## Slicing games
A locked terminal can be sliced instead of using its access code. Set the terminal's `slice.game` to pick the game, or use `random` to roll a different one each attempt:
- **Cipher Lock** (`cipher`): crack a hidden glyph code. Each guess shows LOCK (right glyph, right slot) and DRIFT (right glyph, wrong slot).
- **Circuit Reroute** (`circuit`): click tiles to rotate them until power runs from the source on the left to the core on the right, against the clock.
- **Signal Tuning** (`signal`): turn frequency, amplitude and phase dials until your wave sits on the intercepted one, then lock in. A wrong lock costs 5 seconds.
- **Firewall Run** (`firewall`): move a probe to the data core. Trace sentinels step along their lines after every move, and the cells they'll reach next glow red. Arrow keys work.

Difficulty (`easy`, `normal`, `hard`, `elite`) sets the board size, timer and number of sentinels. Before starting, a player can roll the slicing skill against the terminal's DC. Success gives +1, plus 1 more for every 5 over the DC (up to +3), and a failure gives -1. Each point is an attempt (Cipher), 15 seconds (Circuit), 10 seconds (Signal) or 3 moves (Firewall). The GM gets a whisper naming the game for every success and failure.

## Security cameras
1. On the Regions layer, draw a Region over the area a camera should watch. Any shape works; the feed shows the box around it. Players never see Regions. Naming the Region names the camera.
2. Select it, open the terminal's editor and press *Add selected*. Doors and lights can be selected in the same pass.
3. The terminal gets a **Cameras** tab with a live feed of that area. The feed shows the map, tiles and visible tokens, and updates as tokens move. It works even if the camera is on a different scene from the players.

**Recording:** on the Cameras tab, the GM can press *Record* under a feed. Every token movement inside that area is captured until *Stop recording*. Recording runs on the GM's client, so keep it open while recording. Saved recordings appear under *Recordings*. They're hidden from players until the GM presses the eye icon to share one. Playback has play/pause, a scrub bar, and 1×/2×/4×/8× speed.

## Pulse Scanner
Players send pulses from their token, and matching targets light up on the map.

**Giving scanners (GM):** open the GM Console, go to the **Scanners** tab, and use *Give scanner*. Pick a character, a signal, a range in scene units, and a pulse style (Ripple, Radar sweep, Hex lattice or Interference). You can also give it limited charges. A character can carry several scanners. Select a token and press the eye button to preview a scanner locally, without using a charge.

**Signals:** Tech, Force, Structural, Thermal, Bio-sign and Trace. A scanner finds only targets with the same signal. The console warns you when a target's signal isn't used by any scanner.

**Targets:** draw a Region over the thing to find, and add the **Scan Signature** behaviour to it (Region config, Behaviors, +). Set the signal, a name, notes (and whether players see them), a marker (outline, reticle or both), an optional colour, and an optional DC. One Region can hold several shapes. Each shape is checked against the range on its own and lights up separately. Disable the behaviour, or press the tick in the console, to mark a target resolved so it stops showing up.

**Scanning (players):** select your token and press the satellite-dish button in the Token controls (or bind *Open Pulse Scanner* in Configure Controls). The scanner wheel opens around your token. Click a scanner or press its number to scan. Arrow keys and Enter also work, and Esc or right-click closes the wheel. When a scanner is out of charges, *Recharge* is in the middle of the wheel. The datapad's **Pulse Scanner** app lists your scanners too, with a radar and a list of the last pulse's results.

**What players see:** the pulse rolls out from the token and lights up each target area as the wave reaches it, with a label and notes. Other tokens in range get corner brackets. Tech pulses label droids, Force pulses label creatures with Force powers, Bio-sign pulses label life signs, and Thermal pulses label heat. Highlights fade after a few seconds.

**Settings:**
- Who sees a pulse: the scanning player and the GM, or everyone.
- Token contacts: tokens the player can see, through walls, or off.
- How long highlights last, and a pulse sound.
- Roll to resolve (off by default): each pulse rolls a skill (Tech, Force or other), and targets with a higher DC show only as "Unresolved signal".
- Recharge item: for example `Power Cell`. Recharging then uses one up from the character's inventory.

API: `game.modules.get("holo-terminal").api.openScanner()` opens the wheel, and `.scan(actor, scannerId)` scans directly.

## Galaxy map
Open it from the globe button in the Token controls, from the datapad's **Galaxy Map** tile, or with `api.galaxy()`.

- **6,928 worlds** with their real grid squares (A–V × 1–21), canon and Legends, from Wookieepedia (see `data/ATTRIBUTION.md`). The best-known worlds are labelled first, and more appear as you zoom in.
- **190 hyperspace lanes** built from each planet's listed routes. The big trade routes show at every zoom; smaller lanes appear as you zoom in.
- **Regions:** shaded bands with borders from the Deep Core out to the Outer Rim, shaped by where each region's planets actually are. The Unknown Regions and Wild Space are drawn where their planets cluster.
- **Canon regions:** the Interior, New Territories, the Slice, Trailing Sectors, Western Reaches and Unknown Regions, drawn as outlined, tinted areas. The outlines are stored in `data/canon-regions.json` (traced from Henry Bernberg's Star Wars galaxy map on ArcGIS) and sit on the same A–V grid as the planets. Turn off *Main regions* in Layers to see them on their own. The GM can hide them with the *Galaxy map: canon regions* setting, which also carries the credits.
- **Local areas** (off until switched on): smaller named areas such as Hutt Space, the Tion Cluster and the Legends-era Trans-Hydian, drawn with dashed outlines. Planet cards list every area a world belongs to.
- **Layers:** the layers button opens checkboxes for main regions, canon regions, local areas, region names, hyperlanes, lane names, planet names, Legends-only worlds, the grid and pins. Each player's choices are remembered in their browser. Search finds any planet and flies to it.
- **Planet cards** show the grid square, region, sector, system, class, climate, terrain and routes, plus a canon or Legends badge and a link to the Wookieepedia article.
- **Nav computer:** *Plot course here* finds the fastest route from the party ship (or a chosen start) using the lanes. It shows an estimated time from the hyperdrive class and lists each leg. The GM can show a route to every player.
- **Pins:** right-click to add a private pin. The GM can also add pins that everyone sees.
- **GM tools:** right-click or use the card to move the party ship, edit a planet (notes, which players can be allowed to read, image, linked journal or scene), move it, hide it from players, or add a new planet anywhere.
- **Settings:** show canon and Legends or canon only, hours per grid square at class 1 (lanes are twice as fast), and the default hyperdrive class.
- The arrow button opens the ArcGIS fan map in a browser tab for reference.

## Region triggers
Give any Region the **Open Datapad** behaviour (Region config, Behaviors tab, +). When a player's token walks in, their datapad opens on what you pick: a terminal, a market, the bounty board, Salvage, the Pulse Scanner or the home screen. Locked terminals still ask for their code.
- **Players only** (on by default): tokens moved by the GM don't trigger it.
- **Only once per player**: each player gets it the first time only. Turn it off and on again to reset.

## Encrypted messages and files
Any message or file on a terminal can be encrypted:
```json
{ "from": "Unknown", "subject": "Priority burst", "body": "The real cargo moves through bay 12.",
  "encrypted": { "dc": 15, "key": "Code Cylinder", "game": "signal", "difficulty": "normal" } }
```
Players see scrambled text and up to three ways in:
- **Decrypt (DC)**: one slicing-skill check per player. If it fails, they need another way in.
- **Use key**: shown when the active character carries an item with that exact name.
- **Slice it**: plays a slicing game. It uses `game` and `difficulty` if set, otherwise the terminal's own settings. Set `"game": "none"` to turn this off.

Once decrypted, the text resolves letter by letter. Each player keeps what they've decrypted. The GM always sees the plain text, with an open padlock, and gets a whisper for every attempt.

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
