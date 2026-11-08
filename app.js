// Pack Watch: reads the JSON files the price checker saves and builds the pages.
const $ = (s) => document.querySelector(s);
const money = (n) => n == null ? "" : "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = (iso, opts = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) =>
  iso ? new Date(iso).toLocaleString("en-AU", { ...opts, timeZone: "Australia/Brisbane" }) : "";

const SET_TABS = ["pack", "blister-single", "bundle", "box", "etb", "case"];
const TAB_ORDER = ["pack", "blister-single", "bundle", "box", "etb", "case", "blister-multi", "other"];
const EXTRA_TABS = [["changes", "What changed"], ["search", "Set search"], ["needs", "Needs contents"], ["stores", "Stores"]];
const LANG_NAMES = { EN: "English", JP: "Japanese", KOR: "Korean", TCH: "Traditional Chinese", SCH: "Simplified Chinese",
  CN: "Chinese (script not stated)", TH: "Thai", ID: "Indonesian", DE: "German", FR: "French", ES: "Spanish", IT: "Italian" };
const SORTS = [
  ["default", "In stock first, newest set"],
  ["low-asc", "Price: low to high"],
  ["low-desc", "Price: high to low"],
  ["per-asc", "Price per pack: low to high"],
  ["changed", "Recently changed"],
  ["name-asc", "Name: A to Z"],
];
const CHANGE_TYPES = [
  ["all", "Everything"], ["in-stock", "Back in stock"], ["sold-out", "Sold out"], ["price-down", "Price down"],
  ["price-up", "Price up"], ["new", "New listing"], ["removed", "Removed"],
];
const CHANGE_LABEL = Object.fromEntries(CHANGE_TYPES);

const S = { tab: "pack", sort: "default", changeType: "all", changeLimit: 200, lastTab: "pack" };
let D = {};

