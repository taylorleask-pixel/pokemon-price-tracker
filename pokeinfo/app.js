"use strict";
// PokeInfo: master set binder for every Pokémon TCG set in English, Japanese, Korean and Chinese.
// Card lists come from data/<lang>/ (built weekly from TCGdex). Your collection is data/collection.json in the
// GitHub project, saved straight from the app with a GitHub key you add on each device (see the Sync sheet).

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const REPO = location.hostname.endsWith(".github.io")
  ? `${location.hostname.split(".")[0]}/${location.pathname.split("/")[1]}`
  : "taylorleask-pixel/pokemon-price-tracker";
const COL_PATH = "pokeinfo/data/collection.json";
const LANGS = [
  { id: "en", label: "EN", name: "English" },
  { id: "ja", label: "JP", name: "Japanese" },
  { id: "ko", label: "KR", name: "Korean" },
  { id: "zh-tw", label: "繁中", name: "Chinese (Traditional)" },
  { id: "zh-cn", label: "简中", name: "Chinese (Simplified)" },
];
const VNAME = { n: "Normal", h: "Holo", r: "Reverse holo", f: "1st edition" };
const VSHORT = { n: "N", h: "H", r: "R", f: "1st" };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

const S = { lang: store.get("pi-lang", "en"), q: "", show: "all", newest: true, type: null, own: "all", list: [] };
const D = { sets: {}, setFiles: {} };
let C = store.get("pi-col", { v: 1, cards: {} });        // last known collection (with my unsynced changes applied)
let queue = store.get("pi-queue", []);                    // changes not yet saved to GitHub: [{k, v}]

async function load(path) {
  try { const r = await fetch(`${path}${path.includes("?") ? "&" : "?"}v=${Date.now()}`); return r.ok ? r.json() : null; } catch { return null; }
}
const key = (lang, setId, cardId) => `${lang}|${setId}|${cardId}`;
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "";

