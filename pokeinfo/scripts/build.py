"""Builds PokeInfo's card data from TCGdex (free, no key) for English, Japanese, Korean and Chinese.

For each language it writes:
  pokeinfo/data/<lang>/sets.json          every set: name, series, release date, card counts, logo
  pokeinfo/data/<lang>/sets/<set id>.json every card in the set: number, name, picture, rarity, versions
sets.json also has a short report of what that language has (for spotting gaps).

Card rarity and versions (normal / reverse / holo / 1st edition) need one lookup per card, so a set is only
looked up again when its card count changes or it's less than 60 days old. Runs weekly on GitHub.
"""
import json
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
    sets.sort(key=lambda x: (x["date"] or "9999", x["id"]))
    rep = {"name": LANGS[lang], "sets": len(sets), "sets_with_cards": sum(1 for x in sets if x["cards_n"]),
           "cards": sum(x["cards_n"] for x in sets), "cards_with_pictures": sum(x["img_n"] for x in sets),
           "newest_set": max((f"{x['date']} {x['name']}" for x in sets if x["date"]), default=None),
           "failed_sets": failed, "minutes": round((time.time() - t0) / 60, 1)}
    (OUT / lang).mkdir(parents=True, exist_ok=True)
    (OUT / lang / "sets.json").write_text(json.dumps({"lang": lang, "updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                                                      "report": rep, "sets": sets}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(lang, rep, flush=True)


def main():
    for lang in sys.argv[1:] or list(LANGS):
        build_lang(lang)


if __name__ == "__main__":
    main()
