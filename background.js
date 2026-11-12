// background.js
importScripts("utils.js", "modes.js", "ai-engine.js", "energy-manager.js");

// ---------- Estado en memoria ----------
let lastTabUrl = new Map();
let lastTabActiveAt = new Map();
let lastTabInfo = new Map();
let previousActiveTab = null;
let lastBypassAt = null;
let lastClosedTab = new Map();
let lastClosedDomain = new Map(); // domain → ts (para rapidReopen)
let lastVisitAt = new Map(); // tabId → { url, ts } (para duration)

// ---------- Badge ----------
async function updateBadge() {
  const data = await getData();
  let text = "";
  let color = "#4CAF50";
  if (data.activeSession) {
    const rem = Math.max(0, data.activeSession.endTime - Date.now());
    text = `${Math.floor(rem / 60000)}m`;
    color = "#4CAF50";
  } else if (data.activeBreak) {
    const rem = Math.max(0, data.activeBreak.endTime - Date.now());
    text = `${Math.floor(rem / 60000)}m`;
    color = "#ff6b6b";
  } else if (
    data.bypassUnlockedUntil &&
    Date.now() < data.bypassUnlockedUntil
  ) {
    text = "BY";
    color = "#FF9800";
  } else if (isAnalysisPaused(data)) {
    text = "⏸";
    color = "#9E9E9E";
  } else if (isTotalModeActive(data)) {
    text = "👁";
    color = "#c62828";
  } else if (
    analysisLevel(data) === "invasive" ||
    analysisLevel(data) === "standard"
  ) {
    text = "👁";
    color = "#757575";
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

// ---------- Helpers ----------
async function getGroupForUrl(url) {
  const data = await getData();
  if (isInWhitelist(url, data.whitelist)) return null;
  for (const g of data.groups) {
    if (urlMatchesGroup(url, g)) return g;
  }
  return null;
}

async function notifyTabs(groupId, action, payload) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && tab.url.startsWith("http")) {
      const g = await getGroupForUrl(tab.url);
      if (g && (groupId === null || g.id === groupId)) {
        chrome.tabs.sendMessage(tab.id, { action, ...payload }).catch(() => {});
      }
    }
  }
}

async function showNotification(title, message) {
  const data = await getData();
  if (!data.settings.notificationsEnabled) return;
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icon128.png",
      title,
      message,
      priority: 2,
    });
  } catch {}
}

// ---------- Sesión / descanso ----------
async function startSession(groupId, sessionDuration, breakDuration) {
  const data = await getData();
  const now = Date.now();
  const mode = getActiveMode(data);
  const modeDef = getModeDefinition(mode);

  data.activeSession = {
    groupId,
    sessionDuration,
    breakDuration,
    startTime: now,
    endTime: now + sessionDuration * 60000,
    mode,
    strict: isStrictMode(data),
  };
  data.activeBreak = null;
  data.bypassUnlockedUntil = null;

  data.stats.totalSessions = (data.stats.totalSessions || 0) + 1;
  const dk = todayKey();
  if (!data.stats.dailyStats[dk])
    data.stats.dailyStats[dk] = { sessions: 0, breaks: 0, bypass: 0 };
  data.stats.dailyStats[dk].sessions++;
  data.stats.history = data.stats.history || [];
  data.stats.history.push({
    type: "session",
    timestamp: now,
    duration: sessionDuration,
    completed: false,
    mode,
    groupId,
  });

  await saveData(data);
  await updateBadge();
  await chrome.alarms.create("sessionEnd", {
    when: data.activeSession.endTime,
  });
  await chrome.alarms.create("sessionWarning", {
    when: data.activeSession.endTime - data.settings.warningMinutes * 60000,
  });
  await notifyTabs(groupId, "sessionStarted", {
    sessionDuration,
    breakDuration,
    mode,
  });
  await showNotification(
    "Sesión iniciada",
    `${sessionDuration} min de ${modeDef.name}.`,
  );
}

