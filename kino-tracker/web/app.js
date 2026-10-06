"use strict";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nf = new Intl.NumberFormat("bg-BG");
const fmt = (n) => (n == null ? "—" : nf.format(Math.round(n)));
const eur = (n) => (n == null ? "—" : "€" + nf.format(Math.round(n)));
const SRC = { nfc: "НФЦ", forum: "Форум", cinemas: "Кина" };
const fold = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

const state = { films: [], byKey: {}, charts: [], cinemas: [], status: {}, daily: {}, posts: null, chartIdx: 0 };

async function getJSON(name, fallback) {
  for (const base of ["data/", "../data/"]) {
    try {
      const r = await fetch(base + name, { cache: "no-cache" });
      if (r.ok) return await r.json();
    } catch (_) { /* try next */ }
  }
  return fallback;
}

// ------------------------------------------------------------ tabs
document.querySelectorAll("#tabs button").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(t) {
  if (!document.getElementById("tab-" + t)) t = "now";
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  document.querySelectorAll(".tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + t));
  if (location.hash !== "#" + t) history.replaceState(null, "", "#" + t);
  if (t === "forum") loadForum();
}

// ------------------------------------------------------------ now showing
function renderNow() {
  const q = fold($("#now-q").value), city = $("#now-city").value, sort = $("#now-sort").value;
  let list = state.films.filter((f) => f.now_showing);
  if (city) list = list.filter((f) => f.cities.includes(city));
  if (q) list = list.filter((f) => f.titles.some((t) => fold(t).includes(q)));
  list.sort(sort === "title" ? (a, b) => a.title.localeCompare(b.title, "bg") : (a, b) => b[sort] - a[sort]);
  $("#now-grid").innerHTML = list.length ? list.map((f) => `
    <div class="card" data-key="${esc(f.key)}">
      <div class="poster">${f.poster ? `<img loading="lazy" src="${esc(f.poster)}" alt="" onerror="this.replaceWith('🎞')">` : "🎞"}</div>
      <div class="info">
        <h3>${esc(f.title_bg || f.title)}</h3>
        ${f.title_bg && f.title_bg !== f.title ? `<div class="muted small">${esc(f.title)}</div>` : ""}
        <span class="pill">${f.screenings} прож.</span><span class="pill">${f.venues} кина</span>
        ${f.total_gross_eur ? `<div class="small muted">Общо: ${eur(f.total_gross_eur)}</div>` : ""}
      </div>
    </div>`).join("") : `<div class="empty">Няма данни за програмите още. Пуснете GitHub Action „Scrape cinema data“.</div>`;
}
$("#now-grid").addEventListener("click", (e) => { const c = e.target.closest(".card"); if (c) openFilm(c.dataset.key); });
["#now-q", "#now-city", "#now-sort"].forEach((s) => $(s).addEventListener("input", renderNow));

// ------------------------------------------------------------ box office charts
function chartList() {
  const src = $("#chart-source").value;
  return state.charts.filter((c) => !src || c.source === src);
}
function fillWeeks() {
  const list = chartList();
  $("#chart-week").innerHTML = list.map((c, i) =>
    `<option value="${i}">${c.period_start || ""} – ${c.period_end} · ${SRC[c.source]}${c.estimate ? " (оценка)" : ""}</option>`).join("");
  state.chartIdx = 0;
  renderChart();
}
function renderChart() {
  const list = chartList(), c = list[state.chartIdx];
  $("#chart-week").value = state.chartIdx;
  if (!c) {
    $("#chart-table").innerHTML = `<tr><td class="empty">Няма класации още.</td></tr>`;
    $("#chart-meta").textContent = "";
    return;
  }
  const label = c.period === "week" ? "седмица" : "уикенд";
  $("#chart-meta").innerHTML = `${SRC[c.source]} · ${label} ${c.period_start} – ${c.period_end}` +
    (c.author ? ` · от ${esc(c.author)}` : "") + (c.url ? ` · <a href="${esc(c.url)}" target="_blank" rel="noopener">източник</a>` : "");
  const has = (f) => c.entries.some((e) => e[f] != null);
  const cols = [
    ["rank", "#", (e) => e.rank, "num"],
    ["title", "Филм", (e) => `${esc(e.title)}${e.original_title ? `<div class="muted small">${esc(e.original_title)}</div>` : ""}${e.new ? ' <span class="pill">ново</span>' : ""}`, "title"],
    ["distributor", "Разпространител", (e) => esc(e.distributor || "")],
    ["weekend_gross", label === "седмица" ? "Приходи седм." : "Приходи уикенд", (e) => money(e, "weekend_gross"), "num"],
    ["change_pct", "±%", (e) => e.change_pct == null ? "" : `<span class="${e.change_pct >= 0 ? "up" : "down"}">${e.change_pct > 0 ? "+" : ""}${e.change_pct}%</span>`, "num"],
    ["weekend_adm", "Зрители", (e) => fmt(e.weekend_adm), "num"],
    ["total_gross", "Общо приходи", (e) => money(e, "total_gross"), "num"],
    ["total_adm", "Общо зрители", (e) => fmt(e.total_adm), "num"],
    ["week", "Седм.", (e) => e.week ?? "", "num"],
  ].filter(([f]) => f === "rank" || f === "title" || has(f));
  $("#chart-table").innerHTML = `<thead><tr>${cols.map(([, h, , cl]) => `<th class="${cl || ""}">${h}</th>`).join("")}</tr></thead><tbody>` +
    c.entries.map((e) => `<tr class="click" data-key="${esc(e.key)}">${cols.map(([, , fn, cl]) => `<td class="${cl || ""}">${fn(e)}</td>`).join("")}</tr>`).join("") + "</tbody>";
}
function money(e, f) {
  const v = e[f]; if (v == null) return "—";
  const conv = e[f + "_eur"];
  if (e.currency === "EUR" || conv == null) return `${e.currency === "USD" ? "$" : e.currency === "EUR" ? "€" : ""}${fmt(v)}${e.currency === "BGN" ? " лв" : ""}`;
  return `<span title="${fmt(v)} лв">${eur(conv)}</span>`;
}
$("#chart-source").addEventListener("input", fillWeeks);
$("#chart-week").addEventListener("input", (e) => { state.chartIdx = +e.target.value; renderChart(); });
$("#chart-prev").addEventListener("click", () => { if (state.chartIdx < chartList().length - 1) { state.chartIdx++; renderChart(); } });
$("#chart-next").addEventListener("click", () => { if (state.chartIdx > 0) { state.chartIdx--; renderChart(); } });
$("#chart-table").addEventListener("click", (e) => { const r = e.target.closest("tr[data-key]"); if (r) openFilm(r.dataset.key); });

// ------------------------------------------------------------ all films
function renderFilms() {
  const q = fold($("#films-q").value), year = $("#films-year").value, sort = $("#films-sort").value;
  let list = state.films.filter((f) => f.runs.length || f.now_showing);
  if (q) list = list.filter((f) => f.titles.some((t) => fold(t).includes(q)) || fold(f.distributor).includes(q));
  if (year) list = list.filter((f) => (f.first_chart || "").startsWith(year));
  const by = {
    gross: (a, b) => (b.total_gross_eur || 0) - (a.total_gross_eur || 0),
    adm: (a, b) => (b.total_adm || 0) - (a.total_adm || 0),
    recent: (a, b) => (b.last_chart || "9").localeCompare(a.last_chart || "9"),
    title: (a, b) => a.title.localeCompare(b.title, "bg"),
  }[sort];
  list.sort(by);
  $("#films-table").innerHTML = `<thead><tr><th class="num">#</th><th>Филм</th><th>Период</th><th class="num">Най-добро място</th>
    <th class="num">Общо приходи</th><th class="num">Общо зрители</th><th>Източници</th></tr></thead><tbody>` +
    (list.slice(0, 600).map((f, i) => `<tr class="click" data-key="${esc(f.key)}">
      <td class="num">${i + 1}</td>
      <td class="title">${esc(f.title)}${f.title_bg && f.title_bg !== f.title ? `<div class="muted small">${esc(f.title_bg)}</div>` : ""}</td>
      <td class="small">${f.first_chart ? `${f.first_chart} → ${f.last_chart}` : ""}${f.now_showing ? ' <span class="pill">в кината</span>' : ""}</td>
      <td class="num">${f.best_rank ?? "—"}</td><td class="num">${eur(f.total_gross_eur)}</td>
      <td class="num">${fmt(f.total_adm)}${f.total_adm_estimated ? "*" : ""}</td>
      <td class="small">${f.sources.map((s) => SRC[s]).join(", ")}</td></tr>`).join("") ||
      `<tr><td colspan="7" class="empty">Няма филми.</td></tr>`) + "</tbody>";
}
["#films-q", "#films-year", "#films-sort"].forEach((s) => $(s).addEventListener("input", renderFilms));
$("#films-table").addEventListener("click", (e) => { const r = e.target.closest("tr[data-key]"); if (r) openFilm(r.dataset.key); });

// ------------------------------------------------------------ cinemas + status
function renderCinemas() {
  const s = state.status, rows = [];
  for (const [name, v] of Object.entries(s.sources || {}))
    rows.push([name === "nfc" ? "НФЦ бокс офис" : name === "forum" ? "BoxOfficeTheory форум" : name, v.ok, v.note || Object.entries(v).filter(([k]) => !["ok", "note", "at"].includes(k)).map(([k, x]) => `${k}: ${x}`).join(", "), v.at]);
  for (const c of s.cinemas || []) rows.push([c.name, c.ok, c.note || `${c.films} филма${c.cinemas > 1 ? `, ${c.cinemas} кина` : ""}`, s.generated_at]);
  $("#status-table").innerHTML = `<thead><tr><th>Източник</th><th>Статус</th><th>Детайли</th><th>Обновено</th></tr></thead><tbody>` +
    (rows.map(([n, ok, note, at]) => `<tr><td>${esc(n)}</td><td class="${ok ? "ok" : "err"}">${ok ? "✔ OK" : "✖ проблем"}</td><td class="title small">${esc(note)}</td><td class="small muted">${esc((at || "").replace("T", " ").slice(0, 16))}</td></tr>`).join("") ||
      `<tr><td colspan="4" class="empty">Скрейпърът още не е пускан.</td></tr>`) + "</tbody>";
  const byCity = {};
  for (const c of state.cinemas) (byCity[c.city || "—"] ||= []).push(c);
  $("#cinema-list").innerHTML = Object.keys(byCity).sort((a, b) => a.localeCompare(b, "bg")).map((city) =>
    `<h3>${esc(city)}</h3>` + byCity[city].map((c) => `<details class="cinema"><summary>${esc(c.name)} <span class="muted small">· ${c.films.length} филма</span></summary>
      <ul>${c.films.map((f) => `<li><a href="#" data-key="${esc(f.key)}">${esc(f.title)}</a> <span class="times">${showtimes(f.showtimes)}</span></li>`).join("")}</ul></details>`).join("")).join("");
}
function showtimes(list) {
  const byDay = {};
  for (const s of list || []) {
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(s);
    const [d, t] = m ? [m[1].slice(5).split("-").reverse().join("."), m[2]] : ["", s];
    (byDay[d] ||= []).push(t);
  }
  return Object.entries(byDay).slice(0, 3).map(([d, ts]) => `${d ? d + ": " : ""}${ts.sort().join(", ")}`).join(" · ");
}
$("#cinema-list").addEventListener("click", (e) => { const a = e.target.closest("a[data-key]"); if (a) { e.preventDefault(); openFilm(a.dataset.key); } });

// ------------------------------------------------------------ forum archive
let forumShown = 50;
async function loadForum() {
  if (state.posts) return;
  state.posts = [];
  $("#forum-list").innerHTML = `<div class="empty">Зареждане…</div>`;
  const d = await getJSON("forum_posts.json", { posts: [] });
  state.posts = d.posts.slice().reverse();
  state.chartUrls = new Set(state.charts.filter((c) => c.source === "forum").map((c) => c.url));
  renderForum();
}
function renderForum() {
  const q = fold($("#forum-q").value), only = $("#forum-charts-only").checked;
  let list = state.posts || [];
  if (only) list = list.filter((p) => state.chartUrls.has(p.url));
  if (q) list = list.filter((p) => fold(p.text).includes(q));
  $("#forum-list").innerHTML = list.slice(0, forumShown).map((p) => `<div class="post">
    <div class="small muted">${esc((p.date || "").slice(0, 10))} · ${esc(p.author || "")} · стр. ${p.page}
      · <a href="${esc(p.url)}" target="_blank" rel="noopener">оригинал</a>${state.chartUrls.has(p.url) ? ' <span class="pill">класация</span>' : ""}</div>
    <pre>${esc(p.text)}</pre></div>`).join("") || `<div class="empty">Няма постове. Форумът се обхожда от GitHub Action.</div>`;
  $("#forum-more").style.display = list.length > forumShown ? "" : "none";
}
$("#forum-q").addEventListener("input", () => { forumShown = 50; renderForum(); });
$("#forum-charts-only").addEventListener("input", renderForum);
$("#forum-more").addEventListener("click", () => { forumShown += 50; renderForum(); });

// ------------------------------------------------------------ film dialog
let chartObj;
function openFilm(key) {
  const f = state.byKey[key];
  if (!f) return;
  const runs = f.runs.slice().sort((a, b) => a.period_end.localeCompare(b.period_end));
  const venues = state.cinemas.filter((c) => c.films.some((x) => x.key === key));
  $("#film-body").innerHTML = `
    <div class="film-head">${f.poster ? `<img src="${esc(f.poster)}" alt="">` : ""}
      <div><h2 style="margin:0">${esc(f.title)}</h2>
        <div class="muted">${f.titles.filter((t) => t !== f.title).map(esc).join(" · ")}</div>
        <div class="small">${[f.distributor, f.release && "премиера " + f.release, f.country].filter(Boolean).map(esc).join(" · ")}</div>
        ${f.now_showing ? `<span class="pill">в ${f.venues} кина · ${f.screenings} прожекции</span>` : ""}</div></div>
    <div class="stats">
      <div class="stat"><span class="muted small">Общо приходи</span><b>${eur(f.total_gross_eur)}</b></div>
      <div class="stat"><span class="muted small">Общо зрители</span><b>${fmt(f.total_adm)}</b></div>
      <div class="stat"><span class="muted small">Най-добро място</span><b>${f.best_rank ?? "—"}</b></div>
      <div class="stat"><span class="muted small">В класациите</span><b>${new Set(runs.map((r) => r.period_end)).size} седм.</b></div>
    </div>
    ${runs.length ? `<div class="chart-box"><canvas id="film-chart"></canvas></div>` : ""}
    ${runs.length ? `<div class="table-wrap"><table><thead><tr><th>Период</th><th>Източник</th><th class="num">#</th><th class="num">Приходи</th><th class="num">Зрители</th><th class="num">Общо приходи</th><th class="num">Общо зрители</th></tr></thead><tbody>
      ${runs.slice().reverse().map((r) => `<tr><td>${r.period_end}</td><td>${SRC[r.source]}${r.period === "week" ? " (седм.)" : ""}</td><td class="num">${r.rank ?? ""}</td>
      <td class="num">${money(r, "weekend_gross")}</td><td class="num">${fmt(r.weekend_adm)}</td><td class="num">${money(r, "total_gross")}</td><td class="num">${fmt(r.total_adm)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${venues.length ? `<h3>Програма</h3><ul>${venues.map((c) => `<li><b>${esc(c.name)}</b> <span class="muted small">${esc(c.city || "")}</span>
      <div class="times">${showtimes(c.films.find((x) => x.key === key).showtimes)}</div></li>`).join("")}</ul>` : ""}`;
  $("#film-dialog").showModal();
  if (chartObj) chartObj.destroy();
  const cv = $("#film-chart");
  if (!cv) return;
  if (!window.Chart) { cv.parentElement.remove(); return; }
  const labels = [...new Set(runs.map((r) => r.period_end))];
  const css = getComputedStyle(document.documentElement);
  const series = (src, field) => labels.map((d) => runs.find((r) => r.source === src && r.period_end === d)?.[field] ?? null);
  const useGross = runs.some((r) => r.weekend_gross_eur != null);
  const field = useGross ? "weekend_gross_eur" : "weekend_adm";
  chartObj = new Chart(cv, {
    type: "line",
    data: { labels, datasets: [
      { label: `НФЦ – ${useGross ? "приходи €" : "зрители"}`, data: series("nfc", field), borderColor: css.getPropertyValue("--accent"), spanGaps: true },
      { label: `Форум – ${useGross ? "приходи €" : "зрители"}`, data: series("forum", field), borderColor: css.getPropertyValue("--muted"), borderDash: [4, 4], spanGaps: true },
    ].filter((d) => d.data.some((v) => v != null)) },
    options: { maintainAspectRatio: false, plugins: { legend: { labels: { color: css.getPropertyValue("--text") } } },
      scales: { x: { ticks: { color: css.getPropertyValue("--muted") } }, y: { ticks: { color: css.getPropertyValue("--muted") } } } },
  });
}

// ------------------------------------------------------------ boot
(async function boot() {
  const [films, charts, show, status, daily] = await Promise.all([
    getJSON("films.json", { films: [] }), getJSON("charts.json", { charts: [] }),
    getJSON("showtimes.json", { cinemas: [] }), getJSON("status.json", {}), getJSON("daily.json", {}),
  ]);
  state.films = films.films || [];
  state.films.forEach((f) => (state.byKey[f.key] = f));
  state.charts = charts.charts || [];
  state.cinemas = show.cinemas || [];
  state.status = status; state.daily = daily;
  $("#updated").textContent = status.generated_at ? "Обновено: " + new Date(status.generated_at).toLocaleString("bg-BG") : "Още няма данни";
  const cities = [...new Set(state.films.flatMap((f) => f.cities))].sort((a, b) => a.localeCompare(b, "bg"));
  $("#now-city").insertAdjacentHTML("beforeend", cities.map((c) => `<option>${esc(c)}</option>`).join(""));
  const years = [...new Set(state.films.map((f) => (f.first_chart || "").slice(0, 4)).filter(Boolean))].sort().reverse();
  $("#films-year").insertAdjacentHTML("beforeend", years.map((y) => `<option>${y}</option>`).join(""));
  renderNow(); fillWeeks(); renderFilms(); renderCinemas();
  showTab((location.hash || "#now").slice(1).replace(/[^a-z]/g, "") || "now");
})();
window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));
