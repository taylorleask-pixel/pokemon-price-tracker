"""Builds PokeInfo's card data from TCGdex (free, no key) for English, Japanese, Korean and Chinese.

For each language it writes:
  pokeinfo/data/<lang>/sets.json          every set: name, series, release date, card counts, logo
  pokeinfo/data/<lang>/sets/<set id>.json every card in the set: number, name, picture, rarity, versions
sets.json also has a short report of what that language has (for spotting gaps).

Card rarity and versions (normal / reverse / holo / 1st edition) need one lookup per card, so a set is only
looked up again when its card count changes or it's less than 60 days old. Runs weekly on GitHub.
"""
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

OUT = Path(__file__).resolve().parent.parent / "data"
API = "https://api.tcgdex.net/v2"
LANGS = {"en": "English", "ja": "Japanese", "ko": "Korean", "zh-tw": "Chinese (Traditional)", "zh-cn": "Chinese (Simplified)"}
FRESH_DAYS = 60
MANUAL = Path(__file__).resolve().parent.parent / "manual"
SKIP_SERIES = {"tcgp"}          # Pokémon TCG Pocket: the phone game, not real cards
# English sets TCGdex has without pictures: pokemontcg.io set ids whose names differ (the rest match by name)
PTCG_IDS = {"2011bw": "mcd11", "2012bw": "mcd12", "2014xy": "mcd14", "2015xy": "mcd15", "2016xy": "mcd16", "2017sm": "mcd17",
            "2018sm": "mcd18", "2019sm": "mcd19", "2021swsh": "mcd21", "2022swsh": "mcd22", "sm3.5": "sm35", "sm7.5": "sm75",
            "swsh4.5sv": "swsh45sv", "cel25cc": "cel25c", "swsh9tg": "swsh9tg", "swsh10tg": "swsh10tg", "swsh11tg": "swsh11tg",
            "swsh12tg": "swsh12tg", "swsh12.5gg": "swsh12pt5gg", "sve": "sve", "svp": "svp", "bog": "bp", "30th-c": "me55c",
            "tk-ex-latia": "tk1a", "tk-ex-latio": "tk1b", "tk-ex-p": "tk2a", "tk-ex-m": "tk2b"}
S = requests.Session()
S.headers["User-Agent"] = "PokeInfo (personal collection tracker)"


def get(path):
    for attempt in range(5):
        try:
            r = S.get(API + path, timeout=40)
            if r.status_code == 404:
                return None
            if r.status_code == 200:
                return r.json()
        except (requests.RequestException, ValueError):
            pass
        time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"lookup failed: {path}")


def card_row(lang, brief):
    c = get(f"/{lang}/cards/{brief['id']}") or {}
    v = c.get("variants") or {}
    rarity = c.get("rarity")
    row = {"id": brief["id"], "n": brief.get("localId", ""), "name": brief.get("name", ""),
           "img": brief.get("image"), "r": None if rarity in (None, "None", "") else rarity,
           "cat": c.get("category"),
           "v": "".join(k for k, f in (("n", "normal"), ("r", "reverse"), ("h", "holo"), ("f", "firstEdition")) if v.get(f))}
    tp = (c.get("pricing") or {}).get("tcgplayer") or {}
    prices = [p.get("marketPrice") for k, p in tp.items() if isinstance(p, dict) and p.get("marketPrice")]
    if prices:
        row["usd"] = max(prices)
    return row


def build_set(lang, brief, old):
    s = get(f"/{lang}/sets/{brief['id']}")
    if not s:
        return None
    cards = s.get("cards") or []
    rel = s.get("releaseDate") or ""
    recent = rel and rel >= (date.today() - timedelta(days=FRESH_DAYS)).isoformat()
    path = OUT / lang / "sets" / f"{brief['id']}.json"
    if old and old.get("cards_n") == len(cards) and not recent and path.exists():
        rows = json.loads(path.read_text(encoding="utf-8"))["cards"]
    else:
        with ThreadPoolExecutor(max_workers=12) as pool:
            rows = list(pool.map(lambda b: card_row(lang, b), cards))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"id": brief["id"], "name": s.get("name"), "cards": rows},
                                   ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    cc = s.get("cardCount") or {}
    logo = brief.get("logo") or s.get("logo")
    sym = s.get("symbol")
    return {"id": brief["id"], "name": s.get("name") or brief.get("name"), "serie": (s.get("serie") or {}).get("name"),
            "serie_id": (s.get("serie") or {}).get("id"), "date": rel, "official": cc.get("official"), "total": cc.get("total"),
            "cards_n": len(cards), "img_n": sum(1 for c in cards if c.get("image")),
            "logo": f"{logo}.webp" if logo else None, "symbol": f"{sym}.webp" if sym else None,
            "abbr": (s.get("abbreviation") or {}).get("official") if isinstance(s.get("abbreviation"), dict) else None}