async function startBreak(groupId, breakDuration) {
  const data = await getData();
  const now = Date.now();
  const modeDef = getModeDefinition(
    data.activeSession?.mode || getActiveMode(data),
  );

  const lastSession = [...(data.stats.history || [])]
    .reverse()
    .find((h) => h.type === "session" && !h.completed);
  if (lastSession) lastSession.completed = true;

  data.activeBreak = {
    groupId,
    breakDuration,
    startTime: now,
    endTime: now + breakDuration * 60000,
    mode: data.activeSession?.mode || getActiveMode(data),
    activities: modeDef.breakActivities || [],
  };
  data.activeSession = null;
  data.stats.totalBreaks = (data.stats.totalBreaks || 0) + 1;
  data.stats.history.push({
    type: "break",
    timestamp: now,
    duration: breakDuration,
  });
  const dk = todayKey();
  if (!data.stats.dailyStats[dk])
    data.stats.dailyStats[dk] = { sessions: 0, breaks: 0, bypass: 0 };
  data.stats.dailyStats[dk].breaks++;

  await saveData(data);
  await updateBadge();
  await chrome.alarms.create("breakEnd", { when: data.activeBreak.endTime });
  await notifyTabs(groupId, "breakStarted", {
    breakDuration,
    breakEnd: data.activeBreak.endTime,
    activities: data.activeBreak.activities || [],
  });
  await showNotification("Descanso iniciado", `${breakDuration} minutos.`);
}

async function finishBreak() {
  const data = await getData();
  if (!data.activeBreak) return;
  const bd = data.activeBreak.breakDuration;

  data.stats.breaksRespected = (data.stats.breaksRespected || 0) + 1;
  data.stats.totalBreakTime = (data.stats.totalBreakTime || 0) + bd;

  const today = todayKey();
  if (data.stats.streak.lastDate !== today) {
    const y = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    data.stats.streak.current =
      data.stats.streak.lastDate === y
        ? (data.stats.streak.current || 0) + 1
        : 1;
    if (data.stats.streak.current > (data.stats.streak.best || 0))
      data.stats.streak.best = data.stats.streak.current;
    data.stats.streak.lastDate = today;
  }

  data.activeBreak = null;
  await saveData(data);
  await updateBadge();
  await chrome.alarms.clear("breakEnd");
  await notifyTabs(null, "breakFinished", {});
  await showNotification(
    "Descanso terminado",
    "Ya puedes iniciar una nueva sesión.",
  );

  if (data.settings.aiEnabled) {
    await EnergyManager.flush();
    const result = AIEngine.analyze(data);
    data.ai = { ...data.ai, ...result };
    await saveData(data);
  }

  await purgeAndCompact();
}

async function handleBypass(tabId) {
  const data = await getData();
  if (!data.activeBreak) return;
  const gid = data.activeBreak.groupId;
  const now = Date.now();

  const sessionStart = data.stats.history?.find(
    (h) => h.type === "session" && !h.completed,
  )?.timestamp;
  const afterMinutes = sessionStart
    ? Math.round((now - sessionStart) / 60000)
    : 0;

  data.stats.bypassUsed = (data.stats.bypassUsed || 0) + 1;
  data.stats.bypassHistory = data.stats.bypassHistory || [];
  data.stats.bypassHistory.push({ timestamp: now, groupId: gid, afterMinutes });
  const dk = todayKey();
  if (!data.stats.dailyStats[dk])
    data.stats.dailyStats[dk] = { sessions: 0, breaks: 0, bypass: 0 };
  data.stats.dailyStats[dk].bypass++;
  data.stats.streak.current = 0;
  data.activeBreak = null;
  data.bypassUnlockedUntil = now + 5 * 60000;
  lastBypassAt = now;

  await saveData(data);
  await updateBadge();
  await chrome.alarms.clear("breakEnd");
  await EnergyManager.enqueue("bypass", { afterMinutes });
  await EnergyManager.flush();
  await notifyTabs(gid, "bypassActivated", {});
  await showNotification("Bypass usado", "Has roto tu descanso.");
}

async function stopSession() {
  const data = await getData();
  const last = [...(data.stats.history || [])]
    .reverse()
    .find((h) => h.type === "session" && !h.completed);
  if (last) last.aborted = true;
  data.activeSession = null;
  data.activeBreak = null;
  data.bypassUnlockedUntil = null;
  await chrome.alarms.clear("sessionEnd");
  await chrome.alarms.clear("sessionWarning");
  await chrome.alarms.clear("breakEnd");
  await EnergyManager.flush();
  await saveData(data);
  await updateBadge();
  await notifyTabs(null, "breakFinished", {});
}