async function load(name) {
  try {
    const r = await fetch(`data/${name}.json?v=${Date.now()}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

async function init() {
  const [sets, categories, contents, stores, prices, history, report, changes, ebay] = await Promise.all(
    ["sets", "categories", "contents", "stores", "prices", "history", "report", "changes", "ebay"].map(load));
  D = { sets, categories, contents: contents || {}, stores, prices: prices || { listings: [] },
        history: history || {}, report: report || { stores: {} }, changes: changes?.events || [],
        ebay: ebay || null };
  delete D.contents._how;
  D.setOrder = Object.fromEntries(sets.map((s, i) => [s.name, i]));
  D.catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  D.storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));
  D.rows = buildRows();
  D.byKey = Object.fromEntries(D.rows.map((r) => [r.key, r]));

  $("#updated").textContent = D.prices.updated ? "Prices checked " + when(D.prices.updated)
    : "No prices yet. The first check hasn't run.";
  $("#store-dots").innerHTML = stores.map((s) => {
    const r = D.report.stores[s.id];
    const cls = !r ? "stale" : r.ok ? "" : (r.carried_over ? "stale" : "fail");
    const tip = !r ? "Not checked yet" : r.ok ? `${r.kept} products` : `Failed: ${r.error}`;
    return `<span class="dot ${cls}" title="${esc(tip)}">${esc(s.name)}</span>`;
  }).join("");

  const years = [...new Set(sets.map((s) => s.year))];
  $("#year").innerHTML += years.map((y) => `<option>${y}</option>`).join("");
  $("#sort").innerHTML = SORTS.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("");
  const langs = [...new Set(D.rows.map((r) => r.lang))].sort((a, b) => (a === "EN" ? -1 : b === "EN" ? 1 : a.localeCompare(b)));
  $("#lang").innerHTML = langs.map((c) => `<option value="${c}">${esc(LANG_NAMES[c] ?? c)}</option>`).join("") +
    `<option value="all">All languages</option>`;
  try { $("#lang").value = localStorage.getItem("lang") || "EN"; } catch { $("#lang").value = "EN"; }
  if (!$("#lang").value) $("#lang").value = "EN";

  ["#q", "#instock", "#showempty", "#year"].forEach((id) => $(id).addEventListener("input", render));
  $("#sort").addEventListener("input", () => { S.sort = $("#sort").value; render(); });
  $("#lang").addEventListener("input", () => {
    try { localStorage.setItem("lang", $("#lang").value); } catch { /* private mode */ }
    renderTabs(); render();
  });
  window.addEventListener("hashchange", route);
  route();
}

// ---- routing: #pack, #box … or #p=<product key>
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("p=")) { renderProduct(h.slice(2)); return; }
  const tabs = [...TAB_ORDER, ...EXTRA_TABS.map((t) => t[0])];
  S.tab = tabs.includes(h) ? h : (tabs.includes(S.tab) ? S.tab : "pack");
  S.lastTab = S.tab;
  document.body.classList.remove("on-product");
  renderTabs();
  render();
}
const go = (hash) => { S.inApp = true; location.hash = hash; };
const productHash = (key) => "p=" + encodeURIComponent(key);

// ---- group listings into rows: one row per product
function buildRows() {
  const rows = {};
  for (const l of D.prices.listings) {
    const r = rows[l.key] ??= {
      key: l.key, category: l.category, set: l.set, year: l.year, product: l.product, variant: l.variant,
      lang: l.lang || "EN", packs: l.packs, titles: {}, byStore: {}, listings: [] };
    r.listings.push(l);
    r.titles[l.title] = (r.titles[l.title] || 0) + 1;
    const cur = r.byStore[l.store];
    // keep each store's best offer: in stock beats sold out, then cheaper
    if (!cur || (l.available && !cur.available) || (l.available === cur.available && (l.price ?? 1e12) < (cur.price ?? 1e12))) r.byStore[l.store] = l;
  }
  for (const r of Object.values(rows)) finishRow(r);
  return Object.values(rows);
}

function finishRow(r) {
  const c = r.product ? D.contents[r.product] : null;
  // contents.json wins; otherwise use what the title says (e.g. "Ancient Origins 3-Pack Blister")
  if (!c?.packs) {
    const auto = r.listings.find((l) => l.auto_packs)?.auto_packs;
    r.contents = auto ? { packs: auto, auto: true } : c;
  } else r.contents = c;
  if (r.contents?.packs?.length) r.packs = r.contents.packs.reduce((a, p) => a + p.qty, 0);
  if (r.product && !c?.separate_rows) r.name = r.product;
  else if (SET_TABS.includes(r.category) && r.set) r.name = r.variant ? `${r.set} (${r.variant})` : r.set;
  else r.name = Object.entries(r.titles).sort((a, b) => b[1] - a[1])[0]?.[0] ?? r.key;
  const inStock = Object.values(r.byStore).filter((l) => l.available && l.price != null);
  const best = inStock.slice().sort((a, b) => a.price - b.price)[0];
  r.low = best?.price ?? null;
  r.lowStore = best?.store ?? null;
  r.perPack = r.low != null && r.packs ? r.low / r.packs : null;
  r.prices = inStock.map((l) => l.price);
  r.changed = r.listings.map((l) => l.changed).filter(Boolean).sort().pop() ?? null;
  r.image = r.listings.find((l) => l.image)?.image ?? null;
  r.needsContents = (r.category === "other" || r.category === "blister-multi") &&
    (!r.contents?.packs || r.contents.packs.some((p) => !p.set));
  return r;
}

function packsText(r) {
  if (r.contents?.packs && !r.contents.packs.length) return "No booster packs";
  if (r.contents?.packs?.length) return r.contents.packs.map((p) => `x${p.qty} ${p.set ?? "(sets not listed)"}`).join(" ");
  if (SET_TABS.includes(r.category) && r.set && r.packs) return `x${r.packs} ${r.set}`;
  return "";
}
const extrasText = (r) => (r.contents?.extras ?? []).join(", ");
const langOK = (r) => $("#lang").value === "all" || r.lang === $("#lang").value;
const langBadge = (code) => code && code !== "EN" ? `<span class="lang" title="${esc(LANG_NAMES[code] ?? code)}">${esc(code)}</span>` : "";

function renderTabs() {
  const count = (id) => D.rows.filter((r) => r.category === id && langOK(r)).length;
  const needs = D.rows.filter((r) => r.needsContents && !r.contents?.packs && langOK(r)).length;
  $("#tabs").innerHTML =
    TAB_ORDER.map((id) => tabBtn(id, D.catName[id], count(id))).join("") + '<span class="gap"></span>' +
    EXTRA_TABS.map(([id, name]) => tabBtn(id, name, id === "needs" ? needs : null)).join("");
  $("#tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
}
const tabBtn = (id, name, n) =>
  `<button role="tab" data-tab="${id}" aria-selected="${S.tab === id && !document.body.classList.contains("on-product")}">${esc(name)}${n != null ? `<span class="n">${n}</span>` : ""}</button>`;

function filtered(rows) {
  const q = $("#q").value.trim().toLowerCase();
  const y = $("#year").value;
  return rows.filter((r) => langOK(r) &&
    (!q || r.name.toLowerCase().includes(q) || packsText(r).toLowerCase().includes(q) || extrasText(r).toLowerCase().includes(q)) &&
    (!y || String(r.year) === y) &&
    (!$("#instock").checked || r.low != null));
}

function render() {
  const listTab = TAB_ORDER.includes(S.tab);
  $("#controls").hidden = !listTab;
  $("#empty-wrap").hidden = !SET_TABS.includes(S.tab);
  $("#sort").value = S.sort;
  if (S.tab === "changes") return renderChanges();
  if (S.tab === "search") return renderSearch();
  if (S.tab === "needs") return renderNeeds();
  if (S.tab === "stores") return renderStores();

  let rows = D.rows.filter((r) => r.category === S.tab);
  if (SET_TABS.includes(S.tab) && $("#showempty").checked && ["EN", "all"].includes($("#lang").value)) {
    const have = new Set(rows.filter((r) => r.lang === "EN").map((r) => r.set));
    const cat = D.categories.find((c) => c.id === S.tab);
    for (const s of D.sets) if (!have.has(s.name)) rows.push(finishRow({
      key: `${S.tab}|${s.name}`, category: S.tab, set: s.name, year: s.year, lang: "EN",
      packs: S.tab === "etb" ? (s.year >= 2023 ? 9 : 8) : cat.packs, titles: {}, byStore: {}, listings: [] }));
  }
  renderTable(sortRows(filtered(rows)), { showPacks: !SET_TABS.includes(S.tab) });
}

// S.sort is a menu value ("low-desc") or a column click ("col:<store id>:asc")
function sortRows(rows) {
  const inf = (v) => v ?? Infinity;
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const byDefault = (a, b) => cmp(a.low == null, b.low == null) || cmp(-(a.year ?? 0), -(b.year ?? 0)) ||
    cmp(D.setOrder[a.set] ?? 9999, D.setOrder[b.set] ?? 9999) || cmp(a.name, b.name);
  const sorters = {
    "default": byDefault,
    "low-asc": (a, b) => cmp(inf(a.low), inf(b.low)) || byDefault(a, b),
    "low-desc": (a, b) => cmp(b.low ?? -1, a.low ?? -1) || byDefault(a, b),
    "per-asc": (a, b) => cmp(inf(a.perPack), inf(b.perPack)) || byDefault(a, b),
    "changed": (a, b) => cmp(b.changed ?? "", a.changed ?? "") || byDefault(a, b),
    "name-asc": (a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()),
  };
  if (S.sort.startsWith("col:")) {
    const [, col, dir] = S.sort.split(":");
    const val = (r) => col === "year" ? (r.year ?? 0) : col === "packs" ? (r.packs ?? 0) :
      (r.byStore[col]?.available ? r.byStore[col].price : null);
    return rows.sort((a, b) => {
      const A = val(a), B = val(b);
      if (A == null || B == null) return cmp(A == null, B == null);
      return (dir === "asc" ? 1 : -1) * cmp(A, B) || byDefault(a, b);
    });
  }
  return rows.sort(sorters[S.sort] ?? byDefault);
}

// green (cheapest) -> yellow -> red (dearest), only among in-stock prices in that row
function heat(price, prices) {
  if (prices.length < 2) return null;
  const lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi === lo) return "#63BE7B";
  const t = (price - lo) / (hi - lo);
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const c = t < .5 ? mix([99, 190, 123], [255, 235, 132], t * 2) : mix([255, 235, 132], [248, 105, 107], (t - .5) * 2);
  return `rgb(${c})`;
}

function priceChip(l, prices) {
  const bg = l.available ? heat(l.price, prices) : null;
  const cls = !l.available ? "oos" : bg ? "" : "solo";
  return `<a class="chip ${cls}" href="${esc(l.url)}" target="_blank" rel="noopener"
    title="${esc(l.title)}${l.available ? "" : " (sold out)"}${l.stale ? " (from last good check)" : ""}"
    ${bg ? `style="background:${bg}"` : ""} onclick="event.stopPropagation()">${money(l.price) || "Sold out"}</a>`;
}

function renderTable(rows, { showPacks }) {
  if (!rows.length) {
    $("#view").innerHTML = `<div class="wrap"><p class="none">${D.prices.listings.length
      ? "Nothing matches. Try clearing the search, the In stock filter or the language."
      : "No prices yet. They'll appear after the first check runs on GitHub."}</p></div>`;
    return;
  }
  const stores = D.stores;
  const colSort = (col) => S.sort.startsWith(`col:${col}:`) ? S.sort.split(":")[2] : null;
  const menuSort = { low: ["low-asc", "low-desc"], per: ["per-asc"], name: ["name-asc"] };
  const th = (col, label, cls = "") => {
    let dir = colSort(col);
    if (menuSort[col]?.includes(S.sort)) dir = S.sort.endsWith("desc") ? "desc" : "asc";
    return `<th class="${cls}" data-col="${col}"${dir ? ` aria-sort="${dir === "asc" ? "ascending" : "descending"}"` : ""}>${esc(label)}</th>`;
  };
  const head = `<tr>${th("year", "Year")}${th("name", showPacks ? "Product" : "Set", "namecol")}${
    showPacks ? th("packs", "Packs included") + "<th>Also includes</th>" : ""}${
    th("low", "Lowest")}<th>Cheapest at</th>${th("per", "Per pack")}${
    stores.map((s) => th(s.id, s.name, "store")).join("")}</tr>`;
  const body = rows.map((r) => {
    const cells = stores.map((s) => {
      const l = r.byStore[s.id];
      return l ? `<td class="store chip-cell">${priceChip(l, r.prices)}</td>`
        : `<td class="store"><span class="empty-cell">–</span></td>`;
    }).join("");
    const sub = !r.contents?.packs && r.needsContents ? `<span class="sub warn">Contents unknown</span>` :
      r.needsContents ? `<span class="sub warn">Sets not listed</span>` :
      (!showPacks && r.packs > 1 ? `<span class="sub">${r.packs} packs</span>` : "");
    return `<tr class="row" data-key="${esc(r.key)}" tabindex="${r.listings.length ? 0 : -1}">
      <td class="year">${r.year ?? ""}</td>
      <td class="namecol"><span class="name">${esc(r.name)}</span>${langBadge(r.lang)}${sub}</td>
      ${showPacks ? `<td class="packs">${esc(packsText(r))}</td><td class="extras">${esc(extrasText(r))}</td>` : ""}
      <td class="best">${money(r.low) || '<span class="per">Sold out</span>'}</td>
      <td>${esc(D.storeName[r.lowStore] ?? "")}</td>
      <td class="per">${r.perPack != null ? money(r.perPack) : ""}</td>
      ${cells}</tr>`;
  }).join("");
  $("#view").innerHTML = `<div class="wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;

  $("#view").querySelectorAll("thead th[data-col]").forEach((h) => h.addEventListener("click", () => {
    const col = h.dataset.col;
    if (col === "low") S.sort = S.sort === "low-asc" ? "low-desc" : "low-asc";
    else if (col === "per") S.sort = "per-asc";
    else if (col === "name") S.sort = "name-asc";
    else S.sort = `col:${col}:${colSort(col) === "asc" ? "desc" : "asc"}`;
    render();
  }));
  $("#view").querySelectorAll("tr.row").forEach((tr) => {
    if (!D.byKey[tr.dataset.key]) return; // a "no store has it" placeholder row
    const open = () => go(productHash(tr.dataset.key));
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
  });
}

// ---- product page
function renderProduct(key) {
  const r = D.byKey[key];
  document.body.classList.add("on-product");
  $("#controls").hidden = true;
  renderTabs();
  if (!r) {
    $("#view").innerHTML = `<div class="panel"><p><button class="btn ghost" id="back">← Back</button></p>
      <p class="none">This product isn't listed by any store right now.</p></div>`;
    $("#back").addEventListener("click", back);
    return;
  }
  const order = (l) => (l ? (l.available ? 0 : 1) : 2);
  const storeRows = D.stores.map((s) => ({ s, l: r.byStore[s.id] }))
    .sort((a, b) => order(a.l) - order(b.l) || ((a.l?.price ?? 1e12) - (b.l?.price ?? 1e12)));
  const groups = [["In stock", 0], ["Sold out", 1], ["Doesn't list this", 2]].map(([label, n]) => {
    const items = storeRows.filter((x) => order(x.l) === n);
    if (!items.length) return "";
    return `<h3 class="group">${label} <span class="n">${items.length}</span></h3><ul class="stores">${items.map(({ s, l }) => {
      const others = r.listings.filter((x) => x.store === s.id && x !== l);
      return `<li class="${n === 2 ? "absent" : ""}">
        <div class="st"><span class="sname">${esc(s.name)}</span>
          ${l ? `<a class="ltitle" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>` : ""}
          ${others.map((o) => `<a class="ltitle" href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.title)} (${money(o.price)}${o.available ? "" : ", sold out"})</a>`).join("")}
          ${l?.changed ? `<span class="lt">Last changed ${esc(when(l.changed))}</span>` : ""}</div>
        <div class="sp">${l ? priceChip(l, r.prices) : ""}</div></li>`;
    }).join("")}</ul>`;
  }).join("");
  const facts = [
    ["Lowest price", money(r.low) || "Sold out everywhere"],
    ["Cheapest at", D.storeName[r.lowStore] ?? ""],
    ["Per pack", r.perPack != null ? money(r.perPack) : ""],
    ["Packs included", packsText(r) || (r.packs ? `${r.packs}` : "")],
    ["Also includes", extrasText(r)],
    ["Language", LANG_NAMES[r.lang] ?? r.lang],
  ].filter(([, v]) => v);
  const recent = D.changes.filter((e) => e.key === key).slice(0, 12);
  $("#view").innerHTML = `<article class="product">
    <p><button class="btn ghost" id="back">← Back</button></p>
    <div class="phead">
      ${r.image ? `<img class="pimg" src="${esc(r.image)}" alt="" loading="lazy" onerror="this.remove()">` : ""}
      <div><p class="kicker">${esc(D.catName[r.category] ?? "")}${r.year ? `, ${r.year}` : ""}</p>
        <h2>${esc(r.name)} ${langBadge(r.lang)}</h2>
        <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
        ${r.contents?.note ? `<p class="note">${esc(r.contents.note)}</p>` : ""}
        ${r.needsContents && !r.contents?.packs ? `<p class="note warn">What's inside isn't known yet. Add it from the Needs contents tab.</p>` : ""}
      </div>
    </div>
    <div class="pgrid">
      <section class="panel">${groups}</section>
      <section>
        ${ebayPanel(key)}
        <div class="panel"><h3>Lowest price over time</h3>${spark(D.history[key], true)}</div>
        <div class="panel"><h3>Recent changes</h3>${recent.length ? `<ul class="changes compact">${recent.map(changeItem).join("")}</ul>`
          : `<p class="note">No changes recorded yet. They appear after the next price checks.</p>`}</div>
      </section>
    </div></article>`;
  $("#back").addEventListener("click", back);
  window.scrollTo(0, 0);
}
function ebayPanel(key) {
  if (!D.ebay) return "";                       // eBay keys not added yet
  const e = D.ebay.items?.[key];
  if (!e) return "";
  const ship = (h) => h.ship == null ? "" : h.ship === 0 ? ", free postage" : `, +${money(h.ship)} postage`;
  return `<div class="panel ebay"><h3>On eBay</h3>
    ${e.low ? `<dl class="facts">
        <div><dt>Cheapest</dt><dd><a href="${esc(e.low.url)}" target="_blank" rel="noopener">${money(e.low.price)}</a><br><span class="lt">${esc(ship(e.low).replace(/^, /, ""))}</span></dd></div>
        <div><dt>Typical</dt><dd>${money(e.median)}</dd></div>
        <div><dt>Listings found</dt><dd>${e.n}</dd></div></dl>
      <p class="note">Cheapest: <a href="${esc(e.low.url)}" target="_blank" rel="noopener">${esc(e.low.title)}</a></p>`
      : `<p class="note">No matching listings found.</p>`}
    <p class="note">New, Buy It Now, located in Australia. These are asking prices, not sold prices, and the odd wrong
    listing can slip in. Checked ${esc(when(D.ebay.updated))}. <a href="${esc(e.url)}" target="_blank" rel="noopener">See all on eBay</a></p>
  </div>`;
}
function back() {
  // came here by clicking inside the site: go back to exactly where you were; opened from a link: go to the list
  if (S.inApp) history.back();
  else go(S.lastTab || "pack");
}

function spark(h, big = false) {
  if (!h || h.length < 2) return `<p class="note">The graph appears once there are prices from two different days.</p>`;
  const W = big ? 520 : 320, H = big ? 160 : 90, P = 16;
  const vals = h.map((p) => p[1]), lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i) => P + (i * (W - 2 * P)) / (h.length - 1);
  const y = (v) => hi === lo ? H / 2 : H - P - ((v - lo) * (H - 2 * P)) / (hi - lo);
  const d = h.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const last = h[h.length - 1];
  return `<svg class="spark${big ? " big" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lowest price went from ${money(vals[0])} to ${money(last[1])}">
    <path d="${d}"/><circle cx="${x(h.length - 1)}" cy="${y(last[1])}" r="3.5"/>
    <text x="${P}" y="11">${money(hi)}</text><text x="${P}" y="${H - 1}">${money(lo)}</text>
    <text x="${W - P}" y="11" text-anchor="end">${esc(h[0][0])} to ${esc(last[0])}</text></svg>`;
}

// ---- What changed
function changeItem(e) {
  const price = e.type === "price-up" || e.type === "price-down" ? `${money(e.old)} → ${money(e.new)}`
    : e.type === "sold-out" || e.type === "removed" ? money(e.old) : money(e.new);
  const name = D.byKey[e.key] ? `<a href="#${productHash(e.key)}">${esc(e.title)}</a>` : esc(e.title);
  return `<li class="ev ${e.type}"><span class="etype">${esc(CHANGE_LABEL[e.type] ?? e.type)}</span>
    <span class="etitle">${name}${langBadge(e.lang)}<span class="lt">${esc(D.storeName[e.store] ?? e.store)}</span></span>
    <span class="eprice">${price}</span></li>`;
}

function renderChanges() {
  const lang = $("#lang").value;
  const all = D.changes.filter((e) => (lang === "all" || (e.lang || "EN") === lang));
  const counts = Object.fromEntries(CHANGE_TYPES.map(([t]) => [t, t === "all" ? all.length : all.filter((e) => e.type === t).length]));
  const list = all.filter((e) => S.changeType === "all" || e.type === S.changeType);
  const shown = list.slice(0, S.changeLimit);
  const byTime = {};
  for (const e of shown) (byTime[e.time] ??= []).push(e);
  $("#view").innerHTML = `<div class="panel">
      <div class="filters" role="group" aria-label="Show">${CHANGE_TYPES.map(([t, l]) =>
        `<button class="pill${S.changeType === t ? " on" : ""}" data-t="${t}" aria-pressed="${S.changeType === t}">${esc(l)} <span class="n">${counts[t]}</span></button>`).join("")}</div>
      <p class="note">Changes from the last 30 days, newest first. Language follows the setting on the product tabs.</p>
    </div>
    ${shown.length ? Object.entries(byTime).map(([t, evs]) => `<section class="panel">
      <h3>Check at ${esc(when(t))} <span class="n">${evs.length}</span></h3>
      <ul class="changes">${evs.map(changeItem).join("")}</ul></section>`).join("")
      : `<div class="panel"><p class="none">${D.changes.length ? "Nothing of that kind changed." :
        "No changes recorded yet. They'll show up from the next price check on."}</p></div>`}
    ${list.length > shown.length ? `<p><button class="btn" id="more">Show more (${list.length - shown.length} left)</button></p>` : ""}`;
  $("#view").querySelectorAll(".pill").forEach((b) => b.addEventListener("click", () => {
    S.changeType = b.dataset.t; S.changeLimit = 200; renderChanges();
  }));
  $("#more")?.addEventListener("click", () => { S.changeLimit += 200; renderChanges(); });
}

// ---- Set search: which products contain packs from a set
function renderSearch() {
  const prev = $("#setq")?.value ?? "";
  $("#view").innerHTML = `<div class="panel">
      <label class="big-search"><span class="sr">Set name</span>
        <input id="setq" list="setlist" placeholder="Type a set, e.g. Evolving Skies" value="${esc(prev)}"></label>
      <datalist id="setlist">${D.sets.map((s) => `<option value="${esc(s.name)}">`).join("")}</datalist>
      <p class="note">Shows every English product with packs from that set: loose packs, boxes, and collections whose contents are known.</p>
    </div><div id="setres"></div>`;
  const run = () => {
    const name = D.sets.find((s) => s.name.toLowerCase() === $("#setq").value.trim().toLowerCase())?.name;
    if (!name) { $("#setres").innerHTML = ""; return; }
    const hits = D.rows.filter((r) => r.lang === "EN").map((r) => {
      const fromContents = r.contents?.packs?.find((p) => p.set === name)?.qty;
      const qty = fromContents ?? (SET_TABS.includes(r.category) && r.set === name ? r.packs : null);
      return qty ? { r, qty } : null;
    }).filter(Boolean).sort((a, b) => (a.r.perPack ?? Infinity) - (b.r.perPack ?? Infinity));
    $("#setres").innerHTML = hits.length ? `<div class="wrap"><table><thead><tr>
        <th>Type</th><th class="namecol">Product</th><th>${esc(name)} packs</th><th>Total packs</th>
        <th>Lowest</th><th>Cheapest at</th><th>Per pack</th></tr></thead><tbody>${hits.map(({ r, qty }) => `
        <tr class="row" data-key="${esc(r.key)}" tabindex="0"><td>${esc(D.catName[r.category])}</td><td class="namecol"><span class="name">${esc(r.name)}</span></td>
        <td>x${qty}</td><td>${r.packs ?? ""}</td><td class="best">${money(r.low) || '<span class="per">Sold out</span>'}</td>
        <td>${esc(D.storeName[r.lowStore] ?? "")}</td><td class="per">${r.perPack != null ? money(r.perPack) : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="wrap"><p class="none">No store has anything with ${esc(name)} packs right now.</p></div>`;
    $("#setres").querySelectorAll("tr.row").forEach((tr) => {
      tr.addEventListener("click", () => go(productHash(tr.dataset.key)));
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(productHash(tr.dataset.key)); });
    });
  };
  $("#setq").addEventListener("input", run);
  $("#setq").focus();
  run();
}

// ---- Products whose contents aren't known yet, ready to copy to Claude
function renderNeeds() {
  const rows = D.rows.filter((r) => r.needsContents && !r.contents?.packs && langOK(r))
    .sort((a, b) => (a.low == null) - (b.low == null) || a.name.localeCompare(b.name));
  const text = rows.map((r) => `- ${r.name}${r.low == null ? " (sold out)" : ""}`).join("\n");
  $("#view").innerHTML = `<div class="panel">
    <p class="note">It isn't known which packs are inside these. In-stock ones are listed first. Copy the list and paste it
    to Claude in the chat, and Claude will look them up and add them.</p>
    ${rows.length ? `<p><button class="btn" id="copy">Copy list</button></p><pre class="copy">${esc(text)}</pre>`
      : `<p class="none">Every product's contents are known.</p>`}</div>`;
  $("#copy")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText("Look up what's inside these and add them to contents.json:\n" + text);
    $("#copy").textContent = "Copied";
  });
}

function renderStores() {
  const rows = D.stores.map((s) => {
    const r = D.report.stores[s.id];
    const status = !r ? "Not checked yet" : r.ok ? "Working" : r.carried_over ? "Failed, showing last good prices" : "Failed";
    return `<tr><td class="namecol"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></td>
      <td>${esc(s.platform)}</td><td>${status}</td><td>${r?.kept ?? ""}</td>
      <td style="white-space:normal">${esc(r?.error ?? "")}</td></tr>`;
  }).join("");
  $("#view").innerHTML = `<div class="wrap"><table><thead><tr><th class="namecol">Store</th><th>Platform</th>
    <th>Status</th><th>Products</th><th>Problem</th></tr></thead><tbody>${rows}</tbody></table></div>
    <form class="panel addstore" id="addstore">
      <h3>Add a store</h3>
      <p class="note">Works for shops built on Shopify, WooCommerce or Square Online, which is most small card shops.
      This opens a request on GitHub: tap <b>Create</b> there, and within a few minutes a reply says whether the store
      was added and how many Pokémon products it found.</p>
      <div class="addrow">
        <label>Store name<input id="as-name" required autocomplete="off" placeholder="e.g. Card Kingdom"></label>
        <label>Link to their Pokémon products<input id="as-url" type="url" required placeholder="https://"></label>
        <button class="btn" type="submit">Add store</button>
      </div>
      <p class="note">You need to be signed in to GitHub. Requests from anyone else are ignored.</p>
    </form>`;
  $("#addstore").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#as-name").value.trim(), url = $("#as-url").value.trim();
    const q = new URLSearchParams({ template: "add-store.yml", title: `Add store: ${name}`, store_name: name, store_url: url });
    window.open(`https://github.com/${REPO}/issues/new?${q}`, "_blank", "noopener");
  });
}

// the GitHub repo this site comes from, e.g. taylorleask-pixel/pokemon-price-tracker
const REPO = location.hostname.endsWith(".github.io")
  ? `${location.hostname.split(".")[0]}/${location.pathname.split("/")[1]}`
  : "taylorleask-pixel/pokemon-price-tracker";

init();

// ---- installable app: register the offline helper
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// ---- home-screen apps stay open in the background: reload when coming back after a while
(() => {
  let shownAt = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - shownAt > 5 * 60 * 1000) location.reload();
    if (document.visibilityState === "visible") shownAt = Date.now();
  });
})();
