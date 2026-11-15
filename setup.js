// setup.js
let currentGroupId = null;
let currentDefaults = {};

// Escuchar los datos iniciales enviados desde content.js mediante postMessage
window.addEventListener("message", (event) => {
  if (event.data?.type !== "initSetup") return;

  currentGroupId = event.data.groupId;
  currentDefaults = event.data.defaults || {};

  // Actualizar textos e inputs con los valores por defecto
  const icon = currentDefaults.modeIcon || "⏱️";
  const modeName = currentDefaults.modeName || "Normal";

  document.getElementById("title").textContent = `${icon} Configura tu sesión`;

  const subtitleEl = document.getElementById("subtitle");
  subtitleEl.innerHTML =
    `Modo: <strong>${modeName}</strong>` +
    (currentDefaults.strict
      ? ' · <span class="strict-badge">Estricto</span>'
      : "");

  if (currentDefaults.sessionDuration) {
    document.getElementById("session-duration").value =
      currentDefaults.sessionDuration;
  }
  if (currentDefaults.breakDuration) {
    document.getElementById("break-duration").value =
      currentDefaults.breakDuration;
  }
});

// Botón de sugerencia con IA
document.getElementById("suggest-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage(
    { action: "suggestDuration", mode: currentDefaults.mode },
    (resp) => {
      if (resp?.suggested) {
        document.getElementById("session-duration").value = resp.suggested;
      }
    },
  );
});

// Botón de iniciar sesión
document.getElementById("start-session-btn").addEventListener("click", () => {
  const sd =
    parseInt(document.getElementById("session-duration").value, 10) ||
    currentDefaults.sessionDuration ||
    25;
  const bd =
    parseInt(document.getElementById("break-duration").value, 10) ||
    currentDefaults.breakDuration ||
    5;

  chrome.runtime.sendMessage(
    {
      action: "startSession",
      groupId: currentGroupId,
      sessionDuration: sd,
      breakDuration: bd,
    },
    () => {
      // Notificar a content.js para que cierre el iframe
      window.parent.postMessage({ type: "setupCompleted" }, "*");
    },
  );
});
