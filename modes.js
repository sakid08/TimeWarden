// modes.js
const MODE_DEFINITIONS = {
  work: {
    name: "Trabajo",
    icon: "💼",
    defaultSession: 50,
    defaultBreak: 10,
    strict: true,
    color: "#2196F3",
    breakActivities: [
      "🚶 Levántate y camina 2 minutos",
      "💧 Bebe un vaso de agua",
      "👀 Mira algo lejano por 20 segundos",
      "🧘 Estira cuello y hombros",
    ],
  },
  chill: {
    name: "Chill",
    icon: "🌴",
    defaultSession: 20,
    defaultBreak: 10,
    strict: false,
    color: "#4CAF50",
    breakActivities: [
      "🎵 Escucha una canción",
      "🍵 Prepara una bebida",
      "🌿 Respira profundamente",
      "😌 Cierra los ojos 1 minuto",
    ],
  },
  focus: {
    name: "Enfoque profundo",
    icon: "🎯",
    defaultSession: 90,
    defaultBreak: 20,
    strict: true,
    color: "#9C27B0",
    breakActivities: [
      "🚶 Camina sin mirar el móvil",
      "💧 Hidrátate",
      "🌳 Sal a tomar aire",
      "🧘 Medita 5 minutos",
    ],
  },
  study: {
    name: "Estudio",
    icon: "📚",
    defaultSession: 45,
    defaultBreak: 15,
    strict: true,
    color: "#FF9800",
    breakActivities: [
      "📝 Repasa lo aprendido",
      "💧 Bebe agua",
      "🚶 Estira las piernas",
      "🧠 Descansa la mente",
    ],
  },
  custom: {
    name: "Personalizado",
    icon: "⚙️",
    defaultSession: 25,
    defaultBreak: 5,
    strict: false,
    color: "#607D8B",
    breakActivities: ["💧 Bebe agua", "🚶 Estira"],
  },
};

function getModeDefinition(mode) {
  return MODE_DEFINITIONS[mode] || MODE_DEFINITIONS.custom;
}
function getActiveMode(data) {
  return data.modes?.active || "custom";
}
function getModeDefaults(data) {
  return getModeDefinition(getActiveMode(data));
}
function isStrictMode(data) {
  return (
    data.settings?.strictMode || getModeDefinition(getActiveMode(data)).strict
  );
}

if (typeof module !== "undefined")
  module.exports = {
    MODE_DEFINITIONS,
    getModeDefinition,
    getActiveMode,
    getModeDefaults,
    isStrictMode,
  };
