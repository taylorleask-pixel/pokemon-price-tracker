"""Looks up current eBay Australia prices for every product on the site, once a day.

Uses eBay's official Browse API, which needs a free eBay developer account.
Put the keys in GitHub as repository secrets named EBAY_CLIENT_ID and EBAY_CLIENT_SECRET.
Without them this script does nothing.

What it finds: new-condition Buy It Now listings located in Australia (not sold prices; eBay only
gives sold prices to approved businesses). Listings that look wrong (opened, empty, singles, cases,
other languages, a different product type) are filtered out, but some mismatches can slip through.

Writes data/ebay.json. Run locally with:  EBAY_CLIENT_ID=... EBAY_CLIENT_SECRET=... python scraper/ebay.py
"""
import base64
import json
import os
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlencode

import requests

DATA = Path(__file__).resolve().parent.parent / "data"
OUT = DATA / "ebay.json"
BRISBANE = timezone(timedelta(hours=10))
API = "https://api.ebay.com/buy/browse/v1/item_summary/search"
MIN_HOURS_BETWEEN = 20      # runs with the first price check of the day only
SET_CATS = {"pack": "booster pack", "blister-single": "blister", "bundle": "booster bundle",
            "box": "booster box", "etb": "elite trainer box"}
LANG_WORD = {"JP": "japanese", "KOR": "korean", "TCH": "chinese", "SCH": "chinese", "CN": "chinese"}
FOREIGN = r"japanese|japan|jpn|\bjp\b|korean|\bkor\b|chinese|simplified|traditional|\bchn\b|\bsch\b|\btch\b|thai|indonesian|german|french|italian|spanish"
ALWAYS_BAD = (r"empty|opened|unsealed|resealed|no packs|no cards|code card|codes? only|proxy|custom|fake|replica|"
              r"digital|art card|graded|\bpsa\b|\bcgc\b|\bbgs\b|slab|\bsingles?\b|\bholo\b \d|lot of|"
              r"\bwrapper|\bbox only|\btin only|insert|choose|pick your|you pick|random|mystery|repack|break\b|\bspot\b")
STOP = {"pokemon", "pokémon", "tcg", "the", "and", "of", "a", "ex", "box", "pack", "booster", "collection", "with",
        "sealed", "new", "english", "card", "cards", "game", "trading", "set", "premium"}


def norm(s):
    s = s.lower().replace("é", "e").replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def token():
    cid, sec = os.environ.get("EBAY_CLIENT_ID"), os.environ.get("EBAY_CLIENT_SECRET")
    if not (cid and sec):
        return None
    r = requests.post("https://api.ebay.com/identity/v1/oauth2/token", timeout=30,
                      headers={"Authorization": "Basic " + base64.b64encode(f"{cid}:{sec}".encode()).decode(),
                               "Content-Type": "application/x-www-form-urlencoded"},
                      data={"grant_type": "client_credentials", "scope": "https://api.ebay.com/oauth/api_scope"})
    r.raise_for_status()
    return r.json()["access_token"]


def rows_from_prices():
    """One entry per product row on the site, with the words to search eBay for."""
    contents = json.loads((DATA / "contents.json").read_text(encoding="utf-8"))
    listings = json.loads((DATA / "prices.json").read_text(encoding="utf-8")).get("listings", [])
    rows = {}
    for l in listings:
        r = rows.setdefault(l["key"], {**l, "titles": {}, "store_prices": []})
        r["titles"][l["title"]] = r["titles"].get(l["title"], 0) + 1
        if l.get("available") and l.get("price"):
            r["store_prices"].append(l["price"])
    out = []
    for key, r in rows.items():
        cat, lang = r["category"], r.get("lang") or "EN"
        if cat == "case":
            continue                      # cases are too varied to match reliably
        c = contents.get(r.get("product") or "") or {}
        if r.get("product") and not c.get("separate_rows"):
            name = r["product"]
        elif cat in SET_CATS and r.get("set"):
            name = f"{r['set']} {SET_CATS[cat]}" + (f" {r['variant']}" if r.get("variant") else "")
        else:
            name = max(r["titles"].items(), key=lambda t: t[1])[0]
        name = re.sub(r"\((?:[^)]*sold out[^)]*|preorder|pre-order|[a-z ]*chinese|japanese|korean)\)|\[[^\]]*\]", " ", name, flags=re.I)
        name = re.sub(r"(?i)\bpok[eé]mon( tcg)?\s*[-:|]?\s*|\btcg\s*[-:]\s*|\bsealed\b", " ", name)
        name = re.sub(r"\s+", " ", name).strip(" -:|")
        q = "pokemon " + name + (f" {LANG_WORD[lang]}" if lang in LANG_WORD and LANG_WORD[lang] not in name.lower() else "")
        out.append({"key": key, "q": q, "name": name, "cat": cat, "lang": lang,
                    "store_low": min(r["store_prices"]) if r["store_prices"] else None})
    return out


