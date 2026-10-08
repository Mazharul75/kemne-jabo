// Place lookup, trip planning and fares. Pure functions — no DOM, no network.
import { normalize, placeKey, scoreKeys, suffixVariants } from "./text.js";

/* ───────────── geometry ───────────── */

export function haversineM(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ───────────── place index ───────────── */

/** One searchable entry per stop / area, each with every name it can be called. */
export function buildIndex(stops, areas, routes = []) {
  const entries = [];
  const weight = new Map();
  for (const r of routes) for (const id of r.stops) weight.set(id, (weight.get(id) || 0) + 1);
  const add = (kind, p) => {
    const names = [p.name_en, p.name_bn, ...(p.aliases || [])].filter(Boolean);
    entries.push({
      kind, id: p.id, ref: `${kind === "stop" ? "s" : "a"}:${p.id}`, weight: weight.get(p.id) || 0,
      name_bn: p.name_bn, name_en: p.name_en, lat: p.lat, lng: p.lng, data: p,
      keys: names.map((n) => ({ text: n, ...placeKey(n) })).filter((k) => k.words.length),
    });
  };
  stops.forEach((s) => add("stop", s));
  areas.forEach((a) => add("area", a));
  const byRef = new Map(entries.map((e) => [e.ref, e]));
  return { entries, byRef };
}

function scoreEntry(entry, qKey, opts) {
  let best = 0;
  // "দশ" on its own, answering "which Mirpur?": match by number alone
  if (!qKey.words.length && qKey.nums.length) {
    return entry.keys.some((k) => k.nums.length === qKey.nums.length && k.nums.every((x, i) => x === qKey.nums[i])) ? 0.9 : 0;
  }
  for (const k of entry.keys) best = Math.max(best, scoreKeys(qKey, k, opts));
  return best;
}

/** Rank places against free text. Handles Bangla case endings (মতিঝিলে → মতিঝিল). */
export function findPlaces(index, text, { limit = 6, prefix = false, restrictTo = null } = {}) {
  const base = normalize(text).split(" ").filter(Boolean);
  if (!base.length) return [];
  const variants = new Set([base.join(" ")]);
  const last = base[base.length - 1];
  if (!/^\d+$/.test(last)) {
    for (const v of suffixVariants(last)) variants.add([...base.slice(0, -1), v].join(" "));
  }
  const pool = restrictTo ? index.entries.filter((e) => restrictTo.has(e.ref)) : index.entries;
  const scored = new Map();
  for (const v of variants) {
    const qKey = placeKey(v);
    if (!qKey.words.length && !qKey.nums.length) continue;
    for (const e of pool) {
      const s = scoreEntry(e, qKey, { prefix }) * (e.kind === "area" ? 0.9 : 1);
      if (s > (scored.get(e.ref)?.score ?? 0)) scored.set(e.ref, { entry: e, score: s });
    }
  }
  // stops beat areas on ties: a stop is where the bus actually is
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || b.entry.weight - a.entry.weight)
    .slice(0, limit);
}

/**
 * Decide what a spoken/typed phrase means.
 *   { status: "match",  pick }         one clear answer
 *   { status: "choose", options }      several plausible places → ask
 *   { status: "none" }                 nothing close
 */
export function resolvePlace(index, text, opts = {}) {
  const hits = findPlaces(index, text, { limit: 8, ...opts });
  if (!hits.length || hits[0].score < 0.55) return { status: "none", hits: [] };
  const [a, b] = hits;
  const clear = a.score >= 0.82 && (!b || a.score - b.score >= 0.1);
  if (clear) return { status: "match", pick: a.entry, score: a.score, hits };
  const options = hits.filter((h) => h.score >= 0.55 && h.score >= a.score - 0.22).slice(0, 5);
  if (options.length === 1) return { status: "match", pick: options[0].entry, score: options[0].score, hits };
  return { status: "choose", options: options.map((h) => h.entry), score: a.score, hits };
}

/* ───────────── graph ───────────── */