def norm_name(n):
    # keeps letters in any language (Japanese, Korean, Chinese), drops punctuation and spacing differences
    return re.sub(r"[\W_]+", " ", (n or "").lower().replace("&", " and ")).strip()


def norm_num(n):
    return re.sub(r"(?<![0-9])0+(?=[0-9])", "", str(n or "").upper().strip())


def picture_loads(url):
    for _ in range(2):
        try:
            return S.head(url, timeout=30, allow_redirects=True).status_code == 200
        except requests.RequestException:
            time.sleep(2)
    return False


def fill_pictures(sets):
    """English only: cards TCGdex has no picture for get one from pokemontcg.io (free) when it has the set."""
    need = [x for x in sets if x["cards_n"] and x["img_n"] < x["cards_n"]]
    if not need:
        return
    ptcg = None   # the pokemontcg.io API is often down; its picture links follow a fixed pattern, so use those
    if ptcg is None:
        # fall back to its picture links, which follow a fixed pattern: images.pokemontcg.io/<set>/<number>.png
        n_sets = 0
        for x in need:
            pid = PTCG_IDS.get(x["id"])
            if not pid:
                continue
            path = OUT / "en" / "sets" / f"{x['id']}.json"
            data = json.loads(path.read_text(encoding="utf-8"))
            todo = [row for row in data["cards"] if not row.get("img") and (not row.get("ps") or "pokemontcg" in row["ps"])]
            for row in todo:
                num = row["n"].lstrip("0") if row["n"].isdigit() else row["n"]
                row["ps"], row["pl"] = f"https://images.pokemontcg.io/{pid}/{num}.png", f"https://images.pokemontcg.io/{pid}/{num}_hires.png"
            with ThreadPoolExecutor(max_workers=12) as pool:     # keep only links that actually load
                good = list(pool.map(lambda row: picture_loads(row["ps"]), todo))
            for row, g in zip(todo, good):
                if not g:
                    row.pop("ps", None); row.pop("pl", None)
            path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            x["img_n"] = sum(1 for row in data["cards"] if row.get("img") or row.get("ps"))
            n_sets += 1
        print(f"   pictures linked from pokemontcg.io for {n_sets} sets")
        return
    by_name = {norm_name(p["name"]): p["id"] for p in ptcg}
    ids = {p["id"] for p in ptcg}
    filled_sets = 0
    for x in need:
        pid = PTCG_IDS.get(x["id"]) or by_name.get(norm_name(x["name"]))
        if not pid or pid not in ids:
            continue
        try:
            cards = []
            for page in (1, 2, 3):
                for attempt in range(4):        # pokemontcg.io sometimes answers 500 or 429: wait and try again
                    r = requests.get("https://api.pokemontcg.io/v2/cards", timeout=90,
                                     params={"q": f"set.id:{pid}", "pageSize": 250, "page": page, "select": "number,images"})
                    if r.status_code < 500 and r.status_code != 429:
                        break
                    time.sleep(10 * (attempt + 1))
                r.raise_for_status()
                got = r.json()["data"]
                cards += got
                if len(got) < 250:
                    break
        except Exception as e:  # noqa: BLE001
            print(f"   pokemontcg.io {pid} failed: {e}")
            continue
        pics = {norm_num(c["number"]): c.get("images") or {} for c in cards}
        path = OUT / "en" / "sets" / f"{x['id']}.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        n = 0
        for row in data["cards"]:
            im = pics.get(norm_num(row["n"])) or {}
            if not row.get("img") and im.get("small"):
                row["ps"], row["pl"] = im["small"], im.get("large") or im["small"]
                n += 1
            elif row.get("img") or row.get("ps"):
                pass
        if n:
            path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            filled_sets += 1
        x["img_n"] = sum(1 for row in data["cards"] if row.get("img") or row.get("ps"))
    print(f"   pictures filled from pokemontcg.io for {filled_sets} sets")


