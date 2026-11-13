"""Cheapest eBay Australia Buy It Now listings for every card in your Gengar list.

Uses eBay's official Browse API with the same keys as Pack Watch (GitHub secrets EBAY_CLIENT_ID and
EBAY_CLIENT_SECRET). Without them this script does nothing.

- Buy It Now only: auctions (bids) are skipped, including auctions that also offer Buy It Now.
- Sellers located in Australia only. Postage to Brisbane is saved when eBay gives it.
- Each listing goes through the same card matcher as the singles stores (singles.match_card), so a reverse
  holo or a stamped copy isn't counted as the normal card, and graded or Japanese cards are left out.

Writes gengar/data/ebay.json.
"""
import base64
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import singles  # noqa: E402

D = singles.D
OUT = D / "ebay.json"
API = "https://api.ebay.com/buy/browse/v1/item_summary/search"
KEEP = 3                    # cheapest listings kept per card
EXTRA = {"RH": "reverse holo", "1st": "1st edition", "CH": "cosmos holo", "SS": "staff", "JM": "world championship",
         "EGS": "eb games", "GS": "gamestop"}
SET_Q = {"SWSH Black Star Promos": "swsh promo", "XY Black Star Promos": "xy promo", "Mega Evolution Black Star Promos": "promo",
         "Expedition Base Set": "expedition", "HS—Triumphant": "triumphant", "Brilliant Stars Trainer Gallery": "brilliant stars",
         "Lost Origin Trainer Gallery": "lost origin", "30th Celebration: Classic Collection": "classic collection"}


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


def query(c, with_set=True):
    name = re.sub(r" Play! Pokemon.*| Stamp.*| 1999-2000.*|Pumpkin Pikachu.*", "", c["name"]).strip()
    extra = EXTRA.get(c["variant"]) or ("pumpkin" if "pumpkin" in c["name"].lower() else
                                        "stamp" if c["vclass"] == "stamp" else "")
    st = (SET_Q.get(c["set"]) or c["set"].replace("&", " ")) if with_set else ""
    return re.sub(r"\s+", " ", f"pokemon {name} {st} {c['number'].split('/')[0]} {extra}").strip()


def fetch(tok, q):
    params = {"q": q[:100], "limit": 100, "sort": "price",
              "filter": "buyingOptions:{FIXED_PRICE},itemLocationCountry:AU,priceCurrency:AUD"}
    headers = {"Authorization": f"Bearer {tok}", "X-EBAY-C-MARKETPLACE-ID": "EBAY_AU",
               "X-EBAY-C-ENDUSERCTX": "contextualLocation=country%3DAU%2Czip%3D4000"}
    r = None
    for attempt in range(3):
        r = requests.get(API, params=params, headers=headers, timeout=30)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(5 * (attempt + 1))
            continue
        r.raise_for_status()
        break
    return r.json().get("itemSummaries", [])


def search(tok, c, cards, market):
    q = query(c)
    found = fetch(tok, q)
    if len([it for it in found if (m := singles.match_card(cards, it.get("title", ""))) and m["id"] == c["id"]]) < KEEP:
        seen = {it.get("itemId") for it in found}
        found += [it for it in fetch(tok, query(c, False)) if it.get("itemId") not in seen]
    hits = []
    for it in found:
        if "AUCTION" in (it.get("buyingOptions") or []):      # has bids, even if it also offers Buy It Now
            continue
        title = it.get("title", "")
        m = singles.match_card(cards, title)
        if not m or m["id"] != c["id"]:
            continue
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
        if market and price < market * 0.25:                   # far below market: almost always a fake or the wrong card
            continue
        hits.append({"price": price, "ship": ship, "title": title, "url": it.get("itemWebUrl"),
                     "cond": it.get("condition")})
    hits.sort(key=lambda h: h["price"] + (h["ship"] or 0))
    see_all = "https://www.ebay.com.au/sch/i.html?" + urlencode({"_nkw": q, "LH_BIN": 1, "LH_PrefLoc": 1, "_sop": 15})
    return c["id"], {"q": q, "url": see_all, "n": len(hits), "low": hits[:KEEP]}


def main():
    tok = token()
    if not tok:
        print("eBay keys not set (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET), skipping eBay prices")
        return
    cards = json.loads((D / "cards_base.json").read_text(encoding="utf-8"))
    for c in cards:
        c["vclass"] = "stamp" if (re.search(r"stamp|play! pok", c["name"], re.I) or c["variant"] in
                                  ("PPS", "PPSH", "GCS", "GS", "EGS", "SS", "JM", "SH")) else ""
    try:
        market = {c["id"]: c.get("market_aud") for c in json.loads((D / "cards.json").read_text(encoding="utf-8"))["cards"]}
    except Exception:  # noqa: BLE001
        market = {}
    print(f"Searching eBay for {len(cards)} cards...")
    items, errors = {}, 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for fut in [pool.submit(search, tok, c, cards, market.get(c["id"])) for c in cards]:
            try:
                k, v = fut.result()
                items[str(k)] = v
            except Exception as e:  # noqa: BLE001
                errors += 1
                if errors <= 5:
                    print("   search failed:", e)
    if errors > len(cards) / 2:
        print(f"{errors} of {len(cards)} searches failed, keeping the last eBay prices")
        return
    OUT.write_text(json.dumps({"updated": datetime.now(singles.BRISBANE).isoformat(timespec="minutes"),
                               "note": "Buy It Now listings from Australian sellers (no auctions), cheapest first",
                               "items": items}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    found = sum(1 for v in items.values() if v["low"])
    print(f"eBay: Buy It Now listings found for {found} of {len(cards)} cards ({errors} searches failed)")


if __name__ == "__main__":
    main()