// ---------------------------------------------------------------- collection + sync
const token = () => store.get("pi-token", "");
function applyQueue(base) {
  const out = { v: 1, cards: { ...(base?.cards || {}) } };
  for (const { k, v } of queue) { if (v) out.cards[k] = v; else delete out.cards[k]; }
  return out;
}
function setOwned(k, v) {
  queue.push({ k, v });
  if (v) C.cards[k] = v; else delete C.cards[k];
  store.set("pi-queue", queue); store.set("pi-col", C);
  scheduleSync();
}
const b64e = (s) => btoa(unescape(encodeURIComponent(s)));
const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));
async function gh(method, body) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${COL_PATH}`, {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function readRemote() {
  if (token()) {
    const r = await gh("GET");
    if (r.status === 404) return { data: { v: 1, cards: {} }, sha: null };
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("key"), { auth: true });
    if (!r.ok) throw new Error(`GitHub said ${r.status}`);
    const j = await r.json();
    return { data: JSON.parse(b64d(j.content)), sha: j.sha };
  }
  return { data: (await load("data/collection.json")) || { v: 1, cards: {} }, sha: null };
}
let syncTimer = null, syncing = false;
function scheduleSync(ms = 1800) {
  clearTimeout(syncTimer);
  if (!token()) return status(queue.length ? "local" : "local0");
  status("busy");
  syncTimer = setTimeout(sync, ms);
}
async function sync() {
  if (syncing) return scheduleSync(800);
  if (!token()) return status(queue.length ? "local" : "local0");
  syncing = true; status("busy");
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, sha } = await readRemote();
      const sent = queue.length;
      if (!sent) { C = data; store.set("pi-col", C); break; }
      const merged = applyQueue(data);
      merged.updated = new Date().toISOString();
      const r = await gh("PUT", { message: `PokeInfo: collection (${sent} change${sent === 1 ? "" : "s"})`,
        content: b64e(JSON.stringify(merged, null, 1)), ...(sha ? { sha } : {}) });
      if (r.status === 409 || r.status === 422) continue;          // saved from the other device meanwhile: read again
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error("key"), { auth: true });
      if (!r.ok) throw new Error(`GitHub said ${r.status}`);
      queue = queue.slice(sent);                                      // changes made while saving stay queued
      C = applyQueue(merged);
      store.set("pi-queue", queue); store.set("pi-col", C);
      if (!queue.length) break;
    }
    status(queue.length ? "busy" : "ok");
    if (queue.length) scheduleSync(500);
  } catch (e) {
    status(e.auth ? "auth" : "err");
  } finally { syncing = false; }
}
function status(s) {
  const el = $("#sync"); el.className = "sync";
  const txt = { ok: "Synced", busy: "Saving…", err: "Can't reach GitHub", auth: "GitHub key not accepted",
    local: "Saved on this device", local0: "Not synced" }[s];
  el.classList.add({ ok: "ok", busy: "busy", err: "err", auth: "err" }[s] || "off");
  $("#synctxt").textContent = txt;
  el.title = s === "local" ? "Changes are saved on this device. Connect GitHub to sync with your other devices." : txt;
}
async function refreshFromRemote() {
  try {
    const { data } = await readRemote();
    C = applyQueue(data); store.set("pi-col", C);
    if (token()) { if (queue.length) scheduleSync(300); else status("ok"); } else status(queue.length ? "local" : "local0");
    render();
  } catch (e) { status(e.auth ? "auth" : "err"); }
}
function ownedCounts(lang) {
  const by = {};
  let variants = 0;
  for (const [k, v] of Object.entries(C.cards)) {
    if (!k.startsWith(lang + "|")) continue;
    const setId = k.slice(lang.length + 1, k.indexOf("|", lang.length + 1));
    const o = by[setId] ??= { cards: 0, vars: 0 };
    o.cards++; o.vars += v.length; variants += v.length;
  }
  return by;
}

// ---------------------------------------------------------------- routing
function parseHash() {
  const [lang, kind, ...rest] = decodeURIComponent(location.hash.slice(1)).split("/");
  if (LANGS.some((l) => l.id === lang)) S.lang = lang;
  store.set("pi-lang", S.lang);
  return kind === "set" ? { view: "set", id: rest.join("/") } : { view: "home" };
}
function go(hash) { location.hash = hash; }
async function render() {
  const r = parseHash();
  $("#langs").innerHTML = LANGS.map((l) => `<button type="button" data-lang="${l.id}" aria-pressed="${l.id === S.lang}" title="${esc(l.name)}">${esc(l.label)}</button>`).join("");
  if (!D.sets[S.lang]) {
    $("#view").innerHTML = `<p class="loading">Loading ${esc(LANGS.find((l) => l.id === S.lang).name)} sets…</p>`;
    D.sets[S.lang] = (await load(`data/${S.lang}/sets.json`)) || { sets: [], missing: true };
  }
  if (r.view === "set") return renderSet(r.id);
  renderHome();
}

// ---------------------------------------------------------------- home: every set in the language
function renderHome() {
  const L = LANGS.find((l) => l.id === S.lang), data = D.sets[S.lang];
  if (data.missing) {
    $("#view").innerHTML = `<p class="none">The ${esc(L.name)} card list hasn't been built yet. It's made on GitHub once a week; check back soon.</p>`;
    return;
  }
  const own = ownedCounts(S.lang);
  const sets = data.sets.filter((s) => s.cards_n > 0);
  const hidden = data.sets.length - sets.length;
  const total = sets.reduce((a, s) => a + s.cards_n, 0);
  const have = sets.reduce((a, s) => a + (own[s.id]?.cards || 0), 0);
  const noPics = sets.reduce((a, s) => a + s.cards_n - s.img_n, 0);
  $("#view").innerHTML = `
    <section class="hero">
      <h1>${esc(L.name)} sets</h1>
      <div class="big">${have.toLocaleString()}<small> / ${total.toLocaleString()} cards</small></div>
      <div class="bar${have && have === total ? " done" : ""}"><i style="width:${total ? (have / total) * 100 : 0}%"></i></div>
      <p class="note">${sets.length} sets${hidden ? `. ${hidden} more are listed by the database without their cards yet, so they're hidden` : ""}${noPics ? `. ${Math.round(((total - noPics) / total) * 100)}% of cards have pictures in the card database; the rest show their number and name` : ""}.</p>
    </section>
    <div class="tools">
      <input class="search" id="q" type="search" placeholder="Search sets" value="${esc(S.q)}" aria-label="Search sets">
      <div class="seg" role="group" aria-label="Show">${[["all", "All"], ["started", "Started"], ["done", "Complete"]].map(([v, l]) =>
        `<button type="button" data-show="${v}" aria-pressed="${S.show === v}">${l}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Order">${[[true, "Newest"], [false, "Oldest"]].map(([v, l]) =>
        `<button type="button" data-newest="${v}" aria-pressed="${S.newest === v}">${l}</button>`).join("")}</div>
    </div>
    <div id="setlist"></div>`;
  const draw = () => {
    const q = S.q.trim().toLowerCase();
    let list = sets.filter((s) => (!q || `${s.name} ${s.serie} ${s.id} ${s.abbr || ""} ${(s.date || "").slice(0, 4)}`.toLowerCase().includes(q)) &&
      (S.show === "all" || (S.show === "started" ? own[s.id]?.cards : own[s.id]?.cards >= s.cards_n)));
    if (S.newest) list = list.slice().reverse();
    const eras = [];
    for (const s of list) {
      const e = eras[eras.length - 1];
      if (e && e.name === (s.serie || "Other")) e.sets.push(s); else eras.push({ name: s.serie || "Other", sets: [s] });
    }
    $("#setlist").innerHTML = eras.map((e) => `<div class="era"><h2>${esc(e.name)}</h2><span>${e.sets.length} set${e.sets.length === 1 ? "" : "s"}</span></div>
      <div class="sets">${e.sets.map((s) => {
        const h = own[s.id]?.cards || 0;
        return `<a class="set" href="#${S.lang}/set/${encodeURIComponent(s.id)}">
          <span class="logo">${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'abbr',textContent:this.dataset.a}))" data-a="${esc(s.abbr || s.id)}">`
            : `<span class="abbr">${esc(s.abbr || s.id)}</span>`}</span>
          <b>${esc(s.name)}</b>
          <span class="meta"><span>${esc(s.date ? s.date.slice(0, 4) : "")}</span><span><b>${h}</b>/${s.cards_n}</span></span>
          <span class="bar${h >= s.cards_n ? " done" : ""}"><i style="width:${(h / s.cards_n) * 100}%"></i></span></a>`;
      }).join("")}</div>`).join("") || `<p class="none">No sets match.</p>`;
  };
  $("#q").addEventListener("input", (e) => { S.q = e.target.value; draw(); });
  document.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => { S.show = b.dataset.show; renderHome(); }));
  document.querySelectorAll("[data-newest]").forEach((b) => b.addEventListener("click", () => { S.newest = b.dataset.newest === "true"; renderHome(); }));
  draw();
}

