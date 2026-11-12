// ai-engine.js
const AIEngine = {
  analyze(data) {
    const level = data.analysis?.level || "light";
    const recommendations = [];
    const patterns = {};
    const stats = data.stats || {};
    const ai = data.aiData || {};

    if (!data.settings.aiEnabled) {
      return { patterns: {}, recommendations: [], lastAnalysis: Date.now() };
    }

    if (level === "light") {
      return this._analyzeLight(data, patterns, recommendations);
    } else if (
      level === "standard" ||
      level === "invasive" ||
      level === "total"
    ) {
      this._analyzeLight(data, patterns, recommendations);
      this._analyzeStandard(data, patterns, recommendations);
      if (level === "invasive" || level === "total")
        this._analyzeInvasive(data, patterns, recommendations);
      if (level === "total")
        this._analyzeTotal(data, patterns, recommendations);
    }

    return {
      patterns,
      recommendations: recommendations.slice(0, 8),
      lastAnalysis: Date.now(),
    };
  },

  _analyzeLight(data, patterns, recs) {
    const h = data.stats.history || [];
    if (h.length < 5) {
      recs.push({
        type: "info",
        title: "Recopilando datos",
        message:
          "Necesitamos al menos 5 sesiones para recomendaciones básicas.",
      });
      return;
    }

    // Hora más productiva
    const hours = {};
    h.filter((x) => x.type === "session").forEach((x) => {
      const hr = new Date(x.timestamp).getHours();
      hours[hr] = (hours[hr] || 0) + (x.duration || 0);
    });
    const bestHour = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
    if (bestHour) {
      patterns.bestHour = parseInt(bestHour[0]);
      recs.push({
        type: "productivity",
        title: `Tu hora más productiva: ${bestHour[0]}:00`,
        message: "Programa tus sesiones más largas en ese horario.",
      });
    }

    // Ratio bypass
    const total =
      (data.stats.breaksRespected || 0) + (data.stats.bypassUsed || 0);
    if (total > 0) {
      const ratio = (data.stats.bypassUsed || 0) / total;
      patterns.bypassRatio = ratio;
      if (ratio > 0.3)
        recs.push({
          type: "warning",
          title: "Uso alto de bypass",
          message: `Usas el bypass en ${Math.round(ratio * 100)}% de descansos. Considera sesiones más cortas.`,
        });
      else if (ratio < 0.05)
        recs.push({
          type: "success",
          title: "Excelente disciplina",
          message: `Solo usas el bypass en ${Math.round(ratio * 100)}% de los casos.`,
        });
    }

    // Racha
    if (data.stats.streak?.current > 0) {
      recs.push({
        type: "success",
        title: `Racha de ${data.stats.streak.current} días`,
        message: "¡Sigue respetando tus descansos!",
      });
    }
  },

  _analyzeStandard(data, patterns, recs) {
    const ai = data.aiData || {};
    if ((ai.visits || []).length < 10) return;

    // Total foco real
    const totalFocus = (ai.visits || []).reduce(
      (a, v) => a + (v.duration || 0),
      0,
    );
    patterns.totalFocusMs = totalFocus;
    if (totalFocus > 0) {
      recs.push({
        type: "info",
        title: `Foco real registrado: ${Math.round(totalFocus / 60000)} min`,
        message:
          "Este es el tiempo que realmente has estado visible en sitios de grupos.",
      });
    }

    // Cambios de pestaña por hora
    const switchesByHour = {};
    (ai.tabSwitches || []).forEach((s) => {
      const hr = new Date(s.timestamp).getHours();
      switchesByHour[hr] = (switchesByHour[hr] || 0) + 1;
    });
    const worstHour = Object.entries(switchesByHour).sort(
      (a, b) => b[1] - a[1],
    )[0];
    if (worstHour && worstHour[1] > 5) {
      patterns.worstSwitchHour = parseInt(worstHour[0]);
      recs.push({
        type: "warning",
        title: `Distracción a las ${worstHour[0]}:00`,
        message: `${worstHour[1]} cambios de pestaña a esa hora. Considera modo Enfoque.`,
      });
    }

    // Apertura/cierre de pestañas
    const opens = (ai.tabEvents || []).filter((e) => e.type === "open").length;
    const closes = (ai.tabEvents || []).filter(
      (e) => e.type === "close",
    ).length;
    if (opens > 10) {
      patterns.tabOpens = opens;
      recs.push({
        type: "warning",
        title: `Abres ${opens} pestañas de grupos`,
        message:
          "Considera cerrar las que no uses para reducir distracción pasiva.",
      });
    }

    // Idle
    const idleTime = (ai.idleEvents || []).reduce(
      (a, e) => a + (e.duration || 0),
      0,
    );
    if (idleTime > 0) patterns.idleTimeMs = idleTime;
  },

  _analyzeInvasive(data, patterns, recs) {
    const ai = data.aiData || {};

    // Cadenas de distracción
    const chains = this._detectDistractionChains(ai.transitions || []);
    patterns.distractionChains = chains;
    if (chains.length >= 2) {
      recs.push({
        type: "warning",
        title: "Patrón de distracción detectado",
        message: `Has encadenado ${chains.length} veces redes sociales en <3 min. Es tu patrón de evasión.`,
      });
      ai.distractionChains = chains;
    }

    // Reaperturas rápidas
    if ((ai.rapidReopens || []).length >= 3) {
      const avg =
        (ai.rapidReopens || []).reduce((a, r) => a + r.gapMs, 0) /
        ai.rapidReopens.length;
      recs.push({
        type: "warning",
        title: `${ai.rapidReopens.length} reaperturas rápidas`,
        message: `Cierras y reabres sitios en promedio cada ${Math.round(avg / 1000)}s. Esto indica dependencia.`,
      });
    }

    // Secuencias dentro de grupos
    if ((ai.sequences || []).length > 0) {
      patterns.sequences = ai.sequences.length;
    }

    // Bypass después de X min
    const bp = ai.bypassPatterns || {};
    if ((bp.afterMinutes || []).length >= 3) {
      const avg =
        bp.afterMinutes.reduce((a, b) => a + b, 0) / bp.afterMinutes.length;
      patterns.avgBypassAfterMinutes = Math.round(avg);
      if (avg > 30) {
        recs.push({
          type: "warning",
          title: `Bypass tras ${Math.round(avg)} min`,
          message:
            "Tus bypass ocurren tras fatiga. Considera sesiones más cortas.",
        });
      }
    }
  },

  _analyzeTotal(data, patterns, recs) {
    const ai = data.aiData || {};
    if (!data.analysis || !data.analysis.totalConfirmedAt) return;

    const byDomain = ai.byDomain || {};
    const topDomains = Object.entries(byDomain)
      .sort((a, b) => (b[1].totalTime || 0) - (a[1].totalTime || 0))
      .slice(0, 5);

    if (topDomains.length > 0) {
      patterns.topDomains = topDomains.map(([d, v]) => ({
        domain: d,
        time: v.totalTime,
        visits: v.visits,
      }));
      const top = topDomains[0];
      recs.push({
        type: "info",
        title: `Dominio con más tiempo: ${top[0]}`,
        message: `Le has dedicado ${Math.round(top[1].totalTime / 60000)} min en ${top[1].visits} visitas.`,
      });
    }

    // Score de vida digital
    const score = this._computeDigitalScore(data);
    patterns.digitalScore = score;
    recs.push({
      type: score.distraction > 6 ? "warning" : "success",
      title: `Índice de enfoque: ${score.focus}/10`,
      message: `Distracción: ${score.distraction}/10 · Diversidad: ${score.diversity}/10`,
    });

    // Predicción próxima distracción
    const prediction = this._predictNextDistraction(ai);
    if (prediction) {
      patterns.prediction = prediction;
      recs.push({
        type: "info",
        title: "Predicción de próxima distracción",
        message: `${prediction.probability}% de probabilidad de que abras ${prediction.domain} en los próximos ${prediction.minutes} min.`,
      });
    }
  },

  _detectDistractionChains(transitions) {
    const chains = [];
    const social = [
      "facebook",
      "instagram",
      "twitter",
      "x.com",
      "tiktok",
      "reddit",
      "youtube",
    ];
    for (let i = 0; i < transitions.length - 2; i++) {
      const a = transitions[i],
        b = transitions[i + 1],
        c = transitions[i + 2];
      const isSocial = (t) =>
        t &&
        social.some(
          (s) => (t.from || "").includes(s) || (t.to || "").includes(s),
        );
      if (isSocial(a) && isSocial(b) && isSocial(c)) {
        const totalGap = (c.timestamp || 0) - (a.timestamp || 0);
        if (totalGap > 0 && totalGap < 3 * 60 * 1000) {
          chains.push({
            domains: [a.from, b.to, c.to].filter(Boolean),
            timestamp: a.timestamp,
            totalMs: totalGap,
          });
        }
      }
    }
    return chains.slice(-20);
  },

  _computeDigitalScore(data) {
    const ai = data.aiData || {};
    const stats = data.stats || {};

    const totalBreaks = (stats.breaksRespected || 0) + (stats.bypassUsed || 0);
    const discipline =
      totalBreaks > 0 ? (stats.breaksRespected || 0) / totalBreaks : 0.5;

    const switches = (ai.tabSwitches || []).length;
    const focusEvents = (ai.visits || []).filter(
      (v) => v.duration > 60000,
    ).length;
    const focus =
      focusEvents > 0
        ? Math.min(1, focusEvents / Math.max(1, switches / 2))
        : 0.5;

    const domains = Object.keys(ai.byDomain || {}).length;
    const diversity = Math.min(1, domains / 15);

    const recentBypass = (stats.bypassHistory || []).filter(
      (b) => b.timestamp > Date.now() - 7 * 86400000,
    ).length;
    const distraction = Math.min(1, recentBypass / 10);

    return {
      focus: Math.round(focus * 10),
      discipline: Math.round(discipline * 10),
      diversity: Math.round(diversity * 10),
      distraction: Math.round(distraction * 10),
    };
  },

  _predictNextDistraction(ai) {
    const visits = (ai.visits || []).filter((v) => v.domain);
    if (visits.length < 20) return null;
    const now = new Date();
    const hour = now.getHours();
    const recentDomains = visits.filter((v) => {
      const h = new Date(v.timestamp).getHours();
      return Math.abs(h - hour) <= 1;
    });
    if (recentDomains.length < 5) return null;
    const counts = {};
    recentDomains.forEach((v) => {
      counts[v.domain] = (counts[v.domain] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    const probability = Math.min(
      95,
      Math.round((top[1] / recentDomains.length) * 100),
    );
    return { domain: top[0], probability, minutes: 15 };
  },

  suggestDuration(data, mode) {
    const md =
      typeof getModeDefinition === "function"
        ? getModeDefinition(mode)
        : { defaultSession: 25 };
    const h = (data.stats.history || []).filter((x) => x.type === "session");
    if (h.length < 3) return md.defaultSession;
    const recent = h.slice(-10);
    const avg = recent.reduce((a, b) => a + b.duration, 0) / recent.length;
    return Math.max(5, Math.min(120, Math.round(avg)));
  },
};

if (typeof module !== "undefined") module.exports = { AIEngine };