def find_original(lang, sets, num, name):
    """A stamped reprint like 057/198 Gengar: find the original card (picture, rarity) in the set with that many cards."""
    if "/" not in num:
        return None
    n, total = (norm_num(x) for x in num.split("/", 1))
    for x in sets:
        if x.get("manual") or str(x.get("official") or "") != total:
            continue
        try:
            rows = json.loads((OUT / lang / "sets" / f"{x['id']}.json").read_text(encoding="utf-8"))["cards"]
        except Exception:  # noqa: BLE001
            continue
        for r in rows:
            if norm_num(r["n"]) == n and norm_name(r["name"]).startswith(norm_name(re.sub(r"\s*[(\[].*$", "", name))):
                return {**r, "from": x["name"]}
    return None


def add_manual(lang, sets):
    """Sets typed in by hand (pokeinfo/manual/<lang>/*.json) until the card database adds them."""
    with_cards = [x for x in sets if x.get("cards_n")]
    have = {norm_name(x["name"]) for x in with_cards}
    have_ids = {x["id"]: x for x in with_cards}
    for f in sorted((MANUAL / lang).glob("*.json")) if (MANUAL / lang).exists() else []:
        m = json.loads(f.read_text(encoding="utf-8"))
        db = have_ids.get(m["id"])
        known_id = any(x["id"] == m["id"] for x in sets)      # targets a set the database lists: decide by its code, not its name
        if (db and db["cards_n"] >= len(m["cards"])) or (not db and not known_id and (norm_name(m["name"]) in have or any(norm_name(a) in have for a in m.get("also_called", [])))):
            print(f"   {m['name']}: now in the card database, hand-made copy not used")
            continue
        sets[:] = [x for x in sets if x["id"] != m["id"]]      # replaces the database's empty (or shorter) copy
        rows, found = [], 0
        for c in m["cards"]:
            row = {"id": f"{m['id']}-{c['n'].replace('/', '-')}", "n": c["n"], "name": c["name"], "img": None, "r": c.get("r"),
                   "cat": "Pokemon", "v": c.get("v", "n")}
            if c.get("ps"):
                row.update(ps=c["ps"], pl=c.get("pl", c["ps"]))
            if c.get("from"):
                row["from"] = c["from"]
            orig = find_original(lang, sets, c["n"], c["name"])
            if orig:
                found += 1
                row["from"] = orig["from"]
                for k in ("img", "ps", "pl"):
                    if orig.get(k) and not row.get(k):
                        row[k] = orig[k]
                if orig.get("r") and row["r"] in (None, "Promo"):
                    row["r"] = orig["r"]
            rows.append(row)
        path = OUT / lang / "sets" / f"{m['id']}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"id": m["id"], "name": m["name"], "note": m.get("note"), "cards": rows}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        sets.append({"id": m["id"], "name": m["name"], "serie": m.get("serie"), "serie_id": m.get("serie_id"), "date": m.get("date"),
                     "official": m.get("official"), "total": len(rows), "cards_n": len(rows),
                     "img_n": sum(1 for r in rows if r.get("img") or r.get("ps")), "logo": m.get("logo"), "symbol": None, "abbr": m.get("abbr"), "manual": True, **({"cover_pick": m["cover"]} if m.get("cover") else {})})
        print(f"   added by hand: {m['name']} ({len(rows)} cards, {found} matched to the original card)")


RARE_ORDER = ["mega hyper", "hyper", "special illustration", "illustration", "ultra", "secret", "shiny ultra", "double", "holo", "rare"]


NAME_FIX = {"ja": {"CP5": "幻・伝説ドリームキラコレクション"}}   # database calls CP5 "Cruel Traitor" (that's XY11b)


def add_extra_sets(lang, sets):
    """Sets the card database doesn't list at all (from Taylor's set lists): added with no cards, so they show
    under Missing sets with their logo, ready for a pasted card list."""
    try:
        extra = json.loads((MANUAL / "extra-sets.json").read_text(encoding="utf-8")).get(lang, [])
    except Exception:  # noqa: BLE001
        return
    have = {norm_name(x["name"]) for x in sets} | {x["id"] for x in sets}
    for e in extra:
        if e["id"] in have or norm_name(e["name"]) in have:
            continue
        sets.append({"id": e["id"], "name": e["name"], "name_en": e.get("name_en"), "serie": e.get("serie"), "serie_id": e.get("serie_id"),
                     "date": e.get("date"), "official": e.get("official"), "total": e.get("official"), "cards_n": 0, "img_n": 0,
                     "logo": e.get("logo"), "symbol": e.get("symbol"), "abbr": None, "extra": True})


