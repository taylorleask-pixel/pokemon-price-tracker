// Pack Watch: reads the JSON files the price checker saves and builds the tables.
const $ = (s) => document.querySelector(s);
const money = (n) => n == null ? "" : "$" + n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const SET_TABS = ["pack", "blister-single", "bundle", "box", "etb", "case"];
const TAB_ORDER = ["pack", "blister-single", "bundle", "box", "etb", "case", "blister-multi", "other"];
const EXTRA_TABS = [["search", "Set search"], ["needs", "Needs contents"], ["stores", "Stores"]];

const S = { tab: "pack", sort: { col: "default", dir: -1 }, open: new Set() };
let D = {};

async function load(name) {
  const r = await fetch(`data/${name}.json?v=${Date.now()}`);
  if (!r.ok) return null;
  return r.json();
}

async function init() {
  const [sets, categories, contents, stores, prices, history, report] = await Promise.all(
    ["sets", "categories", "contents", "stores", "prices", "history", "report"].map(load));
  D = { sets, categories, contents: contents || {}, stores, prices: prices || { listings: [] },
        history: history || {}, report: report || { stores: {} } };
  delete D.contents._how;
  D.setOrder = Object.fromEntries(sets.map((s, i) => [s.name, i]));
  D.setYear = Object.fromEntries(sets.map((s) => [s.name, s.year]));
  D.catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  D.storeName = Object.fromEntries(stores.map((s) => [s.id, s.name]));
  D.rows = buildRows();

  if (D.prices.updated) {
    const t = new Date(D.prices.updated);
    $("#updated").textContent = "Prices checked " + t.toLocaleString("en-AU", {
      weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Brisbane" });
  } else {
    $("#updated").textContent = "No prices yet — the first check hasn't run.";
  }
  $("#store-dots").innerHTML = stores.map((s) => {
    const r = D.report.stores[s.id];
    const cls = !r ? "stale" : r.ok ? "" : (r.carried_over ? "stale" : "fail");
    const tip = !r ? "Not checked yet" : r.ok ? `${r.kept} products` : `Failed: ${r.error}`;
    return `<span class="dot ${cls}" title="${esc(tip)}">${esc(s.name)}</span>`;
  }).join("");

  const years = [...new Set(sets.map((s) => s.year))];
  $("#year").innerHTML += years.map((y) => `<option>${y}</option>`).join("");

  ["#q", "#instock", "#showempty", "#year"].forEach((id) => $(id).addEventListener("input", render));
  const fromHash = location.hash.slice(1);
  if ([...TAB_ORDER, ...EXTRA_TABS.map((t) => t[0])].includes(fromHash)) S.tab = fromHash;
  renderTabs();
  render();
}

// Group listings into rows: one row per product (set + type, or a named product).
function buildRows() {
  const rows = {};
  for (const l of D.prices.listings) {
    const r = rows[l.key] ??= {
      key: l.key, category: l.category, set: l.set, year: l.year, product: l.product,
      packs: l.packs, titles: {}, byStore: {}, listings: [] };
    r.listings.push(l);
    r.titles[l.title] = (r.titles[l.title] || 0) + 1;
    const cur = r.byStore[l.store];
    // keep each store's best offer: in stock beats sold out, then cheaper
    if (!cur || (l.available && !cur.available) || (l.available === cur.available && l.price < cur.price)) r.byStore[l.store] = l;
  }
  for (const r of Object.values(rows)) finishRow(r);
  return Object.values(rows);
}

function finishRow(r) {
  const c = r.product ? D.contents[r.product] : null;
  r.contents = c;
  if (c?.packs?.length) r.packs = c.packs.reduce((a, p) => a + p.qty, 0);
  if (r.product) r.name = r.product;
  else if (SET_TABS.includes(r.category) && r.set) r.name = r.set;
  else r.name = Object.entries(r.titles).sort((a, b) => b[1] - a[1])[0]?.[0] ?? r.key;
  const inStock = Object.values(r.byStore).filter((l) => l.available);
  const best = inStock.sort((a, b) => a.price - b.price)[0];
  r.low = best?.price ?? null;
  r.lowStore = best?.store ?? null;
  r.perPack = r.low != null && r.packs ? r.low / r.packs : null;
  r.prices = inStock.map((l) => l.price);
  r.needsContents = (r.category === "other" || r.category === "blister-multi") && !c?.packs?.length;
  return r;
}

function packsText(r) {
  if (r.contents?.packs?.length) return r.contents.packs.map((p) => `x${p.qty} ${p.set}`).join(" ");
  if (SET_TABS.includes(r.category) && r.set && r.packs) return `x${r.packs} ${r.set}`;
  return "";
}

function renderTabs() {
  const count = (id) => D.rows.filter((r) => r.category === id).length;
  const needs = D.rows.filter((r) => r.needsContents).length;
  $("#tabs").innerHTML =
    TAB_ORDER.map((id) => tabBtn(id, D.catName[id], count(id))).join("") + '<span class="gap"></span>' +
    EXTRA_TABS.map(([id, name]) => tabBtn(id, name, id === "needs" ? needs : null)).join("");
  $("#tabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
    S.tab = b.dataset.tab; S.open.clear(); S.sort = { col: "default", dir: -1 };
    history.replaceState(null, "", "#" + S.tab); renderTabs(); render();
  }));
}
const tabBtn = (id, name, n) =>
  `<button role="tab" data-tab="${id}" aria-selected="${S.tab === id}">${esc(name)}${n != null ? `<span class="n">${n}</span>` : ""}</button>`;