// ---------- Alarmas ----------
chrome.alarms.onAlarm.addListener(async (alarm) => {
  const data = await getData();
  if (alarm.name === "sessionEnd" && data.activeSession) {
    await startBreak(
      data.activeSession.groupId,
      data.activeSession.breakDuration,
    );
  } else if (alarm.name === "sessionWarning" && data.activeSession) {
    await notifyTabs(data.activeSession.groupId, "sessionWarning", {
      minutes: data.settings.warningMinutes,
    });
    await showNotification(
      "Queda poco",
      `Tu sesión termina en ${data.settings.warningMinutes} min.`,
    );
  } else if (alarm.name === "breakEnd" && data.activeBreak) {
    await finishBreak();
  } else if (alarm.name === "badgeTick") {
    if (data.activeSession || data.activeBreak) await updateBadge();
    else await chrome.alarms.clear("badgeTick");
  }
});

// ---------- Navegación ----------
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const url = details.url;
  if (!url.startsWith("http")) return;

  const data = await getData();
  if (isInWhitelist(url, data.whitelist)) return;
  if (isAnalysisPaused(data)) return;

  await recordVisit(url, data, details.tabId);

  if (!isWithinSchedule(data.schedule)) return;

  const group = await getGroupForUrl(url);
  if (!group) return;

  const now = Date.now();
  if (data.bypassUnlockedUntil && now < data.bypassUnlockedUntil) return;
  if (data.activeSession && data.activeSession.groupId === group.id) return;

  // --- Descanso activo: bloquear ---
  if (data.activeBreak && data.activeBreak.groupId === group.id) {
    const blockMsg = {
      action: "block",
      breakDuration: data.activeBreak.breakDuration,
      breakEnd: data.activeBreak.endTime,
      activities: data.activeBreak.activities || [],
    };
    // reintentos por si content.js aún no estaba listo
    chrome.tabs.sendMessage(details.tabId, blockMsg).catch(() => {});
    setTimeout(() => {
      chrome.tabs.sendMessage(details.tabId, blockMsg).catch(() => {});
    }, 500);
    setTimeout(() => {
      chrome.tabs.sendMessage(details.tabId, blockMsg).catch(() => {});
    }, 1500);
    return;
  }

  // --- Sin sesión: mostrar setup con reintentos ---
  const modeDef = getModeDefaults(data);
  const setupMsg = {
    action: "showSessionSetup",
    groupId: group.id,
    defaults: {
      sessionDuration: data.settings.defaultSession || modeDef.defaultSession,
      breakDuration: data.settings.defaultBreak || modeDef.defaultBreak,
      mode: getActiveMode(data),
      strict: isStrictMode(data),
      bypassPhrase: data.settings.bypassPhrase,
      modeName: modeDef.name,
      modeIcon: modeDef.icon,
    },
  };

  // intento 1 (inmediato)
  chrome.tabs.sendMessage(details.tabId, setupMsg).catch(() => {});

  // reintento 2 a los 500ms (por si content.js aún no estaba listo)
  setTimeout(() => {
    chrome.tabs.sendMessage(details.tabId, setupMsg).catch(() => {});
  }, 500);

  // reintento 3 a los 1500ms (por si la página tardó en cargar body)
  setTimeout(() => {
    chrome.tabs.sendMessage(details.tabId, setupMsg).catch(() => {});
  }, 1500);
});

