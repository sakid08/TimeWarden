// content.js
let overlayFrame = null;
let warningElement = null;
let visTimer = null;
let visibleStart = null;

// estado del setup pendiente (para re-inyectar si el DOM se reemplaza)
let pendingSetup = null; // { groupId, defaults }
let setupObserver = null;

// ---------- Control de medios durante el bloqueo ----------
let mediaGuard = null; // { observer, interval, resumeHandler }
let savedMediaStates = new Map(); // elemento → { wasPlaying: bool }

function pauseAllMedia() {
  const mediaEls = document.querySelectorAll("video, audio");
  mediaEls.forEach((m) => {
    try {
      if (!m.paused) {
        savedMediaStates.set(m, { wasPlaying: true });
        m.pause();
      } else {
        savedMediaStates.set(m, { wasPlaying: false });
      }
    } catch {}
  });
}

function startMediaGuard() {
  stopMediaGuard(); // por si ya había uno

  // pausa inmediata
  pauseAllMedia();

  // Si el usuario intenta reanudar, lo volvemos a pausar
  const onPlay = (e) => {
    const el = e.target;
    if (el && (el.tagName === "VIDEO" || el.tagName === "AUDIO")) {
      try {
        el.pause();
      } catch {}
    }
  };
  document.addEventListener("play", onPlay, true);
  document.addEventListener("playing", onPlay, true);

  // Re-pausar medios nuevos que aparezcan (páginas SPA, reproductores dinámicos)
  const observer = new MutationObserver(() => {
    document.querySelectorAll("video, audio").forEach((m) => {
      if (!m.paused) {
        try {
          m.pause();
        } catch {}
      }
    });
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Red de seguridad: cada 800ms re-pausar
  const interval = setInterval(() => {
    document.querySelectorAll("video, audio").forEach((m) => {
      if (!m.paused) {
        try {
          m.pause();
        } catch {}
      }
    });
  }, 800);

  mediaGuard = { observer, interval, onPlay };
}

function stopMediaGuard() {
  if (!mediaGuard) return;
  try {
    document.removeEventListener("play", mediaGuard.onPlay, true);
    document.removeEventListener("playing", mediaGuard.onPlay, true);
    mediaGuard.observer.disconnect();
    clearInterval(mediaGuard.interval);
  } catch {}
  mediaGuard = null;
  savedMediaStates.clear();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === "showSessionSetup")
    showSessionSetup(message.groupId, message.defaults);
  else if (message.action === "block")
    showBlockOverlay(
      message.breakDuration,
      message.breakEnd,
      message.activities,
    );
  else if (message.action === "sessionStarted") hideOverlays();
  else if (message.action === "sessionWarning")
    showMinuteWarning(message.minutes || 1);
  else if (message.action === "breakStarted")
    showBlockOverlay(
      message.breakDuration,
      message.breakEnd || null,
      message.activities,
    );
  else if (
    message.action === "breakFinished" ||
    message.action === "bypassActivated"
  ) {
    hideOverlays();
    location.reload();
  }
});

// ---------- Detección de cambios de URL en SPAs (YouTube, etc.) ----------
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;

    // Consultar el estado actual al background al cambiar de página dinámicamente
    chrome.runtime.sendMessage({ action: "getStatus" }, (resp) => {
      if (!resp) return;

      // Si hay un descanso activo, asegurarnos de mostrar el bloqueo
      if (resp.activeBreak) {
        showBlockOverlay(
          resp.activeBreak.breakDuration,
          resp.activeBreak.endTime,
          resp.activeBreak.activities,
        );
      } else {
        // Si no hay descanso activo pero estás navegando a una nueva URL,
        // el background evaluará si debe mostrar el setup de sesión o dejar pasar.
        // Opcionalmente puedes pedirle al background que re-valide la navegación aquí.
      }
    });
  }
}).observe(document, { subtree: true, childList: true });

