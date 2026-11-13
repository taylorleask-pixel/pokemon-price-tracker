import json, requests
S = requests.Session()
def g(u, **kw):
    try:
        r = S.get(u, timeout=40, **kw); return r.status_code, (r.json() if 'json' in r.headers.get('content-type','') else r.text[:200])
    except Exception as e: return 0, str(e)
for lang in ["en", "ja", "ko", "zh-tw", "zh-cn", "th", "id"]:
    st, sets = g(f"https://api.tcgdex.net/v2/{lang}/sets")
    print(f"\n== {lang}: status {st}, {len(sets) if isinstance(sets, list) else sets} sets")
    if not isinstance(sets, list) or not sets: continue
    print("  first:", sets[:2]); print("  last:", sets[-3:])
    sid = sets[-1]["id"]
    st, s = g(f"https://api.tcgdex.net/v2/{lang}/sets/{sid}")
    if isinstance(s, dict):
        print("  set keys:", list(s), "| cardCount", s.get("cardCount"), "| logo", s.get("logo"), "| serie", s.get("serie"), "| releaseDate", s.get("releaseDate"))
        cs = s.get("cards", [])
        print("  cards:", len(cs), cs[:2])
        withimg = sum(1 for c in cs if c.get("image")); print("  with image:", withimg)
        if cs:
            st, c = g(f"https://api.tcgdex.net/v2/{lang}/cards/{cs[0]['id']}")
            if isinstance(c, dict): print("  card keys:", {k: c[k] for k in ("rarity", "variants", "category", "pricing") if k in c})
            if cs[0].get("image"):
                r = S.head(cs[0]["image"] + "/low.webp", timeout=30, allow_redirects=True); print("  image head:", r.status_code)
    # how many sets have images/logos
    nlogo = sum(1 for x in sets if x.get("logo")); print("  sets with logo:", nlogo)
# graphql bulk rarity test
q = '{ set(id: "sv03.5") { name cards { localId name rarity image variants { normal reverse holo firstEdition } } } }'
for lang in ["en", "ja"]:
    r = S.post("https://api.tcgdex.net/v2/graphql", json={"query": q}, headers={"Accept-Language": lang}, timeout=60)
    t = r.text; print(f"\ngraphql {lang}:", r.status_code, t[:600])
# EN set brief with rarity in list endpoint?
st, c = g("https://api.tcgdex.net/v2/en/cards", params={"set.id": "sv03.5", "pagination:itemsPerPage": 3})
print("\ncards filter:", st, str(c)[:400])
st, c = g("https://api.tcgdex.net/v2/ja/cards", params={"rarity": "SAR", "pagination:itemsPerPage": 3})
print("ja rarity filter:", st, str(c)[:400])