async function recordVisit(url, data, tabId = null) {
  // cierra la visita anterior de este tab
  if (tabId != null) {
    const prev = lastVisitAt.get(tabId);
    if (prev && prev.url && prev.url !== url) {
      const dur = Math.max(0, Date.now() - prev.ts);
      if (dur > 500) {
        await EnergyManager.enqueue("visitClose", {
          url: prev.url,
          duration: dur,
        });
      }
    }
    lastVisitAt.set(tabId, { url, ts: Date.now() });
  }

  // retorno tras bypass
  if (lastBypassAt && Date.now() - lastBypassAt < 10 * 60000) {
    await EnergyManager.enqueue("returnAfterBypass", {
      seconds: Math.round((Date.now() - lastBypassAt) / 1000),
    });
    lastBypassAt = null;
  }

  // rapid reopen
  try {
    const host = new URL(url).hostname;
    const closedAt = lastClosedDomain.get(host);
    if (closedAt) {
      const gapMs = Date.now() - closedAt;
      if (gapMs > 0 && gapMs < 60000) {
        await EnergyManager.enqueue("rapidReopen", {
          url: sanitizeUrl(url),
          closedAt,
          gapMs,
        });
      }
      lastClosedDomain.delete(host);
    }
  } catch {}

  const level = analysisLevel(data);
  if (level === "light") {
    const g = data.groups.find((x) => urlMatchesGroup(url, x));
    if (!g) return;
    if (!EnergyManager.shouldRecordVisit(url)) return;
    const sanitized = sanitizeUrl(url);
    if (!sanitized) return;
    await EnergyManager.enqueue("visit", {
      url: sanitized,
      domain: new URL(url).hostname,
      path: new URL(url).pathname,
      isGroup: true,
      groupId: g.id,
      hadActiveSession: !!data.activeSession,
      wasWhitelisted: false,
    });
    return;
  }

  if (isSensitive(url)) return;
  if (level === "total") {
    if (!EnergyManager.shouldRecordVisit(url)) return;
    const sanitized = sanitizeUrl(url);
    if (!sanitized) return;
    const u = new URL(url);
    const pathHash = await hashPath(u.pathname);
    const g = data.groups.find((x) => urlMatchesGroup(url, x));
    await EnergyManager.enqueue("visit", {
      url: sanitized,
      domain: u.hostname,
      path: u.pathname,
      pathHash,
      isGroup: !!g,
      groupId: g?.id || null,
      hadActiveSession: !!data.activeSession,
      wasWhitelisted: isInWhitelist(url, data.whitelist),
    });
  } else {
    const g = data.groups.find((x) => urlMatchesGroup(url, x));
    if (!g) return;
    if (!EnergyManager.shouldRecordVisit(url)) return;
    const sanitized = sanitizeUrl(url);
    if (!sanitized) return;
    await EnergyManager.enqueue("visit", {
      url: sanitized,
      domain: new URL(url).hostname,
      path: new URL(url).pathname,
      isGroup: true,
      groupId: g.id,
      hadActiveSession: !!data.activeSession,
      wasWhitelisted: false,
    });
  }
}

// ---------- Listeners de pestañas ----------
let tabListenersAttached = false;

function attachTabListeners() {
  if (tabListenersAttached) return;
  chrome.tabs.onUpdated.addListener(onTabUpdated);
  chrome.tabs.onActivated.addListener(onTabActivated);
  chrome.tabs.onCreated.addListener(onTabCreated);
  chrome.tabs.onRemoved.addListener(onTabRemoved);
  tabListenersAttached = true;
}

function detachTabListeners() {
  if (!tabListenersAttached) return;
  chrome.tabs.onUpdated.removeListener(onTabUpdated);
  chrome.tabs.onActivated.removeListener(onTabActivated);
  chrome.tabs.onCreated.removeListener(onTabCreated);
  chrome.tabs.onRemoved.removeListener(onTabRemoved);
  tabListenersAttached = false;
}

async function onTabUpdated(tabId, changeInfo, tab) {
  if (!changeInfo.url) return;
  const data = await getData();
  if (isAnalysisPaused(data)) return;
  if (analysisLevel(data) === "light") return;
  const last = lastTabUrl.get(tabId);
  if (last === changeInfo.url) return;
  lastTabUrl.set(tabId, changeInfo.url);
  await recordVisit(changeInfo.url, data, tabId);
}

async function onTabActivated(info) {
  const data = await getData();
  if (isAnalysisPaused(data)) return;
  const level = analysisLevel(data);
  if (level === "light") return;

  try {
    const tab = await chrome.tabs.get(info.tabId);
    if (tab.url && tab.url.startsWith("http") && !isSensitive(tab.url)) {
      const from = previousActiveTab;
      const to = sanitizeUrl(tab.url);
      if (from && to && from !== to) {
        const fromG = data.groups.find((x) => urlMatchesGroup(from, x));
        const toG = data.groups.find((x) => urlMatchesGroup(tab.url, x));
        await EnergyManager.enqueue("tabSwitch", {
          from,
          to,
          fromGroup: fromG?.id || null,
          toGroup: toG?.id || null,
        });
      }
      if (to) previousActiveTab = to;
    }
  } catch {}
}

