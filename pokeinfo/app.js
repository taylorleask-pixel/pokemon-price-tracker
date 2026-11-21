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
// full card lists on other sites, until PokeInfo has them itself (links only, nothing is copied)
const FULL_LISTS = {
  ja: { site: "TCG Collector", url: "https://www.tcgcollector.com/sets/jp?cardCountMode=anyCardVariant&releaseDateOrder=newToOld&displayAs=images" },
  ko: { site: "TCG Collector", url: "https://www.tcgcollector.com/sets/kr?cardCountMode=anyCardVariant&releaseDateOrder=newToOld&displayAs=images" },
  "zh-tw": { site: "TCG Charts", url: "https://tcgcharts.com/pokemon/sets/traditional-chinese" },
  "zh-cn": { site: "Pokipair", url: "https://www.pokipair.com/simplified-chinese-pokemon-set-list/" },
};
const fullListLink = (lang, text) => FULL_LISTS[lang]
  ? `<a class="extlink" href="${esc(FULL_LISTS[lang].url)}" target="_blank" rel="noopener">${esc(text || `Every ${LANGS.find((l) => l.id === lang).name} set on ${FULL_LISTS[lang].site}`)} ↗</a>` : "";
const VNAME = { n: "Normal", h: "Holo", r: "Reverse holo", f: "1st edition", p: "Poké Ball reverse holo", m: "Master Ball reverse holo", s: "Starlight holo" };
const VLABEL = { r: "Reverse", h: "Holo", f: "1st Ed.", p: "Poké Ball", m: "Master Ball", s: "Starlight" };
const isRev = (v) => /[rpm]/.test(v || "");
const VSHORT = { n: "N", h: "H", r: "R", f: "1st", p: "PB", m: "MB" };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

const S = { lang: store.get("pi-lang", "en"), q: "", show: "all", newest: true, type: null, own: "all", list: [] };
const D = { sets: {}, setFiles: {}, en: null };
// English name for a non-English set (by set code), or "" for English sets
const enName = (s, lang = S.lang) => lang === "en" ? "" : (D.en?.[lang]?.[s.id] || D.en?.sets?.[s.id] || (s.name_en && s.name_en !== s.name ? s.name_en : ""));
// percent done: never shows 100% until the set really is complete, and shows <1% instead of 0% once you've started
const pct = (h, t) => !t ? "0%" : h >= t ? "100%" : h > 0 && h / t < 0.01 ? "<1%" : `${Math.floor((h / t) * 100)}%`;
// the code printed at the bottom of non-English cards (M2a, SV9a, S8b…), so you can match a card to its set
const setCode = (s) => S.lang === "en" || !s?.id || s.id.startsWith("x-") ? "" : s.id;
const codeTag = (s) => setCode(s) ? `<span class="code">${esc(setCode(s))}</span>` : "";
// ---- rarities: the code printed on Japanese/Korean/Chinese cards (C, U, R, RR, AR, SR, SAR, UR…), its English name,
// the English symbol (drawn here), and what it usually is (from Taylor's rarity guide)
const STAR = "M12 2.6l2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.3l-5.8 3.1 1.2-6.5L2.6 9.4l6.5-.8z";
const SYM = {
  circle: [["c", "#1b1b1b"]], diamond: [["d", "#1b1b1b"]], star: [["s", "#1b1b1b"]], star2: [["s", "#1b1b1b"], ["s", "#1b1b1b"]],
  star3: [["s", "#1b1b1b"], ["s", "#1b1b1b"], ["s", "#1b1b1b"]], ace: [["s", "#E0247A"]], gold: [["s", "#F2B705"]],
  silver2: [["s", "#9AA0A6"], ["s", "#9AA0A6"]], gold2: [["s", "#F2B705"], ["s", "#F2B705"]], gold3: [["s", "#F2B705"], ["s", "#F2B705"], ["s", "#F2B705"]],
  shiny: [["o", "#F2B705"]], shiny2: [["o", "#F2B705"], ["o", "#F2B705"]], mega: [["s", "#E0247A"], ["s", "#2EA84A"]],
};
function rarSym(kind) {
  const parts = SYM[kind]; if (!parts) return "";
  const w = 12 + (parts.length - 1) * 8;
  const shapes = parts.map(([t, col], i) => {
    const x = i * 8, y = parts.length === 3 && i === 1 ? -2 : 0;
    if (t === "c") return `<circle cx="${x + 6}" cy="6" r="4.2" fill="${col}"/>`;
    if (t === "d") return `<path d="M${x + 6} 1.2 ${x + 10.8} 6 ${x + 6} 10.8 ${x + 1.2} 6z" fill="${col}"/>`;
    return `<path d="${STAR}" transform="translate(${x},${y + 0.3}) scale(.5)" fill="${t === "o" ? "none" : col}" stroke="${col}" stroke-width="${t === "o" ? 2.6 : 0}"/>`;
  }).join("");
  return `<svg class="rsym" viewBox="0 -2 ${w} 14" width="${w}" height="12" aria-hidden="true">${shapes}</svg>`;
}
const RARITY = [
  // [code, English name, symbol, what it usually is, other names it goes by]
  ["C", "Common", "circle", "Everyday Pokémon, Trainer and Energy cards. Flat cards.", ["common"]],
  ["U", "Uncommon", "diamond", "More everyday Pokémon, Trainer and Energy cards. Flat cards.", ["uncommon"]],
  ["R", "Rare", "star", "Stronger cards. Usually flat, sometimes foil.", ["rare", "holo rare", "rare holo"]],
  ["RR", "Double Rare", "star2", "Pokémon ex (and V, GX, EX in older sets). Foil.", ["double rare", "holo rare v", "holo rare vmax", "holo rare vstar"]],
  ["RRR", "Triple Rare", "star3", "VSTAR and VMAX cards in Sword & Shield sets. Foil.", ["triple rare"]],
  ["ACE", "ACE SPEC Rare", "ace", "Powerful Trainer cards, limited to one ACE SPEC per deck. Foil.", ["ace spec rare", "ace spec"]],
  ["AR", "Illustration Rare", "gold", "Alternate-art versions of everyday Pokémon, full-art foil scenes.", ["illustration rare", "art rare"]],
  ["SR", "Ultra Rare", "silver2", "Secret-numbered ex, Supporter and other cards, usually full-art.", ["ultra rare", "super rare"]],
  ["SAR", "Special Illustration Rare", "gold2", "Full-art cards with detailed scenes, either a Pokémon or a Trainer. Secret-numbered.", ["special illustration rare", "super art rare", "sr (sa)"]],
  ["UR", "Hyper Rare", "gold3", "The top tier. Secret-numbered, with gold treatment.", ["hyper rare"]],
  ["HR", "Hyper Rare (rainbow)", "gold3", "Sword & Shield era top tier: rainbow cards.", []],
  ["S", "Shiny Rare", "shiny", "Shiny Pokémon from shiny sets.", ["shiny rare", "shiny", "shiny rare v", "shiny rare vmax"]],
  ["SSR", "Shiny Ultra Rare", "shiny2", "Full-art shiny Pokémon ex from shiny sets.", ["shiny ultra rare", "shiny super rare"]],
  ["CHR", "Character Rare", "", "Pokémon shown with their Trainer, full-art.", ["character rare"]],
  ["CSR", "Character Super Rare", "", "Full-art Pokémon V with their Trainer.", ["character super rare"]],
  ["K", "Radiant Rare", "", "Radiant Pokémon, one per deck.", ["radiant rare"]],
  ["MA", "Mega Attack Rare", "mega", "Full-art Mega Evolution Pokémon ex with a big Japanese attack name.", ["mega attack rare"]],
  ["MUR", "Mega Hyper Rare", "gold3", "Mega Evolution Pokémon ex with gold-etched holo artwork.", ["mega hyper rare"]],
  ["PR", "Promo", "", "Promo card from an event, product or magazine.", ["promo"]],
];
const RAR_BY = new Map();
for (const r of RARITY) { RAR_BY.set(r[0].toLowerCase(), r); for (const a of r[4]) RAR_BY.set(a, r); }
function rarity(r, serie = S.curSerie) {
  if (!r) return null;
  const k = String(r).trim().toLowerCase();
  let hit = RAR_BY.get(k);
  // the database calls some gold cards "Mega Hyper Rare" even outside Mega Evolution sets: there they're plain UR
  if (hit?.[0] === "MUR" && serie && !/^(m|me)$/i.test(serie)) hit = RAR_BY.get("ur");
  return hit ? { code: hit[0], en: hit[1], sym: hit[2], desc: hit[3] } : { code: "", en: String(r).trim(), sym: "", desc: "" };
}
const rKey = (c) => rarity(c.r)?.en || "Unknown rarity";
// tile-sized rarity: English cards show the English symbol; other languages show the code printed on the card
function rarTag(r, serie) {
  const x = rarity(r, serie); if (!x) return "";
  if (S.lang === "en") return x.sym ? `<span class="rtag" title="${esc(x.en)}">${rarSym(x.sym)}</span>` : "";
  return x.code ? `<span class="rtag" title="${esc(x.en)}">${esc(x.code)}</span>` : "";
}
const symImg = (s, cls = "sym") => s.symbol ? `<img class="${cls}" src="${esc(s.symbol)}" alt="" loading="lazy" onerror="this.remove()">` : "";
const enSerie = (name) => S.lang === "en" || !D.en ? "" : (D.en.series?.[name] || "");
// collection: cards = what you have ("nr" = normal + reverse), had = cards you traded or sold, log = every change
let C = norm(store.get("pi-col", null));                  // last known collection (with my unsynced changes applied)
let queue = store.get("pi-queue", []);                    // changes not yet saved to GitHub: [{k, v}] [{h, val}] [{log}]
function norm(c) { return { v: 1, cards: { ...(c?.cards || {}) }, had: { ...(c?.had || {}) }, log: [...(c?.log || [])] }; }

