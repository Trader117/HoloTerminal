"""Builds data/starships.json for HoloDock's "Import ship" from the SW5e Database's Drake's Shipyard data.

Usage:  python tools/build-starships.py <path to SW5e-database>/data/Starships

Reads (never writes) drakesShipyard.json and starshipModification.json from that folder.
Also writes data/shipyard.json, the Shipyard's parts catalog: every starship weapon, system and ammunition item
found on the shipyard's ships, plus all of the database's starship modifications.
Items that repeat across ships (the starship actions, common mods) are stored once in "items" and
each ship lists the indexes it carries, which keeps the file small. HoloDock bakes each ship into a
dnd5e 4.x vehicle actor at import time (scripts/starship-import.mjs)."""
import json, re, sys, hashlib
from pathlib import Path

src = Path(sys.argv[1] if len(sys.argv) > 1 else "../SW5e-database/data/Starships")
out = Path(__file__).resolve().parent.parent / "data" / "starships.json"

ships = json.loads((src / "drakesShipyard.json").read_text(encoding="utf-8"))
mods = json.loads((src / "starshipModification.json").read_text(encoding="utf-8"))
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())
mod_info = {norm(m["name"]): {"category": m.get("type") or "", "grade": m.get("grade") or 0} for m in mods}
# Spelling differences between the two sources.
ALIAS = {"commssuppressor": "communicationssuppressor", "tibanagas": "tibannagas", "activecamouflage": "activecamo"}

def mod_lookup(name):
    """Finds a mod's category and grade, allowing for the shipyard's other ways of naming the same mod."""
    k = mod_key(name)
    return mod_info[k] if k else None

def mod_key(name):
    """The database's key for a mod name as the shipyard spells it, or None."""
    base = re.sub(r"\bMark\b", "Mk", name)
    tries = [name, base, re.sub(r",\s*(Premium|Prototype|Advanced|Standard|Basic)$", "", base)]
    words = base.split()
    if len(words) == 2 and "," not in base: tries += [f"{words[1]}, {words[0]}", words[1]]   # "Living Quarters" -> "Quarters, Living"
    for t in tries:
        n = norm(t)
        for a, b in ALIAS.items(): n = n.replace(a, b)
        if n in mod_info: return n
    return None

def clean(o):
    """Drop empty objects, nulls and empty strings, so stored items carry only real data."""
    if isinstance(o, dict):
        r = {k: clean(v) for k, v in o.items()}
        return {k: v for k, v in r.items() if v not in (None, "", {}, [])}
    if isinstance(o, list): return [clean(v) for v in o]
    return o

items, index, out_ships = [], {}, []
for s in ships:
    d = s["data"]; sys_ = d["system"]; at = sys_["attributes"]; mv = at.get("movement", {})
    refs = []
    for it in d["items"]:
        it = clean({"name": it["name"], "type": it["type"], "system": it["system"]})
        if it["type"] == "loot":
            info = mod_lookup(it["name"])
            it["system"]["identified"] = True
            if info: it["flags"] = {"holo-terminal": {"mod": info}}
        key = hashlib.sha1(json.dumps(it, sort_keys=True).encode()).hexdigest()
        if key not in index: index[key] = len(items); items.append(it)
        refs.append(index[key])
    hp = at.get("hp", {})
    out_ships.append({
        "name": s["name"],
        "size": sys_.get("traits", {}).get("size", "med"),
        "tier": sys_.get("details", {}).get("tier") or 0,
        "abilities": {k: v.get("value", 10) for k, v in sys_["abilities"].items() if k in ("str", "dex", "con", "int", "wis", "cha")},
        "hp": {"value": hp.get("value") or 0, "max": hp.get("max") or 0, "temp": hp.get("temp") or 0, "tempmax": hp.get("tempmax") or 0},
        "space": mv.get("space") or mv.get("fly") or 0, "turn": mv.get("turn") or 0,
        "cargo": at.get("capacity", {}).get("cargo") or 0,
        "fuel": at.get("fuel", {}).get("value"),
        "source": (sys_.get("details", {}).get("source") or {}).get("custom") or "Drake's Shipyard",
        "items": refs
    })

out.write_text(json.dumps({"source": "SW5e Database, Drake's Shipyard", "ships": out_ships, "items": items},
                          separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
# ---------- shipyard catalog ----------
SYSTEMS = {"starship", "ssshield", "reactor", "powerc", "hyper"}
ROMAN = {"I", "II", "III", "IV", "V", "VI"}
def title(name):
    """'AMPHIBIOUS SYSTEMS' -> 'Amphibious Systems', keeping Mk II and similar."""
    return " ".join(w if w in ROMAN else (w[:1].upper() + w[1:].lower()) for w in name.split(" "))
def paras(text):
    return "".join(f"<p>{p.strip()}</p>" for p in re.split(r"\n\s*\n|\r?\n", text or "") if p.strip())

parts = {"weapons": {}, "equipment": {}, "ammo": {}, "modifications": {}}
for it in items:
    t, sub = it["type"], (it["system"].get("type") or {}).get("value") or ""
    cat = ("weapons" if t == "weapon" and "(starship)" in sub else "equipment" if t == "equipment" and sub in SYSTEMS
           else "ammo" if t == "consumable" and sub == "ammo" else "modifications" if t == "loot" and it.get("flags") else None)
    if cat: parts[cat].setdefault((mod_key(it["name"]) if cat == "modifications" else None) or norm(it["name"]), it)
for m in mods:
    key = norm(m["name"])
    known = next((v for k, v in parts["modifications"].items() if k == key), None)
    pre = [p for p in (m.get("prerequisites") or []) if p]
    info = {"category": m.get("type") or "Universal", "grade": m.get("grade") or 0}
    if pre: info["prereq"] = ", ".join(pre)
    if known:
        known["flags"]["holo-terminal"]["mod"].update(info)
        if not (known["system"].get("description") or {}).get("value"): known["system"]["description"] = {"value": paras(m.get("content"))}
        continue
    parts["modifications"][key] = {"name": title(m["name"]), "type": "loot",
        "system": {"description": {"value": paras(m.get("content"))}, "quantity": 1, "identified": True, "source": {"custom": m.get("contentSource") or "SotG"}},
        "flags": {"holo-terminal": {"mod": info}}}
yard = {k: sorted(v.values(), key=lambda i: i["name"]) for k, v in parts.items()}
yout = out.parent / "shipyard.json"
yout.write_text(json.dumps({"source": "SW5e Database (Drake's Shipyard, starship modifications)", **yard}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
print("shipyard:", {k: len(v) for k, v in yard.items()}, f"({yout.stat().st_size // 1024} KB)")

print(f"{len(out_ships)} ships, {len(items)} unique items -> {out} ({out.stat().st_size // 1024} KB)")
