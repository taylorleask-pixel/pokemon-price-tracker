import json, requests
r = requests.get("https://api.pokemontcg.io/v2/sets", params={"pageSize": 250, "orderBy": "releaseDate"}, timeout=60)
print("status", r.status_code)
sets = r.json()["data"]
print(len(sets), "sets")
td = {s["name"].lower(): s for s in json.load(open("pokeinfo/data/en/sets.json"))["sets"]}
for s in sets:
    tag = "IN-TCGDEX" if s["name"].lower() in td else "MISSING"
    imgs = td.get(s["name"].lower(), {}).get("img_n")
    print(f'{tag:9} {s["id"]:10} {s["releaseDate"]} {s["total"]:4} {s["name"]}  tcgdex_imgs={imgs}')
names = {s["name"].lower() for s in sets}
print("\nTCGdex sets not in pokemontcg.io by name:")
for n, s in td.items():
    if n not in names: print("  ", s["id"], s["name"], s["date"], s["cards_n"], s["img_n"])
r = requests.get("https://api.pokemontcg.io/v2/cards", params={"q": "set.id:mcd24", "pageSize": 3}, timeout=60)
print(r.status_code, json.dumps(r.json().get("data", [])[:1])[:800])
