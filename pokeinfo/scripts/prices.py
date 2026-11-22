"""Card prices for PokeInfo (English sets only: the card database has no prices for the other languages).

Every day it looks up TCGplayer market prices (US dollars) for the cards in English sets released in the last
three years, and on Wednesdays (or with --all) for every English set. It writes:
  pokeinfo/data/en/prices/<set id>.json   {"d": date, "c": {card id: {version letter: US$}}}
  pokeinfo/data/en/prices/_meta.json      {"d": date, "aud": Australian dollars per US dollar}
  pokeinfo/data/en/value-history.json     {set id: [[date, whole set A$, master set A$], ...]}  one point a day
Version letters: n normal, h holo, r reverse holo, f 1st edition.
"""
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import requests

DATA = Path(__file__).resolve().parent.parent / "data" / "en"
API = "https://api.tcgdex.net/v2/en"
S = requests.Session()
S.headers["User-Agent"] = "PokeInfo (personal collection tracker)"


def get(url):
    for attempt in range(4):
        try:
            r = S.get(url, timeout=40)
            if r.status_code == 404:
                return None
            if r.status_code == 200:
                return r.json()
        except (requests.RequestException, ValueError):
            pass
        time.sleep(2 * (attempt + 1))
    return None


def aud_rate():
    for url, pick in (("https://api.frankfurter.app/latest?from=USD&to=AUD", lambda j: j["rates"]["AUD"]),
                      ("https://open.er-api.com/v6/latest/USD", lambda j: j["rates"]["AUD"])):
        try:
            return round(float(pick(S.get(url, timeout=30).json())), 4)
        except Exception:  # noqa: BLE001
            continue
    try:
        return json.loads((DATA / "prices" / "_meta.json").read_text())["aud"]
    except Exception:  # noqa: BLE001
        return 1.53


def letter(kind):
    k = kind.lower()
    if "1st" in k or "first" in k:
        return "f"
    if "reverse" in k:
        return "r"
    if k == "normal":
        return "n"
    return "h"


def card_prices(card_id):
    c = get(f"{API}/cards/{card_id}") or {}
    tp = (c.get("pricing") or {}).get("tcgplayer") or {}
    out = {}
    for kind, p in tp.items():
        if isinstance(p, dict) and p.get("marketPrice"):
            v = letter(kind)
            out[v] = max(out.get(v, 0), round(float(p["marketPrice"]), 2))
    return out


def set_values(cards, prices, rate):
    """(whole set, master set) in A$: every card once at its cheapest version, and every version."""
    whole = master = 0.0
    for c in cards:
        p = prices.get(c["id"]) or {}
        if not p:
            continue
        vs = c.get("v") or "n"
        whole += min(p.values())
        master += sum(p.get(v, min(p.values())) for v in vs)
    return round(whole * rate, 2), round(master * rate, 2)


def main():
    today = date.today().isoformat()
    every = "--all" in sys.argv or date.today().weekday() == 2 or not (DATA / "prices").exists()
    rate = aud_rate()
    sets = json.loads((DATA / "sets.json").read_text(encoding="utf-8"))["sets"]
    cutoff = (date.today() - timedelta(days=3 * 365)).isoformat()
    todo = [x for x in sets if x.get("cards_n") and not x.get("manual") and (every or (x.get("date") or "") >= cutoff)]
    (DATA / "prices").mkdir(parents=True, exist_ok=True)
    hist_path = DATA / "value-history.json"
    hist = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else {}
    done = 0
    for x in todo:
        try:
            cards = json.loads((DATA / "sets" / f"{x['id']}.json").read_text(encoding="utf-8"))["cards"]
        except Exception:  # noqa: BLE001
            continue
        with ThreadPoolExecutor(max_workers=12) as pool:
            got = list(pool.map(lambda c: card_prices(c["id"]), cards))
        prices = {c["id"]: p for c, p in zip(cards, got) if p}
        if not prices:
            continue
        (DATA / "prices" / f"{x['id']}.json").write_text(json.dumps({"d": today, "c": prices}, separators=(",", ":")), encoding="utf-8")
        whole, master = set_values(cards, prices, rate)
        pts = [p for p in hist.get(x["id"], []) if p[0] != today]
        hist[x["id"]] = (pts + [[today, whole, master]])[-400:]
        done += 1
    (DATA / "prices" / "_meta.json").write_text(json.dumps({"d": today, "aud": rate}), encoding="utf-8")
    hist_path.write_text(json.dumps(hist, separators=(",", ":")), encoding="utf-8")
    print(f"prices for {done} of {len(todo)} sets, A$ {rate} per US$")


if __name__ == "__main__":
    main()