async function onTabCreated(tab) {
  const data = await getData();
  if (isAnalysisPaused(data)) return;
  if (analysisLevel(data) === "light") return;
  if (!tab.url || !tab.url.startsWith("http")) return;
  if (isSensitive(tab.url)) return;
  const g = data.groups.find((x) => urlMatchesGroup(tab.url, x));
  if (!g) return;
  await EnergyManager.enqueue("tabOpen", {
    url: sanitizeUrl(tab.url),
    groupId: g.id,
  });
  lastTabActiveAt.set(tab.id, Date.now());
}

async function onTabRemoved(tabId) {
  const data = await getData();
  if (isAnalysisPaused(data)) return;
  if (analysisLevel(data) === "light") return;
  const startedAt = lastTabActiveAt.get(tabId);
  const url = lastTabUrl.get(tabId);
  if (!url) return;
  const lifetime = startedAt ? Date.now() - startedAt : 0;
  const g = data.groups.find((x) => urlMatchesGroup(url, x));
  if (!g) return;
  await EnergyManager.enqueue("tabClose", {
    url: sanitizeUrl(url),
    groupId: g.id,
    lifetime,
  });
  try {
    const host = new URL(url).hostname;
    lastClosedDomain.set(host, Date.now());
  } catch {}
  lastTabUrl.delete(tabId);
  lastTabActiveAt.delete(tabId);
  lastVisitAt.delete(tabId);
}

// ---------- Idle ----------
chrome.idle.onStateChanged.addListener(async (state) => {
  const data = await getData();
  const paused = state !== "active";
  EnergyManager.setPaused(paused);
  if (paused) {
    await EnergyManager.enqueue("idle", { state, duration: 0 });
  }
  await updateBadge();
});