def apply_art(lang, sets):
    """Logos and set symbols Taylor supplied. His logos always win; his symbols fill gaps."""
    try:
        art = json.loads((MANUAL / "art.json").read_text(encoding="utf-8")).get(lang, {})
    except Exception:  # noqa: BLE001
        return
    for x in sets:
        a = art.get(x["id"]) or {}
        if a.get("logo"):
            x["logo"] = a["logo"]
        if a.get("symbol") and not x.get("symbol"):
            x["symbol"] = a["symbol"]


def fill_logos(lang, sets):
    """Sets the card database has no logo for: the main set's logo for sub-sets (Trainer Gallery...),
    pokemontcg.io's logo, the set symbol, or failing all that the set's best card as a cover picture."""
    with_logo = sorted([x for x in sets if x.get("logo")], key=lambda x: -len(x["name"]))
    for x in sets:
        x.pop("cover", None)
        sym_parent = next((p for p in sets if p is not x and p.get("symbol") and norm_name(x["name"]).startswith(norm_name(p["name"]) + " ")), None)
        if sym_parent and not x.get("symbol"):
            x["symbol"] = sym_parent["symbol"]
        if x.get("logo"):
            continue
        parent = next((p for p in with_logo if p is not x and norm_name(x["name"]).startswith(norm_name(p["name"]) + " ")), None)
        if parent:
            x["logo"] = parent["logo"]
            continue
        pid = PTCG_IDS.get(x["id"]) if lang == "en" else None
        if pid and picture_loads(f"https://images.pokemontcg.io/{pid}/logo.png"):
            x["logo"] = f"https://images.pokemontcg.io/{pid}/logo.png"
            continue
        try:
            rows = json.loads((OUT / lang / "sets" / f"{x['id']}.json").read_text(encoding="utf-8"))["cards"]
        except Exception:  # noqa: BLE001
            rows = []
        codes = {"MUR": 0, "SAR": 1, "UR": 2, "HR": 2, "SR": 3, "CSR": 3, "AR": 4, "CHR": 4, "RRR": 5, "RR": 6, "K": 6, "R": 9}
        def rank(r):
            rr = (r.get("r") or "").strip()
            if rr.upper() in codes:
                return codes[rr.upper()]
            return next((i for i, w in enumerate(RARE_ORDER) if w in rr.lower()), len(RARE_ORDER))
        def not_star(r):   # prefer the big Pokémon (ex, V, VSTAR, GX…) over trainers and items when nothing else says
            return re.search(r"(\bex|\bv|vmax|vstar|gx|\bex\b|ＥＸ|ｅｘ)\s*$", r.get("name", ""), re.I) is None
        pics = [r for r in rows if r.get("img") or r.get("ps")]
        if x.get("cover_pick"):   # a hand-made set that names its cover card
            x["cover"] = x["cover_pick"]
        elif pics:
            # the set's chase card: most valuable if there are prices, else the rarest Pokémon (not a trainer)
            best = min(pics, key=lambda r: (-(r.get("usd") or 0), (r.get("cat") or "Pokemon").lower() not in ("pokemon", "pokémon"),
                                            rank(r), not_star(r), -rows.index(r)))
            x["cover"] = f"{best['img']}/low.webp" if best.get("img") else best["ps"]
        elif x.get("symbol"):
            x["logo"] = x["symbol"]


def apply_pictures(lang, sets):
    """Card pictures Taylor supplied (manual/pictures.json: language → set → card number → picture), for cards
    the database has no picture for."""
    try:
        pics = json.loads((MANUAL / "pictures.json").read_text(encoding="utf-8")).get(lang, {})
    except Exception:  # noqa: BLE001
        return
    for x in sets:
        mine = {norm_num(k): v for k, v in (pics.get(x["id"]) or {}).items()}
        path = OUT / lang / "sets" / f"{x['id']}.json"
        if not mine or not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        n = 0
        for r in data["cards"]:
            p = mine.get(norm_num(r["n"].split("/")[0]))
            small, big = (p[0], p[-1]) if isinstance(p, list) else (p, p)   # [small, large] or one picture
            if p and not r.get("img") and (r.get("ps"), r.get("pl")) != (small, big):
                r["ps"], r["pl"] = small, big
                n += 1
        if n:
            path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        x["img_n"] = sum(1 for r in data["cards"] if r.get("img") or r.get("ps"))
        print(f"   {x['id']}: {n} pictures from Taylor")


