"use strict";
// GengarFinder: Taylor's Gengar binder. Data lives in gengar/data/*.json, store prices come from Pack Watch (../data).

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => n == null ? "" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const REPO = location.hostname.endsWith(".github.io")
  ? `${location.hostname.split(".")[0]}/${location.pathname.split("/")[1]}`
  : "taylorleask-pixel/pokemon-price-tracker";

const VARIANT = {
  "H": "Holo", "RH": "Reverse Holo", "1st": "1st Edition", "U": "Unlimited", "UH": "Unlimited Holo", "CH": "Cosmos Holo",
  "PPS": "Play! Pokémon Stamp", "PPSH": "Play! Pokémon Stamp Holo", "GCS": "Gym Challenge Stamp", "JM": "World Championships deck",
  "SH": "Sheen Holo", "GS": "GameStop Stamp", "EGS": "EB Games Stamp", "SS": "Staff Stamp", "—": "Regular",
};
const NAME_STAMPS = [[/ Play! Pokemon( Stamp)?/i, "Play! Pokémon Stamp"], [/ Asia Stamp/i, "Asia Stamp"],
  [/ Pumpkin Pikachu Stamp/i, "Pumpkin Pikachu Stamp"], [/ 1999-2000 Red Logo/i, "1999-2000 print"]];
const VORDER = ["—", "U", "1st", "UH", "H", "RH", "CH", "SH", "PPS", "PPSH", "SS", "GCS", "GS", "EGS", "JM"];
const PALETTE = ["#5B3A8C", "#D6336C", "#8E6BC8", "#E58BAF", "#3F6FB0", "#2E9E78", "#C9932E", "#7A6E8F", "#B95BA8", "#4A9BC9"];
const CAT_NAME = { pack: "Booster pack", "blister-single": "Single blister", bundle: "Booster bundle", box: "Booster box",
  etb: "Elite Trainer Box", case: "Case", "blister-multi": "Blister", other: "Collection" };

const S = { tab: "binder", filter: "all", q: "", set: null, shopNeed: true, shopSort: "binder", picked: new Set() };
let D = {};

async function load(path) {
  try { const r = await fetch(`${path}?v=${Date.now()}`); return r.ok ? r.json() : null; } catch { return null; }
}

// ---------- setup
async function init() {
  const [cards, base, sources, collection, places, prices, singles, stores, contents, gstores, changes, ebay] = await Promise.all([
    load("data/cards.json"), load("data/cards_base.json"), load("data/sources.json"), load("data/collection.json"),
    load("data/places.json"), load("../data/prices.json"), load("data/singles.json"), load("../data/stores.json"),
    load("../data/contents.json"), load("data/stores.json"), load("data/changes.json"), load("data/ebay.json")]);
  const list = cards?.cards ?? base ?? [];
  D = { cards: list, updated: cards?.updated, sources: sources || {}, col: collection || { cards: {}, log: [] },
        places: places?.places || [], listings: prices?.listings || [], singles: singles?.listings || [],
        singlesUpdated: singles?.updated, report: singles?.report || {}, stores: gstores || [], changes: changes?.events || [],
        packStoreName: Object.fromEntries((stores || []).map((s) => [s.id, s.name])),
        storeName: Object.fromEntries((gstores || []).map((s) => [s.id, s.name])), contents: contents || {},
        ebay: ebay?.items || {}, ebayUpdated: ebay?.updated };
  for (const c of D.cards) decorate(c);
  D.cards.sort(binderOrder);
  D.byId = Object.fromEntries(D.cards.map((c) => [String(c.id), c]));
  D.setOrder = [...new Set(D.cards.map((c) => c.set))];
  buildSealedIndex();

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
  window.addEventListener("hashchange", route);
  $("#newcard").addEventListener("click", () => openSheet());
  setupSheet();
  route();
}

function decorate(c) {
  let name = c.name, stamp = null;
  for (const [re, label] of NAME_STAMPS) if (re.test(name)) { name = name.replace(re, ""); stamp = label; }
  c.display = name.trim();
  c.vlabel = stamp && (c.variant === "—" || !VARIANT[c.variant]) ? stamp : (VARIANT[c.variant] ?? c.variant);
  if (stamp && c.variant !== "—" && VARIANT[c.variant] && !c.vlabel.includes("Stamp")) c.vlabel = `${stamp}, ${c.vlabel}`;
  const stampish = /stamp|staff|championships|sheen|cosmos/i.test(c.vlabel) || ["JM", "SH", "CH"].includes(c.variant);
  c.vclass = c.variant === "RH" ? "rh" : c.variant === "1st" ? "first" : stampish ? "stamp" : ["—", "U"].includes(c.variant) ? "plain" : "";
  c.flag = stampish ? c.vlabel : null;               // the picture shows the normal card, so say which version it is
  c.src = D.sources?.[c.id] ?? { label: c.set, detail: "" };
  const m = String(c.number).match(/^([A-Z]*)(\d+)/i);
  c.numSort = m ? [m[1] || "", +m[2]] : [c.number, 0];
}

