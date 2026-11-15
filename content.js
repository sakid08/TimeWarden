// content.js
let overlayFrame = null;
let warningElement = null;
let visTimer = null;
let visibleStart = null;

// estado del setup pendiente (para re-inyectar si el DOM se reemplaza)
let pendingSetup = null;
let setupObserver = null;

// ---------- Control de medios mediante el bloqueo o setup con soporte Shadow DOM ----------
let mediaGuard = null;
let savedMediaStates = new Map();

// Función recursiva para encontrar elementos multimedia incluyendo dentro de Shadow Roots (Ej: YouTube)
function getAllMediaElements(root = document) {
  let elements = [];
  try {
    elements.push(...root.querySelectorAll("video, audio"));
    const allEls = root.querySelectorAll("*");
    for (const el of allEls) {
      if (el.shadowRoot) {
        elements.push(...getAllMediaElements(el.shadowRoot));
      }
    }
  } catch {}
  return elements;
}

function pauseAllMedia() {
  const mediaEls = getAllMediaElements();
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
  stopMediaGuard();

  pauseAllMedia();

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

  const observer = new MutationObserver(() => {
    getAllMediaElements().forEach((m) => {
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

  const interval = setInterval(() => {
    getAllMediaElements().forEach((m) => {
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

    // Consultar al background si esta nueva ruta SPA requiere bloqueo o setup
    chrome.runtime.sendMessage(
      { action: "checkUrlStatus", url: currentUrl },
      (resp) => {
        if (!resp) return;
        if (resp.action === "block") {
          showBlockOverlay(resp.breakDuration, resp.breakEnd, resp.activities);
        } else if (resp.action === "setup") {
          showSessionSetup(resp.groupId, resp.defaults);
        } else {
          hideOverlays();
        }
      },
    );
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
function waitForBody(cb, tries = 0) {
  if (document.body) return cb();
  if (tries > 200) return;
  setTimeout(() => waitForBody(cb, tries + 1), 50);
}

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

// ---------- Session setup mediante iframe aislado para SPAs ----------
function showSessionSetup(groupId, defaults) {
  hideOverlays();
  startMediaGuard();
  pendingSetup = { groupId, defaults };

  waitForBody(() => {
    const existing = document.getElementById("session-setup-iframe");
    if (existing) existing.remove();

    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("setup.html");
    iframe.id = "session-setup-iframe";
    iframe.style.cssText = `position:fixed !important; inset:0 !important; width:100% !important; height:100% !important; border:none !important; z-index:2147483647 !important; background:rgba(0,0,0,0.92) !important;`;

    (document.body || document.documentElement).appendChild(iframe);
    overlayFrame = iframe;

    iframe.onload = () => {
      iframe.contentWindow.postMessage(
        {
          type: "initSetup",
          groupId,
          defaults,
        },
        "*",
      );
    };

    if (setupObserver) setupObserver.disconnect();
    setupObserver = keepAttached(iframe, () => {
      if (pendingSetup)
        showSessionSetup(pendingSetup.groupId, pendingSetup.defaults);
    });
  });
}

// ---------- Block overlay ----------
function showBlockOverlay(bd, be, activities) {
  hideOverlays();
  startMediaGuard();
  waitForBody(() => {
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("blocked.html");
    iframe.style.cssText = `position:fixed !important; inset:0 !important; width:100% !important; height:100% !important; border:none !important; z-index:2147483647 !important; background:rgba(0,0,0,0.95) !important;`;
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
    w.style.cssText = `position:fixed !important; bottom:30px !important; right:30px !important; background:#ff9800 !important; color:#000 !important; padding:16px 24px !important; border-radius:12px !important; box-shadow:0 4px 20px rgba(0,0,0,0.3) !important; z-index:2147483646 !important; font-weight:bold !important; font-size:18px !important; font-family:system-ui,Arial !important;`;
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
  const s = document.getElementById("session-setup-iframe");
  if (s) s.remove();
  if (setupObserver) {
    setupObserver.disconnect();
    setupObserver = null;
  }
  stopMediaGuard();
}

// ---------- Mensajes desde los iframes ----------
window.addEventListener("message", (event) => {
  if (overlayFrame && event.source !== overlayFrame.contentWindow) return;

  if (event.data?.type === "setupCompleted") {
    pendingSetup = null;
    hideOverlays();
    return;
  }

  if (event.data?.type === "bypassAttempt") {
    chrome.runtime.sendMessage({ action: "bypassBreak" }, (resp) => {
      if (resp && !resp.success && resp.reason === "strict") {
        if (overlayFrame?.contentWindow) {
          overlayFrame.contentWindow.postMessage(
            { type: "bypassDenied", reason: "strict" },
            "*",
          );
        }
      }
    });
  }
});

// ---------- Estado inicial verificado por URL ----------
chrome.runtime.sendMessage(
  { action: "checkUrlStatus", url: location.href },
  (resp) => {
    if (!resp) return;
    if (resp.action === "block") {
      showBlockOverlay(resp.breakDuration, resp.breakEnd, resp.activities);
    } else if (resp.action === "setup") {
      showSessionSetup(resp.groupId, resp.defaults);
    }
  },
);