function filtered(rows) {
  const q = $("#q").value.trim().toLowerCase();
  const y = $("#year").value;
  return rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || packsText(r).toLowerCase().includes(q)) &&
    (!y || String(r.year) === y) &&
    (!$("#instock").checked || r.low != null));
}

function render() {
  const extra = EXTRA_TABS.some((t) => t[0] === S.tab);
  $("#controls").hidden = extra;
  $("#empty-wrap").hidden = !SET_TABS.includes(S.tab);
  if (S.tab === "search") return renderSearch();
  if (S.tab === "needs") return renderNeeds();
  if (S.tab === "stores") return renderStores();

  let rows = D.rows.filter((r) => r.category === S.tab);
  if (SET_TABS.includes(S.tab) && $("#showempty").checked) {
    const have = new Set(rows.map((r) => r.set));
    const cat = D.categories.find((c) => c.id === S.tab);
    for (const s of D.sets) if (!have.has(s.name)) rows.push(finishRow({
      key: `${S.tab}|${s.name}`, category: S.tab, set: s.name, year: s.year,
      packs: S.tab === "etb" ? (s.year >= 2023 ? 9 : 8) : cat.packs, titles: {}, byStore: {}, listings: [] }));
  }
  rows = sortRows(filtered(rows));
  renderTable(rows, { showPacks: !SET_TABS.includes(S.tab) });
}