// ---------- Mensajes ----------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    const data = await getData();

    if (message.action === "startSession") {
      await startSession(
        message.groupId,
        message.sessionDuration,
        message.breakDuration,
      );
      await chrome.alarms.create("badgeTick", { periodInMinutes: 0.5 });
      sendResponse({ success: true });
    } else if (message.action === "stopSession") {
      await stopSession();
      sendResponse({ success: true });
    } else if (message.action === "bypassBreak") {
      if (isStrictMode(data) && data.modes.active !== "chill")
        sendResponse({ success: false, reason: "strict" });
      else {
        await handleBypass(sender.tab?.id);
        sendResponse({ success: true });
      }
    } else if (message.action === "getStatus") {
      sendResponse({
        activeSession: data.activeSession,
        activeBreak: data.activeBreak,
        stats: data.stats,
        mode: getActiveMode(data),
        modeName: getModeDefinition(getActiveMode(data)).name,
        modeIcon: getModeDefinition(getActiveMode(data)).icon,
        strict: isStrictMode(data),
        settings: data.settings,
        ai: data.ai,
        streak: data.stats.streak,
        analysis: data.analysis,
        level: analysisLevel(data),
        totalActive: isTotalModeActive(data),
      });
    } else if (message.action === "getAI") sendResponse(data.ai);
    else if (message.action === "setMode") {
      data.modes.active = message.mode;
      await saveData(data);
      sendResponse({ success: true });
    } else if (message.action === "startPomodoro") {
      data.pomodoro.currentCount = (data.pomodoro.currentCount || 0) + 1;
      const isLong =
        data.pomodoro.currentCount % data.pomodoro.sessionsUntilLongBreak === 0;
      const bd = isLong ? data.pomodoro.longBreak : data.pomodoro.shortBreak;
      await startSession(
        message.groupId,
        message.sessionDuration || data.pomodoro.sessionDuration,
        bd,
      );
      await chrome.alarms.create("badgeTick", { periodInMinutes: 0.5 });
      sendResponse({
        success: true,
        isLong,
        count: data.pomodoro.currentCount,
      });
    } else if (message.action === "suggestDuration")
      sendResponse({ suggested: AIEngine.suggestDuration(data, message.mode) });
    else if (message.action === "visibilityChange") {
      if (analysisLevel(data) === "light" || isAnalysisPaused(data)) {
        sendResponse({ ok: true });
        return;
      }
      if (isSensitive(message.url)) {
        sendResponse({ ok: true });
        return;
      }
      await EnergyManager.enqueue("visibility", {
        url: sanitizeUrl(message.url),
        state: message.state,
        duration: message.duration || 0,
      });
      sendResponse({ ok: true });
    } else if (message.action === "setAnalysisLevel") {
      data.analysis.level = message.level;
      await saveData(data);
      await updateBadge();
      sendResponse({ success: true });
    } else if (message.action === "confirmTotalMode") {
      if (message.confirmation !== "ENTIENDO LOS RIESGOS") {
        sendResponse({ success: false });
        return;
      }
      data.analysis.level = "total";
      data.analysis.totalConfirmedAt = Date.now();
      data.analysis.totalExpiresAt = message.expiresInDays
        ? Date.now() + message.expiresInDays * 86400000
        : null;
      await saveData(data);
      await updateBadge();
      sendResponse({ success: true });
    } else if (message.action === "pauseAnalysis") {
      data.analysis.pausedUntil = Date.now() + (message.minutes || 60) * 60000;
      await saveData(data);
      await updateBadge();
      sendResponse({ success: true });
    } else if (message.action === "resumeAnalysis") {
      data.analysis.pausedUntil = null;
      await saveData(data);
      await updateBadge();
      sendResponse({ success: true });
    } else if (message.action === "purgeData") {
      await purgeAndCompact(true);
      sendResponse({ success: true });
    } else if (message.action === "updateSettings") {
      data.settings = { ...data.settings, ...message.settings };
      await saveData(data);
      sendResponse({ success: true });
    } else if (message.action === "closeTab") {
      const tabId = sender.tab?.id;
      if (tabId != null) {
        try {
          await chrome.tabs.remove(tabId);
        } catch {}
      }
      sendResponse({ success: true });
    } else if (message.action === "resetAll") {
      await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_DATA });
      await updateBadge();
      sendResponse({ success: true });
    }
  })();
  return true;
});

// ---------- Purga y compactación ----------
async function purgeAndCompact(force = false) {
  const data = await getData();
  const now = Date.now();
  const last = data.analysis.lastPurge || 0;
  if (!force && now - last < 6 * 3600000) return;

  const days = retentionDays(data);
  const cutoff = now - days * 86400000;
  const ai = data.aiData;

  [
    "visits",
    "visibilityEvents",
    "tabSwitches",
    "tabEvents",
    "idleEvents",
    "transitions",
    "rapidReopens",
    "resistance",
  ].forEach((k) => {
    if (ai[k]) ai[k] = ai[k].filter((e) => (e.timestamp || 0) > cutoff);
  });

  // compactar visits > 2 días: agregar a byDomain y borrar
  const compactCutoff = now - 2 * 86400000;
  const old = (ai.visits || []).filter(
    (v) => (v.timestamp || 0) < compactCutoff,
  );
  if (old.length) {
    for (const v of old) {
      if (v.domain && ai.byDomain[v.domain]) {
        ai.byDomain[v.domain].totalTime += v.duration || 0;
      }
    }
    ai.visits = (ai.visits || []).filter(
      (v) => (v.timestamp || 0) >= compactCutoff,
    );
  }

  data.analysis.lastPurge = now;
  data.aiData.lastCompact = now;
  await saveData(data);
}

// ---------- Init ----------
async function syncAnalysisMode() {
  const data = await getData();
  const level = analysisLevel(data);
  if (level === "light") detachTabListeners();
  else attachTabListeners();
  await updateBadge();
}

chrome.runtime.onInstalled.addListener(async () => {
  await getData();
  await syncAnalysisMode();
  await chrome.idle.setDetectionInterval(60);
});

chrome.runtime.onStartup.addListener(async () => {
  await syncAnalysisMode();
  await chrome.idle.setDetectionInterval(60);
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes[STORAGE_KEY]) await syncAnalysisMode();
});
