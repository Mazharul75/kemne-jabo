// Rider data: "bus seen" reports, fares paid, problem flags, and the one trip a rider is currently taking.
//
// Two modes, same interface:
//   local  – everything lives in this browser (default; nothing is shared)
//   remote – reports go to Supabase through the functions in supabase/schema.sql
// In remote mode a failed network call falls back to local so a tap is never lost.
//
// Privacy: a seen-report holds bus + stop + time. A fare report holds amount + trip + time.
// The device is identified only by a salted hash of a random id, kept to limit spam.

const PREFIX = "kj.";
const ls = {
  get(key, fallback) {
    try { const v = localStorage.getItem(PREFIX + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* private mode / full */ } },
};

const now = () => Date.now();
const minutes = (n) => n * 60 * 1000;
const randomId = () => {
  try { const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, "0")).join(""); }
  catch { return String(Math.random()).slice(2) + String(now()); }
};

async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return text; }
}

export function createStore(config, settings) {
  const remote = !!(config.supabaseUrl && config.supabaseAnonKey);
  let deviceId = ls.get("device", null);
  if (!deviceId) { deviceId = randomId(); ls.set("device", deviceId); }
  let hashed = null;
  const deviceHash = async () => (hashed ??= await sha256("kemne-jabo:" + deviceId));

  async function rpc(name, body) {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${name} ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  /* ───── bus seen ───── */

  const localSeen = () => ls.get("seen", []).filter((r) => now() - r.ts < minutes(60 * 24));

  /** Reports still inside the visible window, newest first, grouped per bus + stop. */
  async function seenFor(routeIds) {
    const ttl = minutes(settings.seen_ttl_min);
    const hidden = new Set(ls.get("seen-hidden", []));
    const rows = new Map(); // key -> { route_id, stop_id, ts, riders }
    const put = (route_id, stop_id, ts, riders) => {
      const k = route_id + "|" + stop_id;
      const cur = rows.get(k);
      if (!cur) rows.set(k, { route_id, stop_id, ts, riders });
      else { cur.ts = Math.max(cur.ts, ts); cur.riders = Math.max(cur.riders, riders); }
    };
    let remoteOk = false;
    if (remote && routeIds.length) {
      try {
        const data = await rpc("seen_recent", { p_routes: routeIds, p_ttl_min: settings.seen_ttl_min });
        for (const r of data || []) put(r.route_id, r.stop_id, new Date(r.last_at).getTime(), Number(r.riders));
        remoteOk = true;
      } catch { /* fall back to local below */ }
    }
    for (const r of localSeen()) {
      if (now() - r.ts > ttl || !routeIds.includes(r.route_id)) continue;
      if (remoteOk && r.synced) continue; // already counted by the server
      put(r.route_id, r.stop_id, r.ts, 1);
    }
    return [...rows.values()].filter((r) => !hidden.has(r.route_id + "|" + r.stop_id + "|" + Math.floor(r.ts / 60000)) && now() - r.ts <= ttl)
      .sort((a, b) => b.ts - a.ts);
  }

  /** @returns {{ok:true, shared:boolean} | {ok:false, reason:"tooSoon"|"dayLimit"}} */
  async function reportSeen(routeId, stopId) {
    const mine = localSeen();
    if (mine.some((r) => r.route_id === routeId && r.stop_id === stopId && now() - r.ts < minutes(settings.seen_min_gap_min))) return { ok: false, reason: "tooSoon" };
    if (mine.filter((r) => now() - r.ts < minutes(60 * 24)).length >= settings.seen_max_per_day) return { ok: false, reason: "dayLimit" };
    const row = { route_id: routeId, stop_id: stopId, ts: now(), synced: false };
    let shared = false;
    if (remote) {
      try {
        const res = await rpc("report_seen", { p_route: routeId, p_stop: stopId, p_device: await deviceHash() });
        if (res && res.ok === false) return { ok: false, reason: res.reason === "day" ? "dayLimit" : "tooSoon" };
        row.synced = shared = true;
      } catch { /* keep locally */ }
    }
    ls.set("seen", [...mine, row]);
    return { ok: true, shared };
  }

  /** "Wrong report" — hide it here, and tell the server so it can discount it. */
  async function markSeenWrong(report) {
    const hidden = ls.get("seen-hidden", []);
    hidden.push(report.route_id + "|" + report.stop_id + "|" + Math.floor(report.ts / 60000));
    ls.set("seen-hidden", hidden.slice(-100));
    if (remote) { try { await rpc("report_seen_wrong", { p_route: report.route_id, p_stop: report.stop_id, p_device: await deviceHash() }); } catch { /* best effort */ } }
  }

  /* ───── fares ───── */

  async function reportFare({ routeId, fromStop, toStop, amount }) {
    const mine = ls.get("fares", []).filter((r) => now() - r.ts < minutes(60 * 24));
    if (mine.length >= settings.fare_max_per_day) return { ok: false, reason: "dayLimit" };
    const row = { route_id: routeId, from_stop: fromStop, to_stop: toStop, amount, ts: now() };
    let shared = false;
    if (remote) {
      try {
        const res = await rpc("report_fare", { p_route: routeId, p_from: fromStop, p_to: toStop, p_amount: amount, p_device: await deviceHash() });
        if (res && res.ok === false) return { ok: false, reason: "dayLimit" };
        shared = true;
      } catch { /* keep locally */ }
    }
    ls.set("fares", [...ls.get("fares", []), row].slice(-200));
    return { ok: true, shared };
  }

  async function fareAmounts(routeId, fromStop, toStop) {
    if (remote) {
      try { const a = await rpc("fare_amounts", { p_route: routeId, p_from: fromStop, p_to: toStop }); if (Array.isArray(a)) return a.map(Number); } catch { /* local below */ }
    }
    return ls.get("fares", []).filter((r) => r.route_id === routeId && r.from_stop === fromStop && r.to_stop === toStop).map((r) => r.amount);
  }

  /* ───── flags (wrong info, missing trips, route-correct answers) ───── */

  async function flag({ routeId = null, kind, note = "", extra = null }) {
    const row = { route_id: routeId, kind, note: String(note).slice(0, 300), extra, ts: now() };
    ls.set("flags", [...ls.get("flags", []), row].slice(-100));
    if (remote) {
      try {
        await rpc("report_flag", { p_route: routeId, p_kind: kind, p_note: row.note, p_extra: extra, p_device: await deviceHash() });
        return { ok: true, shared: true };
      } catch { /* kept locally */ }
    }
    return { ok: true, shared: false };
  }

  /* ───── the trip the rider is on now ───── */

  const currentTrip = () => ls.get("trip", null);
  const startTrip = (trip) => ls.set("trip", { ...trip, startedAt: now() });
  const clearTrip = () => ls.set("trip", null);

  /* ───── small preferences ───── */
  const pref = (k, d) => ls.get("pref-" + k, d);
  const setPref = (k, v) => ls.set("pref-" + k, v);

  return {
    mode: remote ? "remote" : "local",
    seenFor, reportSeen, markSeenWrong, reportFare, fareAmounts, flag,
    currentTrip, startTrip, clearTrip, pref, setPref,
    _debug: { ls },
  };
}
