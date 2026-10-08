// Builds data/*.json for Kemne Jabo v2.
//
// Inputs
//   tools/dbs-raw.json  – real bus names + ordered stops (from dhakabusservice.com, via tools/import-dbs.py)
//   tools/seed.mjs      – hand-placed anchor coordinates for well-known stops, plus lane/area hints
// Coordinates
//   1. anchors from seed.mjs (matched by name)
//   2. OpenStreetMap Nominatim candidates (up to 5 per name, cached in tools/geocode-cache-v2.json)
//   3. pick, for each stop, the candidate closest to its neighbours on the bus routes (iteratively)
//   4. anything still unknown is placed between its route neighbours and flagged "approx"
//
//   node tools/build-data.mjs            # uses cache, fetches what is missing (1 req/sec)
//   node tools/build-data.mjs --offline  # never touches the network

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STOPS as ANCHORS, AREAS } from "./seed.mjs";
import { placeKey, scoreKeys } from "../js/text.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const offline = process.argv.includes("--offline");
const raw = JSON.parse(fs.readFileSync(path.join(here, "dbs-raw.json"), "utf8"));
const cachePath = path.join(here, "geocode-cache-v2.json");
const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ───────── 1. clean names ───────── */

// Spelling variants and typos in the source → one canonical stop.
const ALIAS = {
  "golshan 1": "Gulshan 1", "jashimuddin(uttara)": "Jashimuddin", "jashimuddin (uttara)": "Jashimuddin",
  "malibaag moor": "Malibagh", "asulia bazar": "Ashulia", "kuril flyover": "Kuril Bishwa Road", "kuril chourasta": "Kuril Bishwa Road",
  "tejgaon college(farmgate)": "Farmgate", "tejgaon college (farmgate)": "Farmgate", "garrison(cantonment)": "Cantonment", "garrison (cantonment)": "Cantonment",
  "rupnagar abashik": "Rupnagar", "arambagh notre dame college": "Arambagh", "uttara": "House Building", "sayapabad": "Sayedabad",
};
// Better display names (the source's Bangla for Science Lab is the institute's full name, etc.)
const DISPLAY = {
  "Sayedabad": ["Sayedabad", "সায়েদাবাদ"], "Science Lab": ["Science Lab", "সায়েন্স ল্যাব"], "Gulshan 1": ["Gulshan 1", "গুলশান ১"],
  "Jashimuddin": ["Jashimuddin", "জসিমউদ্দিন"], "Malibagh": ["Malibagh", "মালিবাগ"], "Kuril Bishwa Road": ["Kuril Bishwa Road", "কুড়িল বিশ্বরোড"],
  "Kawran Bazar": ["Karwan Bazar", "কারওয়ান বাজার"], "Gabtoli": ["Gabtoli", "গাবতলী"], "Jatrabari": ["Jatrabari", "যাত্রাবাড়ী"],
  "High Court": ["High Court", "হাইকোর্ট"], "Airport": ["Airport", "এয়ারপোর্ট"], "Cantonment": ["Cantonment", "ক্যান্টনমেন্ট"],
  "Bijoy Sarani": ["Bijoy Sarani", "বিজয় সরণি"], "Ashulia": ["Ashulia", "আশুলিয়া"], "House Building": ["House Building (Uttara)", "হাউজ বিল্ডিং (উত্তরা)"],
  "Jigatola": ["Jigatola", "জিগাতলা"], "Panthopoth": ["Panthapath", "পান্থপথ"], "Kakali": ["Kakoli", "কাকলী"],
};
// Extra names people say for a stop. Merged with anchor aliases.
const EXTRA_ALIASES = {
  "Sayedabad": ["saidabad", "সায়দাবাদ", "sayedabad bus terminal"],
  "House Building": ["uttara", "উত্তরা", "uttara house building", "hb"],
  "Kuril Bishwa Road": ["kuril", "কুড়িল", "kuril flyover", "kuril chourasta"],
  "High Court": ["উচ্চ আদালত", "highcourt"],
  "Science Lab": ["science laboratory", "সাইন্স ল্যাব"],
  "Shishu Mela": ["shishumela", "শিশুমেলা"],
  "GPO": ["জিপিও", "general post office", "জেনারেল পোস্ট অফিস"],
  "Matsya Bhaban": ["matsho bhaban", "মৎস ভবন"],
  "Chiriyakhana": ["zoo", "mirpur zoo", "চিড়িয়াখানা"],
  "Farmgate": ["tejgaon college", "farm gate"],
  "Shahbag": ["dhaka university", "ঢাকা বিশ্ববিদ্যালয়", "ঢাবি", "du", "tsc", "টিএসসি", "pg hospital", "পিজি হাসপাতাল", "bsmmu"],
  "Mirpur (DOHS)": ["mirpur dohs", "মিরপুর ডিওএইচএস"],
};