// ---------------------------------------------------------------- one set: the binder
const pic = (c, size = "low") => c.img ? `${c.img}/${size}.webp` : null;
function defaultVersion(c) { return ["n", "h", "f", "r"].find((v) => (c.v || "").includes(v)) || "n"; }
function versions(c) { return (c.v || "n").split("").sort((a, b) => "nhfr".indexOf(a) - "nhfr".indexOf(b)); }

async function renderSet(id) {
  const meta = D.sets[S.lang].sets.find((s) => s.id === id);
  const fk = `${S.lang}/${id}`;
  if (!D.setFiles[fk]) {
    $("#view").innerHTML = `<p class="loading">Opening ${esc(meta?.name || id)}…</p>`;
    D.setFiles[fk] = await load(`data/${S.lang}/sets/${encodeURIComponent(id)}.json`);
  }
  const set = D.setFiles[fk];
  if (!set || !meta) { $("#view").innerHTML = `<button class="back" id="back">← All sets</button><p class="none">That set isn't in the card list.</p>`; $("#back").onclick = () => go(S.lang); return; }
  if (S.setId !== id) { S.setId = id; S.type = null; S.own = "all"; }
  const cards = set.cards;
  const k = (c) => key(S.lang, id, c.id);
  const have = cards.filter((c) => C.cards[k(c)]).length;
  const varTotal = cards.reduce((a, c) => a + versions(c).length, 0);
  const varHave = cards.reduce((a, c) => a + (C.cards[k(c)] || "").length, 0);
  const types = {};
  for (const c of cards) { const t = c.r || "Unknown rarity"; (types[t] ??= { n: 0, have: 0 }).n++; if (C.cards[k(c)]) types[t].have++; }
  const rev = cards.filter((c) => (c.v || "").includes("r")).length;
  const typeList = Object.entries(types);
  const showTypes = typeList.length > 1 || typeList[0]?.[0] !== "Unknown rarity";
  const official = meta.official && meta.official !== cards.length ? ` (${meta.official} in the main set, the rest are secret rares)` : "";

  $("#view").innerHTML = `<button class="back" id="back">← All ${esc(LANGS.find((l) => l.id === S.lang).name)} sets</button>
    <div class="sethead">
      ${meta.logo ? `<img class="logo" src="${esc(meta.logo)}" alt="" onerror="this.remove()">` : ""}
      <h1>${esc(set.name || meta.name)}</h1>
      <p>${esc([meta.serie, fmtDate(meta.date), meta.abbr].filter(Boolean).join(" · "))}</p>
    </div>
    <div class="prog">
      <div><div class="lbl">Cards</div><div class="num">${have}<small> / ${cards.length}</small></div>
        <div class="bar${have === cards.length ? " done" : ""}"><i style="width:${(have / cards.length) * 100}%"></i></div></div>
      ${varTotal > cards.length ? `<div><div class="lbl">Master set (every version, e.g. reverse holos)</div><div class="num">${varHave}<small> / ${varTotal}</small></div>
        <div class="bar${varHave === varTotal ? " done" : ""}"><i style="width:${(varHave / varTotal) * 100}%"></i></div></div>` : ""}
    </div>
    <p class="note" style="margin-top:-4px">${cards.length} cards${esc(official)}${rev ? `. ${rev} also come as a reverse holo` : ""}.</p>
    ${showTypes ? `<ul class="types" aria-label="Filter by type">
      <li><button type="button" data-type="" aria-pressed="${!S.type}">All</button></li>
      ${typeList.map(([t, o]) => `<li><button type="button" data-type="${esc(t)}" aria-pressed="${S.type === t}"><b>${o.n}</b> ${esc(t)}${o.have ? ` · ${o.have} ✓` : ""}</button></li>`).join("")}
      ${rev ? `<li><button type="button" data-type="__rev" aria-pressed="${S.type === "__rev"}"><b>${rev}</b> Reverse holo</button></li>` : ""}
    </ul>` : ""}
    <div class="tools">
      <div class="seg" role="group" aria-label="Show">${[["all", "All"], ["have", "Have"], ["need", "Need"]].map(([v, l]) =>
        `<button type="button" data-own="${v}" aria-pressed="${S.own === v}">${l}</button>`).join("")}</div>
      <span class="note">Tap a card to tick it. Tap <b>i</b> for its versions (normal, reverse holo…).</span>
    </div>
    <div class="grid" id="grid"></div>`;

  const draw = () => {
    S.list = cards.filter((c) => (!S.type || (S.type === "__rev" ? (c.v || "").includes("r") : (c.r || "Unknown rarity") === S.type)) &&
      (S.own === "all" || (S.own === "have") === !!C.cards[k(c)]));
    $("#grid").innerHTML = S.list.map((c, i) => cardTile(c, C.cards[k(c)], i)).join("") || `<p class="none">No cards here.</p>`;
  };
  $("#back").onclick = () => go(S.lang);
  document.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { S.type = b.dataset.type || null; renderSet(id); }));
  document.querySelectorAll("[data-own]").forEach((b) => b.addEventListener("click", () => { S.own = b.dataset.own; renderSet(id); }));
  $("#grid").addEventListener("click", (e) => {
    const tile = e.target.closest(".card"); if (!tile) return;
    const c = S.list[+tile.dataset.i];
    if (e.target.closest(".info")) return openCard(id, +tile.dataset.i);
    const kk = k(c), before = C.cards[kk] || "";
    setOwned(kk, before ? "" : defaultVersion(c));
    tile.outerHTML = cardTile(c, C.cards[kk], +tile.dataset.i);
    toast(before ? `Removed ${c.name}` : `Ticked ${c.name}`, () => { setOwned(kk, before); renderSet(id); });
    refreshProgress(id);
  });
  draw();
}
function cardTile(c, owned, i) {
  const vs = versions(c);
  return `<button type="button" class="card ${owned ? "have" : "need"}" data-i="${i}" aria-pressed="${!!owned}" aria-label="${esc(`${c.name} ${c.n}`)}${owned ? ", have it" : ""}">
    <span class="pic">${pic(c) ? `<img src="${esc(pic(c))}" alt="" loading="lazy" data-ph="${esc(c.name)}" onerror="imgFail(this)">` : `<span class="ph">${esc(c.name)}</span>`}
      ${owned ? `<span class="tick" aria-hidden="true">✓</span>` : ""}
      ${vs.length > 1 && owned ? `<span class="vers">${vs.map((v) => `<i class="${owned.includes(v) ? "on" : ""}">${VSHORT[v]}</i>`).join("")}</span>` : ""}
      <span class="info" role="button" aria-label="Versions and details">i</span></span>
    <span class="cap"><span>${esc(c.name)}</span><span>${esc(c.n)}</span></span></button>`;
}
function refreshProgress(id) {
  // cheap redraw of the numbers without rebuilding the grid (keeps scroll position)
  const set = D.setFiles[`${S.lang}/${id}`]; if (!set) return;
  const k = (c) => key(S.lang, id, c.id);
  const have = set.cards.filter((c) => C.cards[k(c)]).length;
  const varTotal = set.cards.reduce((a, c) => a + versions(c).length, 0);
  const varHave = set.cards.reduce((a, c) => a + (C.cards[k(c)] || "").length, 0);
  const boxes = document.querySelectorAll(".prog > div");
  [[have, set.cards.length], [varHave, varTotal]].forEach(([h, t], i) => {
    const b = boxes[i]; if (!b) return;
    b.querySelector(".num").innerHTML = `${h}<small> / ${t}</small>`;
    b.querySelector(".bar").classList.toggle("done", h === t);
    b.querySelector(".bar i").style.width = `${(h / t) * 100}%`;
  });
}

