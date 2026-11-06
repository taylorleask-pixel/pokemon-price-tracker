"""Visits every store in data/stores.json, reads Pokémon product prices and stock,
sorts each listing with classify.py, and writes:

  data/prices.json   - the latest snapshot the website shows
  data/history.json  - lowest price per product per day, for price graphs
  data/report.json   - how each store went (count / errors), so problems are easy to spot

Run locally with:  python scraper/scrape.py
"""
import json
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
from classify import classify  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "data"
BRISBANE = timezone(timedelta(hours=10))
HEADERS = {"User-Agent": "Mozilla/5.0 (personal price tracker; checks a few times a day)",
           "Accept-Language": "en-AU,en;q=0.9"}
DELAY = 1.5        # seconds between page requests, to be polite to the stores
MAX_PAGES = 40     # safety limit per store

session = requests.Session()
session.headers.update(HEADERS)


def get(url, **kw):
    time.sleep(DELAY)
    r = session.get(url, timeout=30, **kw)
    r.raise_for_status()
    return r


def price_from(text):
    m = re.search(r"\$\s*([\d,]+(?:\.\d{1,2})?)", text or "")
    return float(m.group(1).replace(",", "")) if m else None


# ---------------------------------------------------------------- Shopify
def scrape_shopify(store):
    """Shopify stores publish every product in a collection at /products.json."""
    base = store["url"].split("?")[0].rstrip("/")
    root = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
    items = []
    for page in range(1, MAX_PAGES + 1):
        data = get(f"{base}/products.json", params={"limit": 250, "page": page}).json()
        products = data.get("products", [])
        if not products:
            break
        for p in products:
            variants = p.get("variants") or [{}]
            prices = [float(v["price"]) for v in variants if v.get("price")]
            items.append({
                "title": p["title"],
                "price": min(prices) if prices else None,
                "available": any(v.get("available") for v in variants),
                "url": f"{root}/products/{p['handle']}",
                "image": (p.get("images") or [{}])[0].get("src"),
            })
    return items


# ---------------------------------------------------------------- Misty's (custom site)
MISTY_LABELS = sorted(["Booster Bundles", "Booster Packs", "Booster Boxes", "Elite Trainer Boxes", "Tins",
    "Collections", "Collection Boxes", "Blisters", "Others", "Other Sealeds", "Build & Battles",
    "Theme Decks", "Battle Decks", "Trainer Kits", "Starter Decks", "Premium Collections"], key=len, reverse=True)
STOCK_RE = re.compile(r"\b(in stock|out of stock|sold out|pre-?order|coming soon|notify me)\b", re.I)