function sortRows(rows) {
  const { col, dir } = S.sort;
  const val = {
    default: (r) => [-(r.year ?? 0), D.setOrder[r.set] ?? 9999, r.name],
    name: (r) => r.name.toLowerCase(), year: (r) => r.year ?? 0,
    low: (r) => r.low ?? Infinity, per: (r) => r.perPack ?? Infinity, packs: (r) => r.packs ?? 0,
  }[col] ?? ((r) => r.byStore[col]?.available ? r.byStore[col].price : Infinity);
  return rows.sort((a, b) => {
    const A = val(a), B = val(b);
    if (col === "default") { for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return A[i] < B[i] ? -1 : 1; return 0; }
    if (A === B) return 0;
    const asc = ["low", "per", "name"].includes(col) || D.storeName[col] ? 1 : -1;
    return (A < B ? -1 : 1) * asc * (dir === -1 ? 1 : -1);
  });
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

function renderTable(rows, { showPacks }) {
  if (!rows.length) {
    $("#view").innerHTML = `<div class="wrap"><p class="none">${D.prices.listings.length
      ? "Nothing matches. Try clearing the search or the In stock filter."
      : "No prices yet. They'll appear after the first check runs on GitHub."}</p></div>`;
    return;
  }
  const stores = D.stores;
  const th = (col, label, cls = "") => {
    const sorted = S.sort.col === col ? ` aria-sort="${S.sort.dir === -1 ? "ascending" : "descending"}"` : "";
    return `<th class="${cls}" data-col="${col}"${sorted}>${esc(label)}</th>`;
  };
  const head = `<tr>${th("year", "Year")}${th("name", showPacks ? "Product" : "Set", "namecol")}${
    showPacks ? th("packs", "Packs included") : ""}${
    stores.map((s) => th(s.id, s.name, "store")).join("")}${
    th("low", "Lowest")}<th>Cheapest at</th>${th("per", "Per pack")}</tr>`;
  const cols = stores.length + (showPacks ? 6 : 5);
  const body = rows.map((r) => {
    const cells = stores.map((s) => {
      const l = r.byStore[s.id];
      if (!l) return `<td class="store"><span class="empty-cell">–</span></td>`;
      const bg = l.available ? heat(l.price, r.prices) : null;
      const cls = !l.available ? "oos" : bg ? "" : "solo";
      return `<td class="store chip-cell"><a class="chip ${cls}" href="${esc(l.url)}" target="_blank" rel="noopener"
        title="${esc(l.title)}${l.available ? "" : " (sold out)"}${l.stale ? " · from last good check" : ""}"
        ${bg ? `style="background:${bg}"` : ""} onclick="event.stopPropagation()">${money(l.price)}</a></td>`;
    }).join("");
    const sub = r.needsContents ? `<span class="sub warn">Contents unknown</span>` :
      (!showPacks && r.packs ? `<span class="sub">${r.packs} pack${r.packs > 1 ? "s" : ""}</span>` : "");
    const row = `<tr class="row" data-key="${esc(r.key)}" tabindex="0" aria-expanded="${S.open.has(r.key)}">
      <td class="year">${r.year ?? ""}</td>
      <td class="namecol"><span class="name">${esc(r.name)}</span>${sub}</td>
      ${showPacks ? `<td>${esc(packsText(r))}</td>` : ""}
      ${cells}
      <td class="best">${money(r.low) || '<span class="per">Sold out</span>'}</td>
      <td>${esc(D.storeName[r.lowStore] ?? "")}</td>
      <td class="per">${r.perPack != null ? money(r.perPack) : ""}</td></tr>`;
    return row + (S.open.has(r.key) ? detailRow(r, cols) : "");
  }).join("");
  $("#view").innerHTML = `<div class="wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;

  $("#view").querySelectorAll("thead th[data-col]").forEach((h) => h.addEventListener("click", () => {
    const col = h.dataset.col;
    S.sort = S.sort.col === col ? { col, dir: -S.sort.dir } : { col, dir: -1 };
    render();
  }));
  $("#view").querySelectorAll("tr.row").forEach((tr) => {
    const toggle = () => { const k = tr.dataset.key; S.open.has(k) ? S.open.delete(k) : S.open.add(k); render(); };
    tr.addEventListener("click", toggle);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });
}

function detailRow(r, cols) {
  const list = r.listings.slice().sort((a, b) => (b.available - a.available) || a.price - b.price).map((l) => `
    <li><span><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(D.storeName[l.store])}</a>
      <span class="lt"> ${esc(l.title)}</span></span>
      <span>${money(l.price)} ${l.available ? "" : '<span class="per">sold out</span>'}</span></li>`).join("");
  const extras = r.contents?.extras?.length ? `<p class="note">Also includes: ${esc(r.contents.extras.join(", "))}</p>` : "";
  return `<tr class="detail"><td colspan="${cols}"><div class="detail-grid">
    <div><h3>Every listing</h3><ul class="listings">${list || "<li>No store lists this right now.</li>"}</ul>${extras}</div>
    <div><h3>Lowest price over time</h3>${spark(D.history[r.key])}</div></div></td></tr>`;
}

function spark(h) {
  if (!h || h.length < 2) return `<p class="note">The graph appears once there are prices from two different days.</p>`;
  const W = 320, H = 90, P = 14;
  const vals = h.map((p) => p[1]), lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i) => P + (i * (W - 2 * P)) / (h.length - 1);
  const y = (v) => hi === lo ? H / 2 : H - P - ((v - lo) * (H - 2 * P)) / (hi - lo);
  const d = h.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
  const last = h[h.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Lowest price from ${money(vals[0])} to ${money(last[1])}">
    <path d="${d}"/><circle cx="${x(h.length - 1)}" cy="${y(last[1])}" r="3.5"/>
    <text x="${P}" y="11">${money(hi)}</text><text x="${P}" y="${H - 1}">${money(lo)}</text>
    <text x="${W - P}" y="${H - 1}" text-anchor="end">${esc(last[0])}</text></svg>`;
}

