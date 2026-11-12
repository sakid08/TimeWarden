// dashboard.js
document.addEventListener("DOMContentLoaded", loadDashboard);

async function loadDashboard() {
  const data = await chrome.storage.local.get("productivityData");
  const d = data.productivityData || {};
  renderSummary(d);
  renderWeeklyChart(d);
  renderRecs(d);
  renderUrls(d);
  renderHistory(d);
}

function renderSummary(d) {
  const s = d.stats || {};
  const grid = document.getElementById("summary-grid");
  const items = [
    ["Sesiones", s.totalSessions || 0],
    ["Descansos", s.totalBreaks || 0],
    ["Respetados", s.breaksRespected || 0],
    ["Bypass", s.bypassUsed || 0],
    ["Racha actual", (s.streak?.current || 0) + "d"],
    ["Mejor racha", (s.streak?.best || 0) + "d"],
  ];
  grid.innerHTML = items
    .map(
      ([l, v]) => `
    <div class="stat"><div class="stat-num">${v}</div><div class="stat-lbl">${l}</div></div>
  `,
    )
    .join("");
}

function renderWeeklyChart(d) {
  const daily = d.stats?.dailyStats || {};
  const container = document.getElementById("weekly-chart");
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const key = dt.toISOString().split("T")[0];
    days.push({
      key,
      label: dt.toLocaleDateString("es", { weekday: "short" }),
      data: daily[key] || { sessions: 0, breaks: 0, bypass: 0 },
    });
  }
  const max = Math.max(1, ...days.map((x) => x.data.sessions || 0));
  container.innerHTML = days
    .map((x) => {
      const h = ((x.data.sessions || 0) / max) * 180;
      return `<div class="bar" style="height:${h}px;" title="${x.key}: ${x.data.sessions} sesiones">
      <div class="bar-value">${x.data.sessions || 0}</div>
      <div class="bar-label">${x.label}</div>
    </div>`;
    })
    .join("");
}

function renderRecs(d) {
  const container = document.getElementById("recs-container");
  const recs = d.ai?.recommendations || [];
  if (!recs.length) {
    container.innerHTML =
      '<p style="color:#666;">No hay recomendaciones todavía.</p>';
    return;
  }
  container.innerHTML = recs
    .map(
      (r) => `
    <div class="rec ${r.type}"><strong>${r.title}</strong><br><span style="font-size:13px;">${r.message}</span></div>
  `,
    )
    .join("");
}

function renderUrls(d) {
  const container = document.getElementById("urls-container");
  const byDomain = d.aiData?.byDomain || {};
  const sorted = Object.entries(byDomain)
    .sort((a, b) => (b[1].visits || 0) - (a[1].visits || 0))
    .slice(0, 10);

  if (!sorted.length) {
    container.innerHTML =
      '<p style="color:#666;">Sin datos de dominios todavía.</p>';
    return;
  }
  container.innerHTML = sorted
    .map(([domain, v]) => {
      const min = Math.round((v.totalTime || 0) / 60000);
      return `<div class="url-row"><span>${domain}</span><strong>${v.visits} visitas · ${min} min</strong></div>`;
    })
    .join("");
}

function renderHistory(d) {
  const container = document.getElementById("history-container");
  const hist = (d.stats?.history || []).slice(-20).reverse();
  if (!hist.length) {
    container.innerHTML = '<p style="color:#666;">Sin historial todavía.</p>';
    return;
  }
  container.innerHTML = hist
    .map((h) => {
      const date = new Date(h.timestamp).toLocaleString();
      const icon =
        h.type === "session" ? "✅" : h.type === "break" ? "⏳" : "❓";
      return `<div class="history-item"><span>${icon} ${h.type} · ${h.duration} min</span><span style="color:#999;">${date}</span></div>`;
    })
    .join("");
}