def wanted(row, title):
    """Is this eBay listing really the same product as the row?"""
    t = norm(title)
    if re.search(ALWAYS_BAD, t):
        return False
    if row["lang"] == "EN" and re.search(FOREIGN, t):
        return False
    if row["lang"] in LANG_WORD and LANG_WORD[row["lang"]] not in t and "japan" not in t:
        return False
    words = [w for w in norm(row["name"]).split() if w not in STOP and len(w) > 1]
    if words:
        hit = sum(1 for w in words if w in t.split() or (len(w) > 4 and w in t))
        if hit < max(1, round(len(words) * 0.75)):
            return False
    cat = row["cat"]
    if cat != "case" and re.search(r"\bcase\b|\bdisplay\b", t) and cat != "box":
        return False
    if re.search(r"\bcase\b", t):
        return False
    if cat == "pack" and re.search(r"\bbox\b|bundle|\betb\b|elite|\btin\b|blister|collection|\bx ?\d\b|\d ?x\b|\d+ packs", t):
        return False
    if cat == "box" and (not re.search(r"booster box|\bdisplay\b|36 packs|\bbox\b", t) or
                         re.search(r"\betb\b|elite|bundle|build|battle|mini|half|\bx ?\d\b|\d ?x\b|collection", t)):
        return False
    if cat == "etb" and (not re.search(r"elite trainer|\betb\b", t) or re.search(r"\bx ?[2-9]\b|[2-9] ?x\b", t)):
        return False
    if cat == "bundle" and (not re.search(r"bundle", t) or re.search(r"\bx ?[2-9]\b|[2-9] ?x\b|\bbox\b", t)):
        return False
    return True


def search(tok, row):
    params = {"q": row["q"][:100], "limit": 50, "sort": "price",
              "filter": "buyingOptions:{FIXED_PRICE},conditionIds:{1000},itemLocationCountry:AU,priceCurrency:AUD"}
    headers = {"Authorization": f"Bearer {tok}", "X-EBAY-C-MARKETPLACE-ID": "EBAY_AU",
               "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DAU%2Czip%3D4000"}
    for attempt in range(3):
        r = requests.get(API, params=params, headers=headers, timeout=30)
        if r.status_code == 429:
            time.sleep(5 * (attempt + 1))
            continue
        r.raise_for_status()
        break
    hits = []
    for it in r.json().get("itemSummaries", []):
        try:
            price = float(it["price"]["value"])
        except (KeyError, ValueError):
            continue
        ship = None
        for so in it.get("shippingOptions") or []:
            v = (so.get("shippingCost") or {}).get("value")
            if v is not None:
                ship = float(v)
                break
        if not wanted(row, it.get("title", "")):
            continue
        sl = row["store_low"]
        if sl and (price < sl * 0.4 or price > sl * 6):   # far off the store price: almost always the wrong item
            continue
        hits.append({"price": price, "ship": ship, "title": it.get("title", ""), "url": it.get("itemWebUrl")})
    hits.sort(key=lambda h: h["price"])
    see_all = "https://www.ebay.com.au/sch/i.html?" + urlencode(
        {"_nkw": row["q"], "LH_BIN": 1, "LH_PrefLoc": 1, "LH_ItemCondition": 1000, "_sop": 15})
    res = {"q": row["q"], "url": see_all, "n": len(hits)}
    if hits:
        res["low"] = hits[0]
        res["median"] = round(statistics.median(h["price"] for h in hits[:9]), 2)
    return row["key"], res


def main():
    force = "--force" in sys.argv
    tok = token()
    if not tok:
        print("eBay keys not set (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET), skipping eBay prices")
        return
    try:
        old = json.loads(OUT.read_text(encoding="utf-8"))
        age = datetime.now(BRISBANE) - datetime.fromisoformat(old["updated"])
        if not force and age < timedelta(hours=MIN_HOURS_BETWEEN):
            print(f"eBay prices are {age} old, next update after {MIN_HOURS_BETWEEN} hours")
            return
    except Exception:  # noqa: BLE001
        pass
    rows = rows_from_prices()
    print(f"Searching eBay for {len(rows)} products...")
    items, errors = {}, 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for fut in [pool.submit(search, tok, r) for r in rows]:
            try:
                k, v = fut.result()
                items[k] = v
            except Exception as e:  # noqa: BLE001
                errors += 1
                if errors <= 5:
                    print("   search failed:", e)
    if errors > len(rows) / 2:
        print(f"{errors} of {len(rows)} searches failed, keeping yesterday's eBay prices")
        return
    OUT.write_text(json.dumps({"updated": datetime.now(BRISBANE).isoformat(timespec="minutes"),
                               "note": "Australian new-condition Buy It Now listings, not sold prices",
                               "items": items}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    found = sum(1 for v in items.values() if v.get("low"))
    print(f"eBay: matching listings found for {found} of {len(rows)} products ({errors} searches failed)")


if __name__ == "__main__":
    main()
