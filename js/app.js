// Kemne Jabo v3 — say where you're going; see exactly which buses, where to get on, where to get off.
import { CONFIG } from "./config.js";
import { h, $, $$, toast, openSheet, reducedMotion } from "./ui.js";
import { icon } from "./icons.js";
import { t, tObj, n, setLang, getLang, placeName, placeNameAlt, routeName, routeNameAlt, fmtClock } from "./i18n.js";
import { buildIndex, buildGraph, findPlaces, resolvePlace, planTrip, reachableFrom, routesAtStop, riderFareRange, haversineM, officialFare, rideMinutes } from "./search.js";
import { parseTrip, cleanSinglePlace } from "./parse.js";
import { voiceSupport, VoiceSession, speak, stopSpeaking, hasVoiceFor } from "./voice.js";
import { createStore } from "./store.js";
import { mountJourneyMap, mountNetworkMap } from "./map.js";
import { routeColor, logoSVG } from "./art.js";

/* ═════════════ state ═════════════ */

const S = {
  index: null, graph: null, settings: null, store: null, stops: [],
  from: null, to: null, loc: null,
  plan: null, seen: [], navCount: 0,
};
const V = { support: voiceSupport(), session: null, state: "idle", interim: "", pending: null, error: null };
const ui = {};
const SIDES = ["from", "to"];
const POPULAR = ["s:mirpur-10", "s:farmgate", "s:motijheel", "s:gulistan", "s:house-building", "s:mohakhali", "s:jatrabari", "s:shahbag"];
const QUICK = [["s:mirpur-10", "s:motijheel"], ["s:house-building", "s:farmgate"], ["s:jatrabari", "s:gulistan"], ["s:bashundhara", "s:mohakhali"]];
const DHAKA = { latMin: 23.55, latMax: 24.2, lngMin: 90.15, lngMax: 90.65 };

const mePlace = () => ({ kind: "me", id: "me", ref: "me", lat: S.loc.lat, lng: S.loc.lng, acc: S.loc.acc, name_bn: "আমার অবস্থান", name_en: "My location" });
const stopById = (id) => S.graph.stopsById.get(id);
const roundMin = (m) => Math.max(5, Math.round(m / 5) * 5);
const LIVE = () => ["starting", "listening", "hearing", "processing"].includes(V.state);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const focusAuto = () => requestAnimationFrame(() => ui.voiceZone?.querySelector("[data-autofocus]")?.focus());
const hashOf = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.codePointAt(0)) >>> 0; return x; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

/* ═════════════ boot ═════════════ */

async function boot() {
  try {
    const [stops, areas, routes, settings] = await Promise.all(["stops", "areas", "routes", "settings"].map((f) =>
      fetch(`data/${f}.json`).then((r) => { if (!r.ok) throw new Error(f); return r.json(); })));
    S.stops = stops;
    S.settings = settings;
    S.index = buildIndex(stops, areas, routes);
    S.graph = buildGraph(stops, routes, settings);
    S.store = createStore(CONFIG, settings);
  } catch (e) {
    console.error(e);
    $("#app").replaceChildren(h("p", { class: "fatal" }, t("loadFail")));
    return;
  }
  setLang(S.store.pref("lang", "bn"));
  render();
  window.addEventListener("hashchange", () => { S.navCount++; route(); });
  window.addEventListener("offline", () => toast(t("offline"), 6000));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && V.session) cancelVoice(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { checkTrip(); refreshLive(); } });
  setInterval(() => { if (!document.hidden) refreshLive(); }, 45000);
  await route();
  checkTrip();
}

/* ═════════════ shell ═════════════ */

function render() {
  document.title = `${t("app")} — ${t("tagline")}`;
  $("#skip").textContent = t("skip");
  const brand = h("a", { class: "brand", href: "#/", "aria-label": t("app") });
  brand.innerHTML = logoSVG(30);
  brand.append(h("span", { class: "brand__name", text: t("app") }));
  ui.results = h("section", { class: "results", "aria-live": "polite" });
  ui.mapbox = h("div", { class: "mapbox-fill", style: "position:absolute;inset:0" });
  ui.mapMode = null;
  ui.home = h("div", { class: "home" },
    h("div", { class: "mapstage" }, ui.mapbox),
    h("div", { class: "panel" }, h("div", { class: "panel__in" }, buildSearch(), ui.results, buildExtras())));
  ui.page = h("div", { class: "page", hidden: true });
  ui.live = h("div", { class: "sr", role: "status", "aria-live": "polite" });
  ui.banner = h("div", { class: "banner-slot" });
  $("#app").replaceChildren(
    h("header", { class: "top" }, brand, h("button", { class: "langbtn", type: "button", "aria-label": t("langAria"), onclick: toggleLang, text: t("langSwitch") })),
    ui.banner,
    h("main", { id: "main", tabindex: "-1" }, ui.home, ui.page),
    h("footer", { class: "foot" }, h("span", { text: t("free") }), h("a", { href: "#/about", text: t("about") }), h("a", { href: "#/privacy", text: t("privacy") })),
    ui.live);
  for (const side of SIDES) if (S[side]) ui.fields[side].input.value = placeName(S[side]);
  ui.locBtn.classList.toggle("is-on", S.from?.kind === "me");
  refreshVoiceUI();
}

/** Classes on the home view: the street scene folds down when results are showing; it stops while listening. */
function paintHome() {
  if (!ui.home) return;
  const live = LIVE();
  ui.home.classList.toggle("is-listening", live);
  ui.home.classList.toggle("has-results", !!ui.results.childElementCount && !live);
}

function toggleLang() {
  cancelVoice(true);
  const next = getLang() === "bn" ? "en" : "bn";
  setLang(next);
  S.store.setPref("lang", next);
  render();
  route();
  checkTrip();
}

/* ═════════════ the hero: street scene + the question ═════════════ */

function buildExtras() {
  const trips = QUICK.map(([a, b]) => [S.index.byRef.get(a), S.index.byRef.get(b)]).filter(([a, b]) => a && b);
  return h("div", { class: "extras" },
    h("p", { class: "quick__t", text: t("tryThese") }),
    h("div", { class: "quick__row" }, ...trips.map(([a, b]) => h("button", { class: "trip", type: "button", onclick: () => { setPlace("from", a); setPlace("to", b); submitSearch(); } },
      placeName(a), icon("arrow", { size: 15 }), placeName(b)))));
}

/* ═════════════ search panel ═════════════ */

