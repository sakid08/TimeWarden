// utils.js
const STORAGE_KEY = "productivityData";

const DEFAULT_DATA = {
  groups: [],
  stats: {
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
  },
  settings: {
    defaultSession: 25,
    defaultBreak: 5,
    warningMinutes: 1,
    bypassPhrase:
      "Reconozco que estoy rompiendo mi tiempo de descanso y perdiendo productividad",
    theme: "auto",
    notificationsEnabled: true,
    soundsEnabled: true,
    strictMode: false,
    aiEnabled: true,
  },
  schedule: {
    enabled: false,
    activeHours: { start: "09:00", end: "18:00" },
    activeDays: [1, 2, 3, 4, 5],
  },
  whitelist: ["localhost", "127.0.0.1", "chrome-extension://", "about:"],
  modes: {
    active: "custom",
  },
  ai: {
    patterns: {},
    recommendations: [],
    lastAnalysis: null,
  },
  pomodoro: {
    enabled: false,
    sessionDuration: 25,
    shortBreak: 5,
    longBreak: 15,
    sessionsUntilLongBreak: 4,
    currentCount: 0,
  },
  // NUEVO: energía y análisis
  analysis: {
    level: "light", // light | standard | invasive | total
    retentionDays: { light: 30, standard: 30, invasive: 30, total: 7 },
    totalConfirmedAt: null,
    totalExpiresAt: null,
    pausedUntil: null,
    lastPurge: null,
  },
  aiData: {
    focusByUrl: {},
    heatmap: {}, // day → hour → ms
    visibilityEvents: [],
    tabSwitches: [],
    tabEvents: [],
    idleEvents: [],
    bypassPatterns: { afterMinutes: [], returnAfterBypass: [], hourOfDay: {} },
    sequences: [],
    rapidReopens: [],
    resistance: [],
    visits: [],
    byDomain: {},
    transitions: [],
    distractionChains: [],
    lastCompact: null,
  },
  activeSession: null,
  activeBreak: null,
  bypassUnlockedUntil: null,
};

// ---------- Filtros de sensibles ----------
const SENSITIVE_PATTERNS = [
  /bank/i,
  /banco/i,
  /bbva/i,
  /santander/i,
  /hsbc/i,
  /banorte/i,
  /paypal/i,
  /stripe/i,
  /mercadopago/i,
  /wise/i,
  /binance/i,
  /coinbase/i,
  /mail\.google/i,
  /outlook/i,
  /protonmail/i,
  /yahoo.*mail/i,
  /salud/i,
  /imss/i,
  /issste/i,
  /hospital/i,
  /medic/i,
  /clinic/i,
  /gob\./i,
  /gov\./i,
  /sat\.gob/i,
  /hacienda/i,
  /segob/i,
  /login/i,
  /signin/i,
  /auth/i,
  /oauth/i,
  /password/i,
  /reset/i,
  /[?&](token|key|secret|password|session|auth|access_token)=/i,
  /docs\.google.*\/d\//i,
  /drive\.google/i,
  /dropbox/i,
  /onedrive/i,
  /facebook\.com\/messages/i,
  /instagram\.com\/direct/i,
  /whatsapp/i,
  /telegram/i,
  /signal/i,
];

function isSensitive(url) {
  return SENSITIVE_PATTERNS.some((p) => p.test(url));
}

function sanitizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname}`;
  } catch {
    return null;
  }
}

async function hashPath(path) {
  try {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(path),
    );
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
  } catch {
    return null;
  }
}

// ---------- Datos ----------
async function getData() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULT_DATA });
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  const d = { ...DEFAULT_DATA, ...result[STORAGE_KEY] };
  // merge anidados
  d.settings = { ...DEFAULT_DATA.settings, ...(d.settings || {}) };
  d.stats = { ...DEFAULT_DATA.stats, ...(d.stats || {}) };
  d.stats.streak = { ...DEFAULT_DATA.stats.streak, ...(d.stats.streak || {}) };
  d.analysis = { ...DEFAULT_DATA.analysis, ...(d.analysis || {}) };
  d.aiData = { ...DEFAULT_DATA.aiData, ...(d.aiData || {}) };
  d.ai = { ...DEFAULT_DATA.ai, ...(d.ai || {}) };
  d.schedule = { ...DEFAULT_DATA.schedule, ...(d.schedule || {}) };
  d.modes = { ...DEFAULT_DATA.modes, ...(d.modes || {}) };
  d.pomodoro = { ...DEFAULT_DATA.pomodoro, ...(d.pomodoro || {}) };
  return d;
}

async function saveData(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

// ---------- Helpers ----------
function todayKey() {
  return new Date().toISOString().split("T")[0];
}
function isInWhitelist(url, whitelist) {
  return (whitelist || []).some((w) => url.includes(w));
}
function urlMatchesGroup(url, group) {
  return group.urls.some((p) => url.includes(p));
}

function isWithinSchedule(schedule) {
  if (!schedule.enabled) return true;
  const now = new Date();
  if (!schedule.activeDays.includes(now.getDay())) return false;
  const [sh, sm] = schedule.activeHours.start.split(":").map(Number);
  const [eh, em] = schedule.activeHours.end.split(":").map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = sh * 60 + sm,
    e = eh * 60 + em;
  return s <= e ? cur >= s && cur <= e : cur >= s || cur <= e;
}

function formatTime(ms) {
  const t = Math.floor(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}

function analysisLevel(data) {
  return data.analysis?.level || "light";
}

function retentionDays(data) {
  const lvl = analysisLevel(data);
  return data.analysis?.retentionDays?.[lvl] || 30;
}

function isAnalysisPaused(data) {
  return data.analysis?.pausedUntil && Date.now() < data.analysis.pausedUntil;
}

function isTotalModeActive(data) {
  if (analysisLevel(data) !== "total") return false;
  if (data.analysis.totalExpiresAt && Date.now() > data.analysis.totalExpiresAt)
    return false;
  return true;
}
