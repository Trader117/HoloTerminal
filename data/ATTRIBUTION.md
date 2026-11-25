# Planet data

`planets.json` was built from the infoboxes of pages that use the CelestialBody template on
[Wookieepedia](https://starwars.fandom.com/). Wookieepedia's text is licensed under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), and this file is shared under the same licence.

The fields kept are page title, grid coordinates, region, sector, system, whether it is a Legends page, article length
(used to decide which worlds show first), class, climate, terrain and the hyperspace routes listed. The text was cut down
to short values.

## Planet positions and hyperspace lanes

Exact positions for every world on the map (about 4,500, including some only that map lists), and every hyperspace lane's shape and name in `hyperlanes.json`, come from the public "Planets" and "Hyperspace" layers of Henry Bernberg's Star Wars galaxy map on ArcGIS (https://henrybernberg.maps.arcgis.com/apps/instant/basic/index.html?appid=f8953229bb0e47fcbfbd080640bb57b0), merged by `tools/arcgis-import.py`. Worlds that map doesn't plot are left out.

Star Wars and related names are trademarks of Lucasfilm Ltd. This is a fan project and isn't affiliated with Lucasfilm or Fandom.

## Canon region layout

`canon-regions.json` holds the outlines of the six canon regions (the Interior, New Territories, the Slice, Trailing Sectors, Western Reaches and Unknown Regions), traced from the "Regions (new)" layer of Henry Bernberg's Star Wars galaxy map on ArcGIS (https://henrybernberg.maps.arcgis.com/apps/instant/basic/index.html?appid=f8953229bb0e47fcbfbd080640bb57b0). Star Wars is © Lucasfilm Ltd.; this is an unofficial fan module for private use.

## Starships

`starships.json` holds the 87 Drake's Shipyard starships, with their weapons, equipment, starship actions, features and
modifications, copied from the SW5e Database's `data/Starships/drakesShipyard.json` (mod categories and grades from
`starshipModification.json`) by `tools/build-starships.py`. The rules text is SW5e content (Starships of the Galaxy and
Drake's Shipyard, sw5e.com). The SW5e Database itself is not changed.