async function load(path) {
  try { const r = await fetch(`${path}${path.includes("?") ? "&" : "?"}v=${Date.now()}`); return r.ok ? r.json() : null; } catch { return null; }
}
const key = (lang, setId, cardId) => `${lang}|${setId}|${cardId}`;
const fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "";

// ---------------------------------------------------------------- collection + sync
const token = () => store.get("pi-token", "");
function applyOp(out, op) {
  if (op.log) { if (!out.log.some((e) => e.t === op.log.t && e.k === op.log.k)) out.log.push(op.log); if (out.log.length > 5000) out.log = out.log.slice(-5000); }
  else if (op.h) { if (op.val) out.had[op.h] = op.val; else delete out.had[op.h]; }
  else if (op.k) { if (op.v) out.cards[op.k] = op.v; else delete out.cards[op.k]; }
}
function applyQueue(base) {
  const out = norm(base);
  for (const op of queue) applyOp(out, op);
  return out;
}
function push(...ops) {
  for (const op of ops) { queue.push(op); applyOp(C, op); }
  store.set("pi-queue", queue); store.set("pi-col", C);
  scheduleSync();
}
const today = () => new Date().toLocaleDateString("en-CA");          // YYYY-MM-DD in your time zone
// card = {name, n, set} for the Changes list; without it (restoring a backup) nothing is logged
function setOwned(k, v, card, action) {
  const prev = C.cards[k] || "";
  if (prev === v) return;
  const ops = [{ k, v }];
  if (v && C.had[k]) ops.push({ h: k, val: null });                   // got a traded/sold card back
  if (card) {
    const a = action || (!prev ? (C.had[k] ? "back" : "added") : !v ? "removed" : "versions");
    const last = C.log[C.log.length - 1];
    if (last && last.k === k && ["added", "back", "removed", "versions"].includes(last.a) && Date.now() - Date.parse(last.t) < 20000 && queue.some((o) => o.log === last)) {
      // quick undo or re-tap: fold into the last change instead of logging twice
      const start = last.from ?? "";
      queue.splice(queue.findIndex((o) => o.log === last), 1); C.log.pop();
      if (start !== v) ops.push({ log: { ...last, t: new Date().toISOString(), a: !start ? (last.a === "back" ? "back" : "added") : !v ? "removed" : "versions", v, from: start } });
    } else ops.push({ log: { t: new Date().toISOString(), k, a, v, from: prev, name: card.name, n: card.n, set: card.set } });
  }
  push(...ops);
}
function setHad(k, card, how, note) {   // traded or sold: no longer in the binder, shown as "Had"
  const v = C.cards[k] || "n";
  push({ k, v: "" }, { h: k, val: { v, how, d: today(), note: note || "" } },
    { log: { t: new Date().toISOString(), k, a: how, v: "", from: v, name: card.name, n: card.n, set: card.set, note: note || "" } });
}
const b64e = (s) => btoa(unescape(encodeURIComponent(s)));
const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/\n/g, ""))));
async function gh(method, body, path = COL_PATH) {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${token()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function readRemote() {
  if (token()) {
    const r = await gh("GET");
    if (r.status === 404) return { data: norm(null), sha: null };
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("key"), { auth: true });
    if (!r.ok) throw new Error(`GitHub said ${r.status}`);
    const j = await r.json();
    return { data: JSON.parse(b64d(j.content)), sha: j.sha };
  }
  return { data: norm(await load("data/collection.json")), sha: null };
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
      if (!sent) { C = norm(data); store.set("pi-col", C); break; }
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
  if (lang === "changes") return { view: "changes" };
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
  if (S.lang !== "en" && !D.en) {
    D.en = (await load("data/set-names-en.json")) || {};
  }
  $("#changesbtn").setAttribute("aria-pressed", r.view === "changes");
  if (r.view === "changes") return renderChanges();
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
      <div class="big">${have.toLocaleString()}<small> / ${total.toLocaleString()} cards · ${pct(have, total)}</small></div>
      <div class="bar${have && have === total ? " done" : ""}"><i style="width:${total ? (have / total) * 100 : 0}%"></i></div>
      <p class="note">${sets.length} sets${hidden ? `. ${hidden} more are listed by the database without their cards yet, so they're hidden` : ""}${noPics ? `. ${Math.round(((total - noPics) / total) * 100)}% of cards have pictures in the card database; the rest show their number and name` : ""}.</p>
      ${FULL_LISTS[S.lang] ? `<p class="note">Missing a set or card? ${fullListLink(S.lang)}${S.lang === "ja" ? ` · <a class="extlink" href="https://www.pokeguardian.com/sets/set-lists/japanese-sets" target="_blank" rel="noopener">Newest Japanese sets on PokeGuardian ↗</a>` : ""}</p>` : ""}
    </section>
    ${S.lang !== "en" ? `<details class="missing" id="missing"><summary>Missing sets</summary><div id="missinglist"><p class="note">Working it out…</p></div></details>` : ""}
    <div class="tools">
      <input class="search" id="q" type="search" placeholder="Search sets, cards or codes (gengar, M2a 57)" value="${esc(S.q)}" aria-label="Search sets or cards" autocomplete="off">
      <button type="button" class="btn ghost" id="addset">Add a set</button>
      <div class="seg" role="group" aria-label="Show">${[["all", "All"], ["started", "Started"], ["done", "Complete"]].map(([v, l]) =>
        `<button type="button" data-show="${v}" aria-pressed="${S.show === v}">${l}</button>`).join("")}</div>
      <div class="seg" role="group" aria-label="Order">${[[true, "Newest"], [false, "Oldest"]].map(([v, l]) =>
        `<button type="button" data-newest="${v}" aria-pressed="${S.newest === v}">${l}</button>`).join("")}</div>
    </div>
    <div id="cardhits"></div>
    <div id="setlist"></div>`;
  const draw = () => {
    drawCardHits();
    const q = S.q.trim().toLowerCase();
    const setText = (s) => `${s.name} ${enName(s)} ${s.serie} ${enSerie(s.serie)} ${s.id} ${s.abbr || ""} ${(s.date || "").slice(0, 4)}`.toLowerCase();
    const isCode = (s, w) => w === s.id.toLowerCase() || (s.abbr && w === s.abbr.toLowerCase());
    let list = sets.filter((s) => (!q || setText(s).includes(q) || q.split(/\s+/).some((w) => isCode(s, w))) &&
      (S.show === "all" || (S.show === "started" ? own[s.id]?.cards : own[s.id]?.cards >= s.cards_n)));
    if (S.newest) list = list.slice().reverse();
    const eras = [];
    for (const s of list) {
      const e = eras[eras.length - 1];
      if (e && e.name === (s.serie || "Other")) e.sets.push(s); else eras.push({ name: s.serie || "Other", sets: [s] });
    }
    $("#setlist").innerHTML = eras.map((e) => `<div class="era"><h2>${esc(e.name)}${enSerie(e.name) ? ` <small class="en">${esc(enSerie(e.name))}</small>` : ""}</h2><span>${e.sets.length} set${e.sets.length === 1 ? "" : "s"}</span></div>
      <div class="sets">${e.sets.map((s) => {
        const h = own[s.id]?.cards || 0;
        return `<a class="set" href="#${S.lang}/set/${encodeURIComponent(s.id)}">
          <span class="logo${!s.logo && s.cover ? " cover" : ""}">${s.logo || s.cover ? `<img src="${esc(s.logo || s.cover)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'abbr',textContent:this.dataset.a}))" data-a="${esc(s.abbr || s.id)}">`
            : `<span class="abbr">${esc(s.abbr || s.id)}</span>`}</span>
          <b>${esc(s.name)}${enName(s) ? `<small class="en">${esc(enName(s))}</small>` : ""}</b>
          <span class="meta"><span>${symImg(s)}${codeTag(s)}${esc(s.date ? s.date.slice(0, 4) : "")}</span><span><b>${h}</b>/${s.cards_n} <span class="pct">${pct(h, s.cards_n)}</span></span></span>
          <span class="bar${h >= s.cards_n ? " done" : ""}"><i style="width:${(h / s.cards_n) * 100}%"></i></span></a>`;
      }).join("")}</div>`).join("") || `<p class="none">No sets match.</p>`;
  };
  $("#q").addEventListener("input", (e) => { S.q = e.target.value; draw(); });
  $("#addset").addEventListener("click", () => openAddSet());
  if (S.lang !== "en") drawMissing();
  document.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => { S.show = b.dataset.show; renderHome(); }));
  document.querySelectorAll("[data-newest]").forEach((b) => b.addEventListener("click", () => { S.newest = b.dataset.newest === "true"; renderHome(); }));
  draw();
}

// ---------------------------------------------------------------- card search across every set in the language
D.index = {};
async function cardIndex(lang) {
  if (!D.index[lang]) D.index[lang] = load(`data/${lang}/index.json`).then((d) => d || { sets: [], cards: [] });
  return D.index[lang];
}
let hitsTimer;
function drawCardHits() {
  clearTimeout(hitsTimer);
  const q = (S.q || "").trim(), box = $("#cardhits");
  if (!box) return;
  if (q.length < 2) { box.innerHTML = ""; return; }
  hitsTimer = setTimeout(async () => {
    const lang = S.lang;
    if (!D.index[lang]) box.innerHTML = `<p class="note">Searching every card…</p>`;
    const idx = await cardIndex(lang);
    if (lang !== S.lang || q !== (S.q || "").trim() || !$("#cardhits")) return;
    const order = new Map(D.sets[lang].sets.map((x, i) => [x.id, i]));
    // a word that is a set code (M2a, SV9a, S8b… or swsh6 in English) limits the search to that set: "m2a 57", "s8b gengar"
    const codes = new Map(idx.sets.map(([id], i) => [id.toLowerCase(), i]));
    for (const x of D.sets[lang].sets) if (x.abbr && x.cards_n) { const i = idx.sets.findIndex(([id]) => id === x.id); if (i >= 0) codes.set(x.abbr.toLowerCase(), i); }
    const words = q.toLowerCase().split(/\s+/);
    const inSet = words.map((w) => codes.get(w)).find((v) => v !== undefined);
    const rest = words.filter((w) => !codes.has(w)).join(" ");
    if (inSet !== undefined && !rest) { box.innerHTML = ""; return; }   // just a code: the set itself is listed below
    const hits = [];
    for (const row of idx.cards) {
      const [si, cid, n, name, r, pic] = row;
      if (inSet !== undefined && si !== inSet) continue;
      if (!cardMatches({ name, n, r }, inSet !== undefined ? rest : q)) continue;
      const [setId, setName, base] = idx.sets[si];
      const id = cid || `${setId}-${n}`;
      hits.push({ setId, setName, id, n, name, r, pic: pic === 1 ? `${base}/${id.split("-").pop()}/low.webp` : pic || null, owned: C.cards[key(lang, setId, id)] || "" });
    }
    hits.sort((a, b) => (S.newest ? -1 : 1) * ((order.get(a.setId) ?? 0) - (order.get(b.setId) ?? 0)));
    const LIMIT = S.allHits === q ? hits.length : 60;
    const meta = (id) => D.sets[lang].sets.find((x) => x.id === id);
    box.innerHTML = hits.length ? `<div class="era"><h2>Cards</h2><span>${hits.length.toLocaleString()} match${hits.length === 1 ? "" : "es"} for “${esc(q)}”${hits.length ? `, ${hits.filter((h) => h.owned).length} ticked` : ""}</span></div>
      <div class="grid hits">${hits.slice(0, LIMIT).map((h, i) => `<a class="card hit ${h.owned ? "have" : "need"}" href="#${lang}/set/${encodeURIComponent(h.setId)}" data-h="${i}">
        <span class="pic">${h.pic ? `<img src="${esc(h.pic)}" alt="" loading="lazy" data-ph="${esc(h.name)}" onerror="imgFail(this)">` : `<span class="ph">${esc(h.name)}</span>`}
          ${h.owned ? `<span class="tick" aria-hidden="true">✓</span>` : ""}</span>
        <span class="cap"><span>${esc(h.name)}</span><span>${rarTag(h.r, meta(h.setId)?.serie_id)}${esc(h.n)}</span></span>
        <span class="hitset">${symImg(meta(h.setId) || {})}${codeTag(meta(h.setId))}${esc(h.setName)}${enName({ id: h.setId, name: h.setName, name_en: meta(h.setId)?.name_en }) ? ` · ${esc(enName({ id: h.setId, name: h.setName, name_en: meta(h.setId)?.name_en }))}` : ""}</span></a>`).join("")}</div>
      ${hits.length > LIMIT ? `<p><button type="button" class="btn ghost" id="morehits">Show all ${hits.length.toLocaleString()} cards</button></p>` : ""}`
      : `<p class="note">No cards match “${esc(q)}”.</p>`;
    box.querySelectorAll("a.hit").forEach((a) => a.addEventListener("click", () => { const h = hits[+a.dataset.h]; S.jump = { id: h.setId, q: `${h.n.split("/")[0]} ${h.name}` }; }));
    $("#morehits")?.addEventListener("click", () => { S.allHits = q; drawCardHits(); });
  }, D.index[S.lang] ? 120 : 0);
}

// ---------------------------------------------------------------- one set: the binder
const pic = (c, size = "low") => c.img ? `${c.img}/${size}.webp` : c.ps ? (size === "low" ? c.ps : c.pl || c.ps) : null;
const HOW = { traded: "Traded", sold: "Sold" };
function defaultVersion(c) { return ["n", "h", "f", "r", "p", "m", "s"].find((v) => (c.v || "").includes(v)) || "n"; }
function versions(c) { return (c.v || "n").split("").sort((a, b) => "nhfrpms".indexOf(a) - "nhfrpms".indexOf(b)); }

async function renderSet(id) {
  const meta = D.sets[S.lang].sets.find((s) => s.id === id);
  const fk = `${S.lang}/${id}`;
  if (!D.setFiles[fk]) {
    $("#view").innerHTML = `<p class="loading">Opening ${esc(meta?.name || id)}…</p>`;
    D.setFiles[fk] = await load(`data/${S.lang}/sets/${encodeURIComponent(id)}.json`);
  }
  const set = D.setFiles[fk];
  if (!set || !meta) { $("#view").innerHTML = `<button class="back" id="back">← All sets</button><p class="none">That set isn't in the card list.</p>`; $("#back").onclick = () => go(S.lang); return; }
  if (S.setId !== id) { S.setId = id; S.type = null; S.own = "all"; S.cq = ""; }
  S.curSerie = meta?.serie_id || "";
  if (S.jump?.id === id) { S.cq = S.jump.q; S.jump = null; }   // came from a card search: show just that card
  const cards = set.cards;
  const k = (c) => key(S.lang, id, c.id);
  const info = (c) => ({ name: c.name, n: c.n, set: `${set.name || meta.name}${S.lang === "en" ? "" : ` (${LANGS.find((l) => l.id === S.lang).label})`}`, href: `${S.lang}/set/${id}` });
  S.info = info;
  const hadN = cards.filter((c) => !C.cards[k(c)] && C.had[k(c)]).length;
  const have = cards.filter((c) => C.cards[k(c)]).length;
  const varTotal = cards.reduce((a, c) => a + versions(c).length, 0);
  const varHave = cards.reduce((a, c) => a + (C.cards[k(c)] || "").length, 0);
  const types = {};
  for (const c of cards) { const t = rKey(c); (types[t] ??= { n: 0, have: 0 }).n++; if (C.cards[k(c)]) types[t].have++; }
  const rev = cards.filter((c) => isRev(c.v)).length;
  const typeList = Object.entries(types);
  const showTypes = typeList.length > 1 || typeList[0]?.[0] !== "Unknown rarity";
  const official = meta.official && meta.official !== cards.length ? ` (${meta.official} in the main set, the rest are secret rares)` : "";

  $("#view").innerHTML = `<button class="back" id="back">← All ${esc(LANGS.find((l) => l.id === S.lang).name)} sets</button>
    <div class="sethead">
      ${meta.logo ? `<img class="logo" src="${esc(meta.logo)}" alt="" onerror="this.remove()">` : meta.cover ? `<img class="logo cover" src="${esc(meta.cover)}" alt="" onerror="this.remove()">` : ""}
      <h1>${symImg(meta, "sym big")}${esc(set.name || meta.name)}${setCode(meta) ? ` <span class="code big" title="Set code printed on the cards">${esc(setCode(meta))}</span>` : ""}</h1>
      ${enName(meta) ? `<p class="en-title">${esc(enName(meta))}</p>` : ""}
      <p>${esc([meta.serie, fmtDate(meta.date), meta.abbr].filter(Boolean).join(" · "))}</p>
      ${FULL_LISTS[S.lang] && set.cards.some((c) => !pic(c)) ? `<p class="note">Pictures missing? See this set on ${fullListLink(S.lang, FULL_LISTS[S.lang].site)}</p>` : ""}
    </div>
    <div class="prog">
      <div><div class="lbl">Cards</div><div class="num">${have}<small> / ${cards.length} · ${pct(have, cards.length)}</small></div>
        <div class="bar${have === cards.length ? " done" : ""}"><i style="width:${(have / cards.length) * 100}%"></i></div></div>
      ${varTotal > cards.length ? `<div><div class="lbl">Master set (every version, e.g. reverse holos)</div><div class="num">${varHave}<small> / ${varTotal} · ${pct(varHave, varTotal)}</small></div>
        <div class="bar${varHave === varTotal ? " done" : ""}"><i style="width:${(varHave / varTotal) * 100}%"></i></div></div>` : ""}
    </div>
    <p class="note" style="margin-top:-4px">${cards.length} cards${esc(official)}${rev ? `. ${rev} also come as a reverse holo` : ""}.${hadN ? ` You've traded or sold ${hadN}.` : ""}</p>
    ${set.note ? `<p class="note">${esc(set.note)}</p>` : ""}
    ${showTypes ? `<ul class="types" aria-label="Filter by type">
      <li><button type="button" data-type="" aria-pressed="${!S.type}">All</button></li>
      ${typeList.map(([t, o]) => { const x = rarity(t); return `<li><button type="button" data-type="${esc(t)}" aria-pressed="${S.type === t}"><b>${o.n}</b> ${x?.sym ? rarSym(x.sym) + " " : ""}${x && x.code && S.lang !== "en" ? `${esc(x.code)} · ` : ""}${esc(x ? x.en : t)}${o.have ? ` · ${o.have} ✓` : ""}</button></li>`; }).join("")}
      ${rev ? `<li><button type="button" data-type="__rev" aria-pressed="${S.type === "__rev"}"><b>${rev}</b> Reverse holo</button></li>` : ""}
    </ul>` : ""}
    <div class="tools">
      <input class="search" id="cq" type="search" placeholder="Search cards: name or number" value="${esc(S.cq || "")}" aria-label="Search cards in this set" autocomplete="off">
    </div>
    <div class="tools">
      <div class="seg" role="group" aria-label="Show">${[["all", "All"], ["have", "Have"], ["need", "Need"], ...(hadN ? [["had", "Had"]] : [])].map(([v, l]) =>
        `<button type="button" data-own="${v}" aria-pressed="${S.own === v}">${l}</button>`).join("")}</div>
      <span class="note">Tap a card to tick it. Reverse holos have their own card. Tap <b>i</b> for details or to mark it traded or sold.</span>
    </div>
    <div class="grid" id="grid"></div>`;

  const draw = () => {
    S.list = cards.filter((c) => (!S.type || (S.type === "__rev" ? isRev(c.v) : rKey(c) === S.type)) &&
      (S.own !== "had" || (!C.cards[k(c)] && !!C.had[k(c)])) && cardMatches(c, S.cq));
    // one tile per version, so normal and reverse holo can be ticked straight from the grid
    S.tiles = [];
    S.list.forEach((c, ci) => {
      const vs = versions(c), owned = C.cards[k(c)] || "";
      for (const v of vs) {
        if (S.type === "__rev" && !isRev(v)) continue;
        if (S.own === "have" && !owned.includes(v)) continue;
        if (S.own === "need" && owned.includes(v)) continue;
        S.tiles.push({ c, v, ci, multi: vs.length > 1 });
      }
    });
    $("#grid").innerHTML = S.tiles.map((t, ti) => cardTile(t, C.cards[k(t.c)] || "", ti, C.had[k(t.c)])).join("") || `<p class="none">${S.cq ? `No cards match “${esc(S.cq)}”.` : "No cards here."}</p>`;
  };
  $("#back").onclick = () => go(S.lang);
  document.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => { S.type = b.dataset.type || null; renderSet(id); }));
  document.querySelectorAll("[data-own]").forEach((b) => b.addEventListener("click", () => { S.own = b.dataset.own; renderSet(id); }));
  S.redraw = draw;
  $("#cq").addEventListener("input", (e) => { S.cq = e.target.value; draw(); });
  $("#grid").addEventListener("click", (e) => {
    const tile = e.target.closest(".card"); if (!tile) return;
    const t = S.tiles[+tile.dataset.i], c = t.c;
    if (e.target.closest(".info")) return openCard(id, t.ci);
    const kk = k(c), before = C.cards[kk] || "", hadBefore = C.had[kk];
    const next = before.includes(t.v) ? before.replace(t.v, "") : versions(c).filter((x) => before.includes(x) || x === t.v).join("");
    setOwned(kk, next, info(c));
    // redraw every tile of this card (its other versions show which ones you have)
    document.querySelectorAll(".card").forEach((el) => {
      const tt = S.tiles[+el.dataset.i];
      if (tt && tt.c === c) el.outerHTML = cardTile(tt, C.cards[kk] || "", +el.dataset.i, C.had[kk]);
    });
    const what = `${c.name}${t.multi ? ` (${VNAME[t.v].toLowerCase()})` : ""}`;
    toast(before.includes(t.v) ? `Removed ${what}` : hadBefore && !before ? `Got ${what} back` : `Ticked ${what}`, () => {
      setOwned(kk, before, info(c));
      if (hadBefore && !before) push({ h: kk, val: hadBefore });
      renderSet(id);
    });
    refreshProgress(id);
  });
  draw();
}
// card search: name ("gengar", "pikachu v"), number ("57" finds 057/198), or both ("57 gengar")
function cardMatches(c, q) {
  q = (q || "").trim().toLowerCase();
  if (!q) return true;
  const name = (c.name || "").toLowerCase(), num = String(c.n || "").toLowerCase();
  const bare = num.split("/")[0].replace(/^[a-z]*0*/, "");
  return q.split(/\s+/).every((w) => {
    if (/^#?\d+[a-z]?(\/\d+)?$/.test(w)) {
      const n = w.replace(/^#/, "");
      return n.includes("/") ? num.replace(/^0+/, "") === n.replace(/^0+/, "") || num === n : bare === (n.replace(/^0+/, "") || "0");
    }
    return name.includes(w) || num.includes(w) || (c.r || "").toLowerCase().includes(w);
  });
}
function cardTile(t, ownedAll, i, had) {
  const c = t.c, v = t.v, owned = ownedAll.includes(v) ? ownedAll : "";
  had = !ownedAll && had;
  const label = (t.multi && v !== "n") || /[pms]/.test(v) ? VNAME[v] : "";   // Poké Ball / Master Ball / Starlight always say so
  return `<button type="button" class="card ${owned ? "have" : had ? "had" : "need"}${isRev(v) ? " rev" : ""}${v === "p" ? " pball" : v === "m" ? " mball" : v === "s" ? " sball" : ""}" data-i="${i}" aria-pressed="${!!owned}" aria-label="${esc(`${c.name} ${c.n}${label ? `, ${label}` : ""}`)}${owned ? ", have it" : had ? `, ${HOW[had.how].toLowerCase()}` : ""}">
    <span class="pic">${pic(c) ? `<img src="${esc(pic(c))}" alt="" loading="lazy" data-ph="${esc(c.name)}" onerror="imgFail(this)">` : `<span class="ph">${esc(c.name)}</span>`}
      ${owned ? `<span class="tick" aria-hidden="true">✓</span>` : ""}
      ${had ? `<span class="hadtag">Had · ${HOW[had.how]}</span>` : ""}
      ${label ? `<span class="vlabel">${esc(VLABEL[v] || label)}</span>` : ""}
      <span class="info" role="button" aria-label="Versions and details">i</span></span>
    <span class="cap"><span>${esc(c.name)}</span><span>${rarTag(c.r)}${esc(c.n)}</span></span></button>`;
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
    b.querySelector(".num").innerHTML = `${h}<small> / ${t} · ${pct(h, t)}</small>`;
    b.querySelector(".bar").classList.toggle("done", h === t);
    b.querySelector(".bar i").style.width = `${(h / t) * 100}%`;
  });
}

// ---------------------------------------------------------------- card sheet: versions + details
function openCard(setId, i) {
  const dlg = $("#cardsheet"), c = S.list[i]; if (!c) return;
  let rr;
  const kk = key(S.lang, setId, c.id), owned = C.cards[kk] || "", had = !owned && C.had[kk];
  const meta = D.sets[S.lang].sets.find((s) => s.id === setId);
  const info = S.info(c);
  dlg.innerHTML = `<div class="sheet">
    <div class="sheet-head"><h2 id="cs-name">${esc(c.name)}</h2><button type="button" class="x" id="csx" aria-label="Close">×</button></div>
    <div class="cardview">
      <div class="pic">${pic(c, "high") ? `<img src="${esc(pic(c, "high"))}" alt="${esc(c.name)}" data-ph="No picture for this card" onerror="imgFail(this)">` : `<div class="ph">No picture for this card</div>`}</div>
      <div>
        <dl class="facts">
          <div><dt>Number</dt><dd>${esc(c.n)}${meta?.official && !String(c.n).includes("/") ? ` / ${meta.official}` : ""}</dd></div>
          ${(rr = rarity(c.r)) ? `<div><dt>Rarity</dt><dd>${rr.sym ? rarSym(rr.sym) + " " : ""}${rr.code && S.lang !== "en" ? `${esc(rr.code)} · ` : ""}${esc(rr.en)}</dd></div>
            ${rr.desc ? `<p class="rdesc">${esc(rr.desc)}</p>` : ""}` : ""}
          ${c.cat ? `<div><dt>Type</dt><dd>${esc(c.cat)}</dd></div>` : ""}
          ${c.from ? `<div><dt>Original card</dt><dd>${esc(c.from)}</dd></div>` : ""}
          ${c.usd ? `<div><dt>Market (TCGplayer)</dt><dd>US$${c.usd.toFixed(2)}</dd></div>` : ""}
        </dl>
        ${had ? `<p class="hadnote"><b>${HOW[had.how]}</b> on ${esc(fmtDate(had.d))}${had.note ? `: ${esc(had.note)}` : ""}. Tap a version below if you get it back.</p>` : ""}
        <div class="vbtns" role="group" aria-label="Versions you have">${versions(c).map((v) =>
          `<button type="button" class="vbtn" data-v="${v}" aria-pressed="${owned.includes(v)}">${VNAME[v]}<span>${owned.includes(v) ? "Have it" : "Tap if you have it"}</span></button>`).join("")}</div>
        ${owned ? `<div class="gone"><p class="note">Traded it away or sold it? It stays in the binder as "Had".</p>
          <div class="row"><button type="button" class="btn ghost" data-how="traded">I traded it</button><button type="button" class="btn ghost" data-how="sold">I sold it</button></div>
          <form class="goneform" id="goneform" hidden>
            <label class="fld" id="gonelbl">Note<input id="gonenote" autocomplete="off"></label>
            <div class="row"><button type="submit" class="btn">Save</button><button type="button" class="btn ghost" id="gonecancel">Cancel</button></div>
          </form></div>` : ""}
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
    setOwned(kk, next, info);
    redrawCard(setId, c, kk, i);
  }));
  let how = null;
  dlg.querySelectorAll("[data-how]").forEach((b) => b.addEventListener("click", () => {
    how = b.dataset.how;
    $("#goneform").hidden = false;
    $("#gonelbl").firstChild.textContent = how === "sold" ? "Sold for how much, or to who (optional)" : "Traded for what, or to who (optional)";
    $("#gonenote").placeholder = how === "sold" ? "e.g. $40 on eBay" : "e.g. for a Gengar VMAX, with Jacob";
    $("#gonenote").focus();
  }));
  $("#gonecancel")?.addEventListener("click", () => { $("#goneform").hidden = true; });
  $("#goneform")?.addEventListener("submit", (e) => {
    e.preventDefault();
    setHad(kk, info, how, $("#gonenote").value.trim());
    toast(`${c.name} marked as ${HOW[how].toLowerCase()}`);
    redrawCard(setId, c, kk, i);
  });
  if (!dlg.open) dlg.showModal();
}

