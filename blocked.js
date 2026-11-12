// blocked.js
let breakEnd = 0;
let timerInterval = null;
let expectedPhrase =
  "Reconozco que estoy rompiendo mi tiempo de descanso y perdiendo productividad";
let strictMode = false;

window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  if (event.data.type === "initBreak") {
    const bd = event.data.breakDuration || 0;
    breakEnd = event.data.breakEnd || Date.now() + bd * 60000;
    if (event.data.activities && event.data.activities.length) {
      const el = document.getElementById("activities");
      const list = document.getElementById("activities-list");
      list.innerHTML = "";
      event.data.activities.forEach((a) => {
        const li = document.createElement("li");
        li.textContent = a;
        list.appendChild(li);
      });
      el.style.display = "block";
    }
    startTimer();
  } else if (event.data.type === "bypassDenied") {
    document.getElementById("bypass-error").textContent =
      "🔒 El modo estricto no permite bypass.";
  }
});

chrome.runtime.sendMessage({ action: "getStatus" }, (resp) => {
  if (resp) {
    if (resp.settings?.bypassPhrase)
      expectedPhrase = resp.settings.bypassPhrase;
    if (resp.strict) {
      strictMode = true;
      document.getElementById("bypass-section").classList.add("hidden");
      document.getElementById("strict-note").classList.remove("hidden");
      document
        .getElementById("bypass-section")
        .appendChild(document.getElementById("strict-note"));
    }
  }
});

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const remaining = Math.max(0, breakEnd - Date.now());
    const min = Math.floor(remaining / 60000);
    const sec = Math.floor((remaining % 60000) / 1000);
    document.getElementById("break-timer").textContent =
      `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    if (remaining <= 0) {
      clearInterval(timerInterval);
      document.getElementById("break-timer").textContent = "00:00";
      window.parent.postMessage({ type: "breakFinished" }, "*");
    }
  }, 1000);
}

document.getElementById("bypass-btn").addEventListener("click", () => {
  const input = document.getElementById("bypass-input").value.trim();
  if (input === expectedPhrase) {
    window.parent.postMessage({ type: "bypassAttempt" }, "*");
    document.getElementById("bypass-error").textContent = "";
  } else {
    document.getElementById("bypass-error").textContent =
      "❌ Frase incorrecta. Intenta de nuevo.";
  }
});

document.getElementById("leave-btn").addEventListener("click", () => {
  // Pide al background cerrar la pestaña actual
  chrome.runtime.sendMessage({ action: "closeTab" });
});
