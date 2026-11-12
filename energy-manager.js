// energy-manager.js
const EnergyManager = {
  isIdle: false,
  pendingEvents: [],
  flushTimer: null,
  recentVisits: new Map(),
  FLUSH_INTERVAL_MS: 15000,
  VISIT_THROTTLE_MS: 5 * 60 * 1000,
  MAX_PENDING: 20,

  async enqueue(type, payload) {
    if (this.isIdle) return;
    this.pendingEvents.push({ type, payload, timestamp: Date.now() });
    if (this.pendingEvents.length >= this.MAX_PENDING) {
      await this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL_MS);
    }
  },

  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingEvents.length === 0) return;
    const events = this.pendingEvents;
    this.pendingEvents = [];
    await mergeEventsToStorage(events);
  },

  shouldRecordVisit(url) {
    if (this.isIdle) return false;
    try {
      const domain = new URL(url).hostname;
      const last = this.recentVisits.get(domain);
      const now = Date.now();
      if (last && now - last < this.VISIT_THROTTLE_MS) return false;
      this.recentVisits.set(domain, now);
      return true;
    } catch {
      return false;
    }
  },

  setPaused(paused) {
    this.isIdle = paused;
    if (paused) this.flush();
  },

  clear() {
    this.pendingEvents = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  },
};

async function mergeEventsToStorage(events) {
  const data = await getData();
  const ai = data.aiData;
  const now = Date.now();

  for (const ev of events) {
    const { type, payload } = ev;

    if (type === "visit") {
      if (!payload.url) continue;
      const domain = payload.domain;
      if (!ai.byDomain[domain])
        ai.byDomain[domain] = {
          visits: 0,
          totalTime: 0,
          firstVisit: ev.timestamp,
          lastVisit: ev.timestamp,
          hoursActive: {},
        };
      const bd = ai.byDomain[domain];
      bd.visits++;
      bd.lastVisit = ev.timestamp;
      bd.totalTime += payload.duration || 0;
      const hour = new Date(ev.timestamp).getHours();
      bd.hoursActive[hour] = (bd.hoursActive[hour] || 0) + 1;

      ai.visits.push({
        url: payload.url,
        domain,
        path: payload.path,
        pathHash: payload.pathHash || null,
        timestamp: ev.timestamp,
        duration: payload.duration || 0,
        isGroup: payload.isGroup || false,
        groupId: payload.groupId || null,
        hadActiveSession: payload.hadActiveSession || false,
        wasWhitelisted: payload.wasWhitelisted || false,
      });
    } else if (type === "visitClose") {
      // sumar duración al último visit del mismo url
      const host = (() => {
        try {
          return new URL(payload.url).hostname;
        } catch {
          return null;
        }
      })();
      if (!host) continue;
      if (ai.byDomain[host])
        ai.byDomain[host].totalTime += payload.duration || 0;
      for (let i = ai.visits.length - 1; i >= 0; i--) {
        if (ai.visits[i].url === payload.url) {
          ai.visits[i].duration =
            (ai.visits[i].duration || 0) + (payload.duration || 0);
          break;
        }
      }
    } else if (type === "visibility") {
      ai.visibilityEvents.push({
        url: payload.url,
        state: payload.state,
        timestamp: ev.timestamp,
      });
      if (payload.state === "visible") {
        const day = new Date(ev.timestamp).getDay();
        const hour = new Date(ev.timestamp).getHours();
        if (!ai.heatmap[day]) ai.heatmap[day] = {};
        ai.heatmap[day][hour] =
          (ai.heatmap[day][hour] || 0) + (payload.duration || 0);
      }
    } else if (type === "tabSwitch") {
      ai.tabSwitches.push({
        from: payload.from,
        to: payload.to,
        fromGroup: payload.fromGroup,
        toGroup: payload.toGroup,
        timestamp: ev.timestamp,
      });
      if (payload.from && payload.to && payload.from !== payload.to) {
        ai.transitions.push({
          from: payload.from,
          to: payload.to,
          gapMs: 0,
          timestamp: ev.timestamp,
        });
      }
    } else if (type === "tabOpen" || type === "tabClose") {
      ai.tabEvents.push({
        type: type === "tabOpen" ? "open" : "close",
        url: payload.url,
        groupId: payload.groupId,
        timestamp: ev.timestamp,
        lifetime: payload.lifetime || 0,
      });
    } else if (type === "idle") {
      ai.idleEvents.push({
        state: payload.state,
        timestamp: ev.timestamp,
        duration: payload.duration || 0,
      });
    } else if (type === "bypass") {
      ai.bypassPatterns.afterMinutes.push(payload.afterMinutes || 0);
      const h = new Date(ev.timestamp).getHours();
      ai.bypassPatterns.hourOfDay[h] =
        (ai.bypassPatterns.hourOfDay[h] || 0) + 1;
    } else if (type === "returnAfterBypass") {
      ai.bypassPatterns.returnAfterBypass.push(payload.seconds || 0);
    } else if (type === "rapidReopen") {
      ai.rapidReopens.push({
        url: payload.url,
        closedAt: payload.closedAt,
        reopenedAt: ev.timestamp,
        gapMs: payload.gapMs,
      });
    } else if (type === "resistance") {
      ai.resistance.push({
        url: payload.url,
        timestamp: ev.timestamp,
        durationBeforeSession: payload.durationBeforeSession || 0,
      });
    }
  }

  const MAX = 5000;
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
    if (ai[k].length > MAX) ai[k] = ai[k].slice(-MAX);
  });
  ["sequences", "distractionChains"].forEach((k) => {
    if (ai[k].length > 500) ai[k] = ai[k].slice(-500);
  });

  await saveData(data);
}

if (typeof module !== "undefined")
  module.exports = { EnergyManager, mergeEventsToStorage };