// ---- Set search: which products contain packs from a set
function renderSearch() {
  const prev = $("#setq")?.value ?? "";
  $("#view").innerHTML = `<div class="panel">
      <label class="big-search"><span class="sr">Set name</span>
        <input id="setq" list="setlist" placeholder="Type a set, e.g. Evolving Skies" value="${esc(prev)}"></label>
      <datalist id="setlist">${D.sets.map((s) => `<option value="${esc(s.name)}">`).join("")}</datalist>
      <p class="note">Shows every product with packs from that set: loose packs, boxes, and collections listed in contents.json.</p>
    </div><div id="setres"></div>`;
  const run = () => {
    const name = D.sets.find((s) => s.name.toLowerCase() === $("#setq").value.trim().toLowerCase())?.name;
    if (!name) { $("#setres").innerHTML = ""; return; }
    const hits = D.rows.map((r) => {
      const fromContents = r.contents?.packs?.find((p) => p.set === name)?.qty;
      const qty = fromContents ?? (SET_TABS.includes(r.category) && r.set === name ? r.packs : null);
      return qty ? { r, qty } : null;
    }).filter(Boolean).sort((a, b) => (a.r.perPack ?? Infinity) - (b.r.perPack ?? Infinity));
    $("#setres").innerHTML = hits.length ? `<div class="wrap"><table><thead><tr>
        <th>Type</th><th class="namecol">Product</th><th>${esc(name)} packs</th><th>Total packs</th>
        <th>Lowest</th><th>Cheapest at</th><th>Per pack</th></tr></thead><tbody>${hits.map(({ r, qty }) => `
        <tr><td>${esc(D.catName[r.category])}</td><td class="namecol"><span class="name">${esc(r.name)}</span></td>
        <td>x${qty}</td><td>${r.packs ?? ""}</td><td class="best">${money(r.low) || '<span class="per">Sold out</span>'}</td>
        <td>${esc(D.storeName[r.lowStore] ?? "")}</td><td class="per">${r.perPack != null ? money(r.perPack) : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="wrap"><p class="none">No store has anything with ${esc(name)} packs right now.</p></div>`;
  };
  $("#setq").addEventListener("input", run);
  $("#setq").focus();
  run();
}

// ---- Products whose contents aren't known yet, ready to copy to Claude
function renderNeeds() {
  const rows = D.rows.filter((r) => r.needsContents).sort((a, b) => a.name.localeCompare(b.name));
  const text = rows.map((r) => `- ${r.name}`).join("\n");
  $("#view").innerHTML = `<div class="panel">
    <p class="note">These products are on sale, but it isn't known which packs are inside. Copy the list and ask Claude
    to look them up and add them to <code>data/contents.json</code>.</p>
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
    <th>Status</th><th>Products</th><th>Problem</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

init();
