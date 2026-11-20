/* Amrabad Tiger Reserve – Basecamp Monitoring Database
 * Static site: reads the Basecampdata Google Sheet live (basecamp master list +
 * daily picture reports), then filters, charts, maps on satellite imagery and
 * builds printable / exportable reports. */
(function () {
  "use strict";
  const CFG = window.BC_CONFIG;
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const LOC = ["division", "range", "section", "beat", "camp"];
  const TIME = ["year", "month"];
  const ALERT_KM = CFG.distanceAlertKm ?? 0.5;

  const state = {
    camps: [], reports: [], rHeaders: [], col: {}, ccol: {},
    fReports: [], fCamps: [], stats: new Map(),
    filters: {}, pending: {}, photo: "", pPhoto: "", search: "", pSearch: "", from: "", to: "", pFrom: "", pTo: "",
    sortKey: null, sortDir: -1, showReports: true, period: null,
  };

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s._\-()/]+/g, "");
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  const uniq = (arr) => [...new Set(arr.filter((v) => v !== "" && v != null))];
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  const fmtDay = (k) => { if (!k) return ""; const [y, m, d] = k.split("-"); return `${d}/${m}/${y}`; };
  const group = (list, fn) => { const m = new Map(); list.forEach((x) => { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };
  const daysIn = (list) => uniq(list.map((r) => r.day)).length;
  const campsIn = (list) => uniq(list.map((r) => r.campKey)).length;
  const staffIn = (list) => uniq(list.map((r) => norm(r.employee))).length;
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

  function findColumn(headers, aliases) {
    const map = new Map(headers.map((h) => [norm(h), h]));
    for (const a of aliases) if (map.has(norm(a))) return map.get(norm(a));
    for (const a of aliases) {
      const n = norm(a); if (n.length < 4) continue;
      const hit = headers.find((h) => norm(h).startsWith(n)); if (hit) return hit;
    }
    return null;
  }
  function parseCoord(v) {
    const s = String(v ?? "").trim(); if (!s) return NaN;
    const neg = /[SW]/i.test(s) || /^-/.test(s);
    const nums = s.match(/\d+(?:\.\d+)?/g); if (!nums) return NaN;
    let d = parseFloat(nums[0]);
    const isDecimal = /^\s*[NSEW]?\s*-?\d+(?:\.\d+)?\s*°?\s*[NSEW]?\s*$/i.test(s);
    if (!isDecimal && nums.length >= 2) { const m = +nums[1], sec = +(nums[2] || 0); if (m < 60 && sec < 60) d += m / 60 + sec / 3600; }
    return neg ? -d : d;
  }
  // dd/mm/yyyy (sheet format), yyyy-mm-dd, 21-Sep-2026, or anything Date.parse understands.
  function parseDate(v) {
    const s = String(v ?? "").trim(); if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (m) return { y: +m[1], m: +m[2], d: +m[3] };
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (m) { let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000; if (b > 12 && a <= 12) [a, b] = [b, a]; return { y, m: b, d: a }; }
    m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-,]*(\d{4})/);
    if (m) { const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m[2].toLowerCase().slice(0, 3))); if (mi >= 0) return { y: +m[3], m: mi + 1, d: +m[1] }; }
    m = s.match(/^Date\((\d+),(\d+),(\d+)/); // gviz raw value
    if (m) return { y: +m[1], m: +m[2] + 1, d: +m[3] };
    const t = Date.parse(s);
    if (!isNaN(t)) { const dt = new Date(t); return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() }; }
    return null;
  }
  function photoLinks(v) {
    return String(v ?? "").split(/[\s,;|]+/).filter((p) => /^https?:\/\//i.test(p)).map((url) => {
      const id = (url.match(/\/d\/([\w-]{20,})/) || url.match(/[?&]id=([\w-]{20,})/) || [])[1];
      if (id && /google\.com/.test(url)) return { url, thumb: `https://drive.google.com/thumbnail?id=${id}&sz=w800`, big: `https://drive.google.com/thumbnail?id=${id}&sz=w1600`, alt: `https://lh3.googleusercontent.com/d/${id}=w800` };
      return { url, thumb: url, big: url, alt: "" };
    });
  }
  const imgTag = (p, cls, alt = "") => `<img class="pthumb ${cls || ""}" loading="lazy" src="${esc(p.thumb)}" data-alt="${esc(p.alt || "")}" data-big="${esc(p.big)}" data-url="${esc(p.url)}" alt="${esc(alt)}">`;
  function km(aLat, aLon, bLat, bLon) {
    if (![aLat, aLon, bLat, bLon].every(isFinite)) return NaN;
    const R = 6371, t = Math.PI / 180, dLa = (bLat - aLat) * t, dLo = (bLon - aLon) * t;
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(aLat * t) * Math.cos(bLat * t) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  const okCoord = (lat, lon) => isFinite(lat) && isFinite(lon) && lat !== 0 && lon !== 0;

  // ---------- load ----------
  const tabUrl = (tab) => `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
  function loadCsv(url) {
    return new Promise((resolve, reject) => {
      Papa.parse(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now(), {
        download: true, header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim(),
        complete: (res) => resolve({ headers: (res.meta.fields || []).filter((f) => f !== ""), rows: res.data }),
        error: (e) => reject(e),
      });
    });
  }
  // Fallback that works without CORS: Google Visualization JSONP.
  let jsonpN = 0;
  function loadJsonp(tab) {
    return new Promise((resolve, reject) => {
      const cb = "__bcLoad" + ++jsonpN, s = document.createElement("script");
      const timer = setTimeout(() => { cleanup(); reject("timeout"); }, 20000);
      const cleanup = () => { clearTimeout(timer); delete window[cb]; s.remove(); };
      window[cb] = (resp) => {
        cleanup();
        if (!resp || resp.status === "error") return reject((resp && resp.errors && resp.errors[0] && resp.errors[0].detailed_message) || "error");
        const cols = resp.table.cols.map((c, i) => (c.label || "").trim() || "col" + i);
        const rows = resp.table.rows.map((r) => Object.fromEntries(cols.map((h, i) => { const c = r.c[i]; return [h, c ? (c.f ?? c.v ?? "") : ""]; })));
        resolve({ headers: cols.filter((h) => !/^col\d+$/.test(h)), rows });
      };
      s.onerror = () => { cleanup(); reject("network"); };
      s.src = `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/gviz/tq?tqx=out:json;responseHandler:${cb}&headers=1&sheet=${encodeURIComponent(tab)}&_=${Date.now()}`;
      document.head.appendChild(s);
    });
  }
  const loadTab = (tab, override) => (override ? loadCsv(override) : loadCsv(tabUrl(tab)).catch(() => loadJsonp(tab)));

  async function load() {
    setStatus("Loading data from Google Sheet…");
    try {
      const [rep, camps] = await Promise.all([
        loadTab(CFG.reportsTab, CFG.reportsCsvUrl),
        loadTab(CFG.campsTab, CFG.campsCsvUrl).catch(() => ({ headers: [], rows: [] })),
      ]);
      ingest(rep, camps);
    } catch (e) {
      setStatus("Could not load the sheet (" + e + "). Check that it is shared “Anyone with the link – Viewer”.", true);
    }
  }

  function ingest(rep, camps) {
    const col = {}, ccol = {};
    for (const [k, a] of Object.entries(CFG.columns)) { col[k] = findColumn(rep.headers, a); ccol[k] = findColumn(camps.headers, a); }
    state.col = col; state.ccol = ccol; state.rHeaders = rep.headers;

    // master list
    const byKey = new Map();
    camps.rows.forEach((r) => {
      const g = (k) => (ccol[k] ? String(r[ccol[k]] ?? "").trim() : "");
      const name = g("camp"); if (!name) return;
      const key = norm(name); if (byKey.has(key)) return;
      const lat = parseCoord(g("lat")), lon = parseCoord(g("lon"));
      byKey.set(key, { key, camp: name, division: g("division"), range: g("range"), section: g("section"), beat: g("beat"), compt: g("compt"), lat, lon, hasCoord: okCoord(lat, lon), inMaster: true, isCamp: true });
    });

    state.reports = rep.rows.map((r, i) => {
      const g = (k) => (col[k] ? String(r[col[k]] ?? "").trim() : "");
      const name = g("camp"), key = norm(name);
      let c = byKey.get(key);
      if (!c && name) { // basecamp missing from master list: add it from the report row
        c = { key, camp: name, division: g("division"), range: g("range"), section: g("section"), beat: g("beat"), compt: g("compt"), lat: NaN, lon: NaN, hasCoord: false, inMaster: false, isCamp: true };
        byKey.set(key, c);
      }
      const dt = parseDate(g("date"));
      let lat = parseCoord(g("lat")), lon = parseCoord(g("lon"));
      if (lat > 60 && lon < 40) [lat, lon] = [lon, lat];
      const photos = photoLinks(g("photo"));
      const photoName = g("photoName");
      const dist = c ? km(lat, lon, c.lat, c.lon) : NaN;
      return {
        i, raw: r, campKey: key, camp: name || "(blank)",
        division: g("division") || (c ? c.division : ""), range: g("range") || (c ? c.range : ""),
        section: g("section") || (c ? c.section : ""), beat: g("beat") || (c ? c.beat : ""),
        year: dt ? String(dt.y) : "", month: dt ? MONTHS[dt.m - 1] : "", day: dt ? ymd(dt) : "",
        time: g("time"), employee: g("employee"), designation: g("designation"), id: g("id"),
        lat, lon, hasCoord: okCoord(lat, lon), dist, photos, photoName, hasPhoto: photos.length > 0 || !!photoName,
        sortKey: (dt ? ymd(dt) : "0000") + " " + (g("time") || ""), search: Object.values(r).join(" ").toLowerCase(),
      };
    });
    if (!col.camp) state.reports = [];
    // Basecamp without coordinates in the master list: use its first report's location.
    byKey.forEach((c) => { if (!c.hasCoord) { const r = state.reports.find((x) => x.campKey === c.key && x.hasCoord); if (r) { c.lat = r.lat; c.lon = r.lon; c.hasCoord = true; c.approx = true; } } });
    state.camps = [...byKey.values()].sort((a, b) => natural(a.division, b.division) || natural(a.range, b.range) || natural(a.camp, b.camp));

    buildFilterFields(); buildPivotFields();
    applyFilters(true);
    const ts = new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    setStatus(`● Live · ${state.camps.length} basecamps · ${state.reports.length} reports · synced ${ts}`);
    const missing = ["camp", "date", "lat", "lon"].filter((k) => !col[k]).map((k) => k === "camp" ? "Basecamp name" : k === "date" ? "Picture date" : k);
    const notInMaster = state.camps.filter((c) => !c.inMaster).map((c) => c.camp);
    showBanner([
      missing.length ? `Columns not found in the <b>${esc(CFG.reportsTab)}</b> tab: <b>${esc(missing.join(", "))}</b>. Add the header names in config.js → columns.` : "",
      !camps.rows.length ? `The basecamp master tab <b>${esc(CFG.campsTab)}</b> could not be read; non-reporting basecamps cannot be shown.` : "",
      notInMaster.length ? `Reports name basecamps that are not in the <b>${esc(CFG.campsTab)}</b> tab: <b>${esc(notInMaster.join(", "))}</b>. Check the spelling or add them there.` : "",
    ].filter(Boolean).join("<br>"));
  }

  function setStatus(msg, warn) { const el = $("#status"); el.textContent = msg; el.classList.toggle("warn", !!warn); if (warn) showBanner(esc(msg)); }
  function showBanner(html) {
    let b = $("#banner");
    if (!b) { b = document.createElement("div"); b.id = "banner"; b.className = "banner no-print"; $(".content").prepend(b); }
    b.innerHTML = html; b.hidden = !html;
  }

  // ---------- filters ----------
  function buildFilterFields() {
    const host = $("#filterFields"); host.innerHTML = "";
    CFG.filterOrder.forEach((k) => host.insertAdjacentHTML("beforeend", `<div class="field"><label for="f_${k}">${esc(CFG.labels[k])}</label><select id="f_${k}" data-key="${k}"></select></div>`));
    host.querySelectorAll("select").forEach((sel) => sel.addEventListener("change", () => { state.pending[sel.dataset.key] = sel.value; refreshOptions(); markDirty(); }));
  }
  function locOk(x, f, skip) { for (const k of LOC) if (k !== skip && f[k] && x[k] !== f[k]) return false; return true; }
  function timeOk(r, f, skip, from, to) {
    for (const k of TIME) if (k !== skip && f[k] && r[k] !== f[k]) return false;
    if (from && (!r.day || r.day < from)) return false;
    if (to && (!r.day || r.day > to)) return false;
    return true;
  }
  function repOk(r, f, skip, P) {
    if (!locOk(r, f, skip) || !timeOk(r, f, skip, P.from, P.to)) return false;
    if (P.photo === "with" && !r.hasPhoto) return false;
    if (P.photo === "without" && r.hasPhoto) return false;
    if (P.search && !r.search.includes(P.search)) return false;
    return true;
  }
  const applied = () => ({ f: state.filters, from: state.from, to: state.to, photo: state.photo, search: state.search });
  const pendingP = () => ({ f: state.pending, from: state.pFrom, to: state.pTo, photo: state.pPhoto, search: state.pSearch });

  function refreshOptions() {
    const P = pendingP();
    for (const k of CFG.filterOrder) {
      const sel = $("#f_" + k); if (!sel) continue;
      const reps = state.reports.filter((r) => repOk(r, P.f, k, P));
      const counts = {}; reps.forEach((r) => { counts[r[k]] = (counts[r[k]] || 0) + 1; });
      let vals = uniq(reps.map((r) => r[k]));
      if (LOC.includes(k)) vals = uniq([...vals, ...state.camps.filter((c) => locOk(c, P.f, k)).map((c) => c[k])]);
      vals.sort(k === "month" ? (a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b) : k === "year" ? (a, b) => natural(b, a) : natural);
      const cur = P.f[k] || "";
      if (cur && !vals.includes(cur)) vals.unshift(cur);
      sel.innerHTML = `<option value="">All (${vals.length})</option>` + vals.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(v)} (${counts[v] || 0})</option>`).join("");
      sel.classList.toggle("set", !!cur);
    }
  }
  function markDirty() {
    const a = applied(), p = pendingP();
    $("#applyBtn").classList.toggle("pulse", JSON.stringify(a) !== JSON.stringify(p));
  }
  function commitFilters() {
    state.filters = { ...state.pending }; state.photo = state.pPhoto; state.search = state.pSearch; state.from = state.pFrom; state.to = state.pTo;
    applyFilters(true); markDirty();
  }

  // Reporting period (for compliance %): the date range, else the month/year chosen, else first → last report.
  function computePeriod(list) {
    const today = new Date(), tk = ymd({ y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() });
    let a = state.from, b = state.to;
    const f = state.filters;
    if (!a && !b && f.year) {
      const mi = f.month ? MONTHS.indexOf(f.month) + 1 : 0;
      a = mi ? `${f.year}-${pad(mi)}-01` : `${f.year}-01-01`;
      b = mi ? `${f.year}-${pad(mi)}-${pad(new Date(+f.year, mi, 0).getDate())}` : `${f.year}-12-31`;
    }
    const allDays = list.map((r) => r.day).filter(Boolean).sort();
    if (!a) a = allDays[0] || tk;
    if (!b) b = allDays[allDays.length - 1] || tk;
    if (b > tk && a <= tk) b = tk;
    const days = [];
    const d = new Date(a + "T00:00:00"), end = new Date(b + "T00:00:00");
    for (let n = 0; d <= end && n < 3700; n++, d.setDate(d.getDate() + 1)) days.push(ymd({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }));
    return { from: a, to: b, days };
  }

  function applyFilters(fit) {
    const P = applied();
    state.fReports = state.reports.filter((r) => repOk(r, P.f, null, P)).sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : a.i - b.i));
    state.fCamps = state.camps.filter((c) => locOk(c, P.f, null));
    state.period = computePeriod(state.fReports);
    const g = group(state.fReports, (r) => r.campKey);
    state.stats = new Map(state.fCamps.map((c) => {
      const l = g.get(c.key) || [];
      const last = l[l.length - 1];
      const d = daysIn(l);
      return [c.key, { n: l.length, days: d, staff: staffIn(l), last, list: l, comp: pct(d, state.period.days.length), photos: l.filter((r) => r.photos.length) }];
    }));
    refreshOptions(); renderApplied(); renderKpis(); renderCharts(); renderLatest(); renderMaps(fit); renderCamps();
    renderReport(); renderRegister(); renderPivot(); renderRecords();
  }
  const st = (c) => state.stats.get(c.key) || { n: 0, days: 0, staff: 0, comp: 0, list: [], photos: [] };
  const reporting = () => state.fCamps.filter((c) => st(c).n > 0);

  function filterParts() {
    const p = CFG.filterOrder.filter((k) => state.filters[k]).map((k) => [CFG.labels[k], state.filters[k]]);
    if (state.from) p.push(["From", fmtDay(state.from)]);
    if (state.to) p.push(["To", fmtDay(state.to)]);
    if (state.photo) p.push(["Photo", state.photo === "with" ? "With photo" : "Without photo"]);
    if (state.search) p.push(["Search", state.search]);
    return p;
  }
  const filterSummary = () => { const p = filterParts(); return p.length ? p.map(([a, b]) => `${a}: ${b}`).join(" · ") : "All basecamps, all dates"; };
  const periodText = () => `${fmtDay(state.period.from)} to ${fmtDay(state.period.to)} (${state.period.days.length} days)`;
  function renderApplied() {
    const p = filterParts();
    $("#applied").innerHTML = `<b>Applied:</b> ` + (p.length ? p.map(([a, b]) => `<span class="chip"><small>${esc(a)}</small> ${esc(b)}</span>`).join("") : `<span class="muted">No filters – all basecamps, all dates.</span>`);
    const crumb = `<b>${state.fCamps.length}</b> basecamps · <b>${state.fReports.length}</b> reports · period ${esc(periodText())}`;
    document.querySelectorAll("[data-crumb]").forEach((el) => (el.innerHTML = crumb));
  }

  function kpiData() {
    const f = state.fReports, rc = reporting().length, tot = state.fCamps.length;
    const away = f.filter((r) => r.dist > ALERT_KM).length;
    const avgComp = tot ? Math.round(state.fCamps.reduce((s, c) => s + st(c).comp, 0) / tot) : 0;
    return [
      ["Basecamps", tot, "⛺", "c1"],
      ["Reporting", rc, "✔", "c2"],
      ["Not reporting", tot - rc, "⚠", "c4"],
      ["Reports received", f.length, "📷", "c3"],
      ["Staff reporting", staffIn(f), "👤", "c5"],
      ["Avg. compliance", avgComp + "%", "📈", "c8"],
      ["Days in period", state.period.days.length, "📅", "c6"],
      [`Taken > ${ALERT_KM} km from camp`, away, "📍", "c7"],
    ];
  }
  function renderKpis() {
    $("#kpis").innerHTML = kpiData().map(([l, v, ic, c]) => `<div class="kpi ${c}"><div class="kpi-ic">${ic}</div><div><b>${v}</b><span>${esc(l)}</span></div></div>`).join("");
  }

  // ---------- charts ----------
  const charts = {};
  const C = { green: "#2e7d32", orange: "#ef8a17", teal: "#00796b", red: "#c62828", grid: "#e6e9e1", ink: "#44503f", light: "#b9c4b2" };
  const legendTop = { display: true, position: "top", align: "end", labels: { color: C.ink, boxWidth: 12 } };
  function chart(id, cfg) { if (!window.Chart) return; if (charts[id]) charts[id].destroy(); charts[id] = new Chart(document.getElementById(id), cfg); }
  function baseOpts(extra = {}) {
    return Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#1b2f17" } },
      scales: { x: { grid: { display: false }, ticks: { color: C.ink } }, y: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.ink, precision: 0 } } } }, extra);
  }
  const doughnut = (labels, data, colors) => ({ type: "doughnut", data: { labels, datasets: [{ data, backgroundColor: colors, borderColor: "#fff", borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: "58%", plugins: { legend: { position: "right", labels: { color: C.ink, boxWidth: 12 } } } } });
  function renderCharts() {
    const f = state.fReports, days = state.period.days;
    // trend: day-wise (or month-wise for long periods)
    const monthly = days.length > 120;
    const key = (d) => (monthly ? d.slice(0, 7) : d);
    const keys = uniq(days.map(key));
    const g = group(f, (r) => key(r.day));
    const lab = (k) => monthly ? MONTHS[+k.slice(5, 7) - 1].slice(0, 3) + " " + k.slice(0, 4) : fmtDay(k).slice(0, 5);
    $("#trendNote").textContent = monthly ? "· grouped by month (long period)" : "· " + periodText();
    chart("chTrend", { type: "bar", data: { labels: keys.map(lab), datasets: [
      { type: "line", label: "Basecamps reporting", data: keys.map((k) => campsIn(g.get(k) || [])), borderColor: C.orange, backgroundColor: C.orange, pointRadius: 2, tension: 0.25 },
      { label: "Reports", data: keys.map((k) => (g.get(k) || []).length), backgroundColor: C.green, borderRadius: 3, maxBarThickness: 30 },
    ] }, options: baseOpts({ plugins: { legend: legendTop } }) });
    const rc = reporting().length;
    chart("chStatus", doughnut(["Reporting", "Not reporting"], [rc, state.fCamps.length - rc], [C.green, C.red]));
    const dg = group(f, (r) => r.designation || "Not recorded"); const dk = [...dg.keys()].sort((a, b) => dg.get(b).length - dg.get(a).length);
    chart("chDesig", doughnut(dk, dk.map((k) => dg.get(k).length), ["#2e7d32", "#ef8a17", "#00796b", "#8d6e63", "#3f51b5", "#c0ca33", "#ad1457", "#90a4ae"]));
    const mg = group(f, (r) => r.day.slice(0, 7)); const mk = [...mg.keys()].filter(Boolean).sort();
    chart("chMonth", { type: "bar", data: { labels: mk.map((k) => MONTHS[+k.slice(5, 7) - 1].slice(0, 3) + " " + k.slice(0, 4)), datasets: [{ label: "Reports", data: mk.map((k) => mg.get(k).length), backgroundColor: C.teal, borderRadius: 4, maxBarThickness: 40 }] }, options: baseOpts() });
    const rk = uniq(state.fCamps.map((c) => c.range)).sort(natural);
    chart("chRange", { type: "bar", data: { labels: rk, datasets: [
      { label: "Basecamps", data: rk.map((k) => state.fCamps.filter((c) => c.range === k).length), backgroundColor: C.light, borderRadius: 4, maxBarThickness: 30 },
      { label: "Reporting", data: rk.map((k) => state.fCamps.filter((c) => c.range === k && st(c).n).length), backgroundColor: C.green, borderRadius: 4, maxBarThickness: 30 },
      { label: "Reports (right axis)", data: rk.map((k) => f.filter((r) => r.range === k).length), backgroundColor: C.orange, borderRadius: 4, maxBarThickness: 30, yAxisID: "y2" },
    ] }, options: baseOpts({ plugins: { legend: legendTop }, scales: { x: { grid: { display: false }, ticks: { color: C.ink } }, y: { beginAtZero: true, grid: { color: C.grid }, ticks: { color: C.ink, precision: 0 }, title: { display: true, text: "Basecamps", color: C.ink } },
      y2: { position: "right", beginAtZero: true, grid: { display: false }, ticks: { color: C.orange, precision: 0 }, title: { display: true, text: "Reports", color: C.orange } } } }) });
    const ck = state.fCamps.slice().sort((a, b) => st(b).n - st(a).n || natural(a.camp, b.camp));
    const box = $("#chCamp").parentElement; box.style.height = Math.max(320, ck.length * 20 + 60) + "px";
    chart("chCamp", { type: "bar", data: { labels: ck.map((c) => c.camp), datasets: [
      { label: "Reports", data: ck.map((c) => st(c).n), backgroundColor: ck.map((c) => (st(c).n ? C.green : C.red)), maxBarThickness: 16 },
    ] }, options: baseOpts({ indexAxis: "y", scales: { x: { beginAtZero: true, grid: { color: C.grid }, ticks: { precision: 0, color: C.ink } }, y: { grid: { display: false }, ticks: { color: C.ink, autoSkip: false, font: { size: 11 } } } } }) });
  }

  const distTxt = (r) => (isFinite(r.dist) ? (r.dist > ALERT_KM ? `<span class="badge no">${r.dist.toFixed(2)} km</span>` : `${r.dist.toFixed(2)} km`) : "");
  function renderLatest() {
    const list = state.fReports.slice(-10).reverse();
    $("#latest").innerHTML = list.length ? `<table class="data"><thead><tr><th>Date</th><th>Time</th><th>Basecamp</th><th>Range</th><th>Beat</th><th>Employee</th><th>Designation</th><th>From camp</th><th>Photo</th></tr></thead><tbody>${
      list.map((r) => `<tr data-i="${r.i}" class="go"><td>${esc(fmtDay(r.day))}</td><td>${esc(r.time)}</td><td><b>${esc(r.camp)}</b></td><td>${esc(r.range)}</td><td>${esc(r.beat)}</td><td>${esc(r.employee)}</td><td>${esc(r.designation)}</td><td>${distTxt(r)}</td><td>${r.photos[0] ? imgTag(r.photos[0], "rthumb") : '<span class="badge no">No</span>'}</td></tr>`).join("")}</tbody></table>`
      : `<p class="muted pad">No reports for this selection.</p>`;
  }

  // ---------- maps ----------
  let map, campLayer, repLayer, mini, miniLayer;
  function baseLayers() {
    return {
      "Google Satellite (labels)": L.tileLayer("https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}", { subdomains: "0123", maxZoom: 21, attribution: "Imagery © Google" }),
      "Google Satellite": L.tileLayer("https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", { subdomains: "0123", maxZoom: 21, attribution: "Imagery © Google" }),
      "Google Terrain": L.tileLayer("https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}", { subdomains: "0123", maxZoom: 21, attribution: "Map © Google" }),
      "Esri World Imagery": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, attribution: "Imagery © Esri" }),
      "OpenStreetMap": L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }),
    };
  }
  function initMaps() {
    if (!window.L) return;
    map = L.map("map").setView(CFG.mapCenter, CFG.mapZoom);
    const bl = baseLayers(); bl["Google Satellite (labels)"].addTo(map);
    L.control.layers(bl).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    repLayer = L.markerClusterGroup ? L.markerClusterGroup({ maxClusterRadius: 30, disableClusteringAtZoom: 16 }) : L.layerGroup();
    map.addLayer(repLayer);
    campLayer = L.layerGroup().addTo(map);
    const Ctl = L.Control.extend({ onAdd() {
      const d = L.DomUtil.create("div", "leaflet-bar map-toggle");
      d.innerHTML = `<b>Map options</b><label><input type="checkbox" id="repToggle" checked> Report photo locations</label><label><input type="checkbox" id="lblToggle"> Basecamp names</label>`;
      L.DomEvent.disableClickPropagation(d); return d;
    } });
    map.addControl(new Ctl({ position: "topleft" }));
    $("#repToggle").addEventListener("change", (e) => { state.showReports = e.target.checked; renderMaps(false); });
    $("#lblToggle").addEventListener("change", (e) => { state.labels = e.target.checked; renderMaps(false); });
    mini = L.map("miniMap", { scrollWheelZoom: false }).setView(CFG.mapCenter, CFG.mapZoom);
    baseLayers()["Google Satellite (labels)"].addTo(mini);
    miniLayer = L.layerGroup().addTo(mini);
  }
  function campIcon(c) {
    const s = st(c), cls = s.n ? "ok" : "no";
    return L.divIcon({ className: "camp-pin " + cls, html: `<div><span>⛺</span></div>${state.labels ? `<em>${esc(c.camp)}</em>` : ""}`, iconSize: [30, 38], iconAnchor: [15, 36], popupAnchor: [0, -32] });
  }
  function campPopup(c) {
    const s = st(c), last = s.last;
    const pics = s.photos.slice(-4).reverse().map((r) => imgTag(r.photos[0], "pop-img", c.camp + " " + fmtDay(r.day))).join("");
    return `<div class="popup">
      <div class="pop-h" style="--c:${s.n ? "#2e7d32" : "#c62828"}">${esc(c.camp)}<small>${s.n ? "Reporting" : "No report in period"}</small></div>
      <div class="coords">${c.hasCoord ? `${c.lat.toFixed(5)}° N, ${c.lon.toFixed(5)}° E${c.approx ? " (from report)" : ""} · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${c.lat},${c.lon}&t=k">Google Maps ↗</a>` : "No coordinates"}</div>
      ${pics ? `<div class="pgal">${pics}</div><div class="pcap">Latest photos · click to enlarge</div>` : `<div class="nophoto">No photos in this period</div>`}
      <table>
        <tr><th>Division</th><td>${esc(c.division)}</td></tr><tr><th>Range</th><td>${esc(c.range)}</td></tr>
        <tr><th>Section</th><td>${esc(c.section)}</td></tr><tr><th>Beat</th><td>${esc(c.beat)}</td></tr>
        <tr><th>Reports</th><td>${s.n}</td></tr><tr><th>Days reported</th><td>${s.days} of ${state.period.days.length} (${s.comp}%)</td></tr>
        <tr><th>Last report</th><td>${last ? esc(fmtDay(last.day) + " " + last.time + " · " + last.employee) : "–"}</td></tr>
      </table>
      <div class="pop-act"><button class="btn sm" data-campf="${esc(c.camp)}">Show only this basecamp</button></div></div>`;
  }
  function repPopup(r) {
    const skip = new Set([state.col.photo, state.col.photoName, state.col.lat, state.col.lon].filter(Boolean));
    const rows = state.rHeaders.filter((h) => !skip.has(h) && String(r.raw[h] ?? "").trim() !== "").map((h) => `<tr><th>${esc(h)}</th><td>${esc(r.raw[h])}</td></tr>`).join("");
    const pics = r.photos.map((p) => imgTag(p, "pop-img", r.camp)).join("");
    return `<div class="popup">
      <div class="pop-h" style="--c:#ef8a17">${esc(r.camp)}<small>${esc(fmtDay(r.day))} ${esc(r.time)}</small></div>
      <div class="coords">${r.lat.toFixed(5)}° N, ${r.lon.toFixed(5)}° E${isFinite(r.dist) ? ` · ${r.dist.toFixed(2)} km from basecamp` : ""} · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${r.lat},${r.lon}&t=k">Google Maps ↗</a></div>
      ${pics ? `<div class="pgal">${pics}</div><div class="pcap">Click photo to enlarge</div>` : `<div class="nophoto">No photo link</div>`}
      <table>${rows}</table></div>`;
  }
  function renderMaps(fit) {
    if (!map) return;
    campLayer.clearLayers(); repLayer.clearLayers(); miniLayer.clearLayers();
    const pts = [];
    state.fCamps.filter((c) => c.hasCoord).forEach((c) => {
      const m = L.marker([c.lat, c.lon], { icon: campIcon(c), zIndexOffset: 500 }).bindPopup(() => campPopup(c), { maxWidth: 380, minWidth: 300 });
      m.bindTooltip(esc(c.camp) + ` · ${st(c).n} reports`);
      campLayer.addLayer(m); pts.push([c.lat, c.lon]);
      miniLayer.addLayer(L.circleMarker([c.lat, c.lon], { radius: 7, weight: 2, color: "#fff", fillColor: st(c).n ? "#2e7d32" : "#c62828", fillOpacity: 0.95 }).bindTooltip(esc(c.camp)));
    });
    if (state.showReports) state.fReports.filter((r) => r.hasCoord).forEach((r) => {
      const m = L.circleMarker([r.lat, r.lon], { radius: 6, weight: 2, color: r.dist > ALERT_KM ? "#c62828" : "#fff", fillColor: "#ef8a17", fillOpacity: 0.95 });
      m.bindPopup(() => repPopup(r), { maxWidth: 380, minWidth: 300 }).bindTooltip(esc(r.camp) + " · " + esc(fmtDay(r.day)) + " · " + esc(r.employee));
      repLayer.addLayer(m); pts.push([r.lat, r.lon]);
    });
    const noCoord = state.fCamps.filter((c) => !c.hasCoord).length, rc = reporting().length;
    $("#mapNote").innerHTML = `<div class="lg-title">Legend</div><div class="lg-body">
      <div class="lgx"><span class="camp-dot ok">⛺</span> Basecamp reporting (${rc})</div>
      <div class="lgx"><span class="camp-dot no">⛺</span> Basecamp not reporting (${state.fCamps.length - rc})</div>
      <div class="lgx"><span class="rep-dot"></span> Report photo location (${state.fReports.filter((r) => r.hasCoord).length})</div>
      <div class="lgx"><span class="rep-dot far"></span> Photo taken &gt; ${ALERT_KM} km from basecamp</div>
      ${noCoord ? `<div class="warn">${noCoord} basecamp(s) without coordinates</div>` : ""}
      <div class="muted small">Period: ${esc(periodText())}</div></div>`;
    state.lastBounds = pts.length ? L.latLngBounds(pts) : null;
    if (fit && state.lastBounds) { state.fitMain = true; state.fitMini = true; fitVisible(); }
  }
  function fitVisible() {
    if (!state.lastBounds) return;
    if ($("#view-map").classList.contains("active") && state.fitMain) { state.fitMain = false; map.invalidateSize(); map.fitBounds(state.lastBounds, { maxZoom: 15, padding: [30, 30] }); }
    if ($("#view-dashboard").classList.contains("active") && state.fitMini) { state.fitMini = false; mini.invalidateSize(); mini.fitBounds(state.lastBounds, { maxZoom: 14, padding: [20, 20] }); }
  }

  // ---------- basecamp cards ----------
  function renderCamps() {
    const list = state.fCamps;
    $("#camps").innerHTML = list.length ? list.map((c) => {
      const s = st(c), last = s.last, ph = s.photos[s.photos.length - 1];
      return `<div class="profile" style="--c:${s.n ? "#2e7d32" : "#c62828"}">
        <div class="ph">${ph ? imgTag(ph.photos[0], "", c.camp) : "<span>⛺</span>"}<span class="ph-tag ${s.n ? "ok" : "no"}">${s.n ? "Reporting" : "Not reporting"}</span></div>
        <div class="pb"><h3>${esc(c.camp)} <small>${esc(c.range)} Range</small></h3>
        <dl><dt>Division</dt><dd>${esc(c.division)}</dd><dt>Section</dt><dd>${esc(c.section)}</dd><dt>Beat</dt><dd>${esc(c.beat)}</dd>
        <dt>Reports</dt><dd><b>${s.n}</b> · ${s.days}/${state.period.days.length} days (${s.comp}%)</dd>
        <dt>Last</dt><dd>${last ? esc(fmtDay(last.day) + " · " + last.employee) : "–"}</dd></dl>
        <div class="meter"><i style="width:${Math.min(100, s.comp)}%"></i></div>
        <div class="pop-act"><button class="btn sm" data-locate="${esc(c.key)}" ${c.hasCoord ? "" : "disabled"}>🛰 Map</button><button class="btn sm" data-campf="${esc(c.camp)}">Reports</button></div></div></div>`;
    }).join("") : `<p class="muted">No basecamps for this selection.</p>`;
  }

  // ---------- reports ----------
  function locAbstract(levelKeys, title) {
    const g = group(state.fCamps, (c) => levelKeys.map((k) => c[k]).join("|"));
    const keys = [...g.keys()].sort(natural);
    const rows = keys.map((k) => {
      const cs = g.get(k), reps = state.fReports.filter((r) => levelKeys.map((x) => r[x]).join("|") === k && cs.some((c) => c.key === r.campKey));
      const rc = cs.filter((c) => st(c).n).length;
      return [...k.split("|"), cs.length, rc, cs.length - rc, reps.length, staffIn(reps), Math.round(cs.reduce((s, c) => s + st(c).comp, 0) / cs.length) + "%"];
    });
    const tot = state.fCamps.length, trc = reporting().length;
    rows.push(["Total", ...levelKeys.slice(1).map(() => ""), tot, trc, tot - trc, state.fReports.length, staffIn(state.fReports), (tot ? Math.round(state.fCamps.reduce((s, c) => s + st(c).comp, 0) / tot) : 0) + "%"]);
    return { title, headers: [...levelKeys.map((k) => CFG.labels[k]), "Basecamps", "Reporting", "Not reporting", "Reports", "Staff", "Avg. compliance"], rows, total: true };
  }
  function reportTables() {
    const f = state.fReports, T = [];
    T.push({ key: "camp", title: "Basecamp-wise reporting status", headers: ["Division", "Range", "Section", "Beat", "Basecamp", "Reports", "Days reported", "Compliance", "Staff", "Last report", "Last reported by", "Status"],
      rows: state.fCamps.map((c) => { const s = st(c); return [c.division, c.range, c.section, c.beat, c.camp, s.n, s.days, s.comp + "%", s.staff, s.last ? fmtDay(s.last.day) : "", s.last ? s.last.employee : "", s.n ? "Reporting" : "Not reporting"]; }) });
    T.push({ key: "division", ...locAbstract(["division"], "Division-wise abstract") });
    T.push({ key: "range", ...locAbstract(["division", "range"], "Range-wise abstract") });
    T.push({ key: "section", ...locAbstract(["range", "section"], "Section-wise abstract") });
    T.push({ key: "beat", ...locAbstract(["range", "section", "beat"], "Beat-wise abstract") });
    const mg = group(f, (r) => r.day.slice(0, 7)); const mk = [...mg.keys()].filter(Boolean).sort();
    T.push({ key: "month", title: "Month-wise abstract", headers: ["Year", "Month", "Reports", "Basecamps reporting", "Days with reports", "Staff"], total: true,
      rows: [...mk.map((k) => { const l = mg.get(k); return [k.slice(0, 4), MONTHS[+k.slice(5, 7) - 1], l.length, campsIn(l), daysIn(l), staffIn(l)]; }), ["Total", "", f.length, campsIn(f), daysIn(f), staffIn(f)]] });
    const eg = group(f, (r) => norm(r.employee) + "|" + r.designation); const ek = [...eg.keys()].sort((a, b) => eg.get(b).length - eg.get(a).length);
    T.push({ key: "staff", title: "Employee-wise reports", headers: ["Employee", "Designation", "Basecamp(s)", "Reports", "Days reported", "First report", "Last report"],
      rows: ek.map((k) => { const l = eg.get(k); return [l[0].employee || "(blank)", l[0].designation, uniq(l.map((r) => r.camp)).join(", "), l.length, daysIn(l), fmtDay(l[0].day), fmtDay(l[l.length - 1].day)]; }) });
    T.push({ key: "nonrep", title: "Basecamps not reporting in the period", headers: ["Division", "Range", "Section", "Beat", "Basecamp", "Last report ever"],
      rows: state.fCamps.filter((c) => !st(c).n).map((c) => { const all = state.reports.filter((r) => r.campKey === c.key && r.day).sort((a, b) => (a.day < b.day ? -1 : 1)); return [c.division, c.range, c.section, c.beat, c.camp, all.length ? fmtDay(all[all.length - 1].day) : "Never"]; }) });
    T.push({ key: "away", title: `Photos taken more than ${ALERT_KM} km from the basecamp`, headers: ["Date", "Time", "Basecamp", "Range", "Beat", "Employee", "Designation", "Distance (km)"],
      rows: f.filter((r) => r.dist > ALERT_KM).map((r) => [fmtDay(r.day), r.time, r.camp, r.range, r.beat, r.employee, r.designation, r.dist.toFixed(2)]) });
    T.push({ key: "list", title: "Report list", headers: ["#", "Date", "Time", "Basecamp", "Range", "Section", "Beat", "Employee", "Designation", "Latitude", "Longitude", "From camp (km)", "Photo"], photoCol: 12,
      rows: f.map((r, n) => [n + 1, fmtDay(r.day), r.time, r.camp, r.range, r.section, r.beat, r.employee, r.designation, isFinite(r.lat) ? r.lat : "", isFinite(r.lon) ? r.lon : "", isFinite(r.dist) ? r.dist.toFixed(2) : "", r.photos[0] ? r.photos[0].url : ""]), recs: f });
    return T;
  }
  function letterhead(title) {
    const B = CFG.branding, now = new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" });
    return `<div class="rep-head"><img src="${$("#logoLeft").src}" alt=""><div><div class="rh-s">${esc(B.govLine)}</div><h2>${esc(B.titleSmall)} – ${esc(B.titleMain)}</h2><h4>${esc(title)}</h4></div><img src="${$("#logoRight").src}" alt=""></div>
      <table class="rep-meta"><tr><th>Selection</th><td>${esc(filterSummary())}</td><th>Period</th><td>${esc(periodText())}</td><th>Generated</th><td>${esc(now)}</td></tr></table>`;
  }
  const signs = () => `<div class="signs">${(CFG.signs || []).map((s) => `<div>${s}</div>`).join("")}</div>`;
  function tableHtml(t) {
    const body = t.rows.map((r, i) => `<tr class="${t.total && i === t.rows.length - 1 ? "tot" : ""}">${r.map((c, j) => {
      if (t.photoCol === j) { const rec = t.recs[i]; return `<td>${rec.photos[0] ? imgTag(rec.photos[0], "rthumb") : ""}</td>`; }
      return `<td>${esc(c)}</td>`; }).join("")}</tr>`).join("");
    return `<div class="table-wrap"><table class="data ${t.total ? "pivot" : ""}"><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body || `<tr><td colspan="${t.headers.length}" class="muted">Nothing for this selection.</td></tr>`}</tbody></table></div>`;
  }
  function currentTables() { const all = reportTables(), k = $("#rType").value; return k ? all.filter((t) => t.key === k) : all; }
  function renderReport() {
    const sel = $("#rType"), cur = sel.value, all = reportTables();
    sel.innerHTML = `<option value="">All summaries (full abstract report)</option>` + all.map((t) => `<option value="${t.key}" ${t.key === cur ? "selected" : ""}>${esc(t.title)}</option>`).join("");
    const ts = cur ? all.filter((t) => t.key === cur) : all;
    const tot = state.fCamps.length, rc = reporting().length;
    $("#report").innerHTML = `<div class="paper">${letterhead(cur ? ts[0].title : "Basecamp monitoring – abstract report")}
      <div class="rep-kpis">${kpiData().map(([l, v]) => `<div><b>${v}</b><span>${esc(l)}</span></div>`).join("")}</div>
      ${ts.map((t, n) => `<h3><span class="num">${n + 1}</span> ${esc(t.title)}</h3>${tableHtml(t)}`).join("")}
      <p class="muted small">Compliance = days with at least one report ÷ days in period. ${rc} of ${tot} basecamps reported.</p>${signs()}</div>`;
  }
  function registerData() {
    const sel = $("#regMonth"), months = uniq(state.period.days.map((d) => d.slice(0, 7))).sort().reverse();
    const cur = months.includes(sel.value) ? sel.value : months[0] || "";
    sel.innerHTML = months.map((m) => `<option value="${m}" ${m === cur ? "selected" : ""}>${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}</option>`).join("");
    const days = state.period.days.filter((d) => d.slice(0, 7) === cur);
    const rows = state.fCamps.map((c) => { const l = st(c).list.filter((r) => r.day.slice(0, 7) === cur); const g = group(l, (r) => r.day);
      const cells = days.map((d) => (g.get(d) || []).length || ""); return [c.camp, c.range, ...cells, cells.filter(Boolean).length, l.length]; });
    return { cur, days, title: `Daily attendance register – ${cur ? MONTHS[+cur.slice(5, 7) - 1] + " " + cur.slice(0, 4) : ""}`, headers: ["Basecamp", "Range", ...days.map((d) => d.slice(8)), "Days", "Reports"], rows };
  }
  function renderRegister() {
    const t = registerData();
    $("#registerOut").innerHTML = `<div class="paper">${letterhead(t.title)}<div class="table-wrap"><table class="data register"><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      t.rows.map((r) => `<tr>${r.map((c, j) => `<td class="${j >= 2 && j < r.length - 2 ? (c ? "y" : "n") : ""}">${j >= 2 && j < r.length - 2 ? (c ? "✔" + (c > 1 ? c : "") : "") : esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      <p class="muted small">✔ = report received that day (number = several reports). Empty = no report.</p>${signs()}</div>`;
  }
  const PF = { division: "Division", range: "Range", section: "Section", beat: "Beat", camp: "Basecamp", year: "Year", month: "Month", designation: "Designation", employee: "Employee", day: "Date" };
  function buildPivotFields() {
    const opts = (sel) => Object.entries(PF).map(([k, l]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${l}</option>`).join("");
    $("#pRows").innerHTML = opts("range"); $("#pCols").innerHTML = `<option value="">(none)</option>` + opts("month");
  }
  function pivotData() {
    const R = $("#pRows").value || "range", Cc = $("#pCols").value, V = $("#pVal").value, f = state.fReports;
    const val = (l) => (V === "camps" ? campsIn(l) : V === "days" ? daysIn(l) : V === "staff" ? staffIn(l) : l.length);
    const sorter = (k) => (k === "month" ? (a, b) => MONTHS.indexOf(a) - MONTHS.indexOf(b) : natural);
    const lab = (k, v) => (k === "day" ? fmtDay(v) : v || "(blank)");
    const rk = uniq(f.map((r) => r[R])).sort(sorter(R)), ck = Cc ? uniq(f.map((r) => r[Cc])).sort(sorter(Cc)) : [];
    const rows = rk.map((k) => { const l = f.filter((r) => r[R] === k); return [lab(R, k), ...ck.map((c) => val(l.filter((r) => r[Cc] === c)) || ""), val(l)]; });
    rows.push(["Total", ...ck.map((c) => val(f.filter((r) => r[Cc] === c)) || ""), val(f)]);
    const vl = $("#pVal").selectedOptions[0].textContent;
    return { title: `${vl} by ${PF[R]}${Cc ? " × " + PF[Cc] : ""}`, headers: [PF[R], ...ck.map((c) => lab(Cc, c)), "Total"], rows, total: true };
  }
  function renderPivot() { const t = pivotData(); $("#pivotOut").innerHTML = `<div class="paper">${letterhead("Abstract – " + t.title)}${tableHtml(t)}${signs()}</div>`; }

  // ---------- records ----------
  function renderRecords() {
    const H = state.rHeaders, pc = state.col.photo;
    let list = state.fReports.slice();
    if (state.sortKey) { const k = state.sortKey, d = state.sortDir; list.sort((a, b) => d * (k === "__dist" ? (a.dist || 0) - (b.dist || 0) : natural(a.raw[k] ?? "", b.raw[k] ?? ""))); }
    else list.reverse();
    $("#recCount").textContent = `${list.length} of ${state.reports.length} reports`;
    const th = (h, l) => `<th class="sortable" data-h="${esc(h)}">${esc(l || h)}${state.sortKey === h ? (state.sortDir > 0 ? " ▲" : " ▼") : ""}</th>`;
    $("#recordsTable").innerHTML = `<table class="data"><thead><tr>${H.map((h) => th(h)).join("")}${th("__dist", "From camp")}</tr></thead><tbody>${
      list.map((r) => `<tr class="go" data-i="${r.i}">${H.map((h) => `<td>${h === pc && r.photos[0] ? imgTag(r.photos[0], "rthumb") : esc(r.raw[h])}</td>`).join("")}<td>${distTxt(r)}</td></tr>`).join("")}</tbody></table>`;
  }

  // ---------- export ----------
  const stamp = () => new Date().toISOString().slice(0, 10);
  function recordsAoA() {
    const H = state.rHeaders;
    return [[...H, "Distance from basecamp (km)"], ...state.fReports.map((r) => [...H.map((h) => r.raw[h] ?? ""), isFinite(r.dist) ? +r.dist.toFixed(3) : ""])];
  }
  function download(blob, name) { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); }
  const activePane = () => document.querySelector(".rtab.on").dataset.r;
  function downloadCsv(fromRecords) {
    let aoa, name;
    if (fromRecords === true) { aoa = recordsAoA(); name = "records"; }
    else if (activePane() === "register") { const t = registerData(); aoa = [t.headers, ...t.rows]; name = "attendance_register_" + t.cur; }
    else if (activePane() === "pivot") { const t = pivotData(); aoa = [t.headers, ...t.rows]; name = "pivot"; }
    else { const ts = currentTables(); aoa = ts.length === 1 ? [ts[0].headers, ...ts[0].rows] : recordsAoA(); name = ts.length === 1 ? ts[0].key : "records"; }
    download(new Blob(["﻿" + Papa.unparse(aoa)], { type: "text/csv;charset=utf-8" }), `ATR_basecamp_${name}_${stamp()}.csv`);
  }
  function downloadXlsx(onlyRecords) {
    if (!window.XLSX) return;
    const wb = XLSX.utils.book_new(), B = CFG.branding;
    const add = (aoa, name) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.replace(/[\\/?*[\]:×]/g, "").slice(0, 31));
    add([[B.titleSmall + " – " + B.titleMain], ["Selection", filterSummary()], ["Period", periodText()], ["Generated", new Date().toLocaleString("en-IN")], [], ...kpiData().map(([l, v]) => [l, v])], "Summary");
    if (onlyRecords !== true) {
      currentTables().forEach((t) => add([t.headers, ...t.rows], t.title));
      const r = registerData(); add([r.headers, ...r.rows], "Register " + r.cur);
      const p = pivotData(); add([p.headers, ...p.rows], "Pivot");
    }
    add(recordsAoA(), "All report records");
    XLSX.writeFile(wb, `ATR_basecamp_report_${stamp()}.xlsx`);
  }
  function printPane() { switchView("report"); document.body.dataset.print = activePane(); setTimeout(() => window.print(), 250); }
  window.addEventListener("afterprint", () => { document.body.dataset.print = ""; });

  // ---------- navigation ----------
  function switchView(v) {
    document.querySelectorAll(".menu[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    document.querySelectorAll(".view").forEach((s) => s.classList.toggle("active", s.id === "view-" + v));
    $("#filterBar").hidden = false;
    setTimeout(() => { if (map) { map.invalidateSize(); mini.invalidateSize(); } fitVisible(); Object.values(charts).forEach((c) => c.resize()); }, 60);
  }
  function locateReport(r) {
    if (!r || !r.hasCoord || !map) return;
    switchView("map");
    setTimeout(() => { map.setView([r.lat, r.lon], 16); L.popup({ maxWidth: 380 }).setLatLng([r.lat, r.lon]).setContent(repPopup(r)).openOn(map); }, 120);
  }
  function locateCamp(c) {
    if (!c || !c.hasCoord || !map) return;
    switchView("map");
    setTimeout(() => { map.setView([c.lat, c.lon], 15); L.popup({ maxWidth: 380, offset: [0, -30] }).setLatLng([c.lat, c.lon]).setContent(campPopup(c)).openOn(map); }, 120);
  }
  function openLightbox(img) {
    const lb = $("#lightbox"), li = lb.querySelector("img");
    li.dataset.alt = img.dataset.alt ? img.dataset.alt.replace(/=w\d+$/, "=w1600") : "";
    li.onerror = () => { if (li.dataset.alt) { li.src = li.dataset.alt; li.dataset.alt = ""; } };
    li.src = img.dataset.tried ? img.src : img.dataset.big || img.src;
    lb.querySelector(".lb-open").href = img.dataset.url || img.src;
    lb.hidden = false;
  }
  function applyBranding() {
    const B = CFG.branding;
    $("#govLine").textContent = B.govLine; $("#titleSmall").textContent = B.titleSmall; $("#titleMain").textContent = B.titleMain; $("#titleSub").textContent = B.titleSub;
    if (B.logoLeft) $("#logoLeft").src = B.logoLeft;
    if (B.logoRight) $("#logoRight").src = B.logoRight;
    document.title = B.titleMain + " – " + B.titleSmall;
    $("#yr").textContent = new Date().getFullYear();
    const tick = () => ($("#clock").textContent = new Date().toLocaleString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }));
    tick(); setInterval(tick, 30000);
  }
  function setSeg(v) { $("#f_photo").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.v === v)); }

  document.addEventListener("DOMContentLoaded", () => {
    applyBranding();
    initMaps();
    document.querySelectorAll(".menu[data-view]").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));
    document.querySelectorAll("[data-goto]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); switchView(a.dataset.goto); }));
    $("#f_photo").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; setSeg(b.dataset.v); state.pPhoto = b.dataset.v; refreshOptions(); markDirty(); });
    $("#f_search").addEventListener("input", (e) => { state.pSearch = e.target.value.trim().toLowerCase(); markDirty(); });
    $("#f_search").addEventListener("keydown", (e) => { if (e.key === "Enter") { refreshOptions(); commitFilters(); } });
    $("#f_from").addEventListener("change", (e) => { state.pFrom = e.target.value; refreshOptions(); markDirty(); });
    $("#f_to").addEventListener("change", (e) => { state.pTo = e.target.value; refreshOptions(); markDirty(); });
    $("#applyBtn").addEventListener("click", commitFilters);
    $("#resetBtn").addEventListener("click", () => {
      state.pending = {}; state.pPhoto = ""; state.pSearch = ""; state.pFrom = ""; state.pTo = "";
      $("#f_search").value = ""; $("#f_from").value = ""; $("#f_to").value = ""; setSeg(""); commitFilters();
    });
    $("#refreshBtn").addEventListener("click", load);
    $("#printBtn").addEventListener("click", printPane);
    $("#csvBtn").addEventListener("click", () => downloadCsv(false));
    $("#xlsxBtn").addEventListener("click", () => downloadXlsx(false));
    $("#csvBtn2").addEventListener("click", () => downloadCsv(true));
    $("#xlsxBtn2").addEventListener("click", () => downloadXlsx(true));
    $("#rType").addEventListener("change", renderReport);
    $("#regMonth").addEventListener("change", renderRegister);
    ["#pRows", "#pCols", "#pVal"].forEach((s) => $(s).addEventListener("change", renderPivot));
    document.querySelectorAll(".rtab").forEach((b) => b.addEventListener("click", () => {
      document.querySelectorAll(".rtab").forEach((x) => x.classList.toggle("on", x === b));
      document.querySelectorAll(".rpane").forEach((p) => (p.hidden = p.dataset.r !== b.dataset.r));
    }));
    $("#recordsTable").addEventListener("click", (e) => {
      const th = e.target.closest("th.sortable");
      if (th) { e.stopPropagation(); const h = th.dataset.h; state.sortDir = state.sortKey === h ? -state.sortDir : 1; state.sortKey = h; renderRecords(); }
    });
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("pthumb")) { e.preventDefault(); e.stopPropagation(); openLightbox(e.target); return; }
      if (e.target.matches(".lightbox, .lb-close")) { $("#lightbox").hidden = true; return; }
      const cf = e.target.closest("[data-campf]");
      if (cf) { state.pending = { ...state.filters, camp: cf.dataset.campf }; commitFilters(); switchView("records"); return; }
      const lc = e.target.closest("[data-locate]");
      if (lc) { locateCamp(state.camps.find((c) => c.key === lc.dataset.locate)); return; }
      const tr = e.target.closest("tr.go[data-i]");
      if (tr) locateReport(state.reports[+tr.dataset.i]);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#lightbox").hidden = true; });
    document.addEventListener("error", (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || !img.classList.contains("pthumb")) return;
      if (img.dataset.alt && !img.dataset.tried) { img.dataset.tried = "1"; img.src = img.dataset.alt; return; }
      const holder = img.closest(".ph");
      if (holder) { img.replaceWith(Object.assign(document.createElement("span"), { textContent: "⛺" })); return; }
      img.replaceWith(Object.assign(document.createElement("a"), { href: img.dataset.url, target: "_blank", rel: "noopener", textContent: "📷 Open photo", className: "photo-link" }));
    }, true);
    load();
  });

  window.__BC = { state, parseDate, parseCoord, ingest };
})();