function binderOrder(a, b) {
  return a.date.localeCompare(b.date) || a.set.localeCompare(b.set) || a.numSort[0].localeCompare(b.numSort[0]) ||
    a.numSort[1] - b.numSort[1] || VORDER.indexOf(a.variant) - VORDER.indexOf(b.variant) || a.id - b.id;
}

// ---------- ownership (saved collection + requests just sent from this phone)
function pending() {
  try {
    const p = JSON.parse(localStorage.getItem("gf-pending") || "[]");
    const fresh = p.filter((x) => Date.now() - x.at < 30 * 60 * 1000);
    if (fresh.length !== p.length) localStorage.setItem("gf-pending", JSON.stringify(fresh));
    return fresh;
  } catch { return []; }
}
function ownInfo(id) {
  id = String(id);
  const p = pending().filter((x) => x.ids.map(String).includes(id)).pop();
  if (p?.action === "remove") return null;
  if (D.col.cards[id]) return { ...D.col.cards[id], saved: true };
  if (p) return { date: p.date, where: p.where, paid: p.paid, saved: false };
  return null;
}
const owned = (c) => !!ownInfo(c.id);

// ---------- prices
function singlesFor(c) {
  // cheapest first, in-stock first; one row per store and condition
  return D.singles.filter((x) => x.card === c.id).sort((a, b) => (b.available - a.available) || a.price - b.price);
}
// cheapest store price: in stock if possible, otherwise the last price a store asked
function storeValue(c) {
  const s = singlesFor(c);
  return s.find((x) => x.available) || s[0] || null;
}
// cheapest eBay Buy It Now listing (Australian sellers, no auctions), checked with the stores
const ebayFor = (c) => D.ebay[c.id] || null;
const ebayBest = (c) => ebayFor(c)?.low?.[0] || null;
const postage = (x) => x.ship == null ? "postage not listed" : x.ship === 0 ? "free postage" : `+ ${money(x.ship)} postage`;
function worth(c) {
  return c.market_aud ?? storeValue(c)?.price ?? null;
}
function ebayQuery(c) {
  const extra = { RH: "reverse holo", "1st": "1st edition", CH: "cosmos holo", SS: "staff", JM: "world championship" }[c.variant] ??
    (c.vclass === "stamp" ? "stamp" : "");
  return `pokemon ${c.display} ${c.set.replace(/ Trainer Gallery|: Classic Collection/, "")} ${String(c.number).split("/")[0]} ${extra}`.replace(/\s+/g, " ").trim();
}
const ebayUrl = (c, sold) => "https://www.ebay.com.au/sch/i.html?" + new URLSearchParams({ _nkw: ebayQuery(c), ...(sold ? { LH_Sold: 1, LH_Complete: 1 } : {}) });

// sealed products (from Pack Watch) that contain packs of a set
function buildSealedIndex() {
  const rows = {};
  for (const l of D.listings) {
    const r = rows[l.key] ??= { key: l.key, category: l.category, set: l.set, product: l.product, lang: l.lang || "EN", title: l.title, variant: l.variant, best: null, any: l };
    if (l.available && l.price != null && (!r.best || l.price < r.best.price)) r.best = l;
  }
  D.sealed = Object.values(rows).filter((r) => r.lang === "EN");
}
function sealedFor(set) {
  if (!set) return [];
  return D.sealed.map((r) => {
    const c = r.product ? D.contents[r.product] : null;
    const fromContents = c?.packs?.find((p) => p.set === set)?.qty;
    const direct = ["pack", "blister-single", "bundle", "box", "etb"].includes(r.category) && r.set === set;
    if (!fromContents && !direct) return null;
    return { r, name: r.product && !c?.separate_rows ? r.product : direct ? `${set}${r.variant ? ` ${r.variant}` : ""} ${CAT_NAME[r.category]}` : r.title };
  }).filter(Boolean).sort((a, b) => (!!b.r.best - !!a.r.best) || (a.r.best?.price ?? 1e9) - (b.r.best?.price ?? 1e9)).slice(0, 8);
}

// a picture that won't load becomes a name placeholder
function imgFail(img) {
  const ph = document.createElement("div");
  ph.className = "ph";
  ph.textContent = img.dataset.ph || "";
  img.replaceWith(ph);
}
window.imgFail = imgFail;

// ---------- routing
function go(hash) { location.hash = hash; }
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith("c=")) return renderCard(h.slice(2));
  S.tab = ["binder", "shop", "changes", "sets", "spending"].includes(h) ? h : "binder";
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === S.tab));
  renderProgress();
  ({ binder: renderBinder, shop: renderShop, changes: renderChanges, sets: renderSets, spending: renderSpending })[S.tab]();
}

