// popup.js
let currentData = null;
let currentTab = null;
let currentTabUrl = "";
let currentTabHost = "";
let tickTimer = null;

document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  if (tab?.url) {
    currentTabUrl = tab.url;
    try {
      currentTabHost = new URL(tab.url).hostname;
    } catch {}
  }
  await refresh();
  bindEvents();
  tickTimer = setInterval(updateTimer, 1000);
});

async function refresh() {
  const s = await chrome.runtime.sendMessage({ action: "getStatus" });
  currentData = s;
  renderLevelBanner(s);
  renderModes(s);
  renderTimer(s);
  renderStreak(s);
  renderAITip(s);
  renderQuickStats(s);
  renderPageInfo();
  await renderGroups();
  renderPageStatus();
  renderPauseButtons(s);
}

function renderLevelBanner(s) {
  const el = document.getElementById("level-banner");
  el.className = "level-banner";
  if (s.analysis?.pausedUntil && Date.now() < s.analysis.pausedUntil) {
    el.classList.add("level-paused");
    el.textContent = "⏸ Análisis pausado";
    document.getElementById("level-select").value = s.level || "light";
    return;
  }
  const labels = {
    light: "🟢 Análisis: Ligero",
    standard: "🔵 Análisis: Estándar",
    invasive: "🟠 Análisis: Invasivo",
    total: "🔴 Análisis: TOTAL (panóptico)",
  };
  el.textContent = labels[s.level] || labels.light;
  el.classList.add("level-" + (s.level || "light"));
  document.getElementById("level-select").value = s.level || "light";
}

function renderModes(s) {
  const c = document.getElementById("mode-selector");
  c.innerHTML = "";
  const modes = [
    { id: "work", icon: "💼", name: "Trabajo" },
    { id: "chill", icon: "🌴", name: "Chill" },
    { id: "focus", icon: "🎯", name: "Enfoque" },
    { id: "study", icon: "📚", name: "Estudio" },
    { id: "custom", icon: "⚙️", name: "Custom" },
  ];
  modes.forEach((m) => {
    const b = document.createElement("button");
    b.className = "mode-btn" + (s.mode === m.id ? " active" : "");
    b.innerHTML = `<span class="icon">${m.icon}</span>${m.name}`;
    b.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ action: "setMode", mode: m.id });
      await refresh();
    });
    c.appendChild(b);
  });
  const pill = document.getElementById("mode-pill");
  const a = modes.find((m) => m.id === s.mode);
  if (a) pill.textContent = `${a.icon} ${a.name}`;
}

function renderTimer(s) {
  const badge = document.getElementById("session-badge");
  const stopBtn = document.getElementById("stop-session-btn");
  const startBtn = document.getElementById("start-session-btn");
  const pomoBtn = document.getElementById("pomodoro-btn");

  if (s.activeSession) {
    badge.style.display = "inline-block";
    badge.textContent = "Activa";
    badge.style.background = "#e8f5e9";
    badge.style.color = "#2e7d32";
    stopBtn.classList.remove("hidden");
    startBtn.disabled = true;
    pomoBtn.disabled = true;
  } else if (s.activeBreak) {
    badge.style.display = "inline-block";
    badge.textContent = "Descanso";
    badge.style.background = "#fff3e0";
    badge.style.color = "#e65100";
    stopBtn.classList.remove("hidden");
    startBtn.disabled = true;
    pomoBtn.disabled = true;
  } else {
    badge.style.display = "none";
    stopBtn.classList.add("hidden");
    startBtn.disabled = false;
    pomoBtn.disabled = false;
  }
  updateTimer();
}

function updateTimer() {
  if (!currentData) return;
  const sd = document.getElementById("session-status");
  const td = document.getElementById("timer-display");
  if (currentData.activeSession) {
    const r = Math.max(0, currentData.activeSession.endTime - Date.now());
    sd.innerHTML = `✅ Sesión (${currentData.modeName})`;
    td.textContent = fmt(r);
  } else if (currentData.activeBreak) {
    const r = Math.max(0, currentData.activeBreak.endTime - Date.now());
    sd.innerHTML = "⏳ Descanso";
    td.textContent = fmt(r);
  } else {
    sd.innerHTML = "Sin sesión activa";
    td.textContent = "--:--";
  }
}

function renderStreak(s) {
  const el = document.getElementById("streak-bar");
  if (s.streak?.current > 0) {
    el.classList.remove("hidden");
    el.innerHTML = `🔥 Racha: <strong>${s.streak.current}</strong> días (mejor: ${s.streak.best || 0})`;
  } else el.classList.add("hidden");
}

function renderAITip(s) {
  const el = document.getElementById("ai-tip");
  if (s.ai?.recommendations?.length > 0) {
    const r = s.ai.recommendations[0];
    el.classList.remove("hidden");
    el.innerHTML = `<strong>🤖 ${r.title}</strong><br>${r.message}`;
  } else el.classList.add("hidden");
}