function buildSearch() {
  ui.ask = h("h1", { class: "ask", id: "ask", text: t("ask") });
  ui.askSub = h("p", { class: "ask__sub", text: t("askSub") });
  const wave = h("div", { class: "wave", "aria-hidden": "true" }, ...Array.from({ length: 28 }, () => h("i")));
  const from = makeField("from"), to = makeField("to");
  ui.fields = { from, to };
  ui.locBtn = h("button", { class: "field__act", type: "button", "aria-label": t("useLocation"), title: t("useLocation"), onclick: useMyLocation }, icon("locate", { size: 22 }));
  from.box.append(ui.locBtn);
  const swap = h("button", { class: "swap", type: "button", "aria-label": t("swap"), title: t("swap"), onclick: swapPlaces }, icon("swap", { size: 16 }));

  ui.mic = h("button", { class: "mic", type: "button", "aria-label": t("speakAria"), "aria-pressed": "false", onclick: onMic }, h("span", { class: "mic__icon" }, icon("mic", { size: 28 })));
  ui.micLabel = h("span", { class: "mic__label", "aria-hidden": "true", text: t("speak") });
  ui.find = h("button", { class: "find", type: "submit", "data-going": t("finding") }, h("span", { class: "find__label", text: t("find") }));

  ui.voiceZone = h("div", { class: "voice-zone" });
  const form = h("form", { class: "form", novalidate: true, onsubmit: (e) => { e.preventDefault(); submitSearch(); } },
    h("div", { class: "fields" }, from.el, swap, to.el),
    h("div", { class: "go" }, h("div", { class: "mic-wrap" }, ui.mic, ui.micLabel), ui.find));
  return h("section", { class: "search", "aria-labelledby": "ask" }, h("div", {}, ui.ask, ui.askSub, wave), form, ui.voiceZone);
}

function makeField(side) {
  const id = `f-${side}`;
  const input = h("input", {
    id, type: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: side === "from" ? "next" : "search",
    placeholder: t(side === "from" ? "fromPh" : "toPh"), role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false",
    "aria-controls": `${id}-list`, "aria-describedby": `${id}-msg`,
  });
  const list = h("ul", { class: "suggest", id: `${id}-list`, role: "listbox", hidden: true, "aria-label": t(side) });
  const msg = h("p", { class: "field__msg", id: `${id}-msg`, role: "alert", hidden: true });
  const box = h("div", { class: "field__box" }, h("span", { class: `field__dot field__dot--${side}`, "aria-hidden": "true" }), input);
  const el = h("div", { class: "field" }, h("label", { class: "field__label", for: id, text: t(side) }), box, list, msg);
  const f = { el, box, input, list, msg, items: [], active: -1 };
  wireSuggest(side, f);
  return f;
}

function fieldMsg(side, text, soft = false) {
  const f = ui.fields[side];
  f.msg.textContent = text || "";
  f.msg.hidden = !text;
  f.msg.classList.toggle("field__msg--soft", !!soft);
  f.input.setAttribute("aria-invalid", text && !soft ? "true" : "false");
}

function setPlace(side, place) {
  S[side] = place;
  const f = ui.fields[side];
  f.input.value = placeName(place);
  fieldMsg(side, "");
  closeSuggest(f);
  ui.locBtn?.classList.toggle("is-on", S.from?.kind === "me");
}

function swapPlaces() {
  [S.from, S.to] = [S.to, S.from];
  const a = ui.fields.from.input.value;
  ui.fields.from.input.value = ui.fields.to.input.value;
  ui.fields.to.input.value = a;
  SIDES.forEach((s) => fieldMsg(s, ""));
  ui.locBtn.classList.toggle("is-on", S.from?.kind === "me");
}

/* suggestions (combobox) */
function wireSuggest(side, f) {
  const open = () => {
    const q = f.input.value.trim();
    f.items = q
      ? findPlaces(S.index, q, { prefix: true, limit: 6 }).filter((x) => x.score >= 0.5).map((x) => ({ entry: x.entry }))
      : [...(side === "from" ? [{ me: true }] : []), ...POPULAR.map((r) => S.index.byRef.get(r)).filter(Boolean).map((e) => ({ entry: e }))];
    f.active = -1;
    f.list.replaceChildren(...f.items.map((it, i) => {
      const li = h("li", { role: "option", id: `${f.input.id}-o${i}`, "aria-selected": "false" },
        it.me ? icon("locate", { size: 20, cls: "suggest__icon" }) : h("span", { class: "suggest__pin", "aria-hidden": "true" }),
        h("span", { class: "suggest__text" }, h("b", { text: it.me ? t("useLocation") : placeName(it.entry) }), it.me ? null : h("small", { text: placeNameAlt(it.entry) })));
      li.addEventListener("pointerdown", (e) => { e.preventDefault(); choose(i); });
      return li;
    }));
    f.list.hidden = !f.items.length;
    f.input.setAttribute("aria-expanded", String(!!f.items.length));
  };
  const choose = (i) => {
    const it = f.items[i];
    if (!it) return;
    closeSuggest(f);
    if (it.me) return useMyLocation();
    setPlace(side, it.entry);
    if (side === "from" && !S.to) ui.fields.to.input.focus(); else ui.find.focus();
  };
  const move = (d) => {
    if (f.list.hidden) open();
    if (!f.items.length) return;
    f.active = (f.active + d + f.items.length) % f.items.length;
    [...f.list.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === f.active)));
    f.input.setAttribute("aria-activedescendant", `${f.input.id}-o${f.active}`);
  };
  f.input.addEventListener("input", () => {
    if (S[side] && f.input.value !== placeName(S[side])) { S[side] = null; ui.locBtn.classList.remove("is-on"); }
    fieldMsg(side, "");
    if (V.pending) { V.pending = null; renderVoiceZone(); }
    open();
  });
  f.input.addEventListener("focus", open);
  f.input.addEventListener("blur", () => setTimeout(() => { closeSuggest(f); commitText(side); }, 120));
  f.input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Escape" && !f.list.hidden) { e.stopPropagation(); closeSuggest(f); }
    else if (e.key === "Enter") {
      if (!f.list.hidden && f.active >= 0) { e.preventDefault(); choose(f.active); }
      else if (side === "from") { e.preventDefault(); commitText("from"); ui.fields.to.input.focus(); }
    }
  });
}
function closeSuggest(f) { f.list.hidden = true; f.input.setAttribute("aria-expanded", "false"); f.input.removeAttribute("aria-activedescendant"); }
function commitText(side) {
  const text = ui.fields[side].input.value.trim();
  if (S[side] || !text) return;
  const r = resolvePlace(S.index, text);
  if (r.status === "match") setPlace(side, r.pick);
}

/* location — asked only when the rider taps */
const inDhaka = (p) => p.lat >= DHAKA.latMin && p.lat <= DHAKA.latMax && p.lng >= DHAKA.lngMin && p.lng <= DHAKA.lngMax;