// ---------------------------------------------------------------- card sheet: versions + details
function openCard(setId, i) {
  const dlg = $("#cardsheet"), c = S.list[i]; if (!c) return;
  const kk = key(S.lang, setId, c.id), owned = C.cards[kk] || "";
  const meta = D.sets[S.lang].sets.find((s) => s.id === setId);
  dlg.innerHTML = `<div class="sheet">
    <div class="sheet-head"><h2 id="cs-name">${esc(c.name)}</h2><button type="button" class="x" id="csx" aria-label="Close">×</button></div>
    <div class="cardview">
      <div class="pic">${pic(c, "high") ? `<img src="${esc(pic(c, "high"))}" alt="${esc(c.name)}" data-ph="No picture for this card" onerror="imgFail(this)">` : `<div class="ph">No picture for this card</div>`}</div>
      <div>
        <dl class="facts">
          <div><dt>Number</dt><dd>${esc(c.n)}${meta?.official ? ` / ${meta.official}` : ""}</dd></div>
          ${c.r ? `<div><dt>Rarity</dt><dd>${esc(c.r)}</dd></div>` : ""}
          ${c.cat ? `<div><dt>Type</dt><dd>${esc(c.cat)}</dd></div>` : ""}
          ${c.usd ? `<div><dt>Market (TCGplayer)</dt><dd>US$${c.usd.toFixed(2)}</dd></div>` : ""}
        </dl>
        <div class="vbtns" role="group" aria-label="Versions you have">${versions(c).map((v) =>
          `<button type="button" class="vbtn" data-v="${v}" aria-pressed="${owned.includes(v)}">${VNAME[v]}<span>${owned.includes(v) ? "Have it" : "Tap if you have it"}</span></button>`).join("")}</div>
      </div>
    </div>
    <div class="nav2"><button type="button" class="btn ghost" id="csprev" ${i ? "" : "disabled"}>← Previous</button>
      <button type="button" class="btn ghost" id="csnext" ${i < S.list.length - 1 ? "" : "disabled"}>Next →</button></div></div>`;
  $("#csx").onclick = () => dlg.close();
  $("#csprev").onclick = () => openCard(setId, i - 1);
  $("#csnext").onclick = () => openCard(setId, i + 1);
  dlg.querySelectorAll(".vbtn").forEach((b) => b.addEventListener("click", () => {
    const cur = C.cards[kk] || "", v = b.dataset.v;
    const next = cur.includes(v) ? cur.replace(v, "") : versions(c).filter((x) => cur.includes(x) || x === v).join("");
    setOwned(kk, next);
    openCard(setId, i);
    const tile = document.querySelector(`.card[data-i="${i}"]`);
    if (tile) tile.outerHTML = cardTile(c, C.cards[kk], i);
    refreshProgress(setId);
  }));
  if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------- sync sheet: GitHub key, backup, restore
function openSync() {
  const dlg = $("#syncsheet"), has = !!token();
  const n = Object.keys(C.cards).length;
  dlg.innerHTML = `<div class="sheet">
    <div class="sheet-head"><h2 id="ss-title">Sync your collection</h2><button type="button" class="x" id="ssx" aria-label="Close">×</button></div>
    ${has ? `<p>This device is connected. Ticks save to GitHub a couple of seconds after you make them, and your other devices pick them up when they open PokeInfo.</p>
      <p class="note">${n.toLocaleString()} cards ticked${queue.length ? `, ${queue.length} change${queue.length === 1 ? "" : "s"} still to save` : ""}.</p>
      <div class="row"><button class="btn" id="ssnow" type="button">Sync now</button><button class="btn ghost" id="ssoff" type="button">Disconnect this device</button></div>`
    : `<p>Connect each device (phone and laptop) once with a GitHub key. Until then, ticks are saved on this device only${queue.length ? ` (${queue.length} change${queue.length === 1 ? "" : "s"} waiting)` : ""}.</p>
      <ol class="steps">
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → new fine-grained token</a>.</li>
        <li>Name it <b>PokeInfo</b> and set the expiry to a year (or no expiry).</li>
        <li>Under <b>Repository access</b>, pick <b>Only select repositories</b> → <b>${esc(REPO.split("/")[1])}</b>.</li>
        <li>Under <b>Permissions → Repository permissions</b>, set <b>Contents</b> to <b>Read and write</b>.</li>
        <li>Generate it, copy it, and paste it here.</li>
      </ol>
      <label class="fld">GitHub key<input id="sstok" type="password" autocomplete="off" placeholder="github_pat_…"></label>
      <p class="note">The key is kept in this browser only. It can change files in this one GitHub project (Pack Watch, GengarFinder and PokeInfo), nothing else on your account.</p>
      <div class="row"><button class="btn" id="sson" type="button">Connect</button></div><p class="note" id="ssmsg" role="status"></p>`}
    <h3 style="margin-top:20px">Backup</h3>
    <p class="note">A file with every card you've ticked, in every language.</p>
    <div class="row"><button class="btn ghost" id="ssdl" type="button">Download backup</button>
      <label class="btn ghost">Restore from backup<input id="ssup" type="file" accept="application/json,.json" hidden></label></div></div>`;
  $("#ssx").onclick = () => dlg.close();
  $("#ssnow")?.addEventListener("click", () => { sync(); dlg.close(); });
  $("#ssoff")?.addEventListener("click", () => { store.del("pi-token"); status(queue.length ? "local" : "local0"); openSync(); });
  $("#sson")?.addEventListener("click", async () => {
    const t = $("#sstok").value.trim(); if (!t) return;
    store.set("pi-token", t); $("#ssmsg").textContent = "Checking the key…";
    try {
      await readRemote(); $("#ssmsg").textContent = "Connected.";
      await sync(); await refreshFromRemote(); openSync();
    } catch (e) {
      store.del("pi-token");
      $("#ssmsg").textContent = e.auth ? "GitHub didn't accept that key. Check it has Contents: Read and write for this project." : "Couldn't reach GitHub. Try again in a minute.";
    }
  });
  $("#ssdl").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(C, null, 1)], { type: "application/json" }));
    a.download = `pokeinfo-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  });
  $("#ssup").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.cards) throw new Error();
      const n2 = Object.keys(data.cards).length;
      if (!window.confirm(`Replace your collection with this backup (${n2.toLocaleString()} cards ticked)?`)) return;
      for (const k of Object.keys(C.cards)) if (!data.cards[k]) setOwned(k, "");
      for (const [k, v] of Object.entries(data.cards)) if (C.cards[k] !== v) setOwned(k, v);
      dlg.close(); render(); toast("Backup restored");
    } catch { toast("That file isn't a PokeInfo backup"); }
  });
  if (!dlg.open) dlg.showModal();
}

// ---------------------------------------------------------------- small things
function imgFail(img) {   // a picture that won't load becomes a name placeholder
  const ph = document.createElement("span"); ph.className = "ph"; ph.textContent = img.dataset.ph || ""; img.replaceWith(ph);
}
window.imgFail = imgFail;
let toastTimer;
function toast(msg, undo) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button" id="undo">Undo</button>` : ""}`;
  t.hidden = false;
  if (undo) $("#undo").onclick = () => { t.hidden = true; undo(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}
for (const d of ["#cardsheet", "#syncsheet"]) $(d).addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

$("#langs").addEventListener("click", (e) => { const b = e.target.closest("[data-lang]"); if (b) { S.q = ""; go(b.dataset.lang); } });
$("#sync").addEventListener("click", openSync);
$("#home").addEventListener("click", (e) => { e.preventDefault(); go(S.lang); });
window.addEventListener("hashchange", () => { $("#cardsheet").open && $("#cardsheet").close(); render().then(() => window.scrollTo(0, 0)); });

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
(() => {   // home-screen apps stay open in the background: get the other device's ticks when coming back
  let shownAt = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - shownAt > 60 * 1000) refreshFromRemote();
    if (document.visibilityState === "hidden" && queue.length && token()) sync();
    if (document.visibilityState === "visible") shownAt = Date.now();
  });
})();

status(token() ? (queue.length ? "busy" : "ok") : (queue.length ? "local" : "local0"));
render();
refreshFromRemote();
