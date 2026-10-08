// node tests/voice-store.mjs — the voice session state machine and the rider-data store.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VoiceSession, classifyError, voiceSupport } from "../js/voice.js";

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { createStore } = await import("../js/store.js");

const settings = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "settings.json"), "utf8"));
let pass = 0, fail = 0;
const t = (name, ok, extra = "") => { if (ok) pass++; else { fail++; console.log("  ✗", name, extra); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = (alts, isFinal) => { const r = alts.map((x) => ({ transcript: x, confidence: 0.9 })); r.isFinal = isFinal; return r; };

/** A scripted recogniser: steps = [[delayMs, "event", payload], ...] */
const makeSR = (stepsByLang) => class {
  constructor() { this.timers = []; }
  start() {
    (this.constructor.langs ||= []).push(this.lang);
    const steps = stepsByLang[this.lang] || stepsByLang.default;
    let at = 0;
    for (const [d, ev, p] of steps) { at += d; this.timers.push(setTimeout(() => this[ev]?.(p), at)); }
  }
  stop() { this.timers.forEach(clearTimeout); setTimeout(() => { this.onresult?.({ results: [result(["stopped text"], true)] }); this.onend?.(); }, 5); }
  abort() { this.timers.forEach(clearTimeout); }
};

async function session(SR, opts = {}) {
  const log = { states: [], interim: [], final: [], error: [] };
  const s = new VoiceSession({ SR, lang: "bn", noSpeechMs: 400, maxMs: 2000, ...opts });
  s.start({
    onState: (x) => log.states.push(x), onInterim: (x) => log.interim.push(x),
    onFinal: (x) => log.final.push(x), onError: (x) => log.error.push(x),
  });
  return { s, log };
}

/* happy path */
{
  const SR = makeSR({ default: [[5, "onstart"], [5, "onspeechstart"], [5, "onresult", { results: [result(["মিরপুর"], false)] }], [5, "onresult", { results: [result(["মিরপুর ১০ থেকে মতিঝিল", "মিরপুর দশ থেকে মতিঝিল"], true)] }], [5, "onend"], [5, "onend"]] });
  const { log } = await session(SR); await sleep(120);
  t("final delivered once", log.final.length === 1 && log.error.length === 0, JSON.stringify(log));
  t("alternatives kept in order", log.final[0]?.alternatives.map((a) => a.text).join("|") === "মিরপুর ১০ থেকে মতিঝিল|মিরপুর দশ থেকে মতিঝিল");
  t("interim streamed", log.interim[0] === "মিরপুর");
  t("states walk listening → hearing", log.states.includes("listening") && log.states.includes("hearing"));
  t("first language is bn-BD", SR.langs[0] === "bn-BD");
}
/* only interim text at the end still counts */
{
  const SR = makeSR({ default: [[5, "onstart"], [5, "onresult", { results: [result(["ফার্মগেট থেকে গুলিস্তান"], false)] }], [5, "onend"]] });
  const { log } = await session(SR); await sleep(80);
  t("interim-only result delivered", log.final.length === 1 && log.final[0].alternatives[0].text === "ফার্মগেট থেকে গুলিস্তান", JSON.stringify(log));
}
/* errors */
for (const [code, key] of [["no-speech", "noSpeech"], ["not-allowed", "notAllowed"], ["audio-capture", "audioCapture"], ["network", "network"], ["service-not-allowed", "serviceNotAllowed"]]) {
  const SR = makeSR({ default: [[5, "onstart"], [5, "onerror", { error: code }], [5, "onend"]] });
  const { log } = await session(SR); await sleep(80);
  t(`error ${code} → ${key}`, log.error.length === 1 && log.error[0].key === key && log.final.length === 0, JSON.stringify(log.error));
}
/* silence: nothing heard → recogniser is stopped → "no-speech" */
{
  const SR = makeSR({ default: [[5, "onstart"]] });
  SR.prototype.stop = function () { setTimeout(() => this.onend?.(), 5); };
  const { log } = await session(SR); await sleep(700);
  t("silence times out to no-speech", log.error.length === 1 && log.error[0].key === "noSpeech", JSON.stringify(log));
}
/* bn-BD unsupported → falls back to bn-IN */
{
  const SR = makeSR({
    "bn-BD": [[5, "onerror", { error: "language-not-supported" }], [5, "onend"]],
    "bn-IN": [[5, "onstart"], [5, "onresult", { results: [result(["উত্তরা"], true)] }], [5, "onend"]],
  });
  const { log } = await session(SR); await sleep(120);
  t("fallback to bn-IN", SR.langs.join() === "bn-BD,bn-IN" && log.final.length === 1 && log.error.length === 0, JSON.stringify({ langs: SR.langs, log }));
}
/* every tag unsupported → clear error */
{
  const SR = makeSR({ default: [[5, "onerror", { error: "language-not-supported" }], [5, "onend"]] });
  const { log } = await session(SR); await sleep(120);
  t("all languages unsupported → langUnsupported", log.error[0]?.key === "langUnsupported", JSON.stringify(log.error));
}
/* stop() delivers what was heard; cancel() delivers nothing */
{
  const SR = makeSR({ default: [[5, "onstart"], [5, "onspeechstart"]] });
  const { s, log } = await session(SR, { noSpeechMs: 5000 }); await sleep(30); s.stop(); await sleep(60);
  t("stop() delivers", log.final.length === 1 && log.final[0].alternatives[0].text === "stopped text", JSON.stringify(log));
}
{
  const SR = makeSR({ default: [[5, "onstart"], [60, "onresult", { results: [result(["x"], true)] }], [5, "onend"]] });
  const { s, log } = await session(SR); await sleep(20); s.cancel(); await sleep(150);
  t("cancel() is silent", log.final.length === 0 && log.error.length === 0, JSON.stringify(log));
}
/* unsupported browser */
{
  const { log } = await session(null);
  t("no recogniser → unsupported", log.error[0]?.key === "unsupported");
  t("voiceSupport detects webkit prefix", voiceSupport({ webkitSpeechRecognition: function () {}, isSecureContext: true }).supported === true);
  t("voiceSupport flags insecure origin", voiceSupport({ webkitSpeechRecognition: function () {}, isSecureContext: false }).secure === false);
  t("aborted is silent", classifyError("aborted").silent === true);
}

/* ───────────── store ───────────── */
{
  const store = createStore({}, settings);
  t("local mode by default", store.mode === "local");
  const a = await store.reportSeen("mirpur12-motijheel", "farmgate");
  t("seen accepted", a.ok === true && a.shared === false);
  t("repeat tap ignored", (await store.reportSeen("mirpur12-motijheel", "farmgate")).reason === "tooSoon");
  const rows = await store.seenFor(["mirpur12-motijheel"]);
  t("seen visible", rows.length === 1 && rows[0].stop_id === "farmgate");
  t("other routes unaffected", (await store.seenFor(["uttara-motijheel"])).length === 0);
  // age it past the visible window
  const stored = JSON.parse(mem.get("kj.seen")); stored[0].ts -= (settings.seen_ttl_min + 1) * 60000; mem.set("kj.seen", JSON.stringify(stored));
  t("seen expires", (await store.seenFor(["mirpur12-motijheel"])).length === 0);

  await store.reportSeen("uttara-motijheel", "kuril");
  const [row] = await store.seenFor(["uttara-motijheel"]);
  await store.markSeenWrong(row);
  t("wrong report hidden", (await store.seenFor(["uttara-motijheel"])).length === 0);

  for (let i = 0; i < settings.seen_max_per_day + 2; i++) await store.reportSeen("r" + i, "s");
  t("daily cap", (await store.reportSeen("brand-new", "s")).reason === "dayLimit");

  await store.reportFare({ routeId: "x", fromStop: "a", toStop: "b", amount: 40 });
  await store.reportFare({ routeId: "x", fromStop: "a", toStop: "b", amount: 45 });
  t("fare amounts stored", (await store.fareAmounts("x", "a", "b")).join() === "40,45");
  store.startTrip({ routeId: "x", fromId: "a", toId: "b", fare: 38, expectedMin: 30 });
  t("trip remembered", store.currentTrip()?.routeId === "x");
  store.clearTrip();
  t("trip cleared", store.currentTrip() === null);
  const keys = [...mem.keys()].join(" ");
  t("no position is ever stored", !/lat|lng|loc/.test(JSON.stringify([...mem.values()])) && !/loc/.test(keys));
}
/* remote mode: right calls, and graceful fallback */
{
  mem.clear();
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), headers: init.headers }); return { ok: true, text: async () => JSON.stringify({ ok: true }) }; };
  const store = createStore({ supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" }, settings);
  const r = await store.reportSeen("a", "b");
  t("remote seen shared", r.ok && r.shared);
  t("remote rpc name + auth", calls[0].url.endsWith("/rest/v1/rpc/report_seen") && calls[0].headers.apikey === "anon" && calls[0].body.p_route === "a");
  t("device is sent hashed, not raw", /^[0-9a-f]{64}$/.test(calls[0].body.p_device) && calls[0].body.p_device !== JSON.parse(mem.get("kj.device")));
  globalThis.fetch = async () => { throw new Error("offline"); };
  mem.delete("kj.seen");
  const r2 = await store.reportSeen("a", "b");
  t("offline falls back to local", r2.ok && r2.shared === false);
  t("still visible locally", (await store.seenFor(["a"])).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
