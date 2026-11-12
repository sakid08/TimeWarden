// options.js
document.addEventListener("DOMContentLoaded", loadAll);

async function loadAll() {
  const data = await chrome.storage.local.get("productivityData");
  const d = data.productivityData || {};
  // asegurar defaults mínimos
  d.settings = d.settings || {};
  d.analysis = d.analysis || { level: "light", retentionDays: {} };
  d.analysis.retentionDays = d.analysis.retentionDays || {};
  d.groups = d.groups || [];
  d.whitelist = d.whitelist || [];
  d.pomodoro = d.pomodoro || {};
  d.schedule = d.schedule || {};
  d.stats = d.stats || { streak: {} };
  d.stats.streak = d.stats.streak || {};
  d.ai = d.ai || {};

  renderStats(d);
  renderAI(d);
  renderGroups(d);
  renderSettings(d);
  renderSchedule(d);
  renderWhitelist(d);
  renderPomodoro(d);
  bindEvents();
}

function renderStats(d) {
  const s = d.stats || {};
  const grid = document.getElementById("stats-grid");
  const items = [
    ["Sesiones totales", s.totalSessions || 0],
    ["Descansos totales", s.totalBreaks || 0],
    ["Descansos respetados", s.breaksRespected || 0],
    ["Bypass usados", s.bypassUsed || 0],
    ["Tiempo de sesión (min)", s.totalSessionTime || 0],
    ["Tiempo de descanso (min)", s.totalBreakTime || 0],
    ["Racha actual", (s.streak?.current || 0) + " días"],
    ["Mejor racha", (s.streak?.best || 0) + " días"],
  ];
  grid.innerHTML = items
    .map(
      ([l, v]) =>
        `<div class="stat"><div class="stat-num">${v}</div><div class="stat-lbl">${l}</div></div>`,
    )
    .join("");
}

function renderAI(d) {
  const container = document.getElementById("ai-recommendations");
  const recs = d.ai?.recommendations || [];
  if (recs.length === 0) {
    container.innerHTML =
      '<p style="color:#666;">Aún no hay recomendaciones. Completa algunas sesiones primero.</p>';
    return;
  }
  container.innerHTML = recs
    .map(
      (r) =>
        `<div class="ai-rec ${r.type}">
      <strong>${r.title}</strong><br>
      <span style="font-size:13px;">${r.message}</span>
    </div>`,
    )
    .join("");
}

