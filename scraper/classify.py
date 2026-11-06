"""Works out the set, year and product type of a store listing from its title.

Every store words things differently, so this file holds all the "rules".
If something gets sorted wrong, this is the file to tweak.
"""
import json
import re
import unicodedata
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

SETS = json.loads((DATA / "sets.json").read_text(encoding="utf-8"))
CATEGORIES = json.loads((DATA / "categories.json").read_text(encoding="utf-8"))
CONTENTS = {k: v for k, v in json.loads((DATA / "contents.json").read_text(encoding="utf-8")).items()
            if not k.startswith("_")}

# Era names that also appear inside more specific titles
# ("Scarlet & Violet—Paldea Evolved" is Paldea Evolved, not the base set).
ERA_NAMES = {"Scarlet & Violet", "Sword & Shield", "Sun & Moon", "XY", "Black & White",
             "Diamond & Pearl", "HeartGold & SoulSilver", "Mega Evolution", "Platinum", "EX Ruby & Sapphire"}

FOREIGN = ["japanese", "chinese", "korean", "simplified", "traditional", "thai", "indonesian",
           "(jp)", "[jp]", "jpn", "(cn)", "s-chinese", "t-chinese", "german", "french", "spanish", "italian"]
NOT_SEALED = ["psa ", "psa-", "cgc", "bgs ", "graded", "slab", "single card", "sleeves", "deck box",
              "playmat", "binder", "portfolio", "toploader", "plush", "figure", "card sleeve"]


def norm(text: str) -> str:
    """Lowercase, strip accents (Pokémon -> pokemon) and tidy punctuation."""
    text = re.sub(r"[\u2010-\u2015]", " ", text)  # em/en dashes -> space
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    text = text.lower().replace("&", " and ").replace("’", "'")
    text = re.sub(r"[—–:|/\\(),\[\]]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _pattern(phrase: str) -> re.Pattern:
    return re.compile(r"(?<![a-z0-9])" + re.escape(norm(phrase)) + r"(?![a-z0-9])")


# Build (pattern, set) pairs, longest phrase first so "Team Rocket Returns" beats "Team Rocket".
_SET_PATTERNS = []
for s in SETS:
    for phrase in [s["name"], *s.get("aliases", [])]:
        _SET_PATTERNS.append((len(norm(phrase)), _pattern(phrase), s))
_SET_PATTERNS.sort(key=lambda x: -x[0])


def find_set(title: str):
    t = norm(title)
    found = []
    for _, pat, s in _SET_PATTERNS:
        if pat.search(t) and s not in found:
            found.append(s)
            t = pat.sub(" ", t)  # stop "Team Rocket" matching inside "Team Rocket Returns"
    specific = [s for s in found if s["name"] not in ERA_NAMES]
    pick = specific or found
    return pick[0] if pick else None


def find_category(title: str) -> dict:
    t = norm(title)
    for cat in CATEGORIES:
        if any(_pattern(k).search(t) for k in cat["keywords"]):
            # a "case" is only a case if it's a case of boxes/bundles/ETBs, not a "carry case"
            if cat["id"] == "case" and not re.search(r"(box|bundle|etb|display|trainer).{0,20}case|case of|bundle display", t):
                continue
            return cat
    return CATEGORIES[-1]  # Other


def find_contents(title: str):
    t = norm(title)
    for name, info in CONTENTS.items():
        if all(norm(w) in t for w in info.get("match", [name])):
            return name, info
    return None, None


def pack_count(cat: dict, s: dict | None, title: str, contents: dict | None):
    if contents and contents.get("packs"):
        return sum(p["qty"] for p in contents["packs"])
    t = norm(title)
    m = re.search(r"(\d+)[\s-]*(?:x\s*)?(?:booster\s*)?packs?\b", t)
    if cat["id"] == "etb":
        return 9 if s and s["year"] >= 2023 else 8
    if cat["id"] == "case":
        if "bundle" in t:
            return None  # bundle case sizes vary, fill in via contents.json
        return 6 * 36
    if cat["packs"]:
        return cat["packs"]
    return int(m.group(1)) if m else None


def classify(title: str) -> dict:
    t = norm(title)
    skip = None
    if any(w in t for w in FOREIGN):
        skip = "foreign"
    elif any(w in t for w in NOT_SEALED):
        skip = "not-sealed"
    s = find_set(title)
    c_name, c_info = find_contents(title)
    cat = next((c for c in CATEGORIES if c["id"] == c_info["category"]), None) if c_info else None
    cat = cat or find_category(title)
    # A product named in contents.json is its own row; otherwise sealed set product rows are set+type.
    if c_name:
        key = f"{cat['id']}|{c_name}"
    elif cat["id"] in ("other", "blister-multi") or not s:
        key = f"{cat['id']}|{t}"
    else:
        key = f"{cat['id']}|{s['name']}"
    return {
        "category": cat["id"],
        "set": s["name"] if s else None,
        "year": s["year"] if s else None,
        "product": c_name,
        "packs": pack_count(cat, s, title, c_info),
        "key": key,
        "skip": skip,
    }


if __name__ == "__main__":
    import sys
    for line in sys.argv[1:] or sys.stdin:
        print(line.strip(), "->", classify(line.strip()))
