"""Records a GengarFinder "New card" request (a GitHub issue) in gengar/data/collection.json.

Fields in the issue: card numbers (from your 115 list), where you got it, price paid, date, and
whether to add or remove. A new "where" is remembered in places.json for next time.
Writes gengar/data/_result.md for the bot to post back on the issue.
"""
import json
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path

D = Path(__file__).resolve().parent.parent / "data"
RESULT, OK = D / "_result.md", D / "_ok"
BRISBANE = timezone(timedelta(hours=10))


def field(body, label):
    m = re.search(rf"###\s*{re.escape(label)}\s*\n+(.+?)(?:\n###|\Z)", body or "", re.S)
    v = m.group(1).strip() if m else ""
    return "" if v == "_No response_" else v


def main():
    body = os.environ.get("ISSUE_BODY", "")
    OK.unlink(missing_ok=True)
    cards = {c["id"]: c for c in json.loads((D / "cards_base.json").read_text(encoding="utf-8"))}
    col = json.loads((D / "collection.json").read_text(encoding="utf-8"))
    places = json.loads((D / "places.json").read_text(encoding="utf-8"))

    def finish(text, ok=False):
        RESULT.write_text(text, encoding="utf-8")
        if ok:
            OK.write_text("1")
        print(text)

    ids = [int(x) for x in re.findall(r"\d+", field(body, "Card numbers"))]
    bad = [i for i in ids if i not in cards]
    if not ids or bad:
        return finish("I couldn't find " + (f"card number(s) {', '.join(map(str, bad))} in your list"
                      if bad else "any card numbers") + ". Edit this request with numbers from 1 to 115.")
    action = "remove" if "remove" in field(body, "Add or remove").lower() else "add"
    now = datetime.now(BRISBANE)
    if action == "remove":
        gone = [i for i in ids if col["cards"].pop(str(i), None)]
        col["log"].append({"time": now.isoformat(timespec="minutes"), "action": "remove", "ids": ids})
        (D / "collection.json").write_text(json.dumps(col, indent=1, ensure_ascii=False), encoding="utf-8")
        return finish(f"Removed {len(gone)} card(s): " + ", ".join(f"#{i} {cards[i]['name']} ({cards[i]['set']})" for i in gone), ok=True)

    where = field(body, "Where you got it").strip() or "Unknown"
    match = next((p for p in places["places"] if p.lower() == where.lower()), None)
    if match:
        where = match
    elif where != "Unknown":
        places["places"].append(where)                         # remembered for next time
        (D / "places.json").write_text(json.dumps(places, indent=1, ensure_ascii=False), encoding="utf-8")
    paid_txt = field(body, "Price paid each (AUD)")
    paid = float(re.sub(r"[^\d.]", "", paid_txt)) if re.search(r"\d", paid_txt) else None
    date_txt = field(body, "Date you got it")
    try:
        date = datetime.strptime(date_txt, "%Y-%m-%d").date().isoformat()
    except ValueError:
        date = now.date().isoformat()
    for i in ids:
        col["cards"][str(i)] = {"date": date, "where": where, "paid": paid}
    col["log"].append({"time": now.isoformat(timespec="minutes"), "action": "add", "ids": ids,
                       "where": where, "paid": paid, "date": date})
    (D / "collection.json").write_text(json.dumps(col, indent=1, ensure_ascii=False), encoding="utf-8")
    have = len(col["cards"])
    names = "\n".join(f"- #{i} {cards[i]['name']}, {cards[i]['set']} {cards[i]['number']} ({cards[i]['variant']})" for i in ids)
    finish(f"Added to your collection (from **{where}**{f', ${paid:.2f} each' if paid is not None else ''}, {date}):\n{names}\n\n"
           f"You now have **{have} of {len(cards)}** ({have / len(cards):.0%}). The app updates in about a minute.", ok=True)


if __name__ == "__main__":
    main()
