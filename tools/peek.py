import requests, json
S=requests.Session(); S.headers["User-Agent"]="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
out={}
def g(u, n=60000):
    try:
        r=S.get(u,timeout=40); out[u]={"status":r.status_code,"ct":r.headers.get("content-type"),"text":r.text[:n]}
    except Exception as e: out[u]={"error":str(e)}
g("https://mistyscollectables.com.au/sets", 200000)
g("https://mistyscollectables.com.au/sets/scarlet-violet/151", 400000)
g("https://mistyscollectables.com.au/cards/cmqz57qvm1fbj11fk9evrofe1", 80000)
for base in ["https://www.evogamescards.com.au","https://www.evogamesorion.com.au","https://mintcollectables.com.au","https://raptorgames.com"]:
    g(base+"/search/suggest.json?q=gengar&resources[type]=product&resources[limit]=10", 30000)
    g(base+"/search?q=gengar&type=product&options[prefix]=last", 120000)
    g(base+"/products.json?limit=1", 5000)
g("https://www.evogamescards.com.au/products/zapdos-133-128-me-30th-celebration-holofoil.js", 20000)
json.dump(out, open("tools/peek_out.json","w"))
