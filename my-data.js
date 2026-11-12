// my-data.js
let currentData = null;
let currentTab = "visits";

document.addEventListener("DOMContentLoaded", loadAll);

async function loadAll() {
  const res = await chrome.storage.local.get("productivityData");
  currentData = res.productivityData || {};
  renderLevelInfo();
  renderStorageInfo();
  renderSummary();
  renderView();
  bindEvents();
}

function renderLevelInfo() {
  const el = document.getElementById("level-info");
  const lvl = currentData.analysis?.level || "light";
  const labels = {
    light: "🟢 Ligero",
    standard: "🔵 Estándar",
    invasive: "🟠 Invasivo",
    total: "🔴 Total (panóptico)",
  };
  const days = currentData.analysis?.retentionDays?.[lvl] || 30;
  const totalActive =
    currentData.analysis?.totalConfirmedAt &&
    (!currentData.analysis.totalExpiresAt ||
      Date.now() < currentData.analysis.totalExpiresAt);
  el.innerHTML = `
    <p>Nivel actual: <span class="level-badge level-${lvl}">${labels[lvl]}</span></p>
    <p>Retención: ${days} días</p>
    ${totalActive ? `<p style="color:#c62828;">⚠️ Modo TOTAL activo${currentData.analysis.totalExpiresAt ? ` hasta ${new Date(currentData.analysis.totalExpiresAt).toLocaleString()}` : ""}</p>` : ""}
    ${currentData.analysis?.pausedUntil && Date.now() < currentData.analysis.pausedUntil ? `<p style="color:#9E9E9E;">⏸ Pausado hasta ${new Date(currentData.analysis.pausedUntil).toLocaleString()}</p>` : ""}
  `;
}

async function renderStorageInfo() {
  const bytes = await chrome.storage.local.getBytesInUse("productivityData");
  const kb = (bytes / 1024).toFixed(1);
  const quota = 10 * 1024 * 1024;
  const pct = ((bytes / quota) * 100).toFixed(2);
  document.getElementById("storage-info").innerHTML = `
    <div class="stat"><div class="stat-num">${kb} KB</div><div class="stat-lbl">Almacenamiento usado</div></div>
    <div class="stat"><div class="stat-num">${pct}%</div><div class="stat-lbl">De 10 MB (cuota)</div></div>
  `;
}

function renderSummary() {
  const ai = currentData.aiData || {};
  const visits = ai.visits || [];
  const byDomain = ai.byDomain || {};
  const transitions = ai.transitions || [];
  const tabEvents = ai.tabEvents || [];
  const idle = ai.idleEvents || [];
  const chains = ai.distractionChains || [];
  const rapidReopens = ai.rapidReopens || [];

  document.getElementById("data-summary").innerHTML = `
    <div class="stat"><div class="stat-num">${visits.length}</div><div class="stat-lbl">Visitas registradas</div></div>
    <div class="stat"><div class="stat-num">${Object.keys(byDomain).length}</div><div class="stat-lbl">Dominios únicos</div></div>
    <div class="stat"><div class="stat-num">${transitions.length}</div><div class="stat-lbl">Transiciones</div></div>
    <div class="stat"><div class="stat-num">${tabEvents.length}</div><div class="stat-lbl">Eventos de pestaña</div></div>
    <div class="stat"><div class="stat-num">${idle.length}</div><div class="stat-lbl">Eventos idle</div></div>
    <div class="stat"><div class="stat-num">${chains.length}</div><div class="stat-lbl">Cadenas detectadas</div></div>
    <div class="stat"><div class="stat-num">${rapidReopens.length}</div><div class="stat-lbl">Reaperturas rápidas</div></div>
  `;
}