function locate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("unsupported"));
    ui.locBtn?.classList.add("is-busy");
    if (ui.fields) ui.fields.from.input.placeholder = t("locating");
    const done = () => { ui.locBtn?.classList.remove("is-busy"); if (ui.fields) ui.fields.from.input.placeholder = t("fromPh"); };
    navigator.geolocation.getCurrentPosition(
      (p) => {
        done();
        const loc = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
        // A desktop or VPN can report a place far from Dhaka; a bus guide for Dhaka can't use that.
        if (!inDhaka(loc)) return reject(Object.assign(new Error("outside"), { outside: true }));
        S.loc = loc;
        resolve(S.loc);
      },
      (e) => { done(); reject(e); },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

async function useMyLocation() {
  try {
    await locate();
    setPlace("from", mePlace());
    if (S.loc.acc > 1500) fieldMsg("from", t("roughLocation"), true);
    if (V.pending) { V.pending.items.from = { status: "match", pick: S.from }; renderVoiceZone(); focusAuto(); }
    else if (!S.to) ui.fields.to.input.focus();
    return true;
  } catch (e) {
    S.loc = null;
    fieldMsg("from", e?.outside ? t("outsideDhaka") : t("locationDenied"));
    return false;
  }
}

/* ═════════════ voice ═════════════ */

function onMic() {
  if (LIVE()) { V.session?.stop(); return; }
  startVoice("both");
}

function startVoice(target) {
  stopSpeaking();
  cancelVoice(true);
  V.error = null;
  if (!V.support.supported) return voiceFail({ key: "unsupported" });
  if (!V.support.secure) return voiceFail({ key: "insecure" });
  V.interim = "";
  if (!target.startsWith("pick:")) V.pending = null;
  V.state = "starting";
  const session = new VoiceSession({ SR: V.support.SR, lang: getLang() });
  V.session = session;
  refreshVoiceUI();
  session.start({
    onState: (s) => { if (V.session === session) { V.state = s; refreshVoiceUI(); } },
    onInterim: (txt) => { if (V.session === session) { V.interim = txt; paintAsk(); } },
    onFinal: (res) => {
      if (V.session !== session) return;
      V.session = null; V.state = "idle"; V.interim = "";
      try { handleHeard(res, target); } catch (e) { console.error(e); return voiceFail({ key: "unknown" }); }
      refreshVoiceUI();
      focusAuto();
      ui.live.textContent = `${t("heard")}: ${res.alternatives[0]?.text || ""}`;
    },
    onError: (e) => { if (V.session !== session) return; V.session = null; V.state = "idle"; V.interim = ""; if (!e.silent) voiceFail(e); else refreshVoiceUI(); },
  });
}

function voiceFail(e) {
  V.error = e; V.state = "idle"; V.session = null;
  refreshVoiceUI();
  ui.live.textContent = tObj("verr")[e.key] || "";
}

function cancelVoice(silent = false) {
  const s = V.session;
  V.session = null;
  s?.cancel();
  V.state = "idle"; V.interim = "";
  if (!silent) refreshVoiceUI();
}

function paintAsk() {
  if (!ui.ask) return;
  const live = LIVE();
  ui.ask.textContent = live ? (V.interim || t("listening")) : t("ask");
  ui.ask.classList.toggle("is-live", live);
  ui.askSub.textContent = live ? t("listeningSub") : t("askSub");
}

function refreshVoiceUI() {
  if (!ui.mic) return;
  const live = LIVE();
  ui.mic.classList.toggle("is-live", live);
  ui.mic.setAttribute("aria-pressed", String(live));
  ui.mic.setAttribute("aria-label", live ? t("stop") : t("speakAria"));
  ui.mic.querySelector(".mic__icon").replaceChildren(icon(live ? "stop" : "mic", { size: 28 }));
  ui.micLabel.textContent = live ? t("stop") : t("speak");
  if (live) ui.live.textContent = t("listening");
  paintAsk();
  paintHome();
  renderVoiceZone();
}

/** Try every recogniser alternative; keep the reading that resolves best. */
function interpret(alternatives) {
  const score = (r) => (!r ? 0 : r.status === "match" ? 1 + r.score : r.status === "choose" ? 0.5 : 0);
  const item = (phrase, r) => (!phrase ? { status: "missing" } : r.status === "match" ? { status: "match", phrase, pick: r.pick } : r.status === "choose" ? { status: "choose", phrase, options: r.options } : { status: "none", phrase });
  let best = null;
  alternatives.forEach((a, i) => {
    const p = parseTrip(a.text);
    const fr = p.from ? resolvePlace(S.index, p.from) : null;
    const tr = p.to ? resolvePlace(S.index, p.to) : null;
    let items = { from: p.fromHere ? { status: "me" } : item(p.from, fr || {}), to: item(p.to, tr || {}) };
    // Only one place said while To is already filled and From is empty → it's where they are.
    if (!p.from && !p.fromHere && p.to && S.to && !S.from) items = { from: items.to, to: { status: "match", pick: S.to } };
    const s = score(fr) + score(tr) + (p.fromHere ? 1 : 0) - i * 0.05;
    if (!best || s > best.s) best = { s, text: a.text, items };
  });
  return best;
}

function handleHeard(res, target) {
  if (target.startsWith("pick:")) return handlePick(res, target.slice(5));
  const best = interpret(res.alternatives);
  if (!best) return voiceFail({ key: "noSpeech" });
  for (const side of SIDES) {
    const it = best.items[side];
    if (it.status === "missing" && S[side]) best.items[side] = { status: "match", pick: S[side] };
    else if (it.status === "match" && it.pick !== S[side]) setPlace(side, it.pick);
  }
  V.pending = { text: best.text, items: best.items };
  if (best.items.from.status === "me") useMyLocation();
}

function handlePick(res, side) {
  const it = V.pending?.items[side];
  if (!it || it.status !== "choose") return;
  const restrict = new Set(it.options.map((o) => o.ref));
  for (const alt of res.alternatives) {
    const phrase = cleanSinglePlace(alt.text);
    for (const r of [resolvePlace(S.index, phrase, { restrictTo: restrict }), resolvePlace(S.index, phrase)]) {
      if (r.status === "match") return choose(side, r.pick);
    }
  }
  it.retry = true;
}

function choose(side, entry) {
  setPlace(side, entry);
  if (V.pending) V.pending.items[side] = { status: "match", pick: entry };
  renderVoiceZone();
  focusAuto();
}

function renderVoiceZone() {
  const z = ui.voiceZone;
  if (!z) return;
  z.replaceChildren();
  if (V.error && tObj("verr")[V.error.key]) {
    z.append(h("div", { class: "note note--warn", role: "alert" },
      h("p", { text: tObj("verr")[V.error.key] }),
      h("div", { class: "note__acts" },
        V.error.retry ? h("button", { class: "chip", type: "button", onclick: () => startVoice("both") }, icon("mic", { size: 18 }), t("sayAgain")) : null,
        h("button", { class: "chip chip--quiet", type: "button", onclick: () => { V.error = null; renderVoiceZone(); ui.fields[S.to ? "from" : "to"].input.focus(); } }, t("typeInstead")))));
  }
  if (V.pending) z.append(heardCard(V.pending));
}

function heardCard(p) {
  const needs = SIDES.filter((s) => p.items[s]?.status === "choose");
  const body = [];
  for (const side of needs) {
    const it = p.items[side];
    body.push(h("p", { class: "heard__q", text: t("whichOne", it.phrase) }),
      h("div", { class: "choices" }, ...it.options.map((o, i) => h("button", { class: "choice", type: "button", onclick: () => choose(side, o), ...(i === 0 && side === needs[0] ? { "data-autofocus": "" } : {}) },
        h("b", { text: placeName(o) }), h("small", { text: placeNameAlt(o) })))),
      it.retry ? h("p", { class: "field__msg", text: t("pickRetry") }) : null,
      V.support.supported ? h("button", { class: "chip chip--quiet", type: "button", onclick: () => startVoice("pick:" + side) }, icon("mic", { size: 18 }), t("speak")) : null);
  }
  for (const side of SIDES) if (p.items[side]?.status === "none") body.push(h("p", { class: "field__msg", text: t("notFoundPlace", p.items[side].phrase) }));
  if (!needs.length && !S.from && p.items.from?.status !== "me") body.push(h("p", { class: "heard__q", text: t("needFrom") }),
    h("div", { class: "note__acts" }, h("button", { class: "chip", type: "button", "data-autofocus": "", onclick: useMyLocation }, icon("locate", { size: 18 }), t("myLocation"))));
  if (!needs.length && !S.to) body.push(h("p", { class: "heard__q", text: t("needTo") }));
  const ready = S.from && S.to && !needs.length;
  const routeLine = S.from || S.to ? h("p", { class: "heard__route" },
    h("span", { text: S.from ? placeName(S.from) : "…" }), icon("arrow", { size: 18 }), h("span", { text: S.to ? placeName(S.to) : "…" })) : null;
  return h("div", { class: "heard" },
    p.text ? h("p", { class: "heard__said" }, h("span", { class: "sr", text: t("heard") + ": " }), "“", p.text, "”") : null,
    routeLine, ...body,
    h("div", { class: "heard__acts" },
      ready ? h("button", { class: "find find--small", type: "button", "data-autofocus": "", onclick: submitSearch }, t("confirmYes")) : null,
      V.support.supported && p.text ? h("button", { class: "chip chip--quiet", type: "button", onclick: () => startVoice("both") }, icon("mic", { size: 18 }), t("sayAgain")) : null));
}

/* ═════════════ search ═════════════ */

async function submitSearch() {
  SIDES.forEach((s) => fieldMsg(s, ""));
  for (const side of SIDES) {
    if (S[side]) continue;
    const text = ui.fields[side].input.value.trim();
    if (!text) continue;
    const r = resolvePlace(S.index, text);
    if (r.status === "match") setPlace(side, r.pick);
    else if (r.status === "choose") {
      V.pending = { text: "", items: { from: S.from ? { status: "match", pick: S.from } : { status: "missing" }, to: S.to ? { status: "match", pick: S.to } : { status: "missing" }, [side]: { status: "choose", phrase: text, options: r.options } } };
      renderVoiceZone();
      focusAuto();
      return;
    } else { fieldMsg(side, t("notFoundPlace", text)); ui.fields[side].input.focus(); return; }
  }
  if (!S.to) { fieldMsg("to", t("needTo")); ui.fields.to.input.focus(); return; }
  if (!S.from) { fieldMsg("from", t("needFrom")); ui.fields.from.input.focus(); return; }
  if (S.from.ref === S.to.ref) { fieldMsg("to", t("sameSpot")); return; }
  V.pending = null; V.error = null;
  renderVoiceZone();
  // a little bus drives across the button while we "look" — short, and skipped for reduced motion
  const btn = ui.find;
  if (btn && !reducedMotion() && !btn.classList.contains("is-going")) {
    btn.style.setProperty("--w", `${btn.clientWidth}px`);
    btn.classList.add("is-going");
    await sleep(700);
    btn.classList.remove("is-going");
  }
  const hash = `#/go?from=${encodeURIComponent(S.from.ref)}&to=${encodeURIComponent(S.to.ref)}`;
  if (location.hash === hash) await route(); else location.hash = hash;
}

async function runFromHash(q) {
  const get = async (ref) => {
    if (ref === "me") { if (!S.loc) { try { await locate(); } catch { return null; } } return mePlace(); }
    return S.index.byRef.get(ref) || null;
  };
  const from = await get(q.get("from") || ""), to = await get(q.get("to") || "");
  if (from) setPlace("from", from);
  if (to) setPlace("to", to);
  if (!from || !to) { ui.results.replaceChildren(); paintHome(); showNetworkMap(); return; }
  V.pending = null; V.error = null;
  renderVoiceZone();
  const wasCompact = ui.home.classList.contains("has-results");
  S.plan = { ...planTrip(S.graph, S.settings, from, to), from, to };
  renderResults(S.plan);
  paintHome();
  if (ui.maps.length) showTrip(0); else showNetworkMap();
  document.title = `${placeName(from)} → ${placeName(to)} · ${t("app")}`;
  ui.resultsTitle?.focus({ preventScroll: true });
  if (!matchMedia("(min-width: 1000px)").matches) {
    await sleep(wasCompact || reducedMotion() ? 60 : 650); // let the scene fold down first
    ui.results.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  }
  refreshLive();
}

/* ───── the map behind the sheet ───── */

const tileOpts = () => ({
  tileUrl: matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light" ? CONFIG.tileUrlDark : CONFIG.tileUrl,
  attribution: CONFIG.tileAttribution, attributionUrl: CONFIG.tileAttributionUrl,
});
let stopMap = null, netCache = null;
function setMap(mount) { stopMap?.(); ui.mapbox.replaceChildren(); stopMap = mount(); }

let stopDots = null;
const networkStops = () => (stopDots ||= S.stops.filter((x) => S.graph.stopRoutes.has(x.id)).map((x) => ({ lat: x.lat, lng: x.lng })));
function showNetworkMap() {
  if (ui.mapMode === "net") return;
  ui.mapMode = "net";
  setMap(() => mountNetworkMap(ui.mapbox, { center: { lat: 23.775, lng: 90.395 }, stops: networkStops() }, tileOpts()));
}
function showTrip(i) {
  const m = ui.maps[i];
  if (!m) return;
  ui.mapMode = "trip" + i;
  setMap(() => mountJourneyMap(ui.mapbox, m.data, { ...tileOpts(), label: t("mapTripLabel"), names: m.names, legend: { bus: t("legendBus"), walk: t("legendWalk") }, still: reducedMotion(), padTop: 70, padBottom: 66 }));
}
function inlineMap(data, names) {
  const box = h("div", { class: "mapbox", role: "img", "aria-label": t("mapTripLabel") });
  mountJourneyMap(box, data, { ...tileOpts(), label: t("mapTripLabel"), names, legend: { bus: t("legendBus"), walk: t("legendWalk") }, still: reducedMotion(), padTop: 60, padBottom: 50 });
  return box;
}

/* ═════════════ results ═════════════ */

const footnote = () => h("p", { class: "footnote" }, t("footnote"), h("br"), t("sourceNote"));
const fromLabel = (p) => (p.kind === "me" ? t("myLocation") : placeName(p));

function renderResults(plan) {
  const R = ui.results;
  R.replaceChildren();
  ui.resultsTitle = null;
  ui.maps = [];
  const found = plan.direct.length || plan.change.length;
  if (!found && plan.reason !== "walk") { R.append(emptyState(plan)); return; }
  R.append(journeyCard(plan));
  if (plan.reason === "walk") { R.append(walkCard(plan), footnote()); return; }
  plan.direct.forEach((g, i) => R.append(groupCard(plan, g, i, "direct")));
  plan.change.forEach((g, i) => R.append(groupCard(plan, g, i, "change")));
  R.append(footnote());
}

/** Fare, ride time and bus count for the headline. */
function tripStats(plan) {
  if (plan.direct.length) {
    const buses = plan.direct[0].buses, fares = buses.map((b) => b.fare), mins = buses.map((b) => roundMin(b.rideMin));
    const routes = new Set(plan.direct.flatMap((g) => g.buses.map((b) => b.route.id)));
    return { kind: "direct", lo: Math.min(...fares), hi: Math.max(...fares), rideLo: Math.min(...mins), rideHi: Math.max(...mins), count: routes.size };
  }
  const g = plan.change[0], f1 = g.buses1.map((b) => b.fare), f2 = g.buses2.map((b) => b.fare);
  const m1 = g.buses1.map((b) => roundMin(b.rideMin)), m2 = g.buses2.map((b) => roundMin(b.rideMin));
  return { kind: "change", lo: Math.min(...f1) + Math.min(...f2), hi: Math.max(...f1) + Math.max(...f2), rideLo: Math.min(...m1) + Math.min(...m2), rideHi: Math.max(...m1) + Math.max(...m2), count: g.buses1.length + g.buses2.length };
}

/** The answer in one glance: direct / change / just walk, then fare, time and bus count. */
function journeyCard(plan) {
  const walk = plan.reason === "walk";
  const st = walk ? null : tripStats(plan);
  const kind = walk ? "walk" : st.kind;
  const title = t(kind === "direct" ? "verdictDirect" : kind === "change" ? "verdictChange" : "verdictWalk");
  const sub = kind === "direct" ? t("verdictDirectSub") : kind === "change" ? t("verdictChangeSub") : t("verdictWalkSub", plan.walk.min, plan.walk.distM);
  ui.resultsTitle = h("h2", { tabindex: "-1" }, h("span", { class: "sr", text: `${fromLabel(plan.from)} → ${placeName(plan.to)}: ` }), title);
  const range = (a, b) => (a === b ? n(a) : `${n(a)}–${n(b)}`);
  const fact = (value, label) => h("div", { class: "fact" }, h("b", { class: "num", text: value }), h("small", { text: label }));
  const facts = walk
    ? h("div", { class: "facts facts--one" }, fact(n(plan.walk.min), t("factWalk")))
    : h("div", { class: "facts" }, fact(t("fareRange", st.lo, st.hi), t("officialFare")), fact(range(st.rideLo, st.rideHi), t("factTime")), fact(n(st.count), t("factBuses")));
  const card = h("div", { class: "journey" },
    h("div", { class: "verdict" },
      h("span", { class: `verdict__ok${kind === "change" ? " verdict__ok--change" : ""}`, "aria-hidden": "true" }, icon(kind === "change" ? "refresh" : kind === "walk" ? "walk" : "check", { size: 18 })),
      h("div", {}, ui.resultsTitle, h("p", { text: sub }))),
    facts);
  if (!walk) {
    const listen = h("button", { class: "chip journey__listen", type: "button", hidden: true, onclick: (e) => readAloud(e.currentTarget) }, icon("speaker", { size: 18 }), t("listen"));
    card.append(listen);
    hasVoiceFor(getLang()).then((ok) => { listen.hidden = !ok; });
  }
  return card;
}

/* ───── one boarding option as a step-by-step rail ───── */

const MK = { start: "pin", on: "bus", off: "flag", end: "flag", mid: "refresh" };

function groupCard(plan, g, gi, kind) {
  const direct = kind === "direct";
  const ride1 = direct ? g.buses : g.buses1;
  const c1 = "#0b7a52"; // first bus ride; a second ride (after a change) is blue
  const c2 = direct ? c1 : "#1f6feb";
  let i = 0;
  const rows = [];

  const stopRow = (mk, label, who, { up = "none", down = "none", cu = c1, cd = c1 } = {}) => {
    const link = who.id && S.graph.stopsById.has(who.id) && who.kind !== "area" && who.kind !== "me";
    return h("div", { class: "node node--stop", style: `--i:${i++};--cu:${cu};--cd:${cd}`, "data-up": up, "data-down": down },
      h("div", { class: "rl" }, h("span", { class: `mk mk--${mk}`, "aria-hidden": "true" }, icon(MK[mk], { size: 14 }))),
      h("div", { class: "node__body" }, h("span", { class: "node__lab", text: label }),
        link ? h("a", { class: "node__name", href: `#/stop/${who.id}`, text: placeName(who) }) : h("span", { class: "node__name", text: fromLabel(who) })));
  };
  const legRow = (kindOf, body, color = c1) => h("div", { class: "node node--leg", style: `--i:${i++};--c:${color}`, "data-kind": kindOf },
    h("div", { class: "rl" }), h("div", { class: "node__body" }, body));
  const walkLeg = (leg, hint) => legRow("walk", h("div", { class: "leg" }, icon(leg.mode === "walk" ? "walk" : "rickshaw", { size: 18 }),
    h("b", { text: leg.mode === "walk" ? t("walk", leg.min, leg.distM) : t("rickshaw", leg.min) }),
    hint ? h("span", { class: "leg__hint", text: hint }) : leg.mode === "rickshaw" ? h("span", { class: "leg__hint", text: t("rickshawNote") }) : null));
  const rideRow = (legs, color, groupAlight) => h("div", { class: "node node--leg node--ride", style: `--i:${i++};--c:${color}`, "data-kind": "ride" },
    h("div", { class: "rl" }),
    h("div", { class: "node__body" },
      h("p", { class: "takeany" }, icon("bus", { size: 18 }), legs.length > 1 ? t("takeAny") : t("takeOne")),
      busList(legs, groupAlight)));

  const hint = plan.from.kind === "area" ? (getLang() === "bn" ? plan.from.data?.hint_text_bn : plan.from.data?.hint_text_en) : "";
  const walkIn = g.first.mode !== "none", walkOut = g.last.mode !== "none";
  if (walkIn) rows.push(stopRow("start", t("startHere"), plan.from, { down: "walk" }), walkLeg(g.first, hint));
  rows.push(stopRow("on", t("getOn"), g.board, { up: walkIn ? "walk" : "none", down: "ride", cd: c1 }));
  rows.push(rideRow(ride1, c1, direct ? g.alight : g.transfer));

  if (direct) {
    rows.push(stopRow("off", t("getOff"), g.alight, { up: "ride", down: walkOut ? "walk" : "none", cu: c1 }));
  } else {
    const apart = g.transfer2.id !== g.transfer.id;
    rows.push(stopRow("mid", t("changeHere"), g.transfer, { up: "ride", down: apart ? "walk" : "ride", cu: c1, cd: c2 }));
    if (apart) {
      rows.push(legRow("walk", h("div", { class: "leg" }, icon("walk", { size: 18 }), h("b", { text: t("walkToNext", placeName(g.transfer2), g.transferWalk) }))));
      rows.push(stopRow("on", t("getOn"), g.transfer2, { up: "walk", down: "ride", cd: c2 }));
    }
    rows.push(rideRow(g.buses2, c2, g.alight));
    rows.push(stopRow("off", t("getOff"), g.alight, { up: "ride", down: walkOut ? "walk" : "none", cu: c2 }));
  }
  if (walkOut) rows.push(walkLeg(g.last, ""), stopRow("end", t("arrive"), plan.to, { up: "walk" }));

  const path = direct ? g.buses[0].stopIds.map(stopById) : [...g.buses1[0].stopIds.map(stopById), ...g.buses2[0].stopIds.map(stopById)];
  const idx = ui.maps.length;
  ui.maps.push({
    data: { you: walkIn ? plan.from : null, dest: walkOut ? plan.to : null, board: g.board, alight: g.alight, path, color: c1, accuracy: plan.from.kind === "me" ? plan.from.acc : 0 },
    names: { board: placeName(g.board), alight: placeName(g.alight) },
  });
  return h("section", { class: "group", style: `--g:${gi}` },
    gi > 0 ? h("span", { class: "group__tag", text: t("optionN", gi + 1) }) : null,
    h("div", { class: "rail" }, ...rows),
    idx > 0 ? h("button", { class: "mapbtn", type: "button", onclick: () => { showTrip(idx); window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" }); } }, icon("map", { size: 18 }), t("showMap")) : null);
}

function walkCard(plan) {
  const a = plan.from, b = plan.to, leg = plan.walk;
  const sRow = (mk, label, name, i, down, up) => h("div", { class: "node node--stop", style: `--i:${i}`, "data-up": up, "data-down": down },
    h("div", { class: "rl" }, h("span", { class: `mk mk--${mk}`, "aria-hidden": "true" }, icon(MK[mk], { size: 14 }))),
    h("div", { class: "node__body" }, h("span", { class: "node__lab", text: label }), h("span", { class: "node__name", text: name })));
  ui.maps.push({ data: { walkOnly: true, you: a, dest: b, accuracy: a.kind === "me" ? a.acc : 0 }, names: { board: "", alight: "" } });
  return h("section", { class: "group", style: "--g:0" },
    h("div", { class: "rail" },
      sRow("start", t("startHere"), fromLabel(a), 0, "walk", "none"),
      h("div", { class: "node node--leg", style: "--i:1", "data-kind": "walk" }, h("div", { class: "rl" }),
        h("div", { class: "node__body" }, h("div", { class: "leg" }, icon("walk", { size: 18 }), h("b", { text: t("walk", leg.min, leg.distM) })))),
      sRow("end", t("arrive"), placeName(b), 2, "none", "walk")));
}

/* ───── bus rows ───── */

const SHOW_BUSES = 5;
const hoursText = (r) => { const [a, b] = r.hours.split("–"); return t("runs", fmtClock(a), fmtClock(b)); };

/** One bus: its colour badge, its name, and (optionally) the official fare. */
function busCard({ route, href, delay = 0, fare = null, lines = [] }) {
  return h("a", { class: "bus", href, style: `--delay:${delay.toFixed(2)}s` },
    h("span", { class: "badge", style: `--c:${routeColor(route.id)}`, "aria-hidden": "true" }, icon("bus", { size: 22 })),
    h("span", { class: "bus__main" }, h("span", { class: "bus__name", text: routeName(route) }), ...lines),
    fare != null ? h("span", { class: "bus__fare" }, h("b", { class: "num", text: t("taka", fare) }), h("small", { text: t("officialFare") })) : null);
}

function busList(legs, groupAlight = null) {
  // same-name buses (four "Alif", eight "BRTC") get their end points so riders can tell them apart
  const counts = legs.reduce((m, l) => m.set(routeName(l.route), (m.get(routeName(l.route)) || 0) + 1), new Map());
  const ends = (r) => `${placeName(stopById(r.stops[0]))} – ${placeName(stopById(r.stops[r.stops.length - 1]))}`;
  const item = (leg, k) => {
    const r = leg.route;
    return h("li", {}, busCard({
      route: r, href: `#/bus/${r.id}?b=${leg.board.id}&a=${leg.alight.id}`, delay: 0.35 + Math.min(k, 8) * 0.07, fare: leg.fare,
      lines: [
        counts.get(routeName(r)) > 1 ? h("span", { class: "bus__sub", text: ends(r) }) : null,
        groupAlight && leg.alight.id !== groupAlight.id ? h("span", { class: "bus__sub bus__off", text: `${t("getOff")}: ${placeName(leg.alight)}` }) : null,
        h("span", { class: "bus__sub" }, icon("clock", { size: 14 }), h("span", { text: t("minutes", roundMin(leg.rideMin)) }), r.hours ? h("span", { text: hoursText(r) }) : null),
        h("span", { class: "bus__seen", hidden: true, dataset: { route: r.id, stop: leg.board.id } }),
      ],
    }));
  };
  const list = h("ul", { class: "buses", "aria-label": t("busCount", legs.length) }, ...legs.slice(0, SHOW_BUSES).map(item));
  if (legs.length > SHOW_BUSES) {
    const more = h("li", { class: "buses__more" }, h("button", { class: "textlink", type: "button", onclick: () => {
      more.replaceWith(...legs.slice(SHOW_BUSES).map((l, k) => item(l, k)));
      refreshLive();
    } }, t("moreBuses", legs.length)));
    list.append(more);
  }
  return list;
}

function emptyState(plan) {
  const ico = h("span", { class: "empty__ico", "aria-hidden": "true" }, icon("bus", { size: 28 }));
  if (plan.reason === "same") return h("div", { class: "empty" }, ico, h("h3", { text: t("sameSpot") }));
  if (plan.reason?.startsWith("no-stop-near")) return h("div", { class: "empty" }, ico, h("h3", { text: t("noBusTitle") }), h("p", { class: "muted", text: t("noStopNear") }));
  const anchor = plan.from.kind === "stop" ? plan.from : nearestStop(plan.from);
  const reach = anchor ? reachableFrom(S.graph, anchor.id, 8) : [];
  const btn = h("button", { class: "chip", type: "button", onclick: async () => {
    await S.store.flag({ kind: "missing_trip", extra: { from: plan.from.kind === "me" ? "me" : plan.from.ref, to: plan.to.ref } });
    btn.disabled = true; btn.textContent = t("noTripThanks");
  } }, t("noTripTell"));
  const title = h("h3", { tabindex: "-1", text: t("noTripTitle") });
  ui.resultsTitle = title;
  return h("div", { class: "empty" }, ico, title, h("p", { class: "muted", text: t("noTripBody") }), btn,
    reach.length ? h("div", {}, h("p", { class: "muted", text: t("reachFrom", placeName(anchor)) }),
      h("div", { class: "chips" }, ...reach.map((s) => h("button", { class: "chip chip--quiet", type: "button", onclick: () => { setPlace("to", S.index.byRef.get("s:" + s.id)); submitSearch(); } }, placeName(s))))) : null);
}

function nearestStop(p) {
  let best = null, bd = Infinity;
  for (const s of S.stops) { if (!S.graph.stopRoutes.has(s.id)) continue; const d = haversineM(p, s); if (d < bd) { bd = d; best = s; } }
  return bd <= 4000 ? best : null;
}

async function readAloud(btn) {
  const p = S.plan; if (!p) return;
  const names = (legs) => legs.slice(0, 3).map((l) => routeName(l.route)).join(getLang() === "bn" ? " বা " : " or ");
  let text;
  if (p.direct.length) { const g = p.direct[0]; text = t("summary", placeName(p.to), names(g.buses), placeName(g.board), placeName(g.alight), g.buses[0].fare, roundMin(g.buses[0].rideMin)); }
  else { const g = p.change[0]; text = t("summaryChange", placeName(p.to), names(g.buses1), placeName(g.board), placeName(g.transfer), names(g.buses2), placeName(g.alight)); }
  btn.disabled = true;
  await speak(text, getLang());
  btn.disabled = false;
}

/* ═════════════ live rider data ═════════════ */

async function refreshLive() {
  if (!S.store) return;
  const els = $$("[data-route][data-stop]");
  if (els.length) {
    S.seen = await S.store.seenFor([...new Set(els.map((e) => e.dataset.route))]);
    els.forEach(paintSeen);
  }
  for (const el of $$(".riderfare[data-route]")) {
    const range = riderFareRange(await S.store.fareAmounts(el.dataset.route, el.dataset.from, el.dataset.to), Number(el.dataset.official), S.settings);
    el.textContent = range ? t("riderFare", range.low, range.high, range.n) : "";
  }
}

function paintSeen(el) {
  const r = S.graph.routesById.get(el.dataset.route);
  if (!r) return;
  const pos = r.pos.get(el.dataset.stop);
  const near = S.seen.filter((x) => x.route_id === r.id && Math.abs((r.pos.get(x.stop_id) ?? 999) - pos) <= 3);
  el.replaceChildren();
  if (!near.length) { el.hidden = true; return; }
  const latest = near[0];
  const mins = Math.floor((Date.now() - latest.ts) / 60000);
  const riders = near.filter((x) => Date.now() - x.ts <= 15 * 60000).reduce((s, x) => s + x.riders, 0);
  el.hidden = false;
  el.append(icon("eye", { size: 15 }), " ", riders >= 2 ? t("seenBy", riders, 15) : latest.stop_id === el.dataset.stop ? t("seenAgo", mins) : t("seenAt", placeName(stopById(latest.stop_id)), mins));
  if (el.classList.contains("seen-box")) el.append(" · ", h("button", { class: "textlink", type: "button", onclick: async () => { await S.store.markSeenWrong(latest); refreshLive(); } }, t("seenWrong")));
}

async function reportSeen(route, stop) {
  const res = await S.store.reportSeen(route.id, stop.id);
  if (!res.ok) return toast(t(res.reason === "tooSoon" ? "seenTooSoon" : "seenDayLimit"));
  toast(res.shared ? t("seenThanksShared", S.settings.seen_ttl_min) : t("seenThanksLocal"), 5000);
  refreshLive();
}

/* trip → fare prompt */
let tripTimer;
function tookBus(leg, btn) {
  S.store.startTrip({ routeId: leg.route.id, fromId: leg.board.id, toId: leg.alight.id, fare: leg.fare, expectedMin: Math.ceil(leg.rideMin) + 5 });
  toast(t("tookToast"), 5000);
  btn.disabled = true;
  btn.replaceChildren(icon("check", { size: 18 }), t("tookActive"));
  scheduleTrip();
}
function scheduleTrip() {
  clearTimeout(tripTimer);
  const trip = S.store.currentTrip();
  if (trip) tripTimer = setTimeout(checkTrip, Math.max(1000, Math.min(trip.startedAt + trip.expectedMin * 60000 - Date.now(), 2 ** 30)));
}
function checkTrip() {
  const trip = S.store?.currentTrip();
  if (!trip || !ui.banner) return;
  if (Date.now() - trip.startedAt > 12 * 3600e3) return S.store.clearTrip();
  if (Date.now() < trip.startedAt + trip.expectedMin * 60000) return scheduleTrip();
  const r = S.graph.routesById.get(trip.routeId);
  if (!r) return S.store.clearTrip();
  ui.banner.replaceChildren(h("div", { class: "banner", role: "region", "aria-label": t("farePrompt") },
    h("span", { text: t("fareBanner", routeName(r)) }),
    h("span", { class: "note__acts" },
      h("button", { class: "chip chip--solid", type: "button", onclick: () => openFare(trip) }, t("answer")),
      h("button", { class: "chip chip--quiet", type: "button", onclick: () => ui.banner.replaceChildren() }, t("later")))));
}

function openFare(trip) {
  const r = S.graph.routesById.get(trip.routeId);
  let chosen = null, correct = null, dlg;
  const other = h("input", { class: "input", type: "number", inputmode: "numeric", min: "1", max: "999", placeholder: t("fareOtherPh"), "aria-label": t("fareOther"), hidden: true });
  const send = h("button", { class: "find", type: "button", disabled: true, onclick: submit }, t("fareSend"));
  const btns = [0, 5, 10, 15, 20].map((d) => trip.fare + d).map((a) => h("button", { class: "amount num", type: "button", "aria-pressed": "false", onclick: (e) => pick(a, e.currentTarget) }, n(a)));
  const otherBtn = h("button", { class: "amount", type: "button", "aria-pressed": "false", onclick: (e) => { other.hidden = false; other.focus(); pick(null, e.currentTarget); } }, t("fareOther"));
  function pick(a, b) { chosen = a; [...btns, otherBtn].forEach((x) => x.setAttribute("aria-pressed", String(x === b))); if (a !== null) other.hidden = true; send.disabled = a === null && !other.value; }
  other.addEventListener("input", () => { chosen = null; send.disabled = !other.value; });
  const yes = h("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: () => setC(true) }, t("yes"));
  const no = h("button", { class: "chip", type: "button", "aria-pressed": "false", onclick: () => setC(false) }, t("no"));
  function setC(v) { correct = v; yes.setAttribute("aria-pressed", String(v)); no.setAttribute("aria-pressed", String(!v)); }
  async function submit() {
    const amount = chosen ?? Math.round(Number(other.value));
    if (!(amount > 0)) return;
    await S.store.reportFare({ routeId: trip.routeId, fromStop: trip.fromId, toStop: trip.toId, amount });
    if (correct !== null) await S.store.flag({ routeId: trip.routeId, kind: correct ? "route_ok" : "route_wrong", extra: { from: trip.fromId, to: trip.toId } });
    S.store.clearTrip(); ui.banner.replaceChildren(); dlg.close(); toast(t("fareThanks"));
  }
  dlg = openSheet([
    h("h2", { text: t("farePrompt") }),
    h("p", { class: "muted", text: `${routeName(r)} · ${placeName(stopById(trip.fromId))} → ${placeName(stopById(trip.toId))} · ${t("officialFare")} ${t("taka", trip.fare)}` }),
    h("div", { class: "amounts" }, ...btns, otherBtn), other,
    h("p", { class: "heard__q", text: t("routeCorrect") }), h("div", { class: "note__acts" }, yes, no),
    h("div", { class: "sheet__acts" }, send, h("button", { class: "chip chip--quiet", type: "button", onclick: () => { S.store.clearTrip(); ui.banner.replaceChildren(); dlg.close(); } }, t("fareSkip"))),
  ], { label: t("farePrompt") });
}

function openReport(route, extra) {
  let kind = null, dlg;
  const note = h("textarea", { class: "input", rows: "3", maxlength: "300", placeholder: t("reportNote"), "aria-label": t("reportNote") });
  const send = h("button", { class: "find", type: "button", disabled: true, onclick: async () => {
    await S.store.flag({ routeId: route.id, kind, note: note.value, extra }); dlg.close(); toast(t("reportThanks"));
  } }, t("reportSend"));
  dlg = openSheet([
    h("h2", { text: t("reportTitle") }), h("p", { class: "muted", text: routeName(route) }),
    h("div", { class: "radios", role: "radiogroup", "aria-label": t("reportTitle") }, ...Object.entries(tObj("reportOptions")).map(([k, label]) =>
      h("label", { class: "radio" }, h("input", { type: "radio", name: "why", value: k, onchange: () => { kind = k; send.disabled = false; } }), h("span", { text: label })))),
    note, h("div", { class: "sheet__acts" }, send, h("button", { class: "chip chip--quiet", type: "button", onclick: () => dlg.close() }, t("cancel"))),
  ], { label: t("reportTitle") });
}

/* ═════════════ pages ═════════════ */

function showPage(nodes, title) {
  ui.home.hidden = true;
  ui.page.hidden = false;
  ui.page.replaceChildren(h("a", { class: "back", href: "#/", onclick: (e) => { if (S.navCount > 0) { e.preventDefault(); history.back(); } } }, icon("back", { size: 18 }), t("back")), ...nodes);
  document.title = `${title} · ${t("app")}`;
  const h1 = ui.page.querySelector("h1");
  h1?.setAttribute("tabindex", "-1");
  h1?.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
  refreshLive();
}

function busPage(id, q) {
  const r = S.graph.routesById.get(id);
  if (!r) return location.replace("#/");
  const bi = r.pos.get(q.get("b")), ai = r.pos.get(q.get("a"));
  const hasTrip = bi !== undefined && ai !== undefined && bi !== ai;
  const color = routeColor(r.id);
  const first = stopById(r.stops[0]), last = stopById(r.stops[r.stops.length - 1]);
  const nodes = [
    h("div", { class: "buspage" },
      h("span", { class: "badge badge--lg", style: `--c:${color}`, "aria-hidden": "true" }, icon("bus", { size: 32 })),
      h("div", {}, h("h1", { text: routeName(r) }), h("p", { class: "muted", text: `${placeName(first)} – ${placeName(last)}` }))),
    h("div", { class: "buspage__meta" },
      h("span", { class: "tag", text: r.seating === "seating" ? t("seating") : t("semiSeating") }),
      r.hours ? h("span", { class: "tag", text: hoursText(r) }) : null,
      h("span", { class: "tag", text: t("stopsN", r.stops.length) }),
      routeNameAlt(r) !== routeName(r) ? h("span", { class: "tag", text: routeNameAlt(r) }) : null),
  ];
  if (hasTrip) {
    const board = stopById(r.stops[bi]), alight = stopById(r.stops[ai]);
    const distKm = Math.abs(r.cum[ai] - r.cum[bi]);
    const fare = officialFare(distKm, r.service_type, S.settings), rideMin = rideMinutes(distKm, Math.abs(ai - bi), S.settings);
    nodes.push(h("section", { class: "trip-card", "aria-label": t("yourTrip") },
      h("p", { class: "trip-card__route" }, h("span", { text: placeName(board) }), icon("arrow", { size: 18 }), h("span", { text: placeName(alight) })),
      h("p", { class: "trip-card__nums" }, h("b", { class: "num", text: t("taka", fare) }), h("span", { class: "muted", text: `${t("officialFare")} · ${t("minutes", roundMin(rideMin))} · ${n(distKm.toFixed(1))} ${getLang() === "bn" ? "কিমি" : "km"}` })),
      h("p", { class: "riderfare muted", dataset: { route: r.id, from: board.id, to: alight.id, official: String(fare) } }),
      h("p", { class: "bus__seen seen-box", hidden: true, dataset: { route: r.id, stop: board.id } }),
      h("div", { class: "note__acts" },
        h("button", { class: "chip", type: "button", title: t("seenHint", placeName(board)), onclick: () => reportSeen(r, board) }, icon("eye", { size: 18 }), t("seenBtn")),
        h("button", { class: "chip", type: "button", onclick: (e) => tookBus({ route: r, board, alight, fare, rideMin }, e.currentTarget) }, icon("bus", { size: 18 }), t("tookBtn")))));
  }
  const all = r.stops.map(stopById);
  const lo = hasTrip ? Math.min(bi, ai) : -1, hi = hasTrip ? Math.max(bi, ai) : -1;
  nodes.push(inlineMap({
    board: hasTrip ? all[bi] : first, alight: hasTrip ? all[ai] : last, color,
    path: hasTrip ? all.slice(lo, hi + 1) : all, base: hasTrip ? all : null,
  }, { board: placeName(hasTrip ? all[bi] : first), alight: placeName(hasTrip ? all[ai] : last) }));

  nodes.push(h("h2", { class: "h2", text: t("allStops") }),
    h("ol", { class: "stoplist", style: `--c:${color}` },
      ...r.stops.map((sid, i) => h("li", { class: i === bi || i === ai ? "is-end" : i > lo && i < hi ? "is-on" : "" },
        h("a", { href: `#/stop/${sid}`, text: placeName(stopById(sid)) })))),
    h("p", { class: "footnote" },
      h("span", { class: "tag", text: r.verified ? t("verified") : t("unverified") }), " ", t("sourceNote"), " · ",
      h("button", { class: "textlink", type: "button", onclick: () => openReport(r, hasTrip ? { board: q.get("b"), alight: q.get("a") } : null) }, t("reportProblem"))));
  showPage(nodes, routeName(r));
}

function stopPage(id) {
  const stop = stopById(id);
  if (!stop) return location.replace("#/");
  const routes = routesAtStop(S.graph, id).sort((a, b) => routeName(a).localeCompare(routeName(b)));
  const go = (side) => { setPlace(side, S.index.byRef.get("s:" + id)); location.hash = "#/"; };
  showPage([
    h("h1", { text: placeName(stop) }),
    h("p", { class: "muted", text: `${placeNameAlt(stop)} · ${t("busesHere", routes.length)}` }),
    h("div", { class: "note__acts" }, h("button", { class: "chip", type: "button", onclick: () => go("from") }, t("goFromHere")), h("button", { class: "chip", type: "button", onclick: () => go("to") }, t("goHere"))),
    h("ul", { class: "buses buses--plain" }, ...routes.map((r, k) => h("li", {}, busCard({
      route: r, href: `#/bus/${r.id}`, delay: 0.1 + Math.min(k, 8) * 0.1,
      lines: [h("span", { class: "bus__sub", text: `${placeName(stopById(r.stops[0]))} – ${placeName(stopById(r.stops[r.stops.length - 1]))}` }),
        h("span", { class: "bus__seen", hidden: true, dataset: { route: r.id, stop: id } })],
    })))),
  ], placeName(stop));
}

function textPage(title, paras, extra = []) {
  showPage([h("h1", { text: title }), ...paras.map((p) => h("p", { class: "prose", text: p })), ...extra], title);
}

/* ═════════════ router ═════════════ */

async function route() {
  const [path, qs] = (location.hash.replace(/^#/, "") || "/").split("?");
  const parts = path.split("/").filter(Boolean);
  const q = new URLSearchParams(qs || "");
  const view = parts[0] || "";
  if (view === "" || view === "go") {
    ui.home.hidden = false; ui.page.hidden = true;
    if (view === "go") await runFromHash(q);
    else { ui.results.replaceChildren(); ui.maps = []; S.plan = null; document.title = `${t("app")} — ${t("tagline")}`; paintHome(); showNetworkMap(); }
  } else if (view === "bus") busPage(parts[1], q);
  else if (view === "stop") stopPage(parts[1]);
  else if (view === "about") textPage(t("aboutTitle"), tObj("aboutBody"));
  else if (view === "privacy") textPage(t("privacyTitle"), tObj("privacyBody"), [h("p", { class: "muted", text: S.store.mode === "remote" ? t("sharedMode") : t("localMode") })]);
  else location.replace("#/");
}

// Test hook (used by tests/fake-sr.js)
window.__kj = { S, V, startVoice, submitSearch };
boot();