function redrawCard(setId, c, kk, i) {
  openCard(setId, i);
  S.redraw?.();
  refreshProgress(setId);
}

// ---------------------------------------------------------------- Changes: everything added, traded, sold or removed
const VERB = { added: "Added", back: "Got back", removed: "Removed", versions: "Changed versions of", traded: "Traded", sold: "Sold" };
function renderChanges() {
  const f = S.chg || "all";
  const all = C.log.slice().reverse();
  const list = all.filter((e) => f === "all" || (f === "gone" ? e.a === "traded" || e.a === "sold" : f === "added" ? e.a === "added" || e.a === "back" : e.a === f));
  const days = [];
  for (const e of list) {
    const d = new Date(e.t).toLocaleDateString("en-CA");
    const g = days[days.length - 1];
    if (g && g.d === d) g.items.push(e); else days.push({ d, items: [e] });
  }
  const vtxt = (v) => v && v.length && v !== "n" ? ` (${v.split("").map((x) => VNAME[x]).join(", ")})` : "";
  const hadAll = Object.entries(C.had).filter(([k]) => !C.cards[k]);
  $("#view").innerHTML = `<section class="hero"><h1>Changes</h1>
      <div class="big">${all.length.toLocaleString()}<small> changes</small></div>
      <p class="note">Every card you've added, traded, sold or removed, newest first, from all your devices.${hadAll.length ? ` ${hadAll.length} card${hadAll.length === 1 ? " is" : "s are"} marked as Had.` : ""}</p></section>
    <div class="tools"><div class="seg" role="group" aria-label="Show">${[["all", "Everything"], ["added", "Added"], ["gone", "Traded & sold"], ["removed", "Removed"]].map(([v, l]) =>
      `<button type="button" data-chg="${v}" aria-pressed="${f === v}">${l}</button>`).join("")}</div></div>
    ${days.map((g) => `<h2 class="day">${esc(fmtDate(g.d))}</h2><ul class="log">${g.items.map((e) => {
      const [lang, setId] = e.k.split("|");
      return `<li class="a-${esc(e.a)}"><a href="#${esc(lang)}/set/${encodeURIComponent(setId)}">
        <span class="verb">${esc(VERB[e.a] || e.a)}</span>
        <span class="what"><b>${esc(e.name)}</b> <span class="note">${esc(e.n)} · ${esc(e.set)}${esc(e.a === "versions" ? vtxt(e.v) : e.a === "traded" || e.a === "sold" || e.a === "removed" ? vtxt(e.from) : vtxt(e.v))}</span>
          ${e.note ? `<span class="lognote">${esc(e.note)}</span>` : ""}</span>
        <time>${new Date(e.t).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}</time></a></li>`;
    }).join("")}</ul>`).join("") || `<p class="none">${all.length ? "Nothing here." : "No changes yet. Tick a card in any set and it shows up here."}</p>`}`;
  document.querySelectorAll("[data-chg]").forEach((b) => b.addEventListener("click", () => { S.chg = b.dataset.chg; renderChanges(); }));
}