def clean_misty_title(text):
    text = re.sub(r"\$\s*[\d,]+(?:\.\d{1,2})?", " ", text)
    text = STOCK_RE.sub(" ", text)
    text = re.sub(r"(add to cart|choose options)\s*\u2192?", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    for label in MISTY_LABELS:
        if text.lower().startswith(label.lower() + " "):
            text = text[len(label):].strip()
            break
    return text


def scrape_misty(store):
    """Product pages live at /sealed/product/<name>. Each product box shows its category,
    name, 'In stock' (only when in stock) and a price. We only trust text inside that one box."""
    items, seen = [], set()
    for page in range(1, MAX_PAGES + 1):
        soup = BeautifulSoup(get(store["url"], params={"page": page}).text, "html.parser")
        new = 0
        for a in soup.select("a[href*='/sealed/product/']"):
            url = urljoin(store["url"], a["href"].split("#")[0].split("?")[0])
            if url in seen:
                continue
            # climb to the biggest box that still contains only THIS product
            card = a
            while card.parent is not None:
                links = {urljoin(store["url"], x["href"].split("#")[0].split("?")[0])
                         for x in card.parent.select("a[href*='/sealed/product/']")}
                if len(links) > 1:
                    break
                card = card.parent
            text = card.get_text(" ", strip=True)
            title = clean_misty_title(a.get("title") or a.get_text(" ", strip=True)) or clean_misty_title(text)
            price = price_from(text)
            if not title:
                continue
            seen.add(url)
            new += 1
            img = card.find("img")
            items.append({
                "title": title,
                "price": price,
                "available": bool(re.search(r"\bin stock\b", text, re.I)) and price is not None,
                "url": url,
                "image": urljoin(store["url"], img["src"]) if img and img.get("src") else None,
            })
        if new == 0:
            break
    return items


# ---------------------------------------------------------------- WooCommerce
def scrape_woocommerce(store):
    """Try WooCommerce's public Store API first, fall back to reading the shop pages."""
    root = f"{urlparse(store['url']).scheme}://{urlparse(store['url']).netloc}"
    slug = store["url"].rstrip("/").split("/")[-1]
    items = []
    try:
        cats = get(f"{root}/wp-json/wc/store/v1/products/categories", params={"per_page": 100}).json()
        cat_ids = [c["id"] for c in cats if c.get("slug") == slug]
        if not cat_ids:
            raise ValueError("category not found in Store API")
        for page in range(1, MAX_PAGES + 1):
            batch = get(f"{root}/wp-json/wc/store/v1/products",
                        params={"category": cat_ids[0], "per_page": 100, "page": page}).json()
            if not batch:
                break
            for p in batch:
                pr = p.get("prices", {})
                minor = int(pr.get("currency_minor_unit", 2))
                price = int(pr["price"]) / 10 ** minor if pr.get("price") else None
                items.append({
                    "title": BeautifulSoup(p["name"], "html.parser").get_text(),
                    "price": price,
                    "available": bool(p.get("is_in_stock")),
                    "url": p.get("permalink"),
                    "image": (p.get("images") or [{}])[0].get("src"),
                })
        return items
    except Exception as e:  # noqa: BLE001
        print(f"   Store API didn't work ({e}), reading pages instead")
    url = store["url"]
    for _ in range(MAX_PAGES):
        soup = BeautifulSoup(get(url).text, "html.parser")
        for li in soup.select("li.product, div.product.type-product"):
            title_el = li.select_one(".woocommerce-loop-product__title, h2, h3")
            link = li.select_one("a[href]")
            price_el = li.select_one(".price ins .amount, .price .amount, .price")
            if not title_el or not price_el:
                continue
            img = li.find("img")
            items.append({
                "title": title_el.get_text(" ", strip=True),
                "price": price_from(price_el.get_text()),
                "available": "outofstock" not in " ".join(li.get("class", [])),
                "url": link["href"] if link else store["url"],
                "image": img.get("src") if img else None,
            })
        nxt = soup.select_one("a.next.page-numbers")
        if not nxt:
            break
        url = nxt["href"]
    return items


def square_user_from_browser(url):
    """Open the shop in a hidden browser and read the user ID from the requests it makes."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("   playwright isn't installed, can't open the page in a browser")
        return None
    found = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(user_agent=HEADERS["User-Agent"])
        page.on("request", lambda r: found.extend(re.findall(r"/users/(\d+)/sites/", r.url)))
        try:
            page.goto(url, wait_until="networkidle", timeout=60000)
            page.mouse.wheel(0, 3000)
            page.wait_for_timeout(2000)
        except Exception as e:  # noqa: BLE001
            print(f"   browser had trouble loading the page: {e}")
        browser.close()
    return found[0] if found else None


# ---------------------------------------------------------------- Square Online
def scrape_square(store):
    """Square Online loads products with JavaScript from a hidden API.
    The shop page contains the IDs we need to call that API directly."""
    root = f"{urlparse(store['url']).scheme}://{urlparse(store['url']).netloc}"
    user = site = None
    clues = []
    for page_url in (store["url"], root + "/", root + "/s/shop"):
        try:
            html = get(page_url).text
        except Exception as e:  # noqa: BLE001
            clues.append(f"{page_url}: {e}")
            continue
        user = (re.search(r'"user_?[iI]d"\s*:\s*"?(\d+)', html)
                or re.search(r"/users/(\d+)/sites/", html)
                or re.search(r"(\d{6,})\.cdn\d*\.editmysite\.com", html))
        site = (re.search(r'"site_?[iI]d"\s*:\s*"?(\d{6,})', html)
                or re.search(r'"(?:classicSiteID|catalogSiteId)"\s*:\s*"(\d{6,})', html)
                or re.search(r"/sites/(\d{6,})", html))
        if user and site:
            break
        if site and not user:
            break  # newer Square Online: the user ID only shows up once the page runs, see below
        clues.append(f"{page_url}: {len(html)} chars, user={'y' if user else 'n'} site={'y' if site else 'n'}")
    user = store.get("square_user") or (user.group(1) if user else None)
    site = site.group(1) if site else None
    if site and not user:
        user = square_user_from_browser(store["url"])
        if user:
            store["_found_user"] = user
            print(f"   found Square user ID {user} - you can add \"square_user\": \"{user}\" to stores.json")
    if not (user and site):
        dbg = DATA / "debug"
        dbg.mkdir(exist_ok=True)
        (dbg / f"{store['id']}.html").write_text(html, encoding="utf-8")
        raise RuntimeError("couldn't find Square site IDs. Clues: " + " | ".join(clues))
    api = f"https://cdn5.editmysite.com/app/store/api/v28/editor/users/{user}/sites/{site}/products"
    items = []
    for page in range(1, MAX_PAGES + 1):
        data = get(api, params={"page": page, "per_page": 100, "include": "images,media_files",
                                "visibilities[]": "visible"}).json()
        for p in data.get("data", []):
            pr = p.get("price") or {}
            price = pr.get("low") if isinstance(pr, dict) else pr
            if isinstance(price, dict):
                price = price.get("amount")
            img = ((p.get("images") or {}).get("data") or [{}])[0]
            items.append({
                "title": p.get("name", ""),
                "price": float(price) if price not in (None, "") else None,
                "available": not p.get("badges", {}).get("out_of_stock", False)
                             and p.get("inventory", {}).get("total", 1) != 0,
                "url": urljoin(root, p.get("site_link") or p.get("absolute_site_link") or ""),
                "image": img.get("absolute_url") or img.get("url"),
            })
        meta = (data.get("meta") or {}).get("pagination") or {}
        if page >= int(meta.get("total_pages", page)):
            break
    # Square returns the whole shop, so keep only Pokémon things
    return [i for i in items if "pokemon" in i["title"].lower().replace("é", "e")
            or classify(i["title"])["set"]]


SCRAPERS = {"shopify": scrape_shopify, "misty": scrape_misty,
            "woocommerce": scrape_woocommerce, "square": scrape_square}


def main():
    stores = json.loads((DATA / "stores.json").read_text(encoding="utf-8"))
    now = datetime.now(BRISBANE)
    listings, singles, report = [], [], {}
    for store in stores:
        print(f"Checking {store['name']} ({store['platform']})...")
        try:
            items = SCRAPERS[store["platform"]](store)
            kept = 0
            for it in items:
                if it.get("price") is None and it.get("available"):
                    continue
                info = classify(it["title"])
                if info["skip"] == "single":
                    singles.append({"store": store["id"], **it, "set": info["set"], "year": info["year"]})
                    continue
                if info["skip"]:
                    continue
                # "Delta Reign Booster" for $320 is a booster box, not one pack
                if (info["category"] == "pack" and (info["year"] or 0) >= 2020 and (it["price"] or 0) >= 100
                        and "pack" not in it["title"].lower()):
                    info.update(category="box", packs=18 if "enhanced" in it["title"].lower() else 36,
                                key=info["key"].replace("pack|", "box|", 1))
                listings.append({"store": store["id"], **it, **info})
                kept += 1
            report[store["id"]] = {"ok": True, "found": len(items), "kept": kept}
            if store.get("_found_user"):
                report[store["id"]]["square_user"] = store["_found_user"]
            print(f"   found {len(items)}, kept {kept}")
        except Exception as e:  # noqa: BLE001
            report[store["id"]] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:1500]}
            print(f"   FAILED: {e}")

    # If a store failed this time, keep its last good results so the site doesn't go blank
    old_path = DATA / "prices.json"
    if old_path.exists():
        old = json.loads(old_path.read_text(encoding="utf-8"))
        for sid, r in report.items():
            if not r["ok"]:
                carried = [l for l in old.get("listings", []) if l["store"] == sid]
                listings += [{**l, "stale": True} for l in carried]
                r["carried_over"] = len(carried)

    (DATA / "prices.json").write_text(json.dumps(
        {"updated": now.isoformat(timespec="minutes"), "listings": listings},
        ensure_ascii=False, indent=0), encoding="utf-8")
    (DATA / "singles.json").write_text(json.dumps(
        {"updated": now.isoformat(timespec="minutes"), "singles": singles}, ensure_ascii=False, indent=0), encoding="utf-8")
    (DATA / "report.json").write_text(json.dumps(
        {"updated": now.isoformat(timespec="minutes"), "stores": report}, indent=1), encoding="utf-8")

    # history: lowest in-stock price per product per day
    hist_path = DATA / "history.json"
    history = json.loads(hist_path.read_text(encoding="utf-8")) if hist_path.exists() else {}
    day = now.strftime("%Y-%m-%d")
    lows = {}
    for l in listings:
        if l.get("available") and not l.get("stale") and l.get("price") is not None:
            lows[l["key"]] = min(lows.get(l["key"], 1e12), l["price"])
    for key, low in lows.items():
        h = history.setdefault(key, [])
        if h and h[-1][0] == day:
            h[-1][1] = min(h[-1][1], low)
        else:
            h.append([day, low])
    hist_path.write_text(json.dumps(history, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Done: {len(listings)} listings saved.")


if __name__ == "__main__":
    main()
