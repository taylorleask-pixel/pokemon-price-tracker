"""Checks the singles stores in gengar/data/stores.json for every card in your Gengar list.

- Shopify shops: searches the shop for each card, then reads each matching product's
  conditions (NM, LP...) with their prices and stock.
- Misty's Collectables: reads the set pages for the sets in your list (each set is one page).

Writes gengar/data/singles.json (prices) and gengar/data/changes.json (what changed:
newly listed, back in stock, sold out, price up/down, no longer listed). Runs on GitHub a few times a day.
"""
import html
import json
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

D = Path(__file__).resolve().parent.parent / "data"
BRISBANE = timezone(timedelta(hours=10))
S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (GengarFinder personal price checker)"
DELAY = 0.8
KEEP_DAYS = 30


def n(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def get(url, **params):
    for attempt in range(3):
        try:
            time.sleep(DELAY)
            r = S.get(url, params=params, timeout=40)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(5 * (attempt + 1))
                continue
            return r
        except requests.RequestException:
            time.sleep(5 * (attempt + 1))
    return None


# ---------------------------------------------------------------- which card is this?
SET_WORDS_DROP = {"base", "set", "black", "star", "promos", "promo", "the", "and", "pokemon", "tcg", "series"}
SET_ALIASES = {"HS—Triumphant": ["triumphant"], "Expedition Base Set": ["expedition"],
               "XY Black Star Promos": ["xy"], "SWSH Black Star Promos": ["swsh"],
               "Mega Evolution Black Star Promos": ["mep", "mega evolution promo", "me promo"],
               "Scarlet & Violet": ["scarlet violet"], "FireRed & LeafGreen": ["firered leafgreen", "firered"],
               "Diamond & Pearl": ["diamond pearl"], "Sword & Shield": ["sword shield"]}


def set_hit(card_set, text):
    opts = SET_ALIASES.get(card_set, []) + [" ".join(w for w in n(card_set).split() if w not in SET_WORDS_DROP)]
    return any(o and all(w in text.split() for w in o.split()) for o in opts)


def num_hit(number, text):
    base = number.split("/")[0]
    m = re.match(r"([a-z]*)0*(\d+)$", base.lower())
    if not m:
        return False
    pre, digits = m.groups()
    return re.search(rf"(^|[^a-z0-9]){pre}0*{digits}(?![0-9])", text) is not None


def version_ok(card, text):
    """Does a listing's text describe the same version (holo, reverse, 1st, stamp...) as the card?"""
    t = text
    rev = "reverse" in t
    first = re.search(r"1st|first edition", t) is not None
    cosmos = "cosmo" in t
    staff = "staff" in t
    stampish = re.search(r"stamp|prize pack|play pok|trick or trade|pumpkin|halloween|gamestop|eb games|asia|world championship|sheen|alternate holo|prerelease", t) is not None
    v, name = card["variant"], card["name"].lower()
    if "pumpkin" in name:
        return re.search(r"pumpkin|trick or trade|halloween", t) is not None
    if "asia" in name:
        return "asia" in t
    if "play! pokemon" in name or v in ("PPS", "PPSH"):
        return re.search(r"prize pack|play pok|stamp", t) is not None and not staff
    if "red logo" in name:
        return re.search(r"red logo|1999 2000", t) is not None
    if v == "RH":
        return rev and not first
    if v == "1st":
        return first and not rev
    if v == "CH":
        return cosmos
    if v == "SS":
        return staff
    if v == "GS":
        return "gamestop" in t
    if v == "EGS":
        return "eb games" in t
    if v == "GCS":
        return "gym challenge" in t or "stamp" in t
    if v == "JM":
        return "world championship" in t
    if v == "SH":
        return re.search(r"sheen|alternate holo|gamestop", t) is not None
    if card["set"] == "SWSH Black Star Promos" and v == "H":
        return not staff
    holo = re.search(r"\bholo|holofoil|holo rare", t) is not None
    if v in ("—", "U"):
        return not (rev or first or cosmos or staff or stampish or holo)
    return not (rev or first or cosmos or staff or stampish)     # the normal holo print


def match_card(cards, title, extra=""):
    """Find the one card in the list this listing is for, or None."""
    text = n(f"{title} {extra}")
    if re.search(r"japanese|korean|chinese|\bjpn\b|\bkor\b|psa|cgc|bgs|graded|\bslab|\bsv\d+a\b|\bs\d+a\b|pokemon card 151", text):
        return None
    hits = []
    for c in cards:
        word = n(re.sub(r" Play! Pokemon.*| Stamp.*| 1999-2000.*", "", c["name"])).split()
        key = [w for w in word if w not in ("gengar", "ex", "v", "gx", "vmax", "m", "mega", "lv", "x", "gl")] or ["gengar"]
        if not all(w in text.split() for w in key[:2]) and "gengar" not in text:
            continue
        if not num_hit(c["number"], text) or not set_hit(c["set"], text) or not version_ok(c, text):
            continue
        hits.append(c)
    if len(hits) > 1:
        # both a plain and a holo card fit (no "holo" in the listing): it's the plain one
        plain = [c for c in hits if c["variant"] in ("—", "U")]
        hits = plain or [c for c in hits if c["variant"] not in ("H", "UH")] or hits
    return hits[0] if len(hits) == 1 else None


# ---------------------------------------------------------------- Shopify shops
def shopify_handles(store, query, pages=8):
    root = store["url"].split("/collections/")[0].rstrip("/")
    handles = []
    for page in range(1, pages + 1):
        r = get(f"{root}/search", q=query, type="product", page=page, **{"options[prefix]": "last"})
        if r is None or not r.ok:
            break
        found = [h for h in re.findall(r'href="(?:https?://[^"/]+)?/products/([a-z0-9][a-z0-9-]*)', r.text) if h not in handles]
        if not found:
            break
        handles += list(dict.fromkeys(found))
    return root, handles


def keep_conditions(rows):
    """Keep conditions in stock; if none are, keep one sold-out row (stores use dummy prices like $1000 for those)."""
    avail = [r for r in rows if r["available"]]
    if avail:
        return avail
    real = [r for r in rows if r["price"] < 999]
    return real[:1]


def product_rows(store, root, p, cards):
    tags = " ".join(p.get("tags") or [])
    rows = []
    for v in p.get("variants", []):
        card = match_card(cards, p["title"], f"{tags} {v.get('title', '')}")
        if not card:
            continue
        cond = v.get("title") if v.get("title") not in (None, "Default Title") else ""
        price = v["price"] / 100 if isinstance(v["price"], int) else float(v["price"])
        rows.append({"store": store["id"], "card": card["id"], "title": re.sub(r"\s+", " ", p["title"]),
                     "condition": cond, "price": round(price, 2), "available": bool(v.get("available")),
                     "url": f"{root}/products/{p['handle']}?variant={v['id']}"})
    by_card = {}
    for r in rows:
        by_card.setdefault(r["card"], []).append(r)
    return [r for rs in by_card.values() for r in keep_conditions(rs)]


NAME_WORDS = re.compile(r"gengar|imposter oak|rocket.?s hideout|surprise box|morty|mimikyu|gastly|pikachu|greavard", re.I)


def read_shopify(store, cards, queries):
    out, seen = [], set()
    wanted_nums = {re.sub(r"[^0-9]", "", c["number"].split("/")[0]).lstrip("0") for c in cards}

    def has_num(handle):
        return any(run.lstrip("0").startswith(w) for run in re.findall(r"\d+", handle) for w in wanted_nums if w)

    root = store["url"].split("/collections/")[0].rstrip("/")
    total_handles = 0
    for q in queries:
        root, handles = shopify_handles(store, q)
        handles = [h for h in handles if not h.endswith("gift-card")]
        total_handles += len(handles)
        for h in handles:
            if h in seen or not has_num(h):
                continue
            seen.add(h)
            r = get(f"{root}/products/{h}.js")
            if r is not None and r.ok:
                out += product_rows(store, root, r.json(), cards)
    if total_handles == 0 and "/collections/" in store["url"]:
        # search page is filled in by JavaScript: read the singles collection page by page instead
        base = store["url"].split("?")[0].rstrip("/")
        for page in range(1, 200):
            r = get(f"{base}/products.json", limit=250, page=page)
            if r is None or not r.ok:
                break
            prods = r.json().get("products", [])
            if not prods:
                break
            for p in prods:
                if NAME_WORDS.search(p["title"]) and p["handle"] not in seen:
                    seen.add(p["handle"])
                    out += product_rows(store, root, p, cards)
    return out


# ---------------------------------------------------------------- Misty's Collectables
MISTY_VARIANT_OK = {
    "RH": lambda pv: pv == "REVERSE_HOLO",
    "1st": lambda pv: "FIRST" in pv and "REVERSE" not in pv,
    "CH": lambda pv: "COSMO" in pv,
}


def read_misty(store, cards):
    root = "https://mistyscollectables.com.au"
    r = get(f"{root}/sets")
    if r is None or not r.ok:
        raise RuntimeError("couldn't open the sets page")
    links = {}
    for href, inner in re.findall(r'href="(/sets/[a-z0-9-]+/[a-z0-9-]+)"[^>]*>(.*?)</a>', r.text, re.S):
        m = re.search(r'line-height:1\.25">([^<]+)<', inner)
        if m:
            links[n(html.unescape(m.group(1)))] = href
    out = []
    plain_sibling = {(c["set"], c["number"]) for c in cards if c["variant"] in ("—", "U")}
    holo_sibling = {(c["set"], c["number"]) for c in cards if c["variant"] in ("H", "UH")}
    by_set = {}
    for c in cards:
        by_set.setdefault(c["set"], []).append(c)
    for set_name, cs in by_set.items():
        href = links.get(n(set_name))
        if not href:
            continue                                      # Misty's doesn't stock this set
        page = get(root + href)
        if page is None or not page.ok:
            continue
        text = page.text.replace('\\"', '"')
        dec = json.JSONDecoder()
        for m in re.finditer(r'\{"id":"c[a-z0-9]{10,}","name":', text):
            try:
                obj, _ = dec.raw_decode(text, m.start())
            except ValueError:
                continue
            for c in cs:
                if obj.get("number", "").lstrip("0") != c["number"].split("/")[0].lstrip("0"):
                    continue
                if "gengar" not in n(obj.get("name")) and n(c["name"]).split()[0] not in n(obj.get("name")):
                    continue
                for v in obj.get("variants", []):
                    pv = v.get("printVariant") or ""
                    ok = MISTY_VARIANT_OK.get(c["variant"])
                    if ok:
                        good = ok(pv)
                    elif c["vclass"] == "stamp":
                        good = False
                    elif (c["set"], c["number"]) in plain_sibling and (c["set"], c["number"]) in holo_sibling:
                        # we track both a plain and a holo print: Misty's "Unlimited" is the main print,
                        # which is the holo when the card is a holo rare
                        holo_rare = "holo" in (obj.get("rarity") or "").lower()
                        if c["variant"] in ("H", "UH"):
                            good = ("HOLO" in pv and "REVERSE" not in pv) or (pv == "UNLIMITED" and holo_rare)
                        else:
                            good = pv == "NORMAL" or (pv == "UNLIMITED" and not holo_rare)
                    elif c["variant"] in ("—", "U"):
                        good = pv in ("UNLIMITED", "NORMAL")
                    else:
                        good = pv in ("UNLIMITED", "HOLOFOIL", "NORMAL", "HOLO", "UNLIMITED_HOLOFOIL")
                    if not good or v.get("priceAUD") is None:
                        continue
                    out.append({"store": store["id"], "card": c["id"], "title": f"{obj['name']} {obj['number']} ({obj.get('setName')}) - {v.get('variantLabel')}",
                                "condition": "", "price": round(float(v["priceAUD"]), 2), "available": (v.get("stockQty") or 0) > 0,
                                "stock": v.get("stockQty"), "url": f"{root}/cards/{obj['id']}"})
    return out


# ---------------------------------------------------------------- changes
def track(old, new, now):
    def key(l):
        return f"{l['store']}|{l['card']}|{l.get('condition') or ''}"
    o = {key(l): l for l in old}
    w = {key(l): l for l in new}
    ev = []
    for k, l in w.items():
        p = o.get(k)
        base = {"time": now, "store": l["store"], "card": l["card"], "condition": l.get("condition") or "", "price": l["price"], "url": l["url"]}
        if not p:
            ev.append({**base, "type": "new"})
        elif l["available"] and not p["available"]:
            ev.append({**base, "type": "in-stock"})
        elif p["available"] and not l["available"]:
            ev.append({**base, "type": "sold-out"})
        elif l["price"] != p["price"]:
            ev.append({**base, "type": "price-up" if l["price"] > p["price"] else "price-down", "old": p["price"]})
    for k, p in o.items():
        if k not in w:
            ev.append({"time": now, "store": p["store"], "card": p["card"], "condition": p.get("condition") or "",
                       "price": p["price"], "url": p["url"], "type": "removed"})
    return ev


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None          # check one store (used when adding a store)
    stores = json.loads((D / "stores.json").read_text(encoding="utf-8"))
    cards = json.loads((D / "cards_base.json").read_text(encoding="utf-8"))
    for c in cards:
        c["vclass"] = "stamp" if (re.search(r"stamp|play! pok", c["name"], re.I) or c["variant"] in
                                  ("PPS", "PPSH", "GCS", "GS", "EGS", "SS", "JM", "SH")) else ""
    queries = ["gengar"] + sorted({f"{re.sub(r'[^A-Za-z ]', ' ', c['name']).split()[0]} {c['number'].split('/')[0]}"
                                   for c in cards if "gengar" not in c["name"].lower()})
    try:
        prev = json.loads((D / "singles.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        prev = {"listings": [], "report": {}}
    now = datetime.now(BRISBANE).isoformat(timespec="minutes")
    listings, report = [], {}
    for st in stores:
        if only and st["id"] != only:
            listings += [l for l in prev.get("listings", []) if l["store"] == st["id"]]
            report[st["id"]] = prev.get("report", {}).get(st["id"], {})
            continue
        print(f"Checking {st['name']}...", flush=True)
        try:
            got = read_misty(st, cards) if st["platform"] == "misty" else read_shopify(st, cards, queries)
            old = [l for l in prev.get("listings", []) if l["store"] == st["id"]]
            if not got and old:
                raise RuntimeError("found nothing this time (site may be down), kept the last prices")
            listings += got
            report[st["id"]] = {"ok": True, "count": len(got), "cards": len({l["card"] for l in got}), "checked": now}
            print(f"   {len(got)} listings for {len({l['card'] for l in got})} of your cards")
        except Exception as e:  # noqa: BLE001
            print(f"   problem: {e}")
            listings += [l for l in prev.get("listings", []) if l["store"] == st["id"]]
            report[st["id"]] = {**prev.get("report", {}).get(st["id"], {}), "ok": False, "problem": str(e)[:200], "checked": now}
    good = {sid for sid, r in report.items() if r.get("ok")}
    events = track([l for l in prev.get("listings", []) if l["store"] in good],
                   [l for l in listings if l["store"] in good], now) if prev.get("listings") else []
    (D / "singles.json").write_text(json.dumps({"updated": now, "listings": listings, "report": report},
                                               ensure_ascii=False, indent=0), encoding="utf-8")
    try:
        ch = json.loads((D / "changes.json").read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        ch = {"events": []}
    cutoff = (datetime.now(BRISBANE) - timedelta(days=KEEP_DAYS)).isoformat(timespec="minutes")
    ch["events"] = [e for e in events + ch["events"] if e["time"] >= cutoff][:5000]
    (D / "changes.json").write_text(json.dumps(ch, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(listings)} listings, {len(events)} changes")


if __name__ == "__main__":
    main()