function renderGroups(d) {
  const container = document.getElementById("groups-container");
  const groups = d.groups || [];
  container.innerHTML = "";
  groups.forEach((g, i) => {
    const div = document.createElement("div");
    div.className = "group";
    div.innerHTML = `
      <strong>${g.name}</strong>
      <div class="url-list">
        ${g.urls.map((u, j) => `<span class="url-tag">${u}<button data-g="${i}" data-u="${j}">×</button></span>`).join("")}
      </div>
      <input type="text" placeholder="Añadir URL" id="add-url-${i}" style="flex:1;width:200px;">
      <button class="primary" data-add="${i}">Añadir URL</button>
      <button class="danger" data-del="${i}">Eliminar grupo</button>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll("button[data-u]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const gi = parseInt(btn.dataset.g);
      const ui = parseInt(btn.dataset.u);
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      pd.groups = pd.groups || [];
      if (pd.groups[gi]?.urls) pd.groups[gi].urls.splice(ui, 1);
      await chrome.storage.local.set({ productivityData: pd });
      loadAll();
    });
  });

  container.querySelectorAll("button[data-add]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = parseInt(btn.dataset.add);
      const input = document.getElementById(`add-url-${i}`);
      const url = input.value.trim();
      if (!url) return;
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      pd.groups = pd.groups || [];
      if (pd.groups[i]) pd.groups[i].urls.push(url);
      await chrome.storage.local.set({ productivityData: pd });
      loadAll();
    });
  });

  container.querySelectorAll("button[data-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = parseInt(btn.dataset.del);
      if (!confirm("¿Eliminar este grupo?")) return;
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      pd.groups = pd.groups || [];
      pd.groups.splice(i, 1);
      await chrome.storage.local.set({ productivityData: pd });
      loadAll();
    });
  });
}

function renderSettings(d) {
  const s = d.settings || {};
  document.getElementById("cfg-session").value = s.defaultSession || 25;
  document.getElementById("cfg-break").value = s.defaultBreak || 5;
  document.getElementById("cfg-warning").value = s.warningMinutes || 1;
  document.getElementById("cfg-theme").value = s.theme || "auto";
  document.getElementById("cfg-notifications").checked =
    s.notificationsEnabled !== false;
  document.getElementById("cfg-sounds").checked = s.soundsEnabled !== false;
  document.getElementById("cfg-strict").checked = !!s.strictMode;
  document.getElementById("cfg-ai").checked = s.aiEnabled !== false;
  document.getElementById("cfg-bypass-phrase").value = s.bypassPhrase || "";

  // análisis
  const a = d.analysis || {};
  document.getElementById("cfg-analysis-level").value = a.level || "light";
  document.getElementById("cfg-ret-light").value = a.retentionDays?.light || 30;
  document.getElementById("cfg-ret-standard").value =
    a.retentionDays?.standard || 30;
  document.getElementById("cfg-ret-invasive").value =
    a.retentionDays?.invasive || 30;
  document.getElementById("cfg-ret-total").value = a.retentionDays?.total || 7;
}

function renderSchedule(d) {
  const sch = d.schedule || {};
  document.getElementById("cfg-schedule-enabled").checked = !!sch.enabled;
  document.getElementById("cfg-hour-start").value =
    sch.activeHours?.start || "09:00";
  document.getElementById("cfg-hour-end").value =
    sch.activeHours?.end || "18:00";
  document.querySelectorAll(".day").forEach((cb) => {
    cb.checked = (sch.activeDays || []).includes(parseInt(cb.value));
  });
}

function renderWhitelist(d) {
  const container = document.getElementById("whitelist-container");
  const wl = d.whitelist || [];
  container.innerHTML = wl
    .map(
      (w, i) =>
        `<span class="url-tag">${w}<button data-w="${i}">×</button></span>`,
    )
    .join("");
  container.querySelectorAll("button[data-w]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = parseInt(btn.dataset.w);
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      pd.whitelist = pd.whitelist || [];
      pd.whitelist.splice(i, 1);
      await chrome.storage.local.set({ productivityData: pd });
      loadAll();
    });
  });
}

function renderPomodoro(d) {
  const p = d.pomodoro || {};
  document.getElementById("cfg-pomo-session").value = p.sessionDuration || 25;
  document.getElementById("cfg-pomo-short").value = p.shortBreak || 5;
  document.getElementById("cfg-pomo-long").value = p.longBreak || 15;
  document.getElementById("cfg-pomo-count").value =
    p.sessionsUntilLongBreak || 4;
}

function bindEvents() {
  document
    .getElementById("add-group-btn")
    .addEventListener("click", async () => {
      const name = document.getElementById("new-group-name").value.trim();
      const url = document.getElementById("new-group-url").value.trim();
      if (!name || !url) return;
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      pd.groups = pd.groups || [];
      pd.groups.push({ id: Date.now(), name, urls: [url] });
      await chrome.storage.local.set({ productivityData: pd });
      document.getElementById("new-group-name").value = "";
      document.getElementById("new-group-url").value = "";
      loadAll();
    });

  document
    .getElementById("save-settings-btn")
    .addEventListener("click", async () => {
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      pd.settings = {
        ...(pd.settings || {}),
        defaultSession:
          parseInt(document.getElementById("cfg-session").value) || 25,
        defaultBreak: parseInt(document.getElementById("cfg-break").value) || 5,
        warningMinutes:
          parseInt(document.getElementById("cfg-warning").value) || 1,
        theme: document.getElementById("cfg-theme").value,
        notificationsEnabled:
          document.getElementById("cfg-notifications").checked,
        soundsEnabled: document.getElementById("cfg-sounds").checked,
        strictMode: document.getElementById("cfg-strict").checked,
        aiEnabled: document.getElementById("cfg-ai").checked,
        bypassPhrase: document.getElementById("cfg-bypass-phrase").value,
      };
      await chrome.storage.local.set({ productivityData: pd });
      alert("✅ Configuración guardada");
    });

  document
    .getElementById("save-schedule-btn")
    .addEventListener("click", async () => {
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      const activeDays = [...document.querySelectorAll(".day:checked")].map(
        (cb) => parseInt(cb.value),
      );
      pd.schedule = {
        enabled: document.getElementById("cfg-schedule-enabled").checked,
        activeHours: {
          start: document.getElementById("cfg-hour-start").value,
          end: document.getElementById("cfg-hour-end").value,
        },
        activeDays,
      };
      await chrome.storage.local.set({ productivityData: pd });
      alert("✅ Horario guardado");
    });

  document
    .getElementById("add-whitelist-btn")
    .addEventListener("click", async () => {
      const val = document.getElementById("new-whitelist").value.trim();
      if (!val) return;
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      pd.whitelist = pd.whitelist || [];
      if (!pd.whitelist.includes(val)) pd.whitelist.push(val);
      await chrome.storage.local.set({ productivityData: pd });
      document.getElementById("new-whitelist").value = "";
      loadAll();
    });

  document
    .getElementById("save-pomodoro-btn")
    .addEventListener("click", async () => {
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      pd.pomodoro = {
        ...(pd.pomodoro || {}),
        sessionDuration:
          parseInt(document.getElementById("cfg-pomo-session").value) || 25,
        shortBreak:
          parseInt(document.getElementById("cfg-pomo-short").value) || 5,
        longBreak:
          parseInt(document.getElementById("cfg-pomo-long").value) || 15,
        sessionsUntilLongBreak:
          parseInt(document.getElementById("cfg-pomo-count").value) || 4,
      };
      await chrome.storage.local.set({ productivityData: pd });
      alert("✅ Pomodoro guardado");
    });

  document
    .getElementById("save-analysis-btn")
    .addEventListener("click", async () => {
      const data = await chrome.storage.local.get("productivityData");
      const pd = data.productivityData || {};
      pd.analysis = {
        ...(pd.analysis || {}),
        level: document.getElementById("cfg-analysis-level").value,
        retentionDays: {
          light: parseInt(document.getElementById("cfg-ret-light").value) || 30,
          standard:
            parseInt(document.getElementById("cfg-ret-standard").value) || 30,
          invasive:
            parseInt(document.getElementById("cfg-ret-invasive").value) || 30,
          total: parseInt(document.getElementById("cfg-ret-total").value) || 7,
        },
      };
      await chrome.storage.local.set({ productivityData: pd });
      alert("✅ Análisis guardado");
    });

  document
    .getElementById("purge-now-btn")
    .addEventListener("click", async () => {
      await chrome.runtime.sendMessage({ action: "purgeData" });
      alert("✅ Purgado");
    });

  document.getElementById("export-btn").addEventListener("click", async () => {
    const data = await chrome.storage.local.get("productivityData");
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `productivity-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("import-btn").addEventListener("click", () => {
    document.getElementById("import-input").click();
  });

  document
    .getElementById("import-input")
    .addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const parsed = JSON.parse(text);
        await chrome.storage.local.set(parsed);
        alert("✅ Datos importados");
        loadAll();
      } catch (err) {
        alert("❌ Archivo inválido");
      }
    });

  document
    .getElementById("reset-all-btn")
    .addEventListener("click", async () => {
      if (!confirm("¿Reiniciar TODOS los datos? Esto no se puede deshacer."))
        return;
      await chrome.runtime.sendMessage({ action: "resetAll" });
      alert("✅ Datos reiniciados");
      loadAll();
    });
}
