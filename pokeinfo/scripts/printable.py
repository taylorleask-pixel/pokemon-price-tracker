"""Printable blank sheet: every English set in front-page order, with its symbol and abbreviation and an empty
box for the page number of its cover art. Writes pokeinfo/print/cover-art-pages.html (print it to PDF)."""
import html
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SIDE = re.compile(r"mcdonald|trick or trade|pokéween|miscellaneous|^misc|other", re.I)
sets = [x for x in json.loads((ROOT / "data/en/sets.json").read_text(encoding="utf-8"))["sets"] if x.get("cards_n")][::-1]
groups = {}
for x in sets:
    groups.setdefault(x.get("serie") or "Other", []).append(x)
order = sorted(groups, key=lambda g: (bool(SIDE.search(g)), list(groups).index(g)))
rows = []
for g in order:
    rows.append(f'<tr class="g"><td colspan="4">{html.escape(g)}</td></tr>')
    for x in groups[g]:
        sym = x.get("symbol") or ""
        if sym.startswith("http"):   # save a local copy so the PDF printer doesn't have to wait on the network
            local = ROOT / "print" / "sym" / (x["id"] + Path(sym).suffix)
            try:
                if not local.exists():
                    local.parent.mkdir(parents=True, exist_ok=True)
                    req = urllib.request.Request(sym, headers={"User-Agent": "PokeInfo"})
                    local.write_bytes(urllib.request.urlopen(req, timeout=30).read())
                sym = local.as_uri()
            except Exception:  # noqa: BLE001
                sym = ""
        elif sym:
            sym = (ROOT / sym).as_uri()
        img = f'<img src="{html.escape(sym)}" alt="">' if sym else ""
        rows.append(f'<tr><td class="p"></td><td class="s">{img}</td><td>{html.escape(x["name"])}</td><td class="c">{html.escape(x.get("abbr") or x["id"])}</td></tr>')
doc = f"""<!doctype html><meta charset="utf-8"><title>PokeInfo cover art pages</title>
<style>
@page {{ size: A4; margin: 11mm; }}
body {{ font: 9.5pt/1.2 "Helvetica Neue", Arial, sans-serif; color:#222; margin: 0; }}
h1 {{ font-size: 15pt; margin: 0 0 1.5mm; }} p {{ margin: 0 0 3.5mm; color:#555; }}
.cols {{ columns: 2; column-gap: 7mm; }}
table {{ width: 100%; border-collapse: collapse; }}
td {{ border-bottom: .3mm solid #c8c8c8; padding: 1.1mm 1.2mm; vertical-align: middle; }}
td.p {{ width: 12mm; border: .3mm solid #777; }}
td.s {{ width: 7mm; text-align: center; padding: .6mm; }}
td.s img {{ max-width: 6mm; max-height: 5mm; display: block; margin: auto; }}
td.c {{ width: 14mm; color:#555; font: 700 8pt ui-monospace, Menlo, Consolas, monospace; text-align: right; }}
tr {{ break-inside: avoid; }}
tr.g td {{ border: 0; font-weight: 700; padding: 3mm 0 .8mm; font-size: 10.5pt; }}
</style>
<h1>PokeInfo cover art pages (English)</h1>
<p>Write the page number of each set's cover art in the box. Leave it blank if there's no art. {len(sets)} sets, in the same order as the app.</p>
<div class="cols"><table><tbody>{''.join(rows)}</tbody></table></div>"""
(ROOT / "print").mkdir(exist_ok=True)
(ROOT / "print/cover-art-pages.html").write_text(doc, encoding="utf-8")
print(len(sets), "sets")