function renderProgress() {
  const have = D.cards.filter(owned).length, total = D.cards.length, pct = total ? Math.round((have / total) * 100) : 0;
  $("#have").textContent = have;
  $("#total").textContent = total;
  $("#pct").textContent = `${pct}% done${have < total ? `, ${total - have} to go` : ". Master set complete!"}`;
  $("#pfill").style.width = `${(have / Math.max(total, 1)) * 100}%`;
  $("#pbar").setAttribute("aria-valuenow", pct);
}

// ---------- binder
function pocket(c) {
  const own = ownInfo(c.id);
  return `<button class="pocket ${own ? "have" : "need"}${own && !own.saved ? " pending" : ""}" data-id="${c.id}"
      aria-label="${esc(`${c.display}, ${c.set} ${c.number}, ${c.vlabel}. ${own ? "Have it" : "Need it"}`)}">
    <div class="art">${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" data-ph="${esc(c.display)}" onerror="imgFail(this)">`
      : `<div class="ph">${esc(c.display)}<br>${esc(c.set)}</div>`}
      ${own ? `<span class="have-dot" title="${own.saved ? "In your collection" : "Saving…"}">${own.saved ? "✓" : "…"}</span>` : ""}
      ${c.flag ? `<span class="stampflag">${esc(c.flag)}</span>` : ""}</div>
    <span class="pname">${esc(c.display)}</span>
    <span class="vchip ${c.vclass}">${esc(c.vlabel)}</span>
    <span class="pset">${esc(c.src.label)} · #${esc(c.number)}</span>
  </button>`;
}
function visibleCards() {
  const q = S.q.trim().toLowerCase();
  return D.cards.filter((c) => (S.filter === "all" || (S.filter === "have") === owned(c)) &&
    (!S.set || c.set === S.set) &&
    (!q || `${c.display} ${c.set} ${c.number} ${c.vlabel} ${c.src.label} ${c.id}`.toLowerCase().includes(q)));
}
function renderBinder() {
  const list = visibleCards();
  const pages = [];
  for (let i = 0; i < list.length; i += 9) pages.push(list.slice(i, i + 9));
  $("#view").innerHTML = `<div class="bar">
      <div class="seg" role="group" aria-label="Show">${[["all", "All"], ["have", "Have"], ["need", "Need"]].map(([v, l]) =>
        `<button data-f="${v}" aria-pressed="${S.filter === v}">${l}</button>`).join("")}</div>
      <input class="search" id="q" type="search" placeholder="Search cards" value="${esc(S.q)}" aria-label="Search cards">
      ${S.set ? `<button class="chip-filter" id="clearset" aria-label="Show all sets">${esc(S.set)} <span aria-hidden="true">×</span></button>` : ""}
      <span class="count">${list.length} card${list.length === 1 ? "" : "s"}</span>
    </div>
    ${pages.length ? `<div class="pages">${pages.map((p, i) => `<section class="page" aria-label="Page ${i + 1}">
      <div class="grid9">${p.map(pocket).join("")}</div><div class="pno">Page ${i + 1}</div></section>`).join("")}</div>`
      : `<p class="none">${S.filter === "have" ? "No cards here yet. Tap New card when you get one." : "Nothing matches."}</p>`}`;
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { S.filter = b.dataset.f; renderBinder(); }));
  $("#q").addEventListener("input", (e) => { S.q = e.target.value; const pos = e.target.selectionStart; renderBinder(); const q = $("#q"); q.focus(); q.setSelectionRange(pos, pos); });
  $("#clearset")?.addEventListener("click", () => { S.set = null; renderBinder(); });
  document.querySelectorAll(".pocket").forEach((b) => b.addEventListener("click", () => go(`c=${b.dataset.id}`)));
}

// ---------- card page
function renderCard(id) {
  const c = D.byId[id];
  document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", "false"));
  renderProgress();
  if (!c) { $("#view").innerHTML = `<p class="none">That card isn't in the list.</p>`; return; }
  const own = ownInfo(c.id), singles = singlesFor(c), w = worth(c);
  const diff = own?.paid != null && w != null ? w - own.paid : null;
  const sealed = c.src.pack_set ? sealedFor(c.src.pack_set) : [];
  $("#view").innerHTML = `<button class="back" id="back">← Binder</button>
  <article class="cardpage ${own ? "have" : "need"}">
    <div class="bigart"><div class="art">${c.image_large || c.image ? `<img src="${esc(c.image_large || c.image)}" alt="${esc(c.display)}">`
      : `<div class="ph">No picture for this one yet</div>`}${c.flag ? `<span class="stampflag">${esc(c.flag)} (picture shows the normal card)</span>` : ""}</div></div>
    <div>
      <p class="kicker">#${c.id} in your list · ${esc(c.set)} · ${esc(c.approx_date ? c.date_text : c.date_text)}</p>
      <h2>${esc(c.display)}</h2>
      <span class="vchip ${c.vclass}">${esc(c.vlabel)}</span> <span class="kicker">#${esc(c.number)}${c.rarity ? ` · ${esc(c.rarity)}` : ""}</span>
      <div><span class="status ${own ? "have" : "need"}">${own ? (own.saved ? "✓ In your binder" : "… Saving to your binder") : "Still need it"}</span></div>

      ${own ? `<section class="panel"><h3>Your copy</h3><dl class="facts">
          <div><dt>Got it from</dt><dd>${esc(own.where || "Unknown")}</dd></div>
          <div><dt>Paid</dt><dd>${own.paid != null ? money(own.paid) : "Not recorded"}</dd></div>
          <div><dt>Worth now</dt><dd>${w != null ? money(w) : "Unknown"}</dd></div>
          ${diff != null ? `<div><dt>Paid vs worth</dt><dd class="${diff >= 0 ? "up" : "down"}">${diff >= 0 ? "+" : "−"}${money(Math.abs(diff))}</dd></div>` : ""}
          <div><dt>Date</dt><dd>${esc(own.date || "")}</dd></div></dl>
          <div class="links"><button class="btn ghost" id="remove" type="button">Remove from collection</button></div></section>`
        : `<div class="links" style="margin:0 0 16px"><button class="btn" id="gotit" type="button">I got this one</button></div>`}

      <section class="panel"><h3>What it's worth</h3>
        ${c.market_aud != null ? `<p class="big">${money(c.market_aud)}</p><p class="note">Market price from ${esc(c.market_basis?.startsWith("Cardmarket") ? "Cardmarket (Europe)" : "TCGplayer (US)")}, in AUD. Checked ${esc(when(D.updated))}.</p>`
          : storeValue(c) ? `<p class="big">${money(storeValue(c).price)}</p><p class="note">Cheapest price at your stores (${esc(D.storeName[storeValue(c).store] ?? storeValue(c).store)}${storeValue(c).available ? "" : ", sold out"}). There's no market price for this exact version, so this is used for "worth now".</p>`
          : `<p class="note">No market price for this exact version${c.vclass === "stamp" ? " (stamped and special versions usually don't have one)" : ""}, and none of your stores list it. Check recent eBay sales below.</p>`}
        <div class="links">
          <a class="btn ghost" href="${esc(ebayUrl(c, true))}" target="_blank" rel="noopener">Recently sold on eBay</a>
          <a class="btn ghost" href="${esc(ebayUrl(c, false))}" target="_blank" rel="noopener">For sale on eBay</a>
          ${c.tcgplayer_url ? `<a class="btn ghost" href="${esc(c.tcgplayer_url)}" target="_blank" rel="noopener">TCGplayer</a>` : ""}
        </div></section>

      ${otherVersions(c)}
      <section class="panel"><h3>At stores</h3>
        ${singles.length ? `<ul class="list">${singles.map((s) => `<li><span><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(D.storeName[s.store] ?? s.store)}</a>
            <span class="sub">${esc([s.condition, s.title].filter(Boolean).join(" · "))}</span></span><span class="price ${s.available ? "" : "soldout"}">${money(s.price)}</span></li>`).join("")}</ul>
          <p class="note">Checked ${esc(when(D.singlesUpdated))}.</p>`
          : `<p class="note">None of your singles stores list this card right now.</p>`}
        <h4 class="subhead">eBay Buy It Now</h4>
        ${ebayFor(c)?.low?.length ? `<ul class="list">${ebayFor(c).low.map((x) => `<li><span><a href="${esc(x.url)}" target="_blank" rel="noopener">eBay</a>
            <span class="sub">${esc([x.cond, x.title].filter(Boolean).join(" · "))}</span></span>
            <span class="price">${money(x.price)}<span class="sub">${esc(postage(x))}</span></span></li>`).join("")}</ul>`
          : `<p class="note">${D.ebayUpdated ? "No Buy It Now listings from Australian sellers right now." : "eBay prices haven't been checked yet."}</p>`}
        <p class="note">Australian sellers only, no auctions, cheapest with postage first${D.ebayUpdated ? `. Checked ${esc(when(D.ebayUpdated))}` : ""}.
          <a href="${esc(ebayFor(c)?.url || ebayUrl(c, false))}" target="_blank" rel="noopener">See all on eBay</a></p></section>

      <section class="panel"><h3>Where it comes from</h3>
        <p><b>${esc(c.src.label)}</b>${c.src.confirmed === false ? " <span class='note'>(not confirmed)</span>" : ""}</p>
        <p class="note">${esc(c.src.detail)}</p>
        ${sealed.length ? `<ul class="list">${sealed.map(({ r, name }) => `<li><span><a href="../#p=${encodeURIComponent(r.key)}">${esc(name)}</a>
            <span class="sub">${esc(CAT_NAME[r.category] ?? "")}${r.best ? ` · cheapest at ${esc(D.packStoreName[r.best.store] ?? r.best.store)}` : ""}</span></span>
            <span class="price ${r.best ? "" : "soldout"}">${r.best ? money(r.best.price) : "Sold out"}</span></li>`).join("")}</ul>
            <p class="note">Sealed prices from Pack Watch.</p>`
          : c.src.kind === "pack" ? `<p class="note">No tracked store has sealed ${esc(c.src.pack_set)} product right now.</p>` : ""}
      </section>
    </div>
  </article>`;
  $("#back").addEventListener("click", () => (history.length > 1 ? history.back() : go("binder")));
  $("#gotit")?.addEventListener("click", () => openSheet([c.id]));
  $("#remove")?.addEventListener("click", () => {
    if (!window.confirm(`Remove ${c.display} (${c.vlabel}) from your collection? This opens a request on GitHub.`)) return;
    sendRequest({ ids: [c.id], action: "remove" });
  });
  window.scrollTo(0, 0);
}
function when(iso) {
  if (!iso) return "recently";
  return new Date(iso).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

// other cards in your list with the same name in the same set (holo / reverse / stamped, other numbers)
function otherVersions(c) {
  const sib = D.cards.filter((x) => x.id !== c.id && x.set === c.set && x.display === c.display);
  if (!sib.length) return "";
  return `<section class="panel"><h3>Other versions</h3><ul class="list">${sib.map((x) => {
    const best = singlesFor(x).find((s) => s.available);
    return `<li><span><a href="#c=${x.id}">${esc(x.display)} #${esc(x.number)}</a> <span class="vchip ${x.vclass}">${esc(x.vlabel)}</span>
      <span class="sub">${owned(x) ? "In your binder" : "Still need it"}${best ? ` · cheapest at ${esc(D.storeName[best.store] ?? best.store)}` : ""}</span></span>
      <span class="price">${best ? money(best.price) : "<span class='note'>Not at your stores</span>"}</span></li>`;
  }).join("")}</ul></section>`;
}

// ---------- shop list
function renderShop() {
  let list = D.cards.filter((c) => !S.shopNeed || !owned(c));
  if (S.shopSort !== "binder") list = list.slice().sort((a, b) => ((worth(a) ?? -1) - (worth(b) ?? -1)) * (S.shopSort === "low" ? 1 : -1));
  const storeIds = D.stores.map((s) => s.id);
  const rows = list.map((c) => {
    const s = singlesFor(c), best = s.find((x) => x.available);
    let e;
    return `<tr class="row ${owned(c) ? "have" : "need"}" data-id="${c.id}" tabindex="0">
      <td><div class="cname">${c.image ? `<img class="thumb" src="${esc(c.image)}" alt="" loading="lazy">` : `<span class="thumb"></span>`}
        <div><b>${esc(c.display)}</b><span>${esc(c.set)} #${esc(c.number)}</span></div></div></td>
      <td><span class="vchip ${c.vclass}">${esc(c.vlabel)}</span></td>
      <td>${owned(c) ? "<b class='up'>Have</b>" : "Need"}</td>
      <td class="price">${c.market_aud != null ? money(c.market_aud) : "<span class='note'>–</span>"}</td>
      <td>${best ? `<span class="price">${money(best.price)}</span><br><span class="note">${esc(D.storeName[best.store] ?? best.store)}</span>` : "<span class='note'>–</span>"}</td>
      ${storeIds.map((id) => { const x = s.find((y) => y.store === id && y.available) || s.find((y) => y.store === id); return `<td>${x ? `<span class="price ${x.available ? "" : "soldout"}">${money(x.price)}</span>` : "<span class='note'>–</span>"}</td>`; }).join("")}
      <td>${(e = ebayBest(c)) ? `<a class="price" href="${esc(e.url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${money(e.price)}</a><br><span class="note">${esc(postage(e))}</span><br>` : ""}<a class="note" href="${esc(ebayUrl(c, true))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Sold</a></td></tr>`;
  }).join("");
  $("#view").innerHTML = `<div class="bar">
      <div class="seg" role="group" aria-label="Show"><button data-n="1" aria-pressed="${S.shopNeed}">Cards I need</button><button data-n="0" aria-pressed="${!S.shopNeed}">All cards</button></div>
      <label class="count">Sort <select id="ssort" class="search" style="max-width:200px">
        <option value="binder">Binder order</option><option value="high">Highest value first</option><option value="low">Cheapest first</option></select></label>
      <span class="count">${list.length} cards</span></div>
    <div class="wrap"><table><thead><tr><th>Card</th><th>Type</th><th>Status</th><th>Market value</th><th>Cheapest store</th>
      ${storeIds.map((id) => `<th>${esc(D.storeName[id] ?? id)}</th>`).join("")}<th>eBay Buy It Now</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Store prices are the cheapest condition in stock at each store, checked ${esc(when(D.singlesUpdated))}. eBay is the cheapest Buy It Now listing from an Australian seller (no auctions). Market values are TCGplayer prices in AUD.</p>
    ${storesPanel()}`;
  setupStoreForm();
  $("#ssort").value = S.shopSort;
  $("#ssort").addEventListener("input", (e) => { S.shopSort = e.target.value; renderShop(); });
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { S.shopNeed = b.dataset.n === "1"; renderShop(); }));
  document.querySelectorAll("tr.row").forEach((tr) => {
    tr.addEventListener("click", () => go(`c=${tr.dataset.id}`));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(`c=${tr.dataset.id}`); });
  });
}

