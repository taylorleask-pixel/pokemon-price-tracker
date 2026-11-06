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

# Japanese sets often get English names in Aussie shops ("Ninja Spinner Booster Box"), so they're recognised by name.
JP_SETS = ["mega dream", "abyss eye", "mega symphonia", "mega brave", "munikis zero", "ninja spinner", "inferno x",
           "terastal festival", "storm emeralda", "vstar universe", "vmax climax", "shiny treasure", "shiny star v",
           "cyber judge", "wild force", "crimson haze", "mask of change", "night wanderer", "stellar miracle",
           "paradise dragona", "super electric breaker", "battle partners", "heat wave arena", "glory of team rocket",
           "triplet beat", "snow hazard", "clay burst", "ruler of the black flame", "raging surf", "ancient roar",
           "future flash", "scarlet ex", "violet ex", "pokemon card 151", "eevee heroes", "fusion arts", "blue sky stream",
           "skyscraping perfect", "lost abyss", "dark phantasma", "incandescent arcana", "paradigm trigger", "star birth",
           "time gazer", "space juggler", "battle region", "tag all stars", "dream league", "sky legend",
           "pokemon center hiroshima", "pokemon center tohoku", "pokemon center fukuoka"]
LANGS = [  # first match wins
    ("SCH", ["simplified chinese", "s-chinese", "schinese", "(sc)", "[sc]", "simplified", "gem pack"]),
    ("TCH", ["traditional chinese", "t-chinese", "tchinese", "(tc)", "[tc]", "traditional", "taiwan"]),
    ("CN", ["chinese", "(cn)", "[cn]"]),  # Chinese, but the store doesn't say which script
    ("KOR", ["korean", "(kr)", "[kr]", "(kor)", "[kor]"]),
    ("JP", ["japanese", "(jp)", "[jp]", "(jpn)", "[jpn]", " jpn", "japan exclusive", *JP_SETS]),
    ("TH", ["thai"]), ("ID", ["indonesian"]), ("DE", ["german"]), ("FR", ["french"]),
    ("ES", ["spanish"]), ("IT", ["italian"]),
]


def find_lang(t: str) -> str:
    for code, pats in _LANG_PATTERNS:
        if any(p.search(t) for p in pats):
            return code
    if re.search(r"\bjp\b", t):
        return "JP"
    return "EN"