export function buildGraph(stops, routes, settings) {
  const stopsById = new Map(stops.map((s) => [s.id, s]));
  const routesById = new Map();
  const stopRoutes = new Map(); // stopId -> [{ route, idx }]
  for (const r of routes) {
    const cum = [0];
    for (let i = 1; i < r.stops.length; i++) {
      const a = stopsById.get(r.stops[i - 1]), b = stopsById.get(r.stops[i]);
      cum.push(cum[i - 1] + (haversineM(a, b) * settings.road_factor_ride) / 1000);
    }
    const pos = new Map(r.stops.map((id, i) => [id, i]));
    const route = { ...r, cum, pos };
    routesById.set(r.id, route);
    r.stops.forEach((id, idx) => {
      if (!stopRoutes.has(id)) stopRoutes.set(id, []);
      stopRoutes.get(id).push({ route, idx });
    });
  }
  // stops within a short walk of each other (changing buses across the road, or at the next stop)
  const nearby = new Map();
  for (const a of stops) {
    const list = [a];
    for (const b of stops) if (a !== b && haversineM(a, b) <= (settings.same_place_m || 350)) list.push(b);
    nearby.set(a.id, list);
  }
  return { stopsById, routesById, stopRoutes, nearby };
}

/* ───────────── fares & times ───────────── */

export function officialFare(distKm, serviceType, settings) {
  const type = settings.fare_rate_per_km[serviceType] ? serviceType : "bus";
  const raw = distKm * settings.fare_rate_per_km[type];
  const rounded = settings.fare_rounding === "ceil" ? Math.ceil(raw) : Math.round(raw);
  return Math.max(settings.fare_minimum[type], rounded);
}

export function rideMinutes(distKm, nStops, settings) {
  return (distKm / settings.bus_speed_kmh) * 60 + nStops * settings.stop_dwell_min_per_stop;
}

/* ───────────── first / last leg ───────────── */

/** Describe how to get between a free point and a stop. */
export function legBetween(pointA, pointB, settings) {
  const straight = haversineM(pointA, pointB);
  const distM = Math.round(straight * settings.road_factor_walk);
  if (straight < 60) return { mode: "none", distM: 0, min: 0 };
  if (distM <= settings.walk_threshold_m) {
    return { mode: "walk", distM, min: Math.max(1, Math.round(distM / settings.walk_speed_m_per_min)) };
  }
  return { mode: "rickshaw", distM, min: Math.max(3, Math.round(distM / settings.rickshaw_speed_m_per_min) + 2) };
}

/** Stops near a place where a ride can start or end, each with the walk/rickshaw leg to reach it. */
function boardingCandidates(graph, place, settings, k = 6) {
  const origin = { lat: place.lat, lng: place.lng };
  const ranked = [];
  for (const stop of graph.stopsById.values()) {
    if (!graph.stopRoutes.has(stop.id)) continue;
    const d = haversineM(origin, stop);
    // a named stop offers itself plus anything within a short walk of it
    const limit = place.kind === "stop" ? settings.same_place_m : settings.max_first_leg_m / settings.road_factor_walk;
    if (d <= limit || stop.id === place.id) ranked.push({ stop, d });
  }
  ranked.sort((a, b) => (a.stop.id === place.id ? -1 : b.stop.id === place.id ? 1 : a.d - b.d));
  return ranked.slice(0, place.kind === "stop" ? 4 : k).map(({ stop }) => ({
    stop, leg: stop.id === place.id ? { mode: "none", distM: 0, min: 0 } : legBetween(origin, stop, settings),
  }));
}

/* ───────────── trip planning ───────────── */

function rideLeg(route, iFrom, iTo, graph, settings) {
  const distKm = Math.abs(route.cum[iTo] - route.cum[iFrom]);
  const nStops = Math.abs(iTo - iFrom);
  const stopIds = iFrom <= iTo ? route.stops.slice(iFrom, iTo + 1) : route.stops.slice(iTo, iFrom + 1).reverse();
  return {
    route, board: graph.stopsById.get(route.stops[iFrom]), alight: graph.stopsById.get(route.stops[iTo]),
    stopIds, nStops, distKm,
    fare: officialFare(distKm, route.service_type, settings),
    rideMin: rideMinutes(distKm, nStops, settings),
  };
}