function renderQuickStats(s) {
  document.getElementById("qs-sessions").textContent =
    s.stats?.totalSessions || 0;
  document.getElementById("qs-respected").textContent =
    s.stats?.breaksRespected || 0;
  document.getElementById("qs-bypass").textContent = s.stats?.bypassUsed || 0;
}

function renderPageInfo() {
  const fav = document.getElementById("page-favicon");
  const t = document.getElementById("page-title");
  const u = document.getElementById("page-url");
  if (!currentTab) {
    t.textContent = "Sin pestaña";
    u.textContent = "—";
    return;
  }
  t.textContent = currentTab.title || "(sin título)";
  u.textContent = currentTabUrl;
  if (currentTab.favIconUrl && currentTab.favIconUrl.startsWith("http")) {
    fav.src = currentTab.favIconUrl;
    fav.style.display = "inline";
    fav.onerror = () => {
      fav.style.display = "none";
    };
  } else fav.style.display = "none";
}

function renderPageStatus() {
  chrome.storage.local.get("productivityData", (d) => {
    const data = d.productivityData || {};
    const wl = data.whitelist || [];
    const el = document.getElementById("page-status");
    if (!currentTabUrl) {
      el.className = "page-status status-neutral";
      el.textContent = "—";
      return;
    }
    const isWl = wl.some((w) => currentTabUrl.includes(w));
    const g = (data.groups || []).find((g) =>
      g.urls.some((u) => currentTabUrl.includes(u)),
    );
    if (isWl) {
      el.className = "page-status status-allowed";
      el.textContent = "Permitida";
    } else if (g) {
      el.className = "page-status status-blocked";
      el.textContent = `Bloqueada (${g.name})`;
    } else {
      el.className = "page-status status-neutral";
      el.textContent = "Sin regla";
    }
  });
}

async function renderGroups() {
  const c = document.getElementById("group-list");
  c.innerHTML = "";
  const d = await chrome.storage.local.get("productivityData");
  const groups = d.productivityData?.groups || [];
  if (groups.length === 0) {
    c.innerHTML =
      '<div style="color:#999;font-size:12px;text-align:center;padding:8px;">Sin grupos</div>';
    return;
  }
  groups.forEach((g) => {
    const matched = g.urls.some((u) => currentTabUrl.includes(u));
    const item = document.createElement("div");
    item.className = "group-item" + (matched ? " matched" : "");
    item.innerHTML = `<span>${g.name}</span><span class="action">${matched ? "✓ Incluida" : "＋ Añadir"}</span>`;
    item.addEventListener("click", async () => {
      const d2 = await chrome.storage.local.get("productivityData");
      const gg = d2.productivityData.groups.find((x) => x.id === g.id);
      if (!gg) return;
      if (matched) gg.urls = gg.urls.filter((u) => !currentTabUrl.includes(u));
      else {
        if (!currentTabHost) {
          toast("No se pudo obtener dominio", "error");
          return;
        }
        gg.urls.push(currentTabHost);
      }
      await chrome.storage.local.set(d2);
      toast(
        matched ? "URL quitada del grupo" : "URL añadida al grupo",
        "success",
      );
      await refresh();
    });
    c.appendChild(item);
  });
}

function renderPauseButtons(s) {
  const paused = s.analysis?.pausedUntil && Date.now() < s.analysis.pausedUntil;
  document.getElementById("pause-btn").classList.toggle("hidden", paused);
  document.getElementById("resume-btn").classList.toggle("hidden", !paused);
}

function bindEvents() {
  document
    .getElementById("start-session-btn")
    .addEventListener("click", startSession);
  document
    .getElementById("pomodoro-btn")
    .addEventListener("click", startPomodoro);
  document
    .getElementById("stop-session-btn")
    .addEventListener("click", stopSession);
  document.getElementById("block-now-btn").addEventListener("click", blockNow);
  document
    .getElementById("whitelist-btn")
    .addEventListener("click", addToWhitelist);
  document
    .getElementById("create-group-with-url-btn")
    .addEventListener("click", createGroupWithUrl);
  document
    .getElementById("dashboard-btn")
    .addEventListener("click", () =>
      chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") }),
    );
  document
    .getElementById("mydata-btn")
    .addEventListener("click", () =>
      chrome.tabs.create({ url: chrome.runtime.getURL("my-data.html") }),
    );
  document
    .getElementById("options-btn")
    .addEventListener("click", () => chrome.runtime.openOptionsPage());
  document
    .getElementById("help-btn")
    .addEventListener("click", () =>
      chrome.tabs.create({ url: chrome.runtime.getURL("help.html") }),
    );

  document.getElementById("pause-btn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ action: "pauseAnalysis", minutes: 60 });
    toast("⏸ Análisis pausado 1h", "success");
    await refresh();
  });
  document.getElementById("resume-btn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ action: "resumeAnalysis" });
    toast("▶ Análisis reanudado", "success");
    await refresh();
  });

  document
    .getElementById("level-select")
    .addEventListener("change", async (e) => {
      const newLevel = e.target.value;
      if (newLevel === "total") {
        const conf = prompt(
          '⚠️ MODO TOTAL\n\nRegistrará TODAS tus URLs (filtramos bancos, email, salud, gobierno, tokens).\nTodo es local, nunca se envía.\n\nEscribe "ENTIENDO LOS RIESGOS" para activar:',
        );
        if (conf !== "ENTIENDO LOS RIESGOS") {
          toast("Modo Total cancelado", "error");
          await refresh();
          return;
        }
        const days = prompt("¿Por cuántos días? (vacío = indefinido)", "7");
        const expires = days ? parseInt(days) : null;
        await chrome.runtime.sendMessage({
          action: "confirmTotalMode",
          confirmation: "ENTIENDO LOS RIESGOS",
          expiresInDays: expires,
        });
        toast("🔴 Modo TOTAL activado", "success");
      } else {
        await chrome.runtime.sendMessage({
          action: "setAnalysisLevel",
          level: newLevel,
        });
        toast(`Nivel cambiado a ${newLevel}`, "success");
      }
      await refresh();
    });
}

