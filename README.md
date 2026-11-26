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
Drag it by its frame, title bar or bottom keys to move it anywhere; it reopens where you last left it.
- **Local Net**: terminals on this scene. Each has messages, files and controls (doors and lights). Secured terminals need an access code, or you can **slice in** with the Cipher Lock minigame.
- **Bounties**: open contracts. Press *Take contract* to sign on.
- **Markets**: shops on this scene. *Buy* takes credits, adds the item to the character and lowers the stock.

- **Salvage**: bodies on this scene. Any NPC token at 0 HP can be looted, and the GM can open or lock a body with the sack icon on its token HUD. Players take items one at a time and pocket the credits. Click a body's portrait to ping it and pan the map to it. By default their token has to be within 2 squares (setting: *Salvage range*).

## GM: the console
Open it from the **terminal icon** in Token controls. It has tabs for Terminals, Markets and Bounties. On each entry you can:
- toggle whether players can see it (eye),
- open it yourself,
- push it to every player's datapad (people icon),
- edit it, or delete it.

**Markets** have their own editor. You can set the name, description, picture and price level (120% = 20% dearer), and hide the market from players. You can also pick which scenes it opens on. To stock it, drag Items, or a whole folder of Items, from the sidebar or a compendium onto the drop zone. Then set each item's price and stock (leave stock blank for unlimited).

**Moving from Monk's Enhanced Journal:** in the console's Markets tab, press *Import Monk's shops*. Every Monk's shop is copied in with its items, prices and quantities, and starts hidden so you can check it first. Importing again refreshes the copies.

