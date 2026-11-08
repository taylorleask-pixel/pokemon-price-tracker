"""Adds a picture and a market price to every card in gengar/data/cards_base.json.

Looks each card up in two free Pokémon card databases:
  - pokemontcg.io  (pictures + TCGplayer market prices in USD, and Cardmarket in EUR)
  - TCGdex         (pictures, and newer sets that pokemontcg.io doesn't have yet)
Prices are turned into AUD. Writes gengar/data/cards.json. Runs once a day on GitHub.
"""
import json
import re
import time
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent.parent / "data"
S = requests.Session()
S.headers["User-Agent"] = "GengarFinder (personal collection tracker)"
BRISBANE = timezone(timedelta(hours=10))

# names in the list that the databases spell differently
SET_ALIASES = {
    "expedition base set": ["expedition base set", "expedition"],
    "hs—triumphant": ["hs—triumphant", "triumphant"],
    "xy black star promos": ["xy black star promos", "xy promos"],
    "swsh black star promos": ["swsh black star promos", "sword & shield promos"],
    "mega evolution black star promos": ["mega evolution black star promos", "mega evolution promos", "mep black star promos"],
    "brilliant stars trainer gallery": ["brilliant stars trainer gallery"],
    "lost origin trainer gallery": ["lost origin trainer gallery"],
    "scarlet & violet": ["scarlet & violet", "scarlet & violet base"],
    "30th celebration": ["30th celebration", "pokémon 30th celebration"],
    "30th celebration: classic collection": ["30th celebration: classic collection", "30th celebration classic collection", "classic collection"],
}
# which TCGplayer price to use for each variant code (first one found wins)
PRICE_KEYS = {
    "—": ["normal", "unlimited", "holofoil"], "H": ["holofoil", "unlimitedHolofoil", "normal"],
    "RH": ["reverseHolofoil"], "1st": ["1stEditionHolofoil", "1stEdition", "1stEditionNormal"],
    "U": ["unlimited", "normal", "unlimitedNormal"], "UH": ["unlimitedHolofoil", "holofoil"],
    "PPSH": ["holofoil"], "CH": ["holofoil"],
}