// ---------- singles stores (shown under the shop list)
function storesPanel() {
  return `<section class="panel" style="margin-top:18px"><h3>Singles stores</h3>
    <ul class="list">${D.stores.map((st) => { const r = D.report[st.id] || {};
      return `<li><span><a href="${esc(st.url)}" target="_blank" rel="noopener">${esc(st.name)}</a>
        <span class="sub">${r.ok === false ? `Problem last check: ${esc(r.problem || "")}` : r.ok ? `${r.cards} of your cards listed` : "Not checked yet"}</span></span>
        <span class="note">${r.checked ? esc(when(r.checked)) : ""}</span></li>`; }).join("")}</ul>
    <form id="addstore" class="addstore">
      <h3 style="margin-top:16px">Add a store</h3>
      <p class="note">Works for Shopify shops, which is most card shops. This opens a request on GitHub: tap <b>Create</b>, and a few
      minutes later the reply says whether it was added and which of your cards it has. It's also added to "Where you got it".</p>
      <div class="row2">
        <label class="fld">Store name<input id="as-name" required autocomplete="off"></label>
        <label class="fld">Link to their Pokémon singles<input id="as-url" type="url" required placeholder="https://"></label>
      </div>
      <button class="btn" type="submit" style="margin-top:10px">Add store</button>
    </form></section>`;
}
function setupStoreForm() {
  $("#addstore")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("#as-name").value.trim(), url = $("#as-url").value.trim();
    const q = new URLSearchParams({ template: "gengar-store.yml", title: `Gengar store: ${name}`, store_name: name, store_url: url });
    window.open(`https://github.com/${REPO}/issues/new?${q}`, "_blank", "noopener");
  });
}

