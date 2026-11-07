"""One-off helper: read store product pages and save their text for contents research."""
from playwright.sync_api import sync_playwright
urls = [u.strip() for u in open("tools/peek_urls.txt") if u.strip()]
out = []
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
    for u in urls:
        try:
            pg.goto(u, timeout=45000, wait_until="domcontentloaded")
            pg.wait_for_timeout(4000)
            t = pg.inner_text("body")
        except Exception as e:
            t = f"ERROR {e}"
        t = "\n".join(l.strip() for l in t.splitlines() if l.strip())
        out.append(f"===== {u}\n{t[:6000]}\n")
    b.close()
open("tools/peek_out.txt", "w").write("\n".join(out))
