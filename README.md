# Pack Watch

My personal price tracker for sealed Pokémon TCG products across Brisbane stores.

A script checks each store about three times a day (7am, 1pm and 7pm Brisbane time), sorts every listing by set and product type, and the website shows the prices side by side.

## How it works

```
GitHub Actions (on a schedule)
   └─ scraper/scrape.py      visits each store, reads price + stock
        └─ scraper/classify.py   works out set, year, type and pack count from the title
             └─ data/prices.json    latest prices      ┐
                data/history.json   lowest price/day    ├─ read by the website (index.html + app.js)
                data/report.json    how each store went ┘
```

## Files I edit

| File | What it's for |
|---|---|
| `data/contents.json` | What's inside ex boxes, tins and collections. Add an entry, and the site can do price per pack and set search for it. |
| `data/stores.json` | The stores to check. |
| `data/sets.json` | Every set, its year, and other names stores use for it. |
| `data/categories.json` | Words that decide which tab a product goes on. |

### Adding a product's contents

```json
"Charizard ex Super-Premium Collection": {
  "category": "other",
  "match": ["charizard", "super", "premium"],
  "packs": [{"set": "Paradox Rift", "qty": 2}, {"set": "Stellar Crown", "qty": 2}],
  "extras": ["Charizard ex promo", "metal coin"]
}
```

`match` words must all appear in a store's title (in any order, capitals don't matter) for it to count as this product.

## Running a check right now

GitHub → **Actions** → **Check prices** → **Run workflow**.

## Running it on my computer

```
pip install requests beautifulsoup4
python scraper/scrape.py
python -m http.server     # then open http://localhost:8000
```

## Using it as a phone app

Open the site on your phone and choose **Add to Home Screen** (Safari: Share button; Chrome: ⋮ menu).
It opens full screen with its own icon, and still shows the last prices it saw if you're offline.
On Android, long-press the icon for shortcuts to Booster packs, Booster boxes, ETBs and What changed.
The app files are `manifest.webmanifest`, `sw.js` and the `icons/` folder.
