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

## Region triggers
Give any Region the **Open Datapad** behaviour (Region config, Behaviors tab, +). When a player's token walks in, their datapad opens on what you pick: a terminal, a market, the bounty board, Salvage or the home screen. Locked terminals still ask for their code.
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