const canonical = (en) => ALIAS[en.toLowerCase().replace(/\s+/g, " ")] || en.replace(/\s*\(\s*/g, " (").replace(/\s+\)/g, ")").trim();
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const stopsByName = new Map(); // canonical en -> stop
const routes = [];
for (const b of raw) {
  const ids = [];
  for (const [en0, bn0] of b.stops) {
    const en = canonical(en0);
    if (!stopsByName.has(en)) {
      const [den, dbn] = DISPLAY[en] || [en, bn0];
      stopsByName.set(en, { id: slug(en), name_en: den, name_bn: dbn, aliases: new Set([...(EXTRA_ALIASES[en] || [])]), count: 0 });
    }
    const s = stopsByName.get(en);
    s.aliases.add(en0); if (bn0) s.aliases.add(bn0); s.count++;
    if (!ids.includes(s.id)) ids.push(s.id); // the source sometimes lists a stop twice in one route
  }
  if (ids.length < 2) continue;
  routes.push({
    id: b.slug.replace(/-bus-route/, "").replace(/%[0-9a-f]{2}/gi, "").replace(/-+$/, "") || b.slug,
    name_en: b.name_en, name_bn: b.name_bn || b.name_en, company: b.name_en,
    service_type: "bus", seating: /^seating/i.test(b.service) ? "seating" : "semi-seating",
    hours: b.start && b.end ? `${b.start}–${b.end}` : null,
    frequency_min: null, frequency_max: null,
    verified: false, last_checked: null, source: "dhakabusservice.com", source_slug: b.slug, stops: ids,
  });
}
{ // ids must be unique (BRTC appears several times)
  const taken = new Set();
  for (const r of routes) {
    let id = r.id, k = 2;
    while (taken.has(id)) id = `${r.id}-${k++}`;
    taken.add(id); r.id = id;
  }
}
const stops = [...stopsByName.values()];
const byId = new Map(stops.map((s) => [s.id, s]));

/* ───────── 2. anchors ───────── */