def borrow_rarity(lang, sets):
    """Korean and Chinese sets are the Japanese sets with the same code and card numbers: where a card has no rarity,
    take the Japanese card's rarity (same set code, same number)."""
    filled = 0
    for x in sets:
        jp_file = OUT / "ja" / "sets" / f"{x['id']}.json"
        path = OUT / lang / "sets" / f"{x['id']}.json"
        if not x.get("cards_n") or not jp_file.exists() or not path.exists():
            continue
        try:
            jp = {norm_num(r["n"].split("/")[0]): r.get("r") for r in json.loads(jp_file.read_text(encoding="utf-8"))["cards"] if r.get("r")}
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        n = 0
        for r in data["cards"]:
            if not r.get("r") and jp.get(norm_num(r["n"].split("/")[0])):
                r["r"] = jp[norm_num(r["n"].split("/")[0])]
                n += 1
        if n:
            path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            filled += n
    print(f"   rarity copied from the Japanese sets for {filled} cards")


def write_index(lang, sets):
    """One small file listing every card in the language, so the app can search all sets at once.
    cards: [set index, card id (0 when it's "<set>-<number>"), number, name, rarity, picture (1 = the set's usual picture address)]"""
    out_sets, out_cards = [], []
    for x in sets:
        if not x.get("cards_n"):
            continue
        try:
            rows = json.loads((OUT / lang / "sets" / f"{x['id']}.json").read_text(encoding="utf-8"))["cards"]
        except Exception:  # noqa: BLE001
            continue
        imgs = [r["img"] for r in rows if r.get("img")]
        base = imgs[0].rsplit("/", 1)[0] if imgs else ""
        si = len(out_sets)
        out_sets.append([x["id"], x["name"], base])
        for r in rows:
            if r.get("img") and base and r["img"] == f"{base}/{r['id'].split('-')[-1]}":
                pic = 1
            elif r.get("img"):
                pic = f"{r['img']}/low.webp"
            else:
                pic = r.get("ps") or 0
            out_cards.append([si, 0 if r["id"] == f"{x['id']}-{r['n']}" else r["id"], r["n"], r["name"], r.get("r") or "", pic])
    (OUT / lang / "index.json").write_text(json.dumps({"sets": out_sets, "cards": out_cards}, ensure_ascii=False, separators=(",", ":")),
                                          encoding="utf-8")


def build_lang(lang):
    t0 = time.time()
    try:
        old = {x["id"]: x for x in json.loads((OUT / lang / "sets.json").read_text(encoding="utf-8"))["sets"]}
    except Exception:  # noqa: BLE001
        old = {}
    briefs = get(f"/{lang}/sets") or []
    sets, failed = [], 0
    for b in briefs:
        try:
            row = build_set(lang, b, old.get(b["id"]))
            if row:
                sets.append(row)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"   {lang} {b['id']} failed: {e}")
            if b["id"] in old:
                sets.append(old[b["id"]])       # keep last week's copy
    sets = [x for x in sets if x.get("serie_id") not in SKIP_SERIES]
    if lang == "en":
        fill_pictures(sets)
    for x in sets:   # the card database has a few set names wrong
        x["name"] = NAME_FIX.get(lang, {}).get(x["id"], x["name"])
    add_extra_sets(lang, sets)
    add_manual(lang, sets)
    # the database lists some sets twice (CSV1C twice; empty lowercase "csm1a" beside "CSM1aC")
    best = {}
    for x in sets:
        if x["id"] not in best or x["cards_n"] > best[x["id"]]["cards_n"]:
            best[x["id"]] = x
    have = {i.lower() for i in best}
    sets[:] = [x for i, x in best.items() if x["cards_n"] or (i.lower() + "c") not in have]
    apply_pictures(lang, sets)
    if lang in ("ko", "zh-tw", "zh-cn"):
        borrow_rarity(lang, sets)
    apply_art(lang, sets)
    fill_logos(lang, sets)
    sets.sort(key=lambda x: (x["date"] or "9999", x["id"]))
    rep = {"name": LANGS[lang], "sets": len(sets), "sets_with_cards": sum(1 for x in sets if x["cards_n"]),
           "cards": sum(x["cards_n"] for x in sets), "cards_with_pictures": sum(x["img_n"] for x in sets),
           "newest_set": max((f"{x['date']} {x['name']}" for x in sets if x["date"]), default=None),
           "failed_sets": failed, "minutes": round((time.time() - t0) / 60, 1)}
    (OUT / lang).mkdir(parents=True, exist_ok=True)
    (OUT / lang / "sets.json").write_text(json.dumps({"lang": lang, "updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                                                      "report": rep, "sets": sets}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    write_index(lang, sets)
    print(lang, rep, flush=True)


def main():
    for lang in sys.argv[1:] or list(LANGS):
        build_lang(lang)


if __name__ == "__main__":
    main()
