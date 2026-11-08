"""Adds a singles store to GengarFinder from a GitHub request (issue).

Works for Shopify shops (most card shops). It test-searches the shop for Gengar, and only adds it
if it finds cards from your list. The store is also added to the "Where you got it" choices.
Writes gengar/data/_result.md for the bot to post back on the issue.
"""
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import singles  # noqa: E402

D = singles.D
RESULT, OK = D / "_result.md", D / "_ok"


def field(body, label):
    m = re.search(rf"###\s*{re.escape(label)}\s*\n+(.+?)(?:\n###|\Z)", body or "", re.S)
    v = m.group(1).strip() if m else ""
    return "" if v == "_No response_" else v


def main():
    body = os.environ.get("ISSUE_BODY", "")
    name = field(body, "Store name").strip()
    url = field(body, "Link to the store's Pokémon singles").strip()
    OK.unlink(missing_ok=True)

    def finish(text, ok=False):
        RESULT.write_text(text, encoding="utf-8")
        if ok:
            OK.write_text("1")
        print(text)

    if not name or not re.match(r"https?://", url):
        return finish("I couldn't read a store name and a link starting with https://. Edit this request so both are filled in.")
    stores = json.loads((D / "stores.json").read_text(encoding="utf-8"))
    host = urlparse(url).netloc.removeprefix("www.")
    for s in stores:
        if urlparse(s["url"]).netloc.removeprefix("www.") == host:
            return finish(f"**{s['name']}** is already checked for singles, so nothing was changed.")
    r = singles.get(url)
    if r is None or not r.ok:
        return finish(f"I couldn't open {url}. Check the link and edit this request.")
    if "shopify" not in r.text.lower():
        return finish(f"**{name}** wasn't added: it isn't a Shopify shop, which is the kind GengarFinder can search. "
                      "Shops on other systems need a reader written by hand (like Misty's), so ask Claude.")
    cards = json.loads((D / "cards_base.json").read_text(encoding="utf-8"))
    for c in cards:
        c["vclass"] = "stamp" if re.search(r"stamp|play! pok", c["name"], re.I) or c["variant"] in (
            "PPS", "PPSH", "GCS", "GS", "EGS", "SS", "JM", "SH") else ""
    sid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:24] or "store"
    store = {"id": sid, "name": name, "platform": "shopify", "url": url.split("?")[0]}
    found = singles.read_shopify(store, cards, ["gengar"])
    if not found:
        return finish(f"**{name}** is a Shopify shop, but searching it for Gengar found none of the cards in your list, "
                      "so it wasn't added. If it does sell Gengar singles, ask Claude to look at why.")
    stores.append(store)
    (D / "stores.json").write_text(json.dumps(stores, indent=1, ensure_ascii=False), encoding="utf-8")
    places = json.loads((D / "places.json").read_text(encoding="utf-8"))
    if name not in places["places"]:
        places["places"].insert(len(places["places"]) - ("eBay" in places["places"]), name)
        (D / "places.json").write_text(json.dumps(places, indent=1, ensure_ascii=False), encoding="utf-8")
    cards_by = {c["id"]: c for c in cards}
    sample = "\n".join(f"| {cards_by[l['card']]['name']} ({cards_by[l['card']]['set']} {cards_by[l['card']]['number']}) "
                       f"| {l['condition']} | ${l['price']:.2f} | {'In stock' if l['available'] else 'Sold out'} |" for l in found[:10])
    finish(f"Added **{name}**. A quick Gengar search found **{len(found)}** listings for "
           f"**{len({l['card'] for l in found})}** of your cards. A full check is running now, so they'll be in "
           f"GengarFinder in about 10 minutes, and {name} is now a choice under \"Where you got it\".\n\n"
           f"| Card | Condition | Price | Stock |\n|---|---|---|---|\n{sample}", ok=True)


if __name__ == "__main__":
    main()