**Drawing camera views:** on the Regions layer, turn on the **Camera cone** button (video icon). Set the cone's width in the bar at the top, then click where the camera sits and drag toward what it watches. Let go and a cone-shaped Region named *Camera 1, 2...* is created and selected, ready for *Add selected* in a terminal's editor. The feed shows the whole cone, and anything behind a wall (as seen from the camera's spot) is dark. Closed doors block the view, open ones don't. Use the − and + buttons on a feed to zoom.

**Linking doors and lights to a terminal:** open the terminal's editor. On the map, select one or more doors (Walls layer) or lights (Lighting layer), holding Shift to pick several, and press *Add selected*. Each one appears in the *Doors, lights and cameras* list with a placeholder name. Type the name players should see, then Save. Linked controls remember their scene, so a terminal can open a door on another map. On the datapad they show colour-coded states: SEALED, OPEN, LOCKED, ON, OFF, or OFFLINE if the door or light was deleted.

**Terminals, bounties, missions and contacts** open in a plain form: labelled boxes, drop-downs and tick boxes, no code. On a terminal you set its name and screen colour, which scenes it shows up on (*Only this scene* is one click), and its security: switch on *Needs a password*, *Can be sliced* (pick the hacking game, difficulty and DC), or both. Messages and files are cards you can add, reorder and remove. Type straight into the box (line breaks are kept), press *Open full editor* for a big window with the journal toolbar (headings, lists, tables, bold, italic, dividers, links), or drag a Journal page onto the card to show that page instead. Each card has an *Encrypted* switch that reveals its decrypt DC, key item and slicing game. Linked doors, lights and cameras are listed by name with buttons to rename, reorder, show on the map or unlink. Nothing is saved until you press Save. *Advanced* shows the raw data for anyone who wants it.

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

- **About 4,500 worlds**, canon and Legends, each at the exact spot Henry Bernberg's Star Wars galaxy map on ArcGIS puts them, with details from Wookieepedia (see `data/ATTRIBUTION.md`). Worlds that map doesn't plot are left out; the GM can add any world by hand. The best-known worlds are labelled first, and more appear as you zoom in.
- **Hyperspace lanes** with their real shapes and names (Hydian Way, Nache Bhelfia, Shaltin Tunnels and about 120 more, plus unnamed links), from the same ArcGIS map's Hyperspace layer (`data/hyperlanes.json`). The big trade routes show at every zoom; smaller lanes and lane names appear as you zoom in.
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

## Comms and holocalls
The datapad's **Comms** tile is an in-character inbox for the active character, with a red count of unread messages.

- **Messages:** players write to any player character, or to an NPC who has messaged them. Conversations show as chat bubbles; Enter sends, Shift+Enter adds a line.
- **GM:** the console's **Comms** tab sends as any actor (an NPC contact), as an anonymous alias ("A friend") or as a broadcast to everyone. When a player writes to an NPC the GM gets a notice and can answer as that NPC.
- **GM can read everything:** the Comms tab logs every message, including player-to-player ones. Turn off *Comms: GM can read player messages* to hide those from the log. They are still stored in the world, so it is honour-system privacy.
- **Holocalls:** pick a caller (an NPC or an unknown caller), tick the players to call and start the call. Each player sees a floating blue hologram of the caller's portrait. Type lines into the call window to speak as the caller; *End call* closes it for everyone.
- **Settings:** an optional sound when a message arrives.

## Starship app (HoloDock, bridge and shipyard)
The datapad's **Starship** tile opens the party ship, with tabs for **Status** (the HoloDock screen), **Bridge**, **Shipyard** and **Fleet**. The Fleet tab lists the crew's ships. SW5e starship actors appear on their own; the GM can add any other actor (a vehicle or NPC) from the console's **Ships** tab.

- **Ship status:** hull, shields and fuel bars, hyperdrive class, system damage, power routing, cargo and deployed crew (pilot, crew and passengers from the SW5e sheet). The values are read straight from the starship actor, so damage taken in combat shows at once.
- **Hyperdrive class** comes from the ship's *Hyperdrive, Class X* item (the best equipped one, ignoring backups). **Fuel capacity**, **cargo capacity** and **fuel price** come from the ship's size item (Tiny to Gargantuan). The GM can override any of these, set shield capacity, a location and a log in the Ships tab (pen button).
- **Party ship:** star a ship in the Ships tab (or use *Set as party ship* on its datapad screen). Every player can see it. It names the galaxy map's ship marker and sets the default hyperdrive class for routes.
- **Who sees what:** players see the party ship and any ship they have at least Limited rights on. Observer lets them read its systems. Owner (or the party ship) lets them buy fuel with the active character's credits, change power routing and load or unload cargo.
- **Jumps:** with a route plotted on the galaxy map, the nav computer shows the fuel the party ship needs. The GM's **Make the jump** button moves the ship marker to the destination, burns the fuel, updates the ship's location and posts the arrival to chat.
- **Settings:** fuel per day in hyperspace (default 1, or 0 to turn fuel use off) and a fallback fuel price for ships without an SW5e size item.

### Importing SW5e starships (Foundry v12)
The SW5E module for Foundry v12 (1.2.5) ships its starships as a "starship" actor type that neither it nor dnd5e 4.x defines, so they can't be used. **Import ship** in the console's **Ships** tab builds a working ship instead:

- Pick any of the 87 **Drake's Shipyard** ships (type to search, e.g. *B-wing* or *YT-1300*), or choose a ship file from the SW5e Database (`drakesShipyard.json`, one ship from it, or your own ship in the same shape). Tick **Party ship** to link its token and make it the party ship.
- The ship becomes a dnd5e **space vehicle** in the *HoloDock Ships* folder, with its size, ability scores, weapons, armor, shields, reactor, hyperdrive, starship actions, features and modifications.
- **Hull** is the ship's hit points and **shields** are its temporary hit points, so damage takes the shields first. Patch heals hull and Boost Shields grants temporary shield points. Regenerate Shields rolls the shield points to restore; add them to the shields (temporary hit points) on the sheet.
- **AC** is worked out from the equipped armor (base 10, plus Dexterity up to the armor's cap) and the tier's AC upgrade (+1 at tier 2 up to +4 at tier 5).
- Starship actions that rolled SW5e starship skills or hull dice now roll the ship's ability modifier and its real hull die, with the tier filled in.
- **HoloDock** shows the tier, AC and damage reduction, speed and turning speed, hull and shield dice, fuel (capacity and price by size), cargo, power routing and system damage. Owners can roll any **starship skill** from the ship's screen: d20 + the ship's ability modifier, plus the rolling character's proficiency bonus when they hold a bridge station.
- dnd5e has no fields for tier, space speed, shield capacity, fuel or system damage, so those live in HoloTerminal's flag on the ship. Change system damage from the ship's pen button in the Ships tab.
- Not automated: damage reduction (shown, but subtract it yourself), power dice and shield regeneration each round. Weapons attack with the ship's Dexterity, without crew proficiency.
- `tools/build-starships.py` rebuilds `data/starships.json` from a copy of the SW5e Database.

## Trade runs
Every world prices twelve kinds of cargo (foodstuffs, water, ore, metals, fuel, textiles, droid parts, electronics, medical supplies, luxury goods, and the restricted weapons and spice). Prices come from the world's terrain, climate and class and from how far it is from the Core, so desert worlds want water and the Core sells electronics cheaply.

- **Trade screen:** open it from the party ship in the HoloDock (*Trade*) or with `api.openTrade()`. It works wherever the party ship is docked on the galaxy map. Goods marked *cheap* can be bought; anything can be sold. The active character pays and is paid, and the hold remembers what you paid per ton.
- **Planet cards** on the galaxy map list what is cheap there and what is wanted.
- **GM:** *Shift markets* on the trade screen rerolls every world's prices. The *Trade: restricted goods* setting hides weapons and spice. Sales by players are whispered to the GM.

## Hyperspace events
When the GM uses **Make the jump** on the galaxy map there's a chance (30% by default) of something happening on the way: a pirate ambush, a hyperdrive stutter, a customs patrol, a distress beacon and so on.

- The GM sees the event first and picks **Show players** (a red banner flashes on every screen and a card goes to chat), **Keep it to me** (whispered), **Reroll** or **Nothing happens**.
- Events can cost extra fuel, taken from the party ship.
- Edit the table in the console's **Ships** tab under *Hyperspace events*: turn events on or off, change how often each comes up, write your own, roll one on demand, or restore the defaults. `api.jumpEvent()` rolls one from a macro.
- The chance per jump is a module setting (0 turns events off).

## Missions and contacts
Two more datapad tiles for keeping the story straight.

- **Missions:** a shared log grouped into active, completed and failed. Each mission has who gave it, where, the reward, a summary and a checklist of objectives. Players read it; the GM adds missions (*+ New mission*, or the console's **Missions** tab), ticks objectives and marks missions done or failed right on the datapad. Set `hidden` to keep one secret.
- **Contacts:** an address book of NPCs with portrait, role, location, notes and a standing meter from Hostile to Ally that the GM nudges with + and -. Drag an Actor into a contact's editor to link it; linked contacts get a *Message* button and show up as people players can write to in Comms.

## Credits
The datapad's **Credits** tile shows the active character's balance and a transaction history.

- **Transfers:** pay another player character or a linked NPC contact, with a memo. A confirmation comes up first, and the recipient's player gets a notice.
- **One ledger:** transfers, GM grants and fines, fuel purchases and trade buys and sales are all recorded.
- **GM:** the same screen has a *grant or fine* form for any player character and shows the whole ledger.

## Bridge (crew stations)
The **Bridge** tab of the Starship app is for starship combat on the party ship.

- Five stations: **Pilot**, **Gunner**, **Engineer**, **Operator** and **Captain**. Each character takes one (one per station; the GM can move anyone). The station bar shows who sits where.
- Each station lists the SW5e starship actions on the ship that belong to it (Fly, Evade and Dogfight for the pilot; Fire for the gunner; Patch, Boost and Regenerate Shields for the engineer; Search and Interfere for the operator; Direct for the captain), plus Cast a Power and Use an Object.
- The **Gunner** gets the ship's starship weapons with damage and range and a *Fire* button. The **Engineer** sets power routing and sees system damage.
- Players who own the ship use the actions straight from the datapad. Otherwise the order goes to chat for the GM to resolve.

## Shipyard
Open it from the **Shipyard** tab of the Starship app or with `api.openShipyard()`. It works wherever the party ship is docked on the galaxy map.

- **Repairs:** restore hull points, recharge shields and clear system damage. Prices per point are module settings (25, 10 and 500 cr by default).
- **Upgrades:** browse and search the SW5e starship weapons, equipment and modifications compendiums. Buying one installs a copy on the party ship. Weapons and equipment use their list price; modifications (which have none in SW5e) cost a set amount per grade times the ship size's modification multiplier. A price multiplier setting adjusts everything.
- The active character pays; every purchase goes to the ledger and is whispered to the GM.

## HoloNet news

The datapad has a **HoloNet** app: an in-world news feed with a scrolling ticker on the home screen.

- The GM writes stories from the app (headline, tag, source, body) and can delete any story.
- Big moments can write their own stories: a large or restricted trade sale, a ship arriving after a jump, a hyperspace event shown to players, or a mission marked done.
- The **Auto news** setting decides what happens to those: *queue* (default, the GM approves or spikes each one), *publish* straight away, or *off*.
- Unread stories show as a count on the home tile and are marked read when the player opens the feed.
- Macro api: `game.modules.get("holo-terminal").api.openNews()` and `api.postNews({headline, body, source, tag})`.

## Region triggers
Give any Region the **Open Datapad** behaviour (Region config, Behaviors tab, +). When a player's token walks in, their datapad opens on what you pick: a terminal, a market, the bounty board, Salvage, the Pulse Scanner or the home screen. Locked terminals still ask for their code.
- **Players only** (on by default): NPC tokens moved by the GM don't trigger it.
- **Testing as GM:** move a player's token into the Region and the datapad opens in test mode. You see the password screen, slicing and encryption just as that player would, and nothing you unlock is saved. *GM override* on the terminal stops the test. On any secured terminal you can also press *Test as player* (it uses the selected token).
- **Only once per player**: each player gets it the first time only. Turn it off and on again to reset.

## Encrypted messages and files
Any message or file on a terminal can be encrypted: tick *Encrypted* on its card in the terminal editor. In the raw data (*Advanced*) it looks like this:
```json
{ "from": "Unknown", "subject": "Priority burst", "body": "The real cargo moves through bay 12.",
  "encrypted": { "dc": 15, "key": "Code Cylinder", "game": "signal", "difficulty": "normal" } }
```
Players see scrambled text and up to three ways in:
- **Decrypt (DC)**: one slicing-skill check per player. If it fails, they need another way in.
- **Use key**: shown when the active character carries an item with that exact name.
- **Slice it**: plays a slicing game. It uses `game` and `difficulty` if set, otherwise the terminal's own settings. Set `"game": "none"` to turn this off.

Once decrypted, the text resolves letter by letter. Each player keeps what they've decrypted. The GM always sees the plain text, with an open padlock, and gets a whisper for every attempt.

## Combat HUD
An action bar along the bottom of the screen for the selected token (or your assigned character), built to be easy for new players:

- **Character card**: portrait (click to open the sheet), HP bar with temp HP, AC, power DC and speed, plus **Checks & Saves**, **Short Rest** and **Long Rest** buttons. In combat it shows **YOUR TURN**, **Roll Initiative**, **End Turn** and, at 0 HP, **Death Save**.
- **Action / Bonus Action / Reaction / Free & Other** boxes. Each one lists weapons, powers, features and items that take that kind of action, under labeled headings. Equipped weapons and prepared powers only.
- **Anyone can**: Dash, Disengage, Dodge, Help, Hide, Search, Grapple/Shove, Ready and Opportunity Attack. Each posts a chat note with the rule; Hide, Search and Grapple roll the skill, and Dodge applies the Dodging status if your system has it.
- **Ready / ✓ Used** light on each box. Using something marks it used; it resets when your turn starts. Click it to flip it yourself.
- **Hover** anything for a plain-language tooltip (range, to hit, damage, uses left, description). **Right-click** opens the full item. The **?** button shows a short how-to.
- **Macros**: drag macros onto the box to keep them per character; right-click to remove.
- **Ignite Saber** appears only for characters carrying a lightweapon (any weapon named lightsaber, saberstaff, shoto, lightfoil, saberwhip, lightring and so on). Click it to ignite straight away (blue until you pick a colour): the token gets a pulsing glow and plays the ignition sound. Click again to switch it off, which restores the token's previous light. Shift-click to choose the blade colour; if the saber is already lit it just changes colour. The token must be on the scene. The GM sets the ignite and switch-off sounds in module settings (defaults `media/home/lightsaber-ignition.mp3` and `media/home/lightsaber-deactivation.mp3`).
- Drag the grip on the left to move the bar. **Alt+H** shows or hides it.

Settings (per player): when to show it (always, only in combat, never), colour theme (defaults to the shared SW5e Database look; the old holo colours are still available), size, and whether to show the common actions.

## Settings
- **Credits field**: actor data path for credits. Default `system.currency.gp` on dnd5e, `system.currency.gc` on the SW5e system. If your SW5e content tracks credits elsewhere, point this at that field.
- **Slicing skill**: default `inv` (Investigation) on dnd5e, `tec` (Technology) on the SW5e system. Any skill key the system knows works.
- **Look**: colours come from `styles/theme.css` (the SW5e Database scheme). Every part of the module reads its `--ht-*` variables, so you can change the palette in that one file.
- **Boot sound**: optional audio played when the datapad opens.
- **Datapad & tablet size** (per player): scales the datapad and the character sheet tablet. Default 85%. The Combat HUD has its own size setting (default 85%).

## NPC stat block sheet
An optional NPC sheet on the same datapad tablet as the character sheet. Pick **Holo-Terminal Stat Block (SW5e NPC)** in an NPC's sheet settings (gear button), or make it the default under *Configure Settings → Core → Sheet Configuration*.

- **Stat Block** tab: ability scores with their saves under them (proficient saves in gold), then a gold-framed block with speed, saves, skills (*all skills* opens the full list), resistances, languages, senses and challenge. Every save, skill and ability rolls when clicked.
- **Traits, Actions, Bonus Actions, Reactions, Legendary and Lair Actions** list each feature with its text inline, like a printed stat block. Click a name or icon to use it. Attacks show to-hit, range and damage; recharge abilities show *Recharge 5–6* (green when ready, click to roll the recharge); limited uses can be edited in place.
- **Sidebar**: portrait, AC, initiative, speed, proficiency, HP (type -5 or +5), the HP formula with a dice button that rolls new hit points, force and tech points, legendary action and resistance pips, and a quick list of attacks.
- **Edit** (padlock): name, alignment, CR (1/8 works), HP max and formula, AC, ability scores, legendary maximums, plus buttons for dnd5e's own armor, speed, senses, type and trait editors. The **+** beside each section adds a new trait or action of that kind.
- **Powers**, **Gear**, **Effects** and **Notes** tabs work as on the character sheet.

## Starship sheet
Every dnd5e vehicle now opens on a starship sheet on the same datapad tablet as the character and NPC sheets, in the SW5e Database colours, with the bottom keys switching tabs. It is built for ships made with **Import ship** and works on any vehicle. To go back to dnd5e's vehicle sheet, pick it in the vehicle's sheet settings (gear button).

- **Sidebar**: portrait, AC (tooltip shows armor, Dex and tier upgrade), speed, turning and hyperdrive class, hull, shield and fuel bars (type -5 or +5; shields are temporary hit points, so damage takes them first), system damage pips, power routing, and a quick list of mounted weapons.
- **Status**: ability scores and saves, stat tiles (AC and DR, speed, hull and shield dice, cargo, fuel price, mod slots), the starship skills (click to roll; a character holding a bridge station adds their proficiency), and refuel, **Plot a jump** and **HoloDock** buttons. A plain vehicle gets a **Make it a starship** button that adds the Starships of the Galaxy numbers for its size.
- **Arsenal**: weapons with to-hit and damage and a **Fire** button, ordnance with quantities, pilot, crew and passenger actions, and ship features.
- **Systems**: armor, shields, reactor, power coupling and hyperdrive with their key numbers, and modifications grouped by type with grade, slots used and suites (red when over the limit).
- **Crew**: the five bridge stations, shared with the datapad's Bridge. Owners and the GM can assign or swap crew; anyone can leave their own station.
- **Cargo**: the hold with a capacity bar, load and unload, plus the ship's location and captain's log.
- **Edit** (padlock): name, size and tier (changing either recalculates the hull and shield dice and the tier AC upgrade), hull and shield maximums, fuel capacity, AC, ability scores, space and turning speed, DR, hyperdrive override, cargo capacity, fuel price, mod slots and suites.

## Macro / Region API
```js
const api = game.modules.get("holo-terminal").api;
api.datapad();                         // open home screen
api.openTerminal("Security Node");     // by name or id
api.openShop("Outpost Supply");
api.openBounties();
api.openComms();
api.sendComms({ fromId: npc.id, to: pc.id, text: "Bay 12, midnight." });
api.holocall({ actorId: npc.id, line: "We need to talk." }); // GM, all players
api.openCredits();
api.openBridge();
api.openShipyard();
api.openHoloDock();                    // ship list, or pass an actor id for one ship
api.showAll("shop", "Outpost Supply"); // GM: push to every player
```
Add a Region behavior **Execute Script** on token enter that calls `api.openShop(...)` so a shop pops up when players walk up to the counter.

## Known limits (prototype)
- Not yet tested inside a live Foundry world.
- Other modules (such as the combat HUD) live in their own folders under `scripts/`, `templates/` and `styles/`.
- Players can see every entry's data in the world settings if they go digging, so don't put true secrets there yet.
