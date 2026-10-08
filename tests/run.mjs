// node tests/run.mjs — no dependencies.
// Covers the pieces that decide whether voice works end to end: phonetic matching,
// transcript parsing, place resolution, routing and fares.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { skeleton, normalize } from "../js/text.js";
import { parseTrip, cleanSinglePlace } from "../js/parse.js";
import { buildIndex, buildGraph, resolvePlace, planTrip, officialFare, riderFareRange, findPlaces, haversineM } from "../js/search.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const load = (n) => JSON.parse(fs.readFileSync(path.join(dir, n), "utf8"));
const stops = load("stops.json"), areas = load("areas.json"), routes = load("routes.json"), settings = load("settings.json");
const index = buildIndex(stops, areas, routes);
const graph = buildGraph(stops, routes, settings);

let pass = 0, fail = 0;
const t = (name, ok, extra = "") => { if (ok) pass++; else { fail++; console.log("  ✗", name, extra); } };
const eq = (name, got, want) => t(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

/* skeletons: different spellings, same key */
eq("skeleton mirpur", skeleton("মিরপুর"), skeleton("mirpur"));
eq("skeleton mirpur 2", skeleton("মীরপুর"), skeleton("mirpoor"));
eq("skeleton farmgate", skeleton("ফার্মগেট"), skeleton("farmgate"));
eq("skeleton motijheel", skeleton("মতিঝিল"), skeleton("motijheel"));
eq("skeleton gulistan", skeleton("গুলিস্তান"), skeleton("gulistan"));
eq("skeleton shahbag", skeleton("শাহবাগ"), skeleton("shahbag"));
eq("skeleton jatrabari", skeleton("যাত্রাবাড়ী"), skeleton("jatrabari"));
eq("skeleton agargaon", skeleton("আগারগাঁও"), skeleton("agargaon"));
eq("skeleton tongi", skeleton("টঙ্গী"), skeleton("tongi"));
eq("normalize bangla digits + words", normalize("মিরপুর ১০"), "মিরপুর 10");
eq("normalize number word", normalize("মিরপুর দশ"), "মিরপুর 10");
eq("normalize spelled english number", normalize("মিরপুর টেন"), "মিরপুর 10");

/* parser: what the mouth said → From / To phrases */
const P = (s) => { const r = parseTrip(s); return [r.from, r.to, r.fromHere]; };
eq("bn from-to", P("মিরপুর ১০ থেকে মতিঝিল"), ["মিরপুর 10", "মতিঝিল", false]);
eq("bn from-to + verb", P("মিরপুর ১০ থেকে মতিঝিল যাবো"), ["মিরপুর 10", "মতিঝিল", false]);
eq("bn polite", P("আমি মিরপুর ১০ থেকে ফার্মগেট যেতে চাই"), ["মিরপুর 10", "ফার্মগেট", false]);
eq("bn reversed", P("মতিঝিল যাবো মিরপুর ১০ থেকে"), ["মিরপুর 10", "মতিঝিল", false]);
eq("bn locative", P("ফার্মগেটে আছি মতিঝিল যাব"), ["ফার্মগেটে", "মতিঝিল", false]);
eq("bn here", P("এখান থেকে মতিঝিল"), [null, "মতিঝিল", true]);
eq("bn my location", P("আমার অবস্থান থেকে গুলিস্তান যাব"), [null, "গুলিস্তান", true]);
eq("bn dest only", P("মতিঝিল যাব"), [null, "মতিঝিল", false]);
eq("bn dest only 2", P("কেমনে যাবো মতিঝিল"), [null, "মতিঝিল", false]);
eq("bn word number", P("মিরপুর দশ থেকে উত্তরা"), ["মিরপুর 10", "উত্তরা", false]);
eq("banglish", P("Mirpur 10 theke Uttara jabo"), ["mirpur 10", "uttara", false]);
eq("banglish reversed", P("uttara jabo mirpur 10 theke"), ["mirpur 10", "uttara", false]);
eq("english", P("from Farmgate to Gulistan"), ["farmgate", "gulistan", false]);
eq("english short", P("Farmgate to Gulistan"), ["farmgate", "gulistan", false]);
eq("english want", P("I want to go to Motijheel from Mirpur 12"), ["mirpur 12", "motijheel", false]);
eq("english here", P("from here to Gulshan 2"), [null, "gulshan 2", true]);
eq("bn passenger", P("আমি গুলশান ২ থেকে বসুন্ধরা যেতে চাই"), ["গুলশান 2", "বসুন্ধরা", false]);
eq("bn run-on", P("মিরপুরথেকে মতিঝিল"), ["মিরপুর", "মতিঝিল", false]);
eq("single field", cleanSinglePlace("আমি মিরপুর ১০ থেকে"), "মিরপুর 10");
eq("single field 2", cleanSinglePlace("যাব ফার্মগেটে"), "ফার্মগেটে");

/* resolution: phrase → place */
const R = (s) => resolvePlace(index, s);
const id = (s) => { const r = R(s); return r.status === "match" ? r.pick.id : r.status; };
eq("resolve mirpur 10 en", id("mirpur 10"), "mirpur-10");
eq("resolve mirpur 10 bn", id("মিরপুর 10"), "mirpur-10");
eq("resolve mirpur 10 typo", id("mirpoor 10"), "mirpur-10");
eq("resolve mirpur 1", id("mirpur 1"), "mirpur-1");
eq("resolve mirpur ambiguous", id("মিরপুর"), "choose");
eq("resolve motijheel", id("মতিঝিল"), "motijheel");
eq("resolve motijheel locative", id("মতিঝিলে"), "motijheel");
eq("resolve motijheel typo", id("motijil"), "motijheel");
eq("resolve farmgate locative", id("ফার্মগেটে"), "farmgate");
eq("resolve farmgate banglish", id("farm get"), "farmgate");
eq("resolve gulistan", id("গুলিস্তান"), "gulistan");
eq("resolve gulistan alt", id("গুলিস্থান"), "gulistan");
eq("resolve uttara", id("উত্তরা"), "house-building");
eq("resolve gulshan ambiguous", id("গুলশান"), "choose");
eq("resolve gulshan 2", id("গুলশান 2"), "gulshan-2");
eq("resolve bashundhara", id("বসুন্ধরা"), "bashundhara");
eq("resolve bashundhara road 36", id("bashundhara road 36"), "bashundhara-road-36");
eq("resolve mohakhali", id("মহাখালী"), "mohakhali");
eq("resolve new market", id("নিউ মার্কেট"), "new-market");
eq("resolve du", id("ঢাকা বিশ্ববিদ্যালয়"), "shahbag");
eq("resolve gibberish", id("zzzqx"), "none");
eq("prefix typing", findPlaces(index, "mirp", { prefix: true })[0]?.entry.id.startsWith("mirpur"), true);
eq("prefix typing bn", findPlaces(index, "মতি", { prefix: true })[0]?.entry.id, "motijheel");

/* "which Mirpur?" and answering by number */
{
  const r = resolvePlace(index, "মিরপুর");
  t("mirpur offers the numbered stops", r.status === "choose" && ["mirpur-10", "mirpur-12", "mirpur-1"].every((i) => r.options.some((o) => o.id === i)), JSON.stringify(r.options?.map((o) => o.id)));
  const restrict = new Set(r.options.map((o) => o.ref));
  const a = resolvePlace(index, cleanSinglePlace("দশ নম্বর"), { restrictTo: restrict });
  eq("answer 'দশ নম্বর'", a.status === "match" ? a.pick.id : a.status, "mirpur-10");
  const b = resolvePlace(index, cleanSinglePlace("টুয়েলভ"), { restrictTo: restrict });
  eq("answer 'টুয়েলভ'", b.status === "match" ? b.pick.id : b.status, "mirpur-12");
  const g = resolvePlace(index, "গুলশান");
  t("gulshan offers 1 and 2", g.status === "choose" && g.options.some((o) => o.id === "gulshan-1") && g.options.some((o) => o.id === "gulshan-2"));
  const d = resolvePlace(index, "ধানমন্ডি");
  t("dhanmondi resolves or asks, never errors", d.status !== "none");
}

/* end to end: transcript → plan */
const plan = (said) => {
  const p = parseTrip(said);
  const f = resolvePlace(index, p.from || ""), to = resolvePlace(index, p.to || "");
  if (f.status !== "match" || to.status !== "match") return { err: [f.status, to.status] };
  const pf = { ...f.pick, kind: f.pick.kind, lat: f.pick.lat, lng: f.pick.lng, id: f.pick.id };
  const pt = { ...to.pick, kind: to.pick.kind, lat: to.pick.lat, lng: to.pick.lng, id: to.pick.id };
  return planTrip(graph, settings, pf, pt);
};
const total = (r) => r.direct.length + r.change.length;
for (const said of [
  "মিরপুর ১০ থেকে মতিঝিল", "মতিঝিল যাবো মিরপুর দশ থেকে", "Mirpur 10 theke Motijheel jabo", "from Uttara to Gulistan",
  "বসুন্ধরা রোড ৩৬ থেকে ফার্মগেট", "মোহাম্মদপুর থেকে বসুন্ধরা", "সাভার থেকে যাত্রাবাড়ী", "কুড়িল থেকে মিরপুর ১২", "মিরপুর ১০ থেকে টঙ্গী",
]) {
  const r = plan(said);
  t("plan: " + said, !r.err && total(r) > 0, JSON.stringify(r.err || r.reason));
}

/* the bug from v1: a direct bus exists, so it must be shown, by name */
{
  const r = plan("মিরপুর ১০ থেকে টঙ্গী");
  const names = r.direct.flatMap((g) => g.buses.map((b) => b.route.name_en));
  t("Mirpur 10 → Tongi is direct", r.direct.length > 0, JSON.stringify(r.change.length));
  t("Mirpur 10 → Tongi lists the real buses", ["Basumati Transport", "BRTC"].every((x) => names.includes(x)), JSON.stringify(names));
}
{
  const r = plan("মিরপুর ১০ থেকে মতিঝিল");
  const g = r.direct[0];
  t("direct group boards at Mirpur 10", g && g.board.id === "mirpur-10", g?.board.id);
  t("several buses offered", g && g.buses.length >= 2, String(g?.buses.length));
  t("every bus has fare >= min", g.buses.every((b) => b.fare >= settings.fare_minimum.bus));
  t("ride time sane", g.buses.every((b) => b.rideMin > 15 && b.rideMin < 120), JSON.stringify(g.buses.map((b) => Math.round(b.rideMin))));
  t("no bus listed twice across groups", new Set(r.direct.flatMap((x) => x.buses.map((b) => b.route.id))).size === r.direct.flatMap((x) => x.buses).length);
}
{
  const r = plan("বসুন্ধরা রোড ৩৬ থেকে ফার্মগেট");
  const g = r.direct[0] || r.change[0];
  t("area gets a first leg", ["walk", "rickshaw"].includes(g.first.mode), JSON.stringify(g.first));
}
eq("min fare applies", officialFare(0.5, "bus", settings), 10);
eq("minibus min fare", officialFare(0.5, "minibus", settings), 8);
eq("bus 10 km", officialFare(10, "bus", settings), 27);
eq("minibus 10 km", officialFare(10, "minibus", settings), 26);
eq("rider fare hidden under 5 reports", riderFareRange([38, 40, 45, 50], 38, settings), null);
eq("rider fare p25-p75", riderFareRange([38, 38, 40, 45, 50, 50, 60], 38, settings), { n: 7, low: 39, high: 50 });
eq("rider fare ignores insane", riderFareRange([38, 38, 40, 45, 50, 500, 1], 38, settings), { n: 5, low: 38, high: 45 });

/* data hygiene */
{
  const ids = new Set(stops.map((s) => s.id));
  for (const r of routes) for (const s of r.stops) t(`route ${r.id} stop ${s} exists`, ids.has(s));
  for (const r of routes) {
    let max = 0;
    for (let i = 1; i < r.stops.length; i++) {
      const a = stops.find((x) => x.id === r.stops[i - 1]), b = stops.find((x) => x.id === r.stops[i]);
      max = Math.max(max, haversineM(a, b));
    }
    t(`route ${r.id} no giant hops`, max < 30000, `${Math.round(max)} m`);
  }
}


/* v3: the home screen's quick trips, short hops and the stop-to-stop path used by the map */
{
  const P = (id) => index.byRef.get("s:" + id);
  for (const [a, b] of [["mirpur-10", "motijheel"], ["house-building", "farmgate"], ["jatrabari", "gulistan"], ["bashundhara", "mohakhali"]]) {
    const r = planTrip(graph, settings, P(a), P(b));
    t(`quick trip ${a} → ${b} has a direct bus`, r.direct.length > 0 && r.direct[0].buses.length > 0);
    const leg = r.direct[0].buses[0];
    t(`quick trip ${a} → ${b}: path starts and ends at the stops`, leg.stopIds[0] === r.direct[0].board.id && leg.stopIds[leg.stopIds.length - 1] === leg.alight.id);
  }
  // a stop 600 m away is a walk, not a bus
  const w = planTrip(graph, settings, P("jatrabari"), P("sayedabad"));
  t("close stops give a walk, not a bus", w.reason === "walk" && w.walk.min > 0 && w.walk.distM > 0, JSON.stringify(w.reason));
  // no ride shorter than min_ride_m is ever offered
  let short = 0;
  for (const [a, b] of [["badda", "merul-badda"], ["mirpur-1", "mazar-road"], ["madhya-badda", "badda-link-road"]]) {
    if (!P(a) || !P(b)) continue;
    const r = planTrip(graph, settings, P(a), P(b));
    for (const g of r.direct) if (haversineM(g.board, g.alight) < settings.min_ride_m) short++;
  }
  t("no bus ride shorter than min_ride_m", short === 0, String(short));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
