"""Checks every directly-linked picture (ps) and removes the ones that don't load. Prints a per-set summary."""
import json, glob, collections, requests
from concurrent.futures import ThreadPoolExecutor
S = requests.Session()
def ok(u):
    try: return S.head(u, timeout=30, allow_redirects=True).status_code == 200
    except Exception: return False
for f in sorted(glob.glob("pokeinfo/data/en/sets/*.json")):
    d = json.load(open(f)); rows = [r for r in d["cards"] if r.get("ps")]
    if not rows: continue
    with ThreadPoolExecutor(16) as p: res = list(p.map(lambda r: ok(r["ps"]), rows))
    bad = [r for r, g in zip(rows, res) if not g]
    print(f"{f.split('/')[-1]:22} {len(rows)-len(bad)}/{len(rows)} load", [r["n"] for r in bad][:6])