def n(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def num_forms(num):
    base = num.split("/")[0]
    forms = [base, base.lstrip("0") or "0"]
    return list(dict.fromkeys(forms))


def get(url, **params):
    for attempt in range(4):
        try:
            r = S.get(url, params=params, timeout=40)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(3 * (attempt + 1))
                continue
            return r
        except requests.RequestException:
            time.sleep(3 * (attempt + 1))
    return None


def aud_rates():
    try:
        r = get("https://open.er-api.com/v6/latest/AUD").json()["rates"]
        return 1 / r["USD"], 1 / r["EUR"]
    except Exception:  # noqa: BLE001
        return 1.53, 1.75


def ptcg_sets():
    r = get("https://api.pokemontcg.io/v2/sets", pageSize=250)
    return r.json()["data"] if r is not None and r.ok else []


def tcgdex_sets():
    r = get("https://api.tcgdex.net/v2/en/sets")
    return r.json() if r is not None and r.ok else []


def find_set(name, sets, key="name"):
    wanted = [n(a) for a in SET_ALIASES.get(name.lower(), [name])]
    for w in wanted:
        for s in sets:
            if n(s[key]) == w:
                return s
    return None


def main():
    cards = json.loads((HERE / "cards_base.json").read_text(encoding="utf-8"))
    usd, eur = aud_rates()
    psets, dsets = ptcg_sets(), tcgdex_sets()
    print(f"pokemontcg.io sets: {len(psets)}, TCGdex sets: {len(dsets)}, 1 USD = {usd:.3f} AUD")
    cache = {}
    missing = []
    try:   # last run's results, used when a lookup fails this time
        prev = {(c["set"], c["number"]): c for c in json.loads((HERE / "cards.json").read_text(encoding="utf-8"))["cards"]}
    except Exception:  # noqa: BLE001
        prev = {}
    for c in cards:
        k = (c["set"], c["number"])
        if k not in cache:
            info = {}
            ps = find_set(c["set"], psets)
            if ps:
                for num in num_forms(c["number"]):
                    r = get(f"https://api.pokemontcg.io/v2/cards/{ps['id']}-{num}")
                    if r is not None and r.ok:
                        d = r.json()["data"]
                        info = {"db_name": d.get("name"), "image": d["images"]["small"], "image_large": d["images"]["large"],
                                "rarity": d.get("rarity"), "set_id": ps["id"], "set_total": ps.get("printedTotal"),
                                "tcgplayer": (d.get("tcgplayer") or {}).get("prices") or {},
                                "tcgplayer_url": (d.get("tcgplayer") or {}).get("url"),
                                "cardmarket": (d.get("cardmarket") or {}).get("prices") or {},
                                "set_logo": ps["images"].get("logo"), "set_symbol": ps["images"].get("symbol")}
                        break
            if not info.get("image"):
                ds = find_set(c["set"], dsets)
                if ds:
                    for num in num_forms(c["number"]) + [c["number"].split("/")[0].zfill(3)]:
                        r = get(f"https://api.tcgdex.net/v2/en/sets/{ds['id']}/{num}")
                        if r is not None and r.ok and r.json().get("image"):
                            d = r.json()
                            info.update({"db_name": d.get("name"), "image": d["image"] + "/low.webp", "image_large": d["image"] + "/high.webp",
                                         "rarity": info.get("rarity") or d.get("rarity"),
                                         "set_logo": info.get("set_logo") or (ds.get("logo") and ds["logo"] + ".png")})
                            break
            if not info.get("image"):
                # last try: search TCGdex by card name and number, whatever the set is called there
                r = get("https://api.tcgdex.net/v2/en/cards", name=re.sub(r" Play! Pokemon.*| Stamp.*", "", c["name"]))
                for hit in (r.json() if r is not None and r.ok else []):
                    if hit.get("image") and hit.get("localId", "").lstrip("0") == c["number"].split("/")[0].lstrip("0"):
                        info.update({"db_name": hit.get("name"), "image": hit["image"] + "/low.webp",
                                     "image_large": hit["image"] + "/high.webp"})
                        break
            if not info.get("image") and prev.get(k, {}).get("image"):
                old = prev[k]
                info = {x: old.get(x) for x in ("db_name", "image", "image_large", "rarity", "set_logo", "set_symbol", "tcgplayer_url")}
            if info.get("db_name") and n(info["db_name"]).split()[0] not in n(c["name"]).split() \
                    and n(c["name"]).split()[0] not in n(info["db_name"]):
                info["wrong_card"] = info.pop("db_name")      # the number points at a different card: don't show its picture
                for x in ("image", "image_large", "tcgplayer", "cardmarket"):
                    info.pop(x, None)
            cache[k] = info
        info = cache[k]
        c.update({x: info.get(x) for x in ("db_name", "wrong_card", "image", "image_large", "rarity", "set_logo", "set_symbol", "tcgplayer_url")})
        # market value for this exact variant, in AUD
        tp, value, basis = info.get("tcgplayer") or {}, None, None
        stamped = re.search(r"stamp|play! pok|red logo", c["name"], re.I)   # the normal card's price would be wrong
        for key in ([] if stamped else PRICE_KEYS.get(c["variant"], [])):
            p = tp.get(key) or {}
            if p.get("market") or p.get("mid"):
                value, basis = round((p.get("market") or p.get("mid")) * usd, 2), f"TCGplayer {key}"
                break
        if value is None and not stamped and c["variant"] in ("—", "H", "U", "UH") and (info.get("cardmarket") or {}).get("trendPrice"):
            value, basis = round(info["cardmarket"]["trendPrice"] * eur, 2), "Cardmarket trend"
        c["market_aud"], c["market_basis"] = value, basis
        if not c["image"]:
            missing.append(f"#{c['id']} {c['name']} {c['set']} {c['number']}")
    out = {"updated": datetime.now(BRISBANE).isoformat(timespec="minutes"), "usd_to_aud": round(usd, 4), "cards": cards}
    (HERE / "cards.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"pictures found for {len(cards) - len(missing)} of {len(cards)}; market prices for "
          f"{sum(1 for c in cards if c['market_aud'])}")
    odd = [f"#{c['id']} {c['name']} ({c['set']} {c['number']}) is '{c['wrong_card']}' in the database"
           for c in cards if c.get("wrong_card")]
    if odd:
        print("name doesn't match:\n  " + "\n  ".join(odd))
    if missing:
        print("no picture:\n  " + "\n  ".join(missing))


if __name__ == "__main__":
    main()