NOT_SEALED = ["deck case", "flat brim", " hat", "magnet", "energy box", "booster box acrylic", "socks", "mug", "tumbler", "pop!", "bitty pop", "coin purse", "purse", "stationery", "jewellery",
              "bar bell", "vinyl", "dvd", " cap", "key chain", "keychain", "dice", "damage counter", "coin marker",
              "face washer", "face towel", "textile", "t-shirt", "ichiban kuji", "puzzle", "jigsaw", "piggy bank",
              "cosplay", "drink bottle", "poster board", "acrylic stand", "file folder", "diorama", "card display frame",
              "league challenge", "tournament entry", "event ticket", "mystery pack", "loungefly", "acryshield", "backpack", "crossbody", " bag", "pencil case", "meta zoo", "brick",
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


_LANG_PATTERNS = [(code, [_pattern(w) for w in words if norm(w)]) for code, words in LANGS]

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


FAMILY_PACKS = [  # (pattern on the cleaned title, booster packs)
    (r"poke ball tin", 3),              # Target listing: "Poké Ball Tin, 3 packs"
    (r"stacking tins?\b", 3),           # Pokémon Wizard: 3 packs + coin
    (r"trainer'?s toolkit", 4),         # Wayland Games: 4 packs
    (r"paradox destinies tin", 5),      # Paradox TCG: 5 packs
    (r"holiday calendar 2025|holiday 2025 calendar", 6),  # Card Codex: 6 packs
    (r"fall 2025 collector'?s? chest", 6),
    (r"\bshowcase\b", 3),              # Card Codex: Pikachu V Showcase 3 packs
    (r"\b(ex|v|gx|vmax|vstar)\s+box\b(?!.*(premium|collection))", 4),  # V/ex Boxes: 4 packs
    (r"^(?!.*deluxe)(?!.*legends of johto).*\bpin collection\b", 3),  # Pin Collections: 3 packs
    (r"legends of johto pin collection", 9),
]


def is_family(t: str) -> bool:
    return not re.search(r"display|\bcase\b|bundle of|set of|\+|and .* tins", t) and any(re.search(p, t) for p, _ in FAMILY_PACKS)

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
    bundles = re.search(r"booster bundles?.*set of (\d+)", t)
    if bundles:
        return 6 * int(bundles.group(1))  # a set of booster bundles, 6 packs each
    m = re.search(r"(\d+)[\s-]*(?:x\s*)?(?:booster\s*)?(?:packs?|boosters?|pk|blisters?)\b", t) or re.search(r"set of (\d+)", t)
    if cat["id"] == "etb" and m and int(m.group(1)) > 1:
        return int(m.group(1))  # the title says how many packs
    if cat["id"] == "etb":
        base = 9 if s and s["year"] >= 2023 else 8
        return base + 2 if "pokemon cent" in t else base  # Pokémon Center ETBs have 2 extra packs
    if cat["id"] == "case":
        if "bundle" in t:
            return None  # bundle case sizes vary, fill in via contents.json
        return 6 * 36
    if cat["id"] in ("other", "blister-multi"):
        multi = re.search(r"mini tins?\s+(\d+)[\s-]*pack", t)
        if multi:
            return 2 * int(multi.group(1))  # a bundle of mini tins, 2 packs each
        if re.search(r"\bmini tins?\b", t) and not re.search(r"display|set of|\d+ tins|\bcase\b|\d+-pack|\+|poke ball", t):
            return 2  # every English mini tin has 2 packs
        if re.search(r"build and battle box\b", t) and "display" not in t:
            return 4  # every Build & Battle Box has 4 packs of its set
        # Product families checked once (sources in README): same count for every product in the family
        if not re.search(r"display|\bcase\b|bundle of|set of|\+|and .* tins", t):
            for pat, n in FAMILY_PACKS:
                if re.search(pat, t):
                    return n
    if cat["id"] == "box" and "enhanced" in t:
        return 18  # Enhanced booster boxes hold 18 packs
    if cat["packs"]:
        return cat["packs"]
    return int(m.group(1)) if m else None


def classify(title: str) -> dict:
    t = norm(title)
    skip = None
    lang = find_lang(t)
    raw = title.lower()
    if re.search(r"(?<![\d/])\d{1,3}/\d{2,3}(?![\d/])", raw) or re.search(r"\bgrad(ing|ed)\b|\bpsa\s?\d|\bcgc\s?\d|\bbgs\s?\d", raw) \
            or re.search(r"\breverse holo\b|\bholo\b(?!.*(box|pack|tin|collection))", t) \
            or (re.match(r"^\d{3}\s", t) and re.search(r"\b(holo|promo|foil)\b", t)):
        skip = "single"  # a single card, e.g. "082/94 Linoone Reverse Holo" - kept for the Gengar tracker
    elif re.search(r"dragon ball|one piece|digimon|my hero academia|gundam|transformers|teenage mutant|disney|"
                   r"magic the gathering|mtg|yu-gi-oh|yugioh|lorcana|riftbound|vanguard|flesh and blood|"
                   r"weiss schwarz|union arena|star wars|heropath|how to train your dragon|ravensburger|clementoni", t):
        skip = "not-pokemon"
    elif re.search(r"\bpin$", t) and "collection" not in t:
        skip = "not-sealed"  # a pin on its own
    elif any(w in t for w in NOT_SEALED):
        skip = "not-sealed"
    s = find_set(title)
    c_name, c_info = find_contents(title)
    cat = next((c for c in CATEGORIES if c["id"] == c_info["category"]), None) if c_info else None
    cat = cat or find_category(title, s)
    variant = find_variant(title) if cat["id"] in ("pack", "box", "etb", "bundle", "blister-single") else None
    if cat["id"] in ("pack", "box", "bundle", "etb", "blister-single", "case") and not s and lang == "EN":
        cat = CAT["other"]  # e.g. "2 Booster Packs & Celebi Pin": no single set, so it's a one-off product
    # A product named in contents.json is its own row; otherwise sealed set product rows are set+type.
    if c_name and c_info.get("separate_rows"):
        key = f"{cat['id']}|{t}"
    elif c_name:
        key = f"{cat['id']}|{c_name}"
    elif cat["id"] in ("other", "blister-multi") or not s:
        key = f"{cat['id']}|{t}"
    else:
        key = f"{cat['id']}|{s['name']}" + (f"|{variant}" if variant else "")
    if lang != "EN":
        key = f"{lang}|{cat['id']}|{t}" if not s else f"{lang}|{key}"
    packs = pack_count(cat, s, title, c_info)
    auto = None
    if not c_name and packs and cat["id"] in ("other", "blister-multi"):
        # a family count (e.g. any V Box = 4 packs) doesn't say which sets; a stated count with a set does
        auto = [{"set": s["name"] if s and not is_family(t) else None, "qty": packs}]
    return {
        "lang": lang,
        "auto_packs": auto,
        "variant": variant,
        "category": cat["id"],
        "set": s["name"] if s else None,
        "year": s["year"] if s else None,
        "product": c_name,
        "packs": packs,
        "key": key,
        "skip": skip,
    }


if __name__ == "__main__":
    import sys
    for line in sys.argv[1:] or sys.stdin:
        print(line.strip(), "->", classify(line.strip()))