function renderView() {
  const ai = currentData.aiData || {};
  const el = document.getElementById("data-view");
  let content = "";
  if (currentTab === "visits") {
    content =
      (ai.visits || [])
        .slice(-100)
        .reverse()
        .map(
          (v) =>
            `[${new Date(v.timestamp).toLocaleString()}] ${v.domain}${v.path || ""} (${Math.round((v.duration || 0) / 1000)}s)${v.isGroup ? " [GRUPO]" : ""}`,
        )
        .join("\n") || "Sin visitas";
  } else if (currentTab === "byDomain") {
    content =
      Object.entries(ai.byDomain || {})
        .sort((a, b) => (b[1].totalTime || 0) - (a[1].totalTime || 0))
        .map(
          ([d, v]) =>
            `${d}: ${v.visits} visitas, ${Math.round((v.totalTime || 0) / 60000)} min totales`,
        )
        .join("\n") || "Sin datos";
  } else if (currentTab === "transitions") {
    content =
      (ai.transitions || [])
        .slice(-50)
        .reverse()
        .map(
          (t) => `${t.from} → ${t.to} (${Math.round((t.gapMs || 0) / 1000)}s)`,
        )
        .join("\n") || "Sin transiciones";
  } else if (currentTab === "tabEvents") {
    content =
      (ai.tabEvents || [])
        .slice(-50)
        .reverse()
        .map(
          (e) =>
            `[${new Date(e.timestamp).toLocaleString()}] ${e.type} ${e.url}${e.lifetime ? ` (vida ${Math.round(e.lifetime / 1000)}s)` : ""}`,
        )
        .join("\n") || "Sin eventos";
  } else if (currentTab === "idle") {
    content =
      (ai.idleEvents || [])
        .slice(-50)
        .reverse()
        .map((e) => `[${new Date(e.timestamp).toLocaleString()}] ${e.state}`)
        .join("\n") || "Sin eventos idle";
  } else if (currentTab === "full") {
    content = JSON.stringify(currentData, null, 2);
  }
  el.textContent = content;
}

function bindEvents() {
  document.querySelectorAll("#tab-bar button").forEach((b) => {
    b.addEventListener("click", () => {
      document
        .querySelectorAll("#tab-bar button")
        .forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      currentTab = b.dataset.tab;
      renderView();
    });
  });

  document.getElementById("export-btn").addEventListener("click", async () => {
    const res = await chrome.storage.local.get("productivityData");
    const blob = new Blob([JSON.stringify(res, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `productivity-data-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("purge-btn").addEventListener("click", async () => {
    if (!confirm("¿Purgar datos más antiguos que la retención configurada?"))
      return;
    await chrome.runtime.sendMessage({ action: "purgeData" });
    alert("✅ Datos purgados");
    loadAll();
  });

  document
    .getElementById("delete-all-btn")
    .addEventListener("click", async () => {
      if (
        !confirm(
          "¿Borrar TODO el historial de análisis? Esto no afecta a tus grupos ni configuración.",
        )
      )
        return;
      const res = await chrome.storage.local.get("productivityData");
      const d = res.productivityData || {};
      d.aiData = {
        focusByUrl: {},
        heatmap: {},
        visibilityEvents: [],
        tabSwitches: [],
        tabEvents: [],
        idleEvents: [],
        bypassPatterns: {
          afterMinutes: [],
          returnAfterBypass: [],
          hourOfDay: {},
        },
        sequences: [],
        rapidReopens: [],
        resistance: [],
        visits: [],
        byDomain: {},
        transitions: [],
        distractionChains: [],
        lastCompact: null,
      };
      d.ai = { patterns: {}, recommendations: [], lastAnalysis: null };
      d.stats = {
        totalSessions: 0,
        totalBreaks: 0,
        totalSessionTime: 0,
        totalBreakTime: 0,
        breaksRespected: 0,
        bypassUsed: 0,
        bypassHistory: [],
        history: [],
        dailyStats: {},
        urlVisits: {},
        streak: { current: 0, best: 0, lastDate: null },
      };
      await chrome.storage.local.set({ productivityData: d });
      alert("✅ Historial borrado");
      loadAll();
    });
}
