"""Merges Henry Bernberg's Star Wars galaxy map (ArcGIS) into the module's map data.

Inputs are tab-separated dumps of two public ArcGIS feature layers, already converted to map units
(100 = one grid square, A-1's top-left corner is 0,0):
  planets.tsv  Planet, X, Y (km in web-mercator metres / 1000), Grid, Canon, Legends, zm, System, Sector, Region, CRegion, name1, name2
  lanes.tsv    FID, hyperspace name, zoom_level, paths ("x,y x,y|x,y ...", already in map units)

Usage: python3 tools/arcgis-import.py planets.tsv lanes.tsv
Writes data/planets.json (adds x, y to matched rows, drops worlds the ArcGIS map does not plot, appends ArcGIS-only worlds)
and data/hyperlanes.json.
"""
import json, re, sys, unicodedata
from pathlib import Path

root = Path(__file__).resolve().parent.parent
ptsv, ltsv = sys.argv[1], sys.argv[2]

def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"/legends$", "", s); s = re.sub(r" \((planet|moon|celestial body)\)$", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)

to_x = lambda xk: round((xk + 16500) / 15, 1)
to_y = lambda yk: round((13500 - yk) / 15, 1)

arc = []
for line in open(ptsv, encoding="utf-8").read().split("\n"):
    f = line.split("\t")
    if len(f) < 13 or not f[0].strip(): continue
    name, X, Y, grid, canon, legends, zm, system, sector, region, cregion, n1, n2 = f[:13]
    arc.append(dict(name=name.strip(), x=to_x(float(X)), y=to_y(float(Y)), grid=grid.strip(), canon=canon == "1", legends=legends == "1",
                    zm=int(zm or 5), system=system.strip(), sector=sector.strip(), region=region.strip(), cregion=cregion.strip(),
                    alias=[a.strip() for a in (n1, n2) if a.strip()]))

by = {}
for a in arc:
    by.setdefault(norm(a["name"]), a)
for a in arc:
    for al in a["alias"]: by.setdefault(norm(al), a)

def grid_of(x, y):
    return f"{chr(65 + int(x // 100))}-{int(y // 100) + 1}"

rows = json.loads((root / "data/planets.json").read_text(encoding="utf-8"))
used, matched = set(), 0
for r in rows:
    r[:] = r[:12]
    a = by.get(norm(r[0]))
    if not a: continue
    r += [a["x"], a["y"]]
    used.add(id(a)); matched += 1
    # Keep Wookieepedia's square when the point sits on (or within 1 unit of) its edge, e.g. Coruscant at a corner.
    m = re.match(r"^\s*([A-Z])\s*[-\u2013\u2014]?\s*(\d{1,2})", str(r[1] or "").upper())
    if m:
        c0, r0 = (ord(m[1]) - 65) * 100, (int(m[2]) - 1) * 100
        if c0 - 1 <= a["x"] <= c0 + 101 and r0 - 1 <= a["y"] <= r0 + 101: continue
    r[1] = grid_of(a["x"], a["y"])

dropped = len(rows)
rows = [r for r in rows if len(r) >= 14]
dropped -= len(rows)
added = 0
for a in arc:
    if id(a) in used: continue
    if not re.match(r"^[A-Z]-\d+$", a["grid"]): continue
    rows.append([a["name"], grid_of(a["x"], a["y"]), a["region"], a["sector"], a["system"], 0 if a["canon"] else 1,
                 max(40, 1500 - a["zm"] * 250), "", "", "", "", a["cregion"] if a["cregion"] in ("The Slice", "Western Reaches", "Hutt Space") else "", a["x"], a["y"]])
    added += 1

(root / "data/planets.json").write_text(json.dumps(rows, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

lanes = []
for line in open(ltsv, encoding="utf-8").read().split("\n"):
    f = line.split("\t")
    if len(f) < 4 or not f[3]: continue
    paths = [[c for v in p.split(" ") for c in map(float, v.split(","))] for p in f[3].split("|")]
    lanes.append({"n": f[1].strip(), "z": int(f[2] or 5), "p": paths})
(root / "data/hyperlanes.json").write_text(json.dumps({
    "about": "Hyperspace lanes in map units (100 = one grid square; A-1's top-left corner is 0,0). Each entry is one lane segment: n = name ('' for unnamed links), z = the source map's zoom level (1 = most important), p = paths as flat x,y lists. From the 'Hyperspace' layer of Henry Bernberg's Star Wars galaxy map on ArcGIS.",
    "lanes": lanes}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"planets: {len(rows)} rows, {matched} placed from ArcGIS, {dropped} unplotted dropped, {added} ArcGIS-only worlds added; lanes: {len(lanes)} segments")