// ---------------------------------------------------------------- Add a set: paste a card list copied from any site
const RARITY_CODES = new Set(["C", "U", "R", "RR", "RRR", "AR", "SR", "SAR", "UR", "HR", "MUR", "ACE", "TR", "K", "PR", "S", "SSR", "CHR", "CSR", "H", "P", "BWR", "MA", "SP"]);
function parseList(text) {
  const cards = [], skipped = [];
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/\s+/g, " ").replace(/[|,;]+/g, " ").trim();
    if (!line) continue;
    const toks = line.split(" ");
    const isNum = (t) => /^(#|No\.?)?[A-Za-z]{0,4}\d{1,4}[a-z]?(\/[A-Za-z]{0,4}\d{1,4})?\.?$/.test(t);
    let i = toks.findIndex(isNum);
    if (i < 0 || toks.length < 2) { skipped.push(line); continue; }
    const n = toks[i].replace(/^(#|No\.?)/, "").replace(/\.$/, "");
    const rest = toks.filter((_, j) => j !== i).filter((t) => !/^[$¥￥€£]|^\d+([.,]\d+)?$/.test(t));
    let r = null;
    if (rest.length > 1 && RARITY_CODES.has(rest[rest.length - 1].toUpperCase())) r = rest.pop().toUpperCase();
    const name = rest.join(" ").trim();
    if (!name || /^(no|number|card|name|rarity)$/i.test(name)) { skipped.push(line); continue; }
    cards.push({ n, name, r, v: "n" });
  }
  const seen = new Set();
  return { cards: cards.filter((c) => !seen.has(c.n) && seen.add(c.n)), skipped };
}
// junk entries in the card database: 15 copies of "Triplet Beat" with codes like CS1a (real only in Simplified Chinese)
const junkSet = (s, lang) => lang !== "zh-cn" && /^CS[0-9A-Z.]+[a-z]?$/.test(s.id) && !s.cards_n;
async function missingSets(lang) {
  const listed = D.sets[lang].sets;
  const empty = listed.filter((s) => !s.cards_n && !junkSet(s, lang)).slice().reverse().map((s) => ({ ...s, kind: "empty" }));
  let unlisted = [];
  if (lang === "ko" || lang === "zh-tw") {   // these get most Japanese sets too: flag recent Japanese sets they don't list at all
    D.sets.ja ??= (await load("data/ja/sets.json")) || { sets: [] };
    const have = new Set(listed.map((s) => s.id.toUpperCase()));
    unlisted = D.sets.ja.sets.filter((s) => (s.date || "") >= "2023-01-01" && !junkSet(s, "ja") && !have.has(s.id.toUpperCase()) && !/^(SV-P|M-P|WCS|MC|MF|SVK|SVL)/.test(s.id))
      .slice().reverse().map((s) => ({ ...s, kind: "unlisted", jaName: s.name }));
  }
  return { empty, unlisted };
}
async function drawMissing() {
  const { empty, unlisted } = await missingSets(S.lang);
  const L = LANGS.find((l) => l.id === S.lang);
  const row = (s) => `<li><span><b>${esc(s.kind === "unlisted" ? (enName(s, "ja") || s.name) : s.name)}</b>
      <span class="note">${esc([s.kind === "unlisted" ? "" : enName(s), s.id.startsWith("x-") ? "Not in the card database yet" : s.id, s.date ? s.date.slice(0, 4) : ""].filter(Boolean).join(" · "))}</span></span>
      <button type="button" class="btn ghost small" data-paste="${esc(s.id)}" data-kind="${s.kind}">Paste list</button></li>`;
  $("#missing summary").textContent = `Missing sets (${empty.length + unlisted.length})`;
  $("#missinglist").innerHTML = `<p class="note">Sets PokeInfo doesn't have a card list for yet. Find one on ${fullListLink(S.lang, FULL_LISTS[S.lang]?.site || "another site")}, copy its card list and tap <b>Paste list</b>.</p>
    ${empty.length ? `<h3 class="mh">Listed, but no cards yet (${empty.length})</h3><ul class="mlist">${empty.map(row).join("")}</ul>` : ""}
    ${unlisted.length ? `<h3 class="mh">Probably out in ${esc(L.name)} too, not listed at all (${unlisted.length})</h3>
      <p class="note">Japanese sets from 2023 on that ${esc(L.name)} usually gets as well. Names are shown in English; the ${esc(L.name)} name may differ.</p>
      <ul class="mlist">${unlisted.map(row).join("")}</ul>` : ""}
    <p class="note">Not here? Use <b>Add a set</b> → “A set that isn't in this list”.</p>`;
  $("#missinglist").querySelectorAll("[data-paste]").forEach((b) => b.addEventListener("click", () => {
    const src = b.dataset.kind === "unlisted" ? D.sets.ja.sets.find((x) => x.id === b.dataset.paste) : null;
    openAddSet(b.dataset.kind === "empty" ? b.dataset.paste : null, src && { name: enName(src, "ja") || src.name, code: src.id, date: src.date });
  }));
}
function openAddSet(preset = null, guess = null) {
  const dlg = $("#addsheet"), L = LANGS.find((l) => l.id === S.lang);
  const empty = D.sets[S.lang].sets.filter((s) => !s.cards_n && !junkSet(s, S.lang)).slice().reverse();
  dlg.innerHTML = `<form class="sheet" id="asform">
    <div class="sheet-head"><h2 id="as-title">Add a ${esc(L.name)} set</h2><button type="button" class="x" id="asx" aria-label="Close">×</button></div>
    <p class="note">Copy a set's card list from any site (TCG Collector, Limitless, PokeGuardian…) and paste it below: one card per line, with its number and name. Pictures are added wherever the card database has them.</p>
    <label class="fld">Which set
      <select id="aswhich">${empty.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}${enName(s) ? ` (${esc(enName(s))})` : ""}${s.date ? ` · ${esc(s.date.slice(0, 4))}` : ""}</option>`).join("")}
        <option value="__new">A set that isn't in this list</option></select></label>
    <div id="asnew" hidden>
      <label class="fld">Set name<input id="asname" autocomplete="off" placeholder="As printed, e.g. アビスアイ"></label>
      <div class="row2"><label class="fld">Set code<input id="ascode" autocomplete="off" placeholder="e.g. M5"></label>
        <label class="fld">Release date<input id="asdate" type="date"></label></div>
    </div>
    <label class="fld">Card list<textarea id="aslist" rows="9" placeholder="001/080 Bulbasaur C&#10;002/080 Ivysaur U&#10;…"></textarea></label>
    <p class="note" id="aspreview" role="status">Paste a list to see the cards it found.</p>
    <div class="row"><button type="submit" class="btn" id="assave" disabled>Save set</button></div>
    <p class="note" id="asmsg" role="status"></p></form>`;
  const which = $("#aswhich");
  const syncNew = () => { $("#asnew").hidden = which.value !== "__new"; };
  if (!empty.length || guess) which.value = "__new";
  if (preset) which.value = preset;
  if (guess) { $("#asname").value = guess.name || ""; $("#ascode").value = guess.code || ""; $("#asdate").value = guess.date || ""; }
  syncNew();
  let parsed = { cards: [], skipped: [] };
  const preview = () => {
    parsed = parseList($("#aslist").value);
    const c = parsed.cards;
    $("#aspreview").innerHTML = c.length
      ? `Found <b>${c.length} cards</b>: ${esc(c.slice(0, 4).map((x) => `${x.n} ${x.name}`).join(", "))}${c.length > 4 ? `… ${esc(`${c[c.length - 1].n} ${c[c.length - 1].name}`)}` : ""}.${parsed.skipped.length ? ` ${parsed.skipped.length} line${parsed.skipped.length === 1 ? "" : "s"} skipped (no card number), e.g. “${esc(parsed.skipped[0].slice(0, 40))}”.` : ""}`
      : "Paste a list to see the cards it found.";
    $("#assave").disabled = !c.length;
  };
  which.addEventListener("change", syncNew);
  $("#aslist").addEventListener("input", preview);
  $("#asx").onclick = () => dlg.close();
  $("#asform").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!token()) { $("#asmsg").textContent = "Connect GitHub first (the sync button at the top), so the set can be saved for all your devices."; return; }
    const db = D.sets[S.lang].sets.find((x) => x.id === which.value);
    const name = db ? db.name : $("#asname").value.trim();
    const id = db ? db.id : ($("#ascode").value.trim() || name).replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-|-$/g, "") || `set-${Date.now()}`;
    if (!name) { $("#asmsg").textContent = "Add the set's name."; return; }
    const set = { id, name, serie: db?.serie || null, serie_id: db?.serie_id || null, date: db?.date || $("#asdate").value || null,
      official: db?.official || null, abbr: db?.abbr || (db ? null : $("#ascode").value.trim() || null), logo: db?.logo || null,
      note: "Card list pasted in PokeInfo.", source: "pasted", cards: parsed.cards };
    $("#assave").disabled = true; $("#asmsg").textContent = "Saving…";
    try {
      const path = `pokeinfo/manual/${S.lang}/${id}.json`;
      const old = await gh("GET", null, path);
      const sha = old.ok ? (await old.json()).sha : undefined;
      const r = await gh("PUT", { message: `PokeInfo: add ${S.lang} set ${name} (${parsed.cards.length} cards)`, content: b64e(JSON.stringify(set, null, 1)), ...(sha ? { sha } : {}) }, path);
      if (!r.ok) throw new Error(r.status);
      $("#asmsg").innerHTML = `<b>Saved.</b> ${esc(name)} will show up in about 5 minutes, once the card update has run.`;
    } catch (err) {
      $("#assave").disabled = false;
      $("#asmsg").textContent = String(err.message) === "401" || String(err.message) === "403" ? "GitHub didn't accept the key. Check it in the sync settings." : "Couldn't save to GitHub. Try again in a minute.";
    }
  });
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
      const b = norm(data), ops = [];
      for (const k of Object.keys(C.cards)) if (!b.cards[k]) ops.push({ k, v: "" });
      for (const [k, v] of Object.entries(b.cards)) if (C.cards[k] !== v) ops.push({ k, v });
      for (const k of Object.keys(C.had)) if (!b.had[k]) ops.push({ h: k, val: null });
      for (const [k, v] of Object.entries(b.had)) ops.push({ h: k, val: v });
      for (const e of b.log) if (!C.log.some((x) => x.t === e.t && x.k === e.k)) ops.push({ log: e });
      push(...ops);
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
for (const d of ["#cardsheet", "#syncsheet", "#addsheet"]) $(d).addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

$("#langs").addEventListener("click", (e) => { const b = e.target.closest("[data-lang]"); if (b) { S.q = ""; go(b.dataset.lang); } });
$("#sync").addEventListener("click", openSync);
$("#changesbtn").addEventListener("click", () => go("changes"));
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