const km = (a, b) => {
  const R = 6371, rad = Math.PI / 180, dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
// Exact names only: sound-alike matching would glue Azimpur (old Dhaka) to Azampur (Uttara).
const norm = (x) => String(x || "").toLowerCase().normalize("NFC").replace(/[\s\-().,'’]/g, "");
const anchors = ANCHORS.map(([, en, bn, lat, lng, , aliases]) => ({ pos: [lat, lng], aliases, names: new Set([en, bn].map(norm)), alias: new Set(aliases.map(norm)) }));
const stopNames = new Set(stops.flatMap((s) => [s.name_en, s.name_bn].map(norm)));
for (const s of stops) {
  const mine = [s.name_en, s.name_bn, ...s.aliases].map(norm).filter(Boolean);
  const a = anchors.find((x) => mine.some((m) => x.names.has(m))) 
    // by alias only when the anchor isn't itself another stop ("Jahangir Gate" was an alias of the Mohakhali anchor)
    || anchors.find((x) => ![...x.names].some((nm) => stopNames.has(nm)) && [s.name_en, s.name_bn].map(norm).some((m) => x.alias.has(m)));
  if (!a) continue;
  s.pos = a.pos; s.src = "hand";
  // never borrow an alias that is another stop's own name (Jahangir Gate is not Mohakhali)
  a.aliases.filter((x) => !stopNames.has(norm(x)) || [s.name_en, s.name_bn].map(norm).includes(norm(x))).forEach((x) => s.aliases.add(x));
}

/* ───────── 3. OSM candidates ───────── */

async function candidates(q) {
  if (q in cache) return cache[q];
  if (offline) return [];
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=bd&bounded=1&viewbox=89.85,24.35,90.80,23.40&q=" + encodeURIComponent(q);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "KemneJabo-data-builder/2.0 (public-benefit Dhaka bus guide)" } });
    const json = await res.json();
    cache[q] = json.map((r) => [Number(r.lat), Number(r.lon)]);
  } catch (e) { console.warn("geocode failed", q, e.message); return []; }
  fs.writeFileSync(cachePath, JSON.stringify(cache));
  await sleep(1100);
  return cache[q];
}

const plainEn = (s) => s.name_en.replace(/\s*\(.*?\)/g, "");
let done = 0;
for (const s of stops) {
  s.cands = [];
  if (s.src) continue;
  for (const q of [`${plainEn(s)}, Dhaka`, s.name_bn, `${plainEn(s)} bus stop`]) {
    for (const c of await candidates(q)) if (!s.cands.some((x) => km(x, c) < 0.05)) s.cands.push(c);
    if (s.cands.length >= 3) break;
  }
  if (++done % 25 === 0) console.log(`  geocoded ${done}`);
}

/* ───────── 4. choose by route consistency ───────── */

const neighbours = new Map(stops.map((s) => [s.id, new Map()]));
for (const r of routes) r.stops.forEach((id, i) => {
  for (const d of [-2, -1, 1, 2]) {
    const j = i + d; if (j < 0 || j >= r.stops.length) continue;
    const m = neighbours.get(id); m.set(r.stops[j], Math.min(m.get(r.stops[j]) ?? 9, Math.abs(d)));
  }
});

for (let pass = 0; pass < 8; pass++) {
  let changed = 0;
  for (const s of stops) {
    if (s.pos || !s.cands.length) continue;
    const anchored = [...neighbours.get(s.id)].filter(([id]) => byId.get(id).pos);
    if (!anchored.length) continue;
    let best = null, bd = Infinity;
    for (const c of s.cands) {
      const ds = anchored.map(([id, hop]) => km(c, byId.get(id).pos) / hop).sort((a, b) => a - b);
      const med = ds[Math.floor(ds.length / 2)];
      if (med < bd) { bd = med; best = c; }
    }
    if (best && bd <= 6) { s.pos = best; s.src = "osm"; changed++; }
  }
  if (!changed) break;
}
// Source typos: a stop that sends the bus 10+ km out of its way and straight back is dropped from that route.
let dropped = 0;
for (const r of routes) {
  for (let i = 1; i < r.stops.length - 1; i++) {
    const p = byId.get(r.stops[i - 1]).pos, c = byId.get(r.stops[i]).pos, nx = byId.get(r.stops[i + 1]).pos;
    if (!p || !c || !nx) continue;
    if (km(p, c) + km(c, nx) - km(p, nx) > 10) { r.stops.splice(i, 1); i--; dropped++; }
  }
}
console.log(`dropped ${dropped} out-of-place stops (source typos)`);
// Interpolate what's left between placed neighbours (route order).
for (let pass = 0; pass < 8; pass++) {
  for (const s of stops) {
    if (s.pos) continue;
    const pts = [];
    for (const r of routes) {
      const i = r.stops.indexOf(s.id); if (i < 0) continue;
      let a = null, b = null;
      for (let j = i - 1; j >= 0 && !a; j--) if (byId.get(r.stops[j]).pos) a = byId.get(r.stops[j]).pos;
      for (let j = i + 1; j < r.stops.length && !b; j++) if (byId.get(r.stops[j]).pos) b = byId.get(r.stops[j]).pos;
      if (a && b) pts.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); else if (a || b) pts.push(a || b);
    }
    if (pts.length) { s.pos = [pts.reduce((x, p) => x + p[0], 0) / pts.length, pts.reduce((x, p) => x + p[1], 0) / pts.length]; s.src = "approx"; }
  }
}

/* ───────── 5. write ───────── */

const round = (n) => Math.round(n * 1e5) / 1e5;
const outStops = stops.filter((s) => s.pos).map((s) => ({
  id: s.id, name_bn: s.name_bn, name_en: s.name_en,
  aliases: [...s.aliases].filter((a) => a && a !== s.name_en && a !== s.name_bn),
  lat: round(s.pos[0]), lng: round(s.pos[1]), coord: s.src,
}));
const used = new Set(routes.flatMap((r) => r.stops));
const placed = new Set(outStops.filter((s) => used.has(s.id)).map((s) => s.id));
const outRoutes = routes.map((r) => ({ ...r, stops: r.stops.filter((id) => placed.has(id)) })).filter((r) => r.stops.length >= 2);

const areas = AREAS.map(([id, en, bn, lat, lng, , aliases, hintEn, hintBn]) => {
  let best = null, bd = Infinity;
  for (const s of outStops) { const d = km([lat, lng], [s.lat, s.lng]); if (d < bd) { bd = d; best = s; } }
  return { id, name_bn: bn, name_en: en, aliases, lat, lng, hint_text_en: hintEn, hint_text_bn: hintBn, nearest_stop_id: best.id };
}).filter((a) => !outStops.some((s) => s.name_en.toLowerCase() === a.name_en.toLowerCase())); // a stop with the same name wins

const settings = {
  _note: "Edit this file, not the code, when the government fare changes. Source: gazette of 23 Sep 2026.",
  fare_rate_per_km: { bus: 2.7, minibus: 2.6 }, fare_minimum: { bus: 10, minibus: 8 }, fare_rounding: "nearest", fare_gazette_date: "2026-09-23",
  road_factor_ride: 1.15, road_factor_walk: 1.3, bus_speed_kmh: 14, stop_dwell_min_per_stop: 0.4,
  walk_speed_m_per_min: 75, rickshaw_speed_m_per_min: 200, walk_threshold_m: 500, max_first_leg_m: 2500, same_place_m: 350, walk_only_m: 650, min_ride_m: 400,
  seen_ttl_min: 30, seen_min_gap_min: 10, seen_max_per_day: 20, fare_max_per_day: 10, fare_min_reports_to_show: 5,
  rider_fare_sane_min_factor: 0.5, rider_fare_sane_max_factor: 3,
};

const write = (n, d) => fs.writeFileSync(path.join(root, "data", n), JSON.stringify(d, null, 1));
write("stops.json", outStops.filter((s) => placed.has(s.id))); write("routes.json", outRoutes); write("areas.json", areas); write("settings.json", settings);

const bySrc = outStops.reduce((m, s) => ((m[s.coord] = (m[s.coord] || 0) + 1), m), {});
console.log(`buses ${outRoutes.length}, stops ${outStops.length} (${JSON.stringify(bySrc)}), areas ${areas.length}, unplaced ${stops.length - outStops.length}`);
const bad = [];
for (const r of outRoutes) for (let i = 1; i < r.stops.length; i++) {
  const a = byId.get(r.stops[i - 1]), b = byId.get(r.stops[i]); const d = km(a.pos, b.pos);
  if (d > 7) bad.push(`${r.name_en}: ${a.name_en}(${a.src}) → ${b.name_en}(${b.src}) ${d.toFixed(1)} km`);
}
console.log(`long hops (>7 km): ${bad.length}\n  ` + bad.slice(0, 80).join("\n  "));
console.log("approx:", outStops.filter((s) => s.coord === "approx").map((s) => s.name_en).join(", "));
