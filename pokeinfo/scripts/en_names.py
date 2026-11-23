"""English names for Japanese, Korean and Chinese cards, so a card with no picture can still be recognised.
Pokémon and item names come from PokeAPI (manual/name-dict.json); forms, owners and card mechanics are
handled here. Cards it can't work out (most trainers) get no English name."""
import json
import re
from pathlib import Path

D = json.loads((Path(__file__).resolve().parent.parent / "manual" / "name-dict.json").read_text(encoding="utf-8"))
NAMES = {**D["items"], **D["pokemon"]}
SUFFIX = re.compile(r"\s*(ex|EX|ＥＸ|ｅｘ|V|Ｖ|VMAX|ＶＭＡＸ|VSTAR|ＶＳＴＡＲ|V-UNION|GX|ＧＸ|BREAK|LV\.X|Lv\.X|☆|δ|◇|prime|LEGEND|TAG TEAM)$")
FORMS = [(r"^(메가|メガ|超級|超级)\s*", "Mega "), (r"^(알로라|アローラ|阿羅拉|阿罗拉)\s*", "Alolan "),
         (r"^(가라르|ガラル|伽勒爾|伽勒尔)\s*", "Galarian "), (r"^(히스이|ヒスイ|洗翠)\s*", "Hisuian "),
         (r"^(팔데아|パルデア|帕底亞|帕底亚)\s*", "Paldean "), (r"^(테라스탈|テラスタル)\s*", "Tera "),
         (r"^(다크|ダーク|暗黑|暗黑)\s*", "Dark "), (r"^(라이트|ライト)\s*", "Light ")]
OWNER = re.compile(r"^(로켓단|ロケット団|火箭隊|火箭队)(의|の|的)\s*")
TYPES = {"풀": "Grass", "불꽃": "Fire", "물": "Water", "번개": "Lightning", "초": "Psychic", "격투": "Fighting", "악": "Darkness",
         "강철": "Metal", "페어리": "Fairy", "草": "Grass", "炎": "Fire", "水": "Water", "雷": "Lightning", "超": "Psychic",
         "闘": "Fighting", "悪": "Darkness", "鋼": "Metal", "フェアリー": "Fairy", "火": "Fire", "鬥": "Fighting", "斗": "Fighting",
         "惡": "Darkness", "恶": "Darkness", "鋼": "Metal", "钢": "Metal", "妖精": "Fairy"}
ENERGY = re.compile(r"^(기본\s*)?(\S+?)\s*에너지$|^基本(\S+?)エネルギー$|^基本(\S+?)能量$")


def english(name):
    n = (name or "").strip()
    if not n or re.fullmatch(r"[\x00-\x7F’'é&\s]+", n):
        return None
    if n in NAMES:
        return NAMES[n]
    m = ENERGY.match(n)
    if m:
        t = next(g for g in m.groups()[1:] if g)
        return f"Basic {TYPES[t]} Energy" if t in TYPES else None
    pre = ""
    m = OWNER.match(n)
    if m:
        pre, n = "Team Rocket's ", n[m.end():]
    suf = ""
    m = SUFFIX.search(n)
    if m:
        suf = " " + m.group(1).translate(str.maketrans("ＥＸｅｘＶＭＡＳＴＲＧ", "EXexVMASTRG")).replace("EX", "ex" if m.group(1) in ("ex", "ｅｘ") else "EX")
        n = n[: m.start()].strip()
    form = ""
    for pat, word in FORMS:
        m = re.match(pat, n)
        if m:
            form += word
            n = n[m.end():]
    xy = ""
    m = re.search(r"\s*([XYＸＹ])$", n)
    if form.startswith("Mega") and m:
        xy, n = " " + m.group(1).translate(str.maketrans("ＸＹ", "XY")), n[: m.start()]
    base = NAMES.get(n)
    if not base:
        return None
    return f"{pre}{form}{base}{xy}{suf}"


def add_english(path):
    data = json.loads(path.read_text(encoding="utf-8"))
    changed = False
    for c in data.get("cards", []):
        e = english(c.get("name"))
        if e and c.get("en") != e:
            c["en"] = e
            changed = True
    if changed:
        path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return changed