async function startSession() {
  const d = await chrome.storage.local.get("productivityData");
  const groups = d.productivityData?.groups || [];
  if (groups.length === 0) {
    toast("Primero crea un grupo", "error");
    return;
  }
  const matched = groups.find((g) =>
    g.urls.some((u) => currentTabUrl.includes(u)),
  );
  const gid = matched ? matched.id : groups[0].id;
  const sd = parseInt(document.getElementById("pomo-session").value) || 25;
  const bd = parseInt(document.getElementById("pomo-break").value) || 5;
  await chrome.runtime.sendMessage({
    action: "startSession",
    groupId: gid,
    sessionDuration: sd,
    breakDuration: bd,
  });
  toast("✅ Sesión iniciada", "success");
  await refresh();
}

async function startPomodoro() {
  const d = await chrome.storage.local.get("productivityData");
  const groups = d.productivityData?.groups || [];
  if (groups.length === 0) {
    toast("Primero crea un grupo", "error");
    return;
  }
  const matched = groups.find((g) =>
    g.urls.some((u) => currentTabUrl.includes(u)),
  );
  const gid = matched ? matched.id : groups[0].id;
  const r = await chrome.runtime.sendMessage({
    action: "startPomodoro",
    groupId: gid,
  });
  toast(
    r?.isLong ? "🍅 Pomodoro — descanso largo" : "🍅 Pomodoro iniciado",
    "success",
  );
  await refresh();
}

async function stopSession() {
  if (!confirm("¿Detener la sesión actual?")) return;
  await chrome.runtime.sendMessage({ action: "stopSession" });
  toast("Sesión detenida", "success");
  await refresh();
}

async function blockNow() {
  if (!currentTabHost) {
    toast("No se pudo obtener dominio", "error");
    return;
  }
  const d = await chrome.storage.local.get("productivityData");
  const pd = d.productivityData || {};
  const groups = pd.groups || [];
  const already = groups.find((g) =>
    g.urls.some((u) => currentTabUrl.includes(u)),
  );
  if (already) {
    toast(`Ya está en "${already.name}"`, "info");
    return;
  }
  let t = groups.find((g) => g.name === "Bloqueadas");
  if (!t) {
    t = { id: Date.now(), name: "Bloqueadas", urls: [] };
    groups.push(t);
  }
  t.urls.push(currentTabHost);
  pd.groups = groups;
  await chrome.storage.local.set({ productivityData: pd });
  toast(`🚫 ${currentTabHost} bloqueada`, "success");
  await refresh();
}

async function addToWhitelist() {
  if (!currentTabHost) {
    toast("No se pudo obtener dominio", "error");
    return;
  }
  const d = await chrome.storage.local.get("productivityData");
  const pd = d.productivityData || {};
  pd.whitelist = pd.whitelist || [];
  if (pd.whitelist.includes(currentTabHost)) {
    toast("Ya está en lista blanca", "info");
    return;
  }
  pd.whitelist.push(currentTabHost);
  pd.groups = (pd.groups || []).map((g) => ({
    ...g,
    urls: g.urls.filter((u) => !currentTabHost.includes(u)),
  }));
  await chrome.storage.local.set({ productivityData: pd });
  toast(`✅ ${currentTabHost} permitida`, "success");
  await refresh();
}

async function createGroupWithUrl() {
  const name = document.getElementById("new-group-name").value.trim();
  if (!name) {
    toast("Escribe un nombre", "error");
    return;
  }
  if (!currentTabHost) {
    toast("No se pudo obtener dominio", "error");
    return;
  }
  const d = await chrome.storage.local.get("productivityData");
  const pd = d.productivityData || {};
  pd.groups = pd.groups || [];
  pd.groups.push({ id: Date.now(), name, urls: [currentTabHost] });
  await chrome.storage.local.set({ productivityData: pd });
  document.getElementById("new-group-name").value = "";
  toast(`✅ Grupo "${name}" creado`, "success");
  await refresh();
}

let toastTimeout = null;
function toast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className =
    "toast show " +
    (type === "success" ? "success" : type === "error" ? "error" : "");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove("show"), 2500);
}

function fmt(ms) {
  const m = Math.floor(ms / 60000),
    s = Math.floor((ms % 60000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