// ---------- what changed
const CHANGE = { new: ["Newly listed", "up"], "in-stock": ["Back in stock", "up"], "sold-out": ["Sold out", "down"],
  "price-down": ["Price down", "up"], "price-up": ["Price up", "down"], removed: ["No longer listed", "down"] };
function renderChanges() {
  const types = S.ctype ?? "all", onlyNeed = S.cneed ?? false;
  const ev = D.changes.filter((e) => D.byId[e.card] && (types === "all" || (types === "new" ? ["new", "in-stock"].includes(e.type) : e.type.startsWith(types)))
    && (!onlyNeed || !owned(D.byId[e.card])));
  const days = {};
  for (const e of ev) (days[e.time.slice(0, 10)] ??= []).push(e);
  $("#view").innerHTML = `<div class="bar">
      <div class="seg" role="group" aria-label="Show">${[["all", "Everything"], ["new", "New & restocked"], ["price", "Price changes"], ["sold", "Sold out"]].map(([v, l]) =>
        `<button data-t="${v}" aria-pressed="${types === v}">${l}</button>`).join("")}</div>
      <label class="count"><input type="checkbox" id="cneed" ${onlyNeed ? "checked" : ""}> Only cards I need</label></div>
    ${Object.keys(days).length ? Object.entries(days).map(([day, list]) => `<section class="panel"><h3>${esc(new Date(day + "T00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }))}</h3>
      <ul class="list">${list.map((e) => { const c = D.byId[e.card], [label, cls] = CHANGE[e.type] ?? [e.type, ""];
        return `<li><span><a href="#c=${c.id}">${esc(c.display)}</a> <span class="vchip ${c.vclass}">${esc(c.vlabel)}</span>${owned(c) ? "" : " <span class='note'>(need)</span>"}
          <span class="sub">${esc(c.set)} #${esc(c.number)} · <a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(D.storeName[e.store] ?? e.store)}</a>${e.condition ? ` · ${esc(e.condition)}` : ""} · ${esc(new Date(e.time).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" }))}</span></span>
          <span class="price"><span class="${cls}">${label}</span><span class="sub">${e.old != null ? `${money(e.old)} → ` : ""}${money(e.price)}</span></span></li>`; }).join("")}</ul></section>`).join("")
      : `<p class="none">No changes yet. After each check (about 7am, 1pm and 7pm), anything new, restocked, sold out or repriced shows here.</p>`}`;
  document.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => { S.ctype = b.dataset.t; renderChanges(); }));
  $("#cneed").addEventListener("change", (e) => { S.cneed = e.target.checked; renderChanges(); });
}

// ---------- sets
function renderSets() {
  const groups = D.setOrder.map((set) => {
    const cs = D.cards.filter((c) => c.set === set);
    return { set, year: cs[0].date.slice(0, 4), n: cs.length, have: cs.filter(owned).length, names: [...new Set(cs.map((c) => c.display))] };
  });
  const draw = () => {
    const q = ($("#setq")?.value || "").trim().toLowerCase();
    const rows = groups.filter((g) => !q || `${g.set} ${g.year} ${g.names.join(" ")}`.toLowerCase().includes(q));
    $("#setrows").innerHTML = rows.map((g) => `<tr class="row" data-set="${esc(g.set)}" tabindex="0">
      <td>${g.year}</td><td><b>${esc(g.set)}</b><br><span class="note">${esc(g.names.join(", "))}</span></td>
      <td>${g.n}</td><td><span class="mini"><i style="width:${(g.have / g.n) * 100}%"></i></span>${g.have}/${g.n}</td></tr>`).join("")
      || `<tr><td colspan="4" class="none">No set matches.</td></tr>`;
    document.querySelectorAll("#setrows tr.row").forEach((tr) => {
      const open = () => { S.set = tr.dataset.set; S.filter = "all"; S.q = ""; go("binder"); };
      tr.addEventListener("click", open);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
    });
  };
  $("#view").innerHTML = `<div class="bar"><input class="search" id="setq" type="search" placeholder="Search sets" aria-label="Search sets">
      <span class="count">${groups.length} sets with Gengar cards</span></div>
    <div class="wrap"><table><thead><tr><th>Year</th><th>Set</th><th>Gengars</th><th>You have</th></tr></thead><tbody id="setrows"></tbody></table></div>`;
  $("#setq").addEventListener("input", draw);
  draw();
}

// ---------- spending
function renderSpending() {
  const mine = D.cards.filter(owned).map((c) => ({ c, o: ownInfo(c.id), w: worth(c) }));
  const paid = mine.reduce((a, x) => a + (x.o.paid ?? 0), 0);
  const withBoth = mine.filter((x) => x.o.paid != null && x.w != null);
  const worthNow = mine.reduce((a, x) => a + (x.w ?? 0), 0);
  const gain = withBoth.reduce((a, x) => a + x.w - x.o.paid, 0);
  const byPlace = {};
  for (const x of mine) {
    const p = byPlace[x.o.where || "Unknown"] ??= { n: 0, paid: 0 };
    p.n++; p.paid += x.o.paid ?? 0;
  }
  const places = Object.entries(byPlace).sort((a, b) => b[1].n - a[1].n);
  const color = (i) => PALETTE[i % PALETTE.length];
  const recent = mine.slice().sort((a, b) => (b.o.date || "").localeCompare(a.o.date || "")).slice(0, 12);
  $("#view").innerHTML = `<dl class="stats">
      <div class="stat"><dt>Cards you have</dt><dd>${mine.length}</dd></div>
      <div class="stat"><dt>Total paid</dt><dd>${money(paid)}</dd></div>
      <div class="stat"><dt>Worth now</dt><dd>${money(worthNow)}</dd></div>
      <div class="stat"><dt>Paid vs worth</dt><dd class="${gain >= 0 ? "up" : "down"}">${withBoth.length ? `${gain >= 0 ? "+" : "−"}${money(Math.abs(gain))}` : "–"}</dd></div>
    </dl>
    <section class="panel"><h3>Where your cards came from</h3>
      ${places.length ? `<div class="stack" role="img" aria-label="${esc(places.map(([p, v]) => `${p} ${Math.round((v.n / mine.length) * 100)}%`).join(", "))}">
          ${places.map(([p, v], i) => `<i style="width:${(v.n / mine.length) * 100}%;background:${color(i)}" title="${esc(p)}"></i>`).join("")}</div>
        <ul class="list legend">${places.map(([p, v], i) => `<li><span><span class="sw" style="background:${color(i)}"></span>${esc(p)}</span>
          <span><b>${Math.round((v.n / mine.length) * 100)}%</b> <span class="note">· ${v.n} card${v.n === 1 ? "" : "s"} · ${money(v.paid)}</span></span></li>`).join("")}</ul>`
        : `<p class="note">Nothing yet. Each card you add with New card shows up here.</p>`}
    </section>
    <section class="panel"><h3>Recently added</h3>
      ${recent.length ? `<ul class="list">${recent.map(({ c, o, w }) => `<li><span><a href="#c=${c.id}">${esc(c.display)}</a> <span class="vchip ${c.vclass}">${esc(c.vlabel)}</span>
          <span class="sub">${esc(c.set)} · ${esc(o.where || "Unknown")} · ${esc(o.date || "")}</span></span>
          <span class="price">${o.paid != null ? money(o.paid) : ""}${w != null && o.paid != null ? `<span class="sub ${w - o.paid >= 0 ? "up" : "down"}">worth ${money(w)}</span>` : ""}</span></li>`).join("")}</ul>`
        : `<p class="note">No cards yet.</p>`}</section>
    <p class="note">Worth now uses market prices where there is one, otherwise the cheapest store price. Paid vs worth only counts cards with both a price paid and a value.</p>`;
}

// ---------- new card sheet
function setupSheet() {
  const sheet = $("#sheet");
  $("#sheet-close").addEventListener("click", () => sheet.close());
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  $("#nf-search").addEventListener("input", drawPicklist);
  $("#nf-where").addEventListener("input", () => { $("#nf-other-wrap").hidden = $("#nf-where").value !== "__other"; checkSave(); });
  $("#nf-other").addEventListener("input", checkSave);
  $("#nf-save").addEventListener("click", () => {
    const where = $("#nf-where").value === "__other" ? $("#nf-other").value.trim() : $("#nf-where").value;
    const paidTxt = $("#nf-paid").value.replace(/[^\d.]/g, "");
    sendRequest({ ids: [...S.picked], action: "add", where, paid: paidTxt ? +paidTxt : null, date: $("#nf-date").value });
    sheet.close();
  });
}
function openSheet(ids = []) {
  S.picked = new Set(ids.map(Number));
  $("#nf-search").value = "";
  const last = (() => { try { return localStorage.getItem("gf-last-where"); } catch { return null; } })();
  $("#nf-where").innerHTML = `<option value="">Pick one</option>` + D.places.map((p) => `<option>${esc(p)}</option>`).join("") +
    `<option value="__other">Other…</option>`;
  if (last && D.places.includes(last)) $("#nf-where").value = last;
  $("#nf-other").value = ""; $("#nf-other-wrap").hidden = true;
  $("#nf-paid").value = "";
  const d = new Date(); $("#nf-date").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  drawPicklist(); checkSave();
  $("#sheet").showModal();
  if (!ids.length) $("#nf-search").focus();
}
function drawPicklist() {
  const q = $("#nf-search").value.trim().toLowerCase();
  const list = D.cards.filter((c) => S.picked.has(c.id) || !q || `${c.id} ${c.display} ${c.set} ${c.number} ${c.vlabel}`.toLowerCase().includes(q))
    .sort((a, b) => (S.picked.has(b.id) - S.picked.has(a.id)) || (owned(a) - owned(b)));
  $("#nf-list").innerHTML = list.map((c) => `<label class="pick"><input type="checkbox" value="${c.id}" ${S.picked.has(c.id) ? "checked" : ""}>
      ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : `<span class="noimg"></span>`}
      <span class="t">${esc(c.display)} <span>${esc(c.set)} #${esc(c.number)} · ${esc(c.vlabel)}</span></span>
      ${owned(c) ? `<span class="owned">Have</span>` : ""}</label>`).join("");
  $("#nf-list").querySelectorAll("input").forEach((i) => i.addEventListener("change", () => {
    i.checked ? S.picked.add(+i.value) : S.picked.delete(+i.value); checkSave();
  }));
  checkSave();
}
function checkSave() {
  const n = S.picked.size;
  const names = [...S.picked].map((id) => D.byId[id]).filter(Boolean).map((c) => `${c.display} (${c.vlabel})`);
  $("#nf-picked").textContent = n ? `Picked: ${names.slice(0, 3).join(", ")}${n > 3 ? ` and ${n - 3} more` : ""}` : "No card picked yet";
  const whereOK = $("#nf-where").value && ($("#nf-where").value !== "__other" || $("#nf-other").value.trim());
  $("#nf-save").disabled = !(n && whereOK);
  $("#nf-save").textContent = n > 1 ? `Save ${n} cards to collection` : "Save to collection";
}
function sendRequest({ ids, action, where = "", paid = null, date = "" }) {
  const first = D.byId[ids[0]];
  const title = action === "remove" ? `Gengar: remove #${ids.join(", #")}` :
    `Gengar: ${ids.length > 1 ? `${ids.length} cards` : `${first.display} (${first.vlabel})`} from ${where}`;
  const q = new URLSearchParams({ template: "gengar-card.yml", title, cards: ids.join(", "), where, paid: paid ?? "", date, action });
  try {
    const p = pending(); p.push({ ids, action, where, paid, date, at: Date.now() });
    localStorage.setItem("gf-pending", JSON.stringify(p));
    if (where) localStorage.setItem("gf-last-where", where);
  } catch { /* private mode: the change still shows once GitHub saves it */ }
  window.open(`https://github.com/${REPO}/issues/new?${q}`, "_blank", "noopener");
  route();
}

init();
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));

// ---- home-screen apps stay open in the background: reload when coming back after a while
(() => {
  let shownAt = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - shownAt > 5 * 60 * 1000) location.reload();
    if (document.visibilityState === "visible") shownAt = Date.now();
  });
})();