// Visibilidad con debounce
document.addEventListener("visibilitychange", () => {
  if (!location.href.startsWith("http")) return;
  clearTimeout(visTimer);
  visTimer = setTimeout(() => {
    const now = Date.now();
    let duration = 0;
    if (document.visibilityState === "hidden" && visibleStart) {
      duration = now - visibleStart;
      visibleStart = null;
    } else if (document.visibilityState === "visible") {
      visibleStart = now;
    }
    chrome.runtime
      .sendMessage({
        action: "visibilityChange",
        url: location.href,
        state: document.visibilityState,
        duration,
      })
      .catch(() => {});
  }, 200);
});

if (document.visibilityState === "visible") visibleStart = Date.now();

// ---------- Helpers ----------

// Espera a que document.body exista (o timeout)
function waitForBody(cb, tries = 0) {
  if (document.body) return cb();
  if (tries > 200) return; // ~10s
  setTimeout(() => waitForBody(cb, tries + 1), 50);
}

// Vuelve a añadir el nodo si fue eliminado del DOM
function keepAttached(node, reattachFn) {
  if (!node) return null;
  const obs = new MutationObserver(() => {
    if (!node.isConnected) {
      reattachFn();
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  return obs;
}

// ---------- Session setup mejorado para SPAs (YouTube, etc.) ----------
function showSessionSetup(groupId, defaults) {
  hideOverlays();
  pendingSetup = { groupId, defaults };

  // Intentar renderizar de inmediato
  renderSessionSetup();

  // Vigilar que el overlay no sea borrado por los scripts dinámicos de la página
  if (setupObserver) setupObserver.disconnect();
  setupObserver = keepAttached(
    document.getElementById("session-setup-overlay"),
    () => {
      if (pendingSetup) renderSessionSetup();
    },
  );
}

function renderSessionSetup() {
  if (!pendingSetup) return;
  const { groupId, defaults } = pendingSetup;

  waitForBody(() => {
    // Evitar duplicados
    const existing = document.getElementById("session-setup-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "session-setup-overlay";
    // Forzamos un z-index ultra alto y position fixed para garantizar que esté por encima de todo en YouTube
    overlay.style.cssText = `position:fixed !important; inset:0 !important; background:rgba(0,0,0,0.92) !important; z-index:2147483647 !important; display:flex !important; justify-content:center !important; align-items:center !important; color:white !important; font-family:system-ui,Arial !important;`;

    overlay.innerHTML = `
      <div style="background:#1e1e1e; padding:36px; border-radius:16px; max-width:460px; width:100%; box-shadow:0 20px 60px rgba(0,0,0,0.6); pointer-events:auto;">
        <h2 style="margin:0 0 8px; color:white;">${defaults.modeIcon} Configura tu sesión</h2>
        <p style="margin:0 0 20px; color:#aaa;">Modo: <strong>${defaults.modeName}</strong>${defaults.strict ? ' · <span style="color:#ff6b6b;">Estricto</span>' : ""}</p>
        <div style="margin-bottom:16px;"><label style="display:block;margin-bottom:6px;font-size:14px;">Sesión (min)</label>
          <input type="number" id="session-duration" value="${defaults.sessionDuration}" min="1" max="240" style="width:100%;padding:10px;border-radius:8px;border:1px solid #444;background:#2a2a2a;color:white;box-sizing:border-box;font-size:16px;"></div>
        <div style="margin-bottom:16px;"><label style="display:block;margin-bottom:6px;font-size:14px;">Descanso (min)</label>
          <input type="number" id="break-duration" value="${defaults.breakDuration}" min="1" max="120" style="width:100%;padding:10px;border-radius:8px;border:1px solid #444;background:#2a2a2a;color:white;box-sizing:border-box;font-size:16px;"></div>
        <button id="suggest-btn" style="width:100%;margin-bottom:10px;padding:10px;border-radius:8px;border:1px solid #555;background:#2a2a2a;color:#bbb;cursor:pointer;font-size:14px;">🤖 Sugerir duración con IA</button>
        <button id="start-session-btn" style="width:100%;padding:14px;border-radius:8px;border:none;background:#4CAF50;color:white;font-size:16px;font-weight:bold;cursor:pointer;">▶ Iniciar sesión</button>
      </div>`;

    // Asegurarnos de agregarlo al documento de forma segura
    (document.body || document.documentElement).appendChild(overlay);

    document.getElementById("suggest-btn").addEventListener("click", () => {
      chrome.runtime.sendMessage(
        { action: "suggestDuration", mode: defaults.mode },
        (r) => {
          if (r?.suggested)
            document.getElementById("session-duration").value = r.suggested;
        },
      );
    });

    document
      .getElementById("start-session-btn")
      .addEventListener("click", () => {
        const sd =
          parseInt(document.getElementById("session-duration").value) ||
          defaults.sessionDuration;
        const bd =
          parseInt(document.getElementById("break-duration").value) ||
          defaults.breakDuration;
        chrome.runtime.sendMessage({
          action: "startSession",
          groupId,
          sessionDuration: sd,
          breakDuration: bd,
        });
        pendingSetup = null;
        hideOverlays();
      });
  });
}

// ---------- Block overlay ----------
function showBlockOverlay(bd, be, activities) {
  hideOverlays();
  startMediaGuard(); // ⬅️ pausar todo el contenido multimedia
  waitForBody(() => {
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("blocked.html");
    iframe.style.cssText = `position:fixed;inset:0;width:100%;height:100%;border:none;z-index:2147483647;background:rgba(0,0,0,0.95);`;
    iframe.id = "block-overlay-iframe";
    document.body.appendChild(iframe);
    overlayFrame = iframe;
    iframe.onload = () => {
      iframe.contentWindow.postMessage(
        {
          type: "initBreak",
          breakDuration: bd,
          breakEnd: be || Date.now() + bd * 60000,
          activities: activities || [],
        },
        "*",
      );
    };
  });
}

function showMinuteWarning(minutes) {
  if (warningElement) return;
  waitForBody(() => {
    const w = document.createElement("div");
    w.style.cssText = `position:fixed;bottom:30px;right:30px;background:#ff9800;color:#000;padding:16px 24px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:2147483646;font-weight:bold;font-size:18px;font-family:system-ui,Arial;`;
    w.textContent = `⚠️ Tu sesión termina en ${minutes} minuto(s)`;
    document.body.appendChild(w);
    warningElement = w;
    setTimeout(() => {
      if (warningElement) {
        warningElement.remove();
        warningElement = null;
      }
    }, 60000);
  });
}

function hideOverlays() {
  if (overlayFrame) {
    overlayFrame.remove();
    overlayFrame = null;
  }
  if (warningElement) {
    warningElement.remove();
    warningElement = null;
  }
  const s = document.getElementById("session-setup-overlay");
  if (s) s.remove();
  if (setupObserver) {
    setupObserver.disconnect();
    setupObserver = null;
  }
  stopMediaGuard(); // liberar
}

// ---------- Bypass desde el iframe ----------
window.addEventListener("message", (event) => {
  if (event.data?.type !== "bypassAttempt") return;
  if (overlayFrame && event.source !== overlayFrame.contentWindow) return;
  chrome.runtime.sendMessage({ action: "bypassBreak" }, (resp) => {
    if (resp && !resp.success && resp.reason === "strict") {
      if (overlayFrame?.contentWindow)
        overlayFrame.contentWindow.postMessage(
          { type: "bypassDenied", reason: "strict" },
          "*",
        );
    }
  });
});

// ---------- Estado inicial ----------
chrome.runtime.sendMessage({ action: "getStatus" }, (resp) => {
  if (!resp) return;
  if (resp.activeBreak)
    showBlockOverlay(
      resp.activeBreak.breakDuration,
      resp.activeBreak.endTime,
      resp.activeBreak.activities,
    );
  // si ya hay un setup pendiente (no, el background no lo guarda), nada más
});