/** Every bus that runs from stop o to stop d, in either direction. */
function busesBetween(graph, o, d, settings) {
  const atD = new Map((graph.stopRoutes.get(d.id) || []).map((x) => [x.route.id, x.idx]));
  const out = [];
  for (const { route, idx } of graph.stopRoutes.get(o.id) || []) {
    if (!atD.has(route.id)) continue;
    const leg = rideLeg(route, idx, atD.get(route.id), graph, settings);
    if (leg.nStops > 0) out.push(leg);
  }
  return out.sort((a, b) => a.rideMin - b.rideMin || a.fare - b.fare || a.route.name_en.localeCompare(b.route.name_en));
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
// Getting to and from the bus is the least predictable part, so it weighs more when ranking;
// a stop with many buses is worth a little (shorter wait, more chances).
const groupScore = (firstMin, rides, lastMin) => firstMin * 1.6 + median(rides) + lastMin * 1.6 - Math.min(rides.length, 6) * 0.6;

/**
 * Plan a trip. A place is { kind: "stop"|"area"|"me", id, lat, lng }.
 * Buses come grouped by where to board:
 *   direct: [{ board, alight, first, last, buses: [leg…] }]                       best group first
 *   change: [{ board, transfer, transfer2, alight, first, last, buses1, buses2 }]  only when nothing is direct
 */
export function planTrip(graph, settings, fromPlace, toPlace) {
  const empty = (reason) => ({ direct: [], change: [], reason });
  if (fromPlace.kind === toPlace.kind && fromPlace.id === toPlace.id) return empty("same");
  const gap = haversineM(fromPlace, toPlace);
  if (gap < 150) return empty("same");
  // so close that waiting for a bus would take longer than walking
  if (gap < settings.walk_only_m) {
    const distM = Math.round(gap * settings.road_factor_walk);
    return { direct: [], change: [], reason: "walk", walk: { distM, min: Math.max(1, Math.round(distM / settings.walk_speed_m_per_min)) } };
  }
  const oCands = boardingCandidates(graph, fromPlace, settings);
  const dCands = boardingCandidates(graph, toPlace, settings);
  if (!oCands.length) return empty("no-stop-near-origin");
  if (!dCands.length) return empty("no-stop-near-destination");

  const direct = [];
  for (const oc of oCands) for (const dc of dCands) {
    if (oc.stop.id === dc.stop.id || haversineM(oc.stop, dc.stop) < settings.min_ride_m) continue;
    const buses = busesBetween(graph, oc.stop, dc.stop, settings);
    if (!buses.length) continue;
    direct.push({ board: oc.stop, alight: dc.stop, first: oc.leg, last: dc.leg, buses, score: groupScore(oc.leg.min, buses.map((b) => b.rideMin), dc.leg.min) });
  }
  if (direct.length) {
    direct.sort((a, b) => a.score - b.score);
    // Same boarding stop, getting off a short walk apart → one list (each bus keeps its own get-off stop).
    for (let i = 0; i < direct.length; i++) {
      for (let j = i + 1; j < direct.length; j++) {
        const A = direct[i], B = direct[j];
        if (A.board.id !== B.board.id || haversineM(A.alight, B.alight) > settings.same_place_m) continue;
        const have = new Set(A.buses.map((b) => b.route.id));
        A.buses.push(...B.buses.filter((b) => !have.has(b.route.id)));
        A.buses.sort((x, y) => x.rideMin - y.rideMin || x.fare - y.fare);
        direct.splice(j--, 1);
      }
    }
    // alternatives only if they add buses the earlier groups don't have
    const shown = [], have = new Set();
    for (const g of direct) {
      const fresh = g.buses.filter((b) => !have.has(b.route.id));
      if (!fresh.length) continue;
      if (shown.length && g.score > shown[0].score + 25) break;
      shown.push(shown.length ? { ...g, buses: fresh } : g);
      g.buses.forEach((b) => have.add(b.route.id));
      if (shown.length === 3) break;
    }
    return { direct: shown, change: [], reason: null };
  }

  // One change: bus A to a transfer stop, a short walk if the next bus stops nearby, bus B.
  const best = new Map();
  for (const oc of oCands) for (const dc of dCands) {
    if (oc.stop.id === dc.stop.id || haversineM(oc.stop, dc.stop) < settings.min_ride_m) continue;
    const straight = haversineM(oc.stop, dc.stop) / 1000;
    const toD = new Map((graph.stopRoutes.get(dc.stop.id) || []).map((x) => [x.route.id, x.idx]));
    for (const { route: A, idx: ia } of graph.stopRoutes.get(oc.stop.id) || []) {
      for (const [tid, ja] of A.pos) {
        if (ja === ia) continue;
        for (const t2 of graph.nearby.get(tid) || []) {
          if (t2.id === dc.stop.id) continue;
          for (const { route: B, idx: jb } of graph.stopRoutes.get(t2.id) || []) {
            if (B.id === A.id || !toD.has(B.id)) continue;
            const ib = toD.get(B.id);
            if (jb === ib) continue;
            const km = Math.abs(A.cum[ja] - A.cum[ia]) + Math.abs(B.cum[ib] - B.cum[jb]);
            if (km > straight * 1.9 + 3) continue; // no silly detours
            const key = `${oc.stop.id}|${tid}|${t2.id}|${dc.stop.id}`;
            let g = best.get(key);
            if (!g) best.set(key, (g = { board: oc.stop, transfer: graph.stopsById.get(tid), transfer2: t2, alight: dc.stop, first: oc.leg, last: dc.leg, l1: new Map(), l2: new Map() }));
            if (!g.l1.has(A.id)) g.l1.set(A.id, rideLeg(A, ia, ja, graph, settings));
            if (!g.l2.has(B.id)) g.l2.set(B.id, rideLeg(B, jb, ib, graph, settings));
          }
        }
      }
    }
  }
  const change = [...best.values()].map((g) => {
    const buses1 = [...g.l1.values()].sort((a, b) => a.rideMin - b.rideMin);
    const buses2 = [...g.l2.values()].sort((a, b) => a.rideMin - b.rideMin);
    const transferWalk = g.transfer.id === g.transfer2.id ? 0 : Math.max(1, Math.round(haversineM(g.transfer, g.transfer2) * settings.road_factor_walk / settings.walk_speed_m_per_min));
    const score = g.first.min * 1.6 + median(buses1.map((b) => b.rideMin)) + 8 + transferWalk * 1.6 + median(buses2.map((b) => b.rideMin)) + g.last.min * 1.6
      - Math.min(buses1.length, 4) * 0.5 - Math.min(buses2.length, 4) * 0.5;
    return { board: g.board, transfer: g.transfer, transfer2: g.transfer2, transferWalk, alight: g.alight, first: g.first, last: g.last, buses1, buses2, score };
  }).sort((a, b) => a.score - b.score);
  const shown = [];
  for (const g of change) {
    if (shown.some((s) => s.board.id === g.board.id && s.transfer.id === g.transfer.id)) continue;
    shown.push(g);
    if (shown.length === 2) break;
  }
  return shown.length ? { direct: [], change: shown, reason: null } : empty("no-route");
}

/** Buses that serve a stop, used by the "no trip" fallback and stop pages. */
export function routesAtStop(graph, stopId) {
  return (graph.stopRoutes.get(stopId) || []).map((x) => x.route);
}

/** Where could someone get to from a stop (one ride, no change)? Used for the honest "we don't have this trip" fallback. */
export function reachableFrom(graph, stopId, limit = 6) {
  const names = new Map();
  for (const { route, idx } of graph.stopRoutes.get(stopId) || []) {
    route.stops.forEach((id, j) => {
      if (id === stopId) return;
      const d = Math.abs(route.cum[j] - route.cum[idx]);
      if (!names.has(id) || names.get(id) > d) names.set(id, d);
    });
  }
  return [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => graph.stopsById.get(id));
}

/* ───────────── rider fare stats ───────────── */

/** Middle range of what riders paid; returns null until enough sane reports exist. */
export function riderFareRange(amounts, official, settings) {
  const sane = amounts.filter((a) => a >= official * settings.rider_fare_sane_min_factor && a <= official * settings.rider_fare_sane_max_factor);
  if (sane.length < settings.fare_min_reports_to_show) return null;
  const s = [...sane].sort((a, b) => a - b);
  const q = (p) => {
    const pos = (s.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };
  return { n: s.length, low: Math.round(q(0.25)), high: Math.round(q(0.75)) };
}
