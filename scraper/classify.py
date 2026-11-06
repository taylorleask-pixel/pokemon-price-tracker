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
NOT_SEALED = ["loungefly", "acryshield", "backpack", "crossbody", " bag", "pencil case", "meta zoo", "brick",
              "keychain", "plushie", "protector", "magnetic", "ultra pro", "dragon shield", "storage box",
              "playmat", "psa ", "psa-", "cgc", "bgs ", "graded", "slab", "single card", "sleeves", "deck box",
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


VARIANTS = [("1st edition", "1st Edition"), ("pokemon center", "Pokémon Center"), ("pokemon centre", "Pokémon Center"),
            ("enhanced", "Enhanced"), ("shadowless", "Shadowless")]
CAT = {c["id"]: c for c in CATEGORIES}


def find_variant(title: str):
    t = norm(title)
    return next((label for key, label in VARIANTS if key in t), None)


def find_category(title: str, set_obj=None) -> dict:
    t = norm(title)
    # take the set name out first, so "Legendary Collection" or "Platinum" can't look like product words
    if set_obj:
        for phrase in [set_obj["name"], *set_obj.get("aliases", [])]:
            t = _pattern(phrase).sub(" ", t)
    if re.search(r"art bundle|set of \d", t):
        return CAT["other"]  # bundles of several packs/products sold together
    for cat in CATEGORIES:  # order matters: case, blisters, other, box, bundle, ETB, pack
        if any(_pattern(k).search(t) for k in cat["keywords"]):
            if cat["id"] == "case" and "acrylic" in t:
                continue  # an acrylic display case, not a case of boxes
            return cat
    return CAT["other"]


def find_contents(title: str):
    t = norm(title)
    for name, info in CONTENTS.items():
        # a "case" or "display" of a product is a different (bigger) product
        if any(_pattern(w).search(t) for w in info.get("exclude", ["case", "display", "set of"])):
            continue
        if all(norm(w) in t for w in info.get("match", [name])):
            return name, info
    return None, None


def pack_count(cat: dict, s: dict | None, title: str, contents: dict | None):
    if contents and contents.get("packs"):
        return sum(p["qty"] for p in contents["packs"])
    t = norm(title)
    t = re.sub(r"\btwo\b", "2", re.sub(r"\bthree\b", "3", re.sub(r"\bdouble\b", "2 pack", t)))
    m = re.search(r"(\d+)[\s-]*(?:x\s*)?(?:booster\s*)?(?:packs?|boosters?)\b", t) or re.search(r"set of (\d+)", t)
    if cat["id"] == "etb":
        base = 9 if s and s["year"] >= 2023 else 8
        return base + 2 if "pokemon cent" in t else base  # Pokémon Center ETBs have 2 extra packs
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
    elif re.search(r"(?<![\d/])\d{1,3}/\d{2,3}(?![\d/])|\breverse holo\b|\bholo\b(?!.*(box|pack|tin|collection))", t) \
            or re.match(r"^\d{3}\s", t):
        skip = "single"  # a single card, e.g. "082/94 Linoone Reverse Holo" - kept for the Gengar tracker
    elif any(w in t for w in NOT_SEALED):
        skip = "not-sealed"
    s = find_set(title)
    c_name, c_info = find_contents(title)
    cat = next((c for c in CATEGORIES if c["id"] == c_info["category"]), None) if c_info else None
    cat = cat or find_category(title, s)
    variant = find_variant(title) if cat["id"] in ("pack", "box", "etb", "bundle", "blister-single") else None
    if cat["id"] in ("pack", "box", "bundle", "etb", "blister-single", "case") and not s:
        cat = CAT["other"]  # e.g. "2 Booster Packs & Celebi Pin": no single set, so it's a one-off product
    # A product named in contents.json is its own row; otherwise sealed set product rows are set+type.
    if c_name:
        key = f"{cat['id']}|{c_name}"
    elif cat["id"] in ("other", "blister-multi") or not s:
        key = f"{cat['id']}|{t}"
    else:
        key = f"{cat['id']}|{s['name']}" + (f"|{variant}" if variant else "")
    return {
        "variant": variant,
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
