"""Adds a store from an "Add a store" request on GitHub.

The request (a GitHub issue made by the form on the website) gives a store name and a link.
This script works out what kind of shop it is (Shopify, WooCommerce or Square Online),
test-reads it, and only adds it to data/stores.json if it finds Pokémon sealed products.

It writes what happened to data/_add_store_result.md, which the workflow posts back on the issue.
Run locally with:  STORE_NAME="Shop" STORE_URL="https://..." python scraper/add_store.py
"""
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scrape  # noqa: E402
from classify import classify  # noqa: E402

DATA = scrape.DATA
RESULT = DATA / "_add_store_result.md"
OK_FLAG = DATA / "_add_store_ok"


def field(body, label):
    """Read one answer from a GitHub issue form body ("### Label\\n\\nanswer")."""
    m = re.search(rf"###\s*{re.escape(label)}\s*\n+(.+?)(?:\n###|\Z)", body or "", re.S)
    v = m.group(1).strip() if m else ""
    return "" if v == "_No response_" else v


def slug(name):
    return re.sub(r"[^a-z0-9]+", "", name.lower())[:20] or "store"


def detect(url):
    """Return (platform, store-fields) for a shop link, or (None, reason)."""
    p = urlparse(url)
    root = f"{p.scheme}://{p.netloc}"
    try:
        html = scrape.get(url).text
    except Exception as e:  # noqa: BLE001
        return None, f"couldn't open the link ({e})"
    low = html.lower()

    # Shopify: every Shopify shop answers /products.json
    if "cdn.shopify.com" in low or "shopify" in low:
        base = url.split("?")[0].rstrip("/")
        if "/collections/" not in base:
            # a home page link: look for a Pokémon collection so other games aren't included
            try:
                cols = scrape.get(f"{root}/collections.json", params={"limit": 250}).json().get("collections", [])
                poke = [c for c in cols if "pokemon" in c["handle"]]
                poke.sort(key=lambda c: (("tcg" not in c["handle"] and "card" not in c["handle"]), len(c["handle"])))
                if poke:
                    base = f"{root}/collections/{poke[0]['handle']}"
            except Exception:  # noqa: BLE001
                pass
        if "/collections/" not in base:
            return None, ("it's a Shopify shop, but I couldn't find a Pokémon section on it, and reading the whole "
                          "shop would mix in other games. Open the shop, go to their Pokémon page, and edit this "
                          "request with that page's link (it will have /collections/ in it).")
        return "shopify", {"url": base}

    # Square Online (Weebly / editmysite)
    if "editmysite.com" in low or "square online" in low or "squareup.com" in low:
        return "square", {"url": url}

    # WooCommerce (WordPress)
    if "woocommerce" in low or "wp-content" in low:
        if "/product-category/" not in url:
            try:
                cats = scrape.get(f"{root}/wp-json/wc/store/v1/products/categories", params={"per_page": 100}).json()
                poke = [c for c in cats if "pokemon" in c.get("slug", "")]
                poke.sort(key=lambda c: -int(c.get("count", 0)))
                if poke:
                    return "woocommerce", {"url": f"{root}/product-category/{poke[0]['slug']}/"}
            except Exception:  # noqa: BLE001
                pass
        return "woocommerce", {"url": url}

    return None, ("it isn't a Shopify, WooCommerce or Square Online shop, which are the kinds the price checker "
                  "can read. Stores on other systems need their own reader written by hand (like Misty's).")


def main():
    body = os.environ.get("ISSUE_BODY", "")
    name = (os.environ.get("STORE_NAME") or field(body, "Store name")).strip()
    url = (os.environ.get("STORE_URL") or field(body, "Link to the store's Pokémon products")).strip()
    OK_FLAG.unlink(missing_ok=True)

    def finish(text, ok=False):
        RESULT.write_text(text, encoding="utf-8")
        if ok:
            OK_FLAG.write_text("1")
        print(text)

    if not name or not re.match(r"https?://", url):
        return finish("I couldn't read a store name and a link starting with https:// from this request. "
                      "Edit the request so both are filled in and I'll try again.")
    stores = json.loads((DATA / "stores.json").read_text(encoding="utf-8"))
    dry = bool(os.environ.get("DRY_RUN"))
    host = urlparse(url).netloc.removeprefix("www.")
    for s in ([] if dry else stores):
        if urlparse(s["url"]).netloc.removeprefix("www.") == host:
            return finish(f"**{s['name']}** is already tracked with that website, so nothing was changed.")

    platform, info = detect(url)
    if not platform:
        return finish(f"**{name}** wasn't added: {info}")

    sid = slug(name)
    while any(s["id"] == sid for s in stores):
        sid += "2"
    store = {"id": sid, "name": name, "platform": platform, **info}
    print(f"Test-reading {name} as {platform}: {store['url']}")
    try:
        items = scrape.SCRAPERS[platform](store)
    except Exception as e:  # noqa: BLE001
        return finish(f"**{name}** looks like a {platform} shop, but reading it failed: `{e}`.\n\n"
                      "Try a link to the shop's Pokémon product page instead of the home page, then edit this request.")
    found_user = store.pop("_found_user", None)
    if found_user:
        store["square_user"] = found_user
    sealed = []
    for it in items:
        info_c = classify(it["title"])
        if not info_c["skip"] and (info_c["set"] or info_c["product"]):   # a known Pokémon set or product
            sealed.append((it, info_c))
    if not sealed:
        return finish(f"**{name}** was read as a {platform} shop and had {len(items)} products, but none of them "
                      "looked like Pokémon sealed product, so it wasn't added.\n\n"
                      "Try a link to the shop's Pokémon or sealed product page, then edit this request.")

    if platform == "square" and "square_user" not in store:
        # remember the shop's Square ID so later checks don't need the hidden browser
        m = re.search(r"/(\d{6,})/", " ".join(i.get("image") or "" for i in items[:5]))
        if m:
            store["square_user"] = m.group(1)
    stores.append(store)
    if not dry:
        (DATA / "stores.json").write_text(json.dumps(stores, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    in_stock = sum(1 for it, _ in sealed if it.get("available"))
    sample = "\n".join(f"| {it['title'][:70]} | {'$%.2f' % it['price'] if it.get('price') else ''} | "
                       f"{'In stock' if it.get('available') else 'Sold out'} |" for it, _ in sealed[:8])
    finish(f"Added **{name}** ({platform}). It has **{len(sealed)}** Pokémon sealed products, "
           f"{in_stock} in stock. Prices are being checked now and will be on the site in about 10 minutes.\n\n"
           f"| A few of them | Price | Stock |\n|---|---|---|\n{sample}\n\n"
           f"Reading: {store['url']}", ok=True)


if __name__ == "__main__":
    main()
