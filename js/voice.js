// Voice input (browser speech recognition) and spoken read-out (speech synthesis).
//
// Why this file is longer than "new SpeechRecognition().start()":
//  - Chrome ends a session silently, fires onend more than once, and reports failures only via onerror codes.
//  - Bangla (bn-BD) is not available on every device; we fall back to bn-IN, and the caller can switch to English.
//  - Mic permission, insecure origins, offline use and "said nothing" all need different human messages.
//  - Tests run without a microphone, so the recogniser class is injectable.

export const VOICE_LANGS = {
  bn: ["bn-BD", "bn-IN"],
  en: ["en-IN", "en-US"],
};

export function voiceSupport(win = globalThis) {
  const SR = win.SpeechRecognition || win.webkitSpeechRecognition || null;
  return { SR, supported: !!SR, secure: win.isSecureContext !== false };
}

/** 'granted' | 'denied' | 'prompt' | 'unknown' — never throws, never triggers a prompt. */
export async function micPermission(nav = globalThis.navigator) {
  try {
    if (!nav?.permissions?.query) return "unknown";
    const st = await nav.permissions.query({ name: "microphone" });
    return st.state;
  } catch { return "unknown"; }
}

/** Map a raw recogniser error code to something a person can act on. */
export function classifyError(code) {
  switch (code) {
    case "no-speech": return { key: "noSpeech", retry: true };
    case "aborted": return { key: "aborted", retry: true, silent: true };
    case "audio-capture": return { key: "audioCapture", retry: false };
    case "not-allowed": return { key: "notAllowed", retry: false };
    case "service-not-allowed": return { key: "serviceNotAllowed", retry: false };
    case "network": return { key: "network", retry: true };
    case "language-not-supported": return { key: "langUnsupported", retry: false };
    default: return { key: "unknown", retry: true };
  }
}

/**
 * One listening session. Create a new one per tap.
 *
 *   const s = new VoiceSession({ SR, lang: "bn" });
 *   s.start({ onState, onInterim, onFinal, onError });
 *   s.stop();    // finish now and deliver what was heard
 *   s.cancel();  // throw it away
 *
 * onState:   "starting" | "listening" | "hearing" | "processing"
 * onInterim: (text) — live words as they are recognised
 * onFinal:   ({ alternatives: [{ text, confidence }], lang }) — delivered exactly once
 * onError:   ({ code, key, retry, silent }) — delivered exactly once, never together with onFinal
 */
export class VoiceSession {
  constructor({ SR, lang = "bn", maxAlternatives = 5, noSpeechMs = 8000, maxMs = 20000 } = {}) {
    this.SR = SR;
    this.langKey = lang;
    this.tags = VOICE_LANGS[lang] || VOICE_LANGS.bn;
    this.maxAlternatives = maxAlternatives;
    this.noSpeechMs = noSpeechMs;
    this.maxMs = maxMs;
    this.done = false;
    this.tagIdx = 0;
    this.rec = null;
  }

  start(handlers) {
    this.h = handlers;
    if (!this.SR) return this._fail("unsupported");
    this._begin();
  }

  _begin() {
    let rec;
    try { rec = new this.SR(); } catch { return this._fail("unsupported"); }
    this.rec = rec;
    const tag = this.tags[this.tagIdx];
    const finals = []; // one entry per final result: array of alternatives
    let interim = "", err = null, heardSomething = false;

    rec.lang = tag;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = this.maxAlternatives;

    const clear = () => { clearTimeout(this._tNo); clearTimeout(this._tMax); };

    rec.onstart = () => {
      this._emitState("listening");
      this._tNo = setTimeout(() => { if (!heardSomething) this._safe(() => rec.stop()); }, this.noSpeechMs);
      this._tMax = setTimeout(() => this._safe(() => rec.stop()), this.maxMs);
    };
    rec.onspeechstart = () => { heardSomething = true; this._emitState("hearing"); };
    rec.onresult = (e) => {
      heardSomething = true;
      interim = "";
      finals.length = 0;
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finals.push(Array.from(r).map((a) => ({ text: (a.transcript || "").trim(), confidence: a.confidence })));
        else interim += (r[0]?.transcript || "") + " ";
      }
      const shown = [...finals.map((f) => f[0]?.text || ""), interim.trim()].filter(Boolean).join(" ");
      if (shown) this._safe(() => this.h.onInterim?.(shown));
    };
    rec.onerror = (e) => { err = e.error || "unknown"; };
    rec.onend = () => {
      clear();
      if (this.done || this.rec !== rec) return;
      // Language not available on this device → try the next tag before giving up.
      if (err === "language-not-supported" && this.tagIdx < this.tags.length - 1) {
        this.tagIdx++; this.rec = null; return this._begin();
      }
      const alternatives = this._alternatives(finals, interim);
      if (alternatives.length && (!err || err === "no-speech" || err === "aborted" || err === "network")) {
        this._emitState("processing");
        return this._deliver({ alternatives, lang: tag });
      }
      if (err) return this._fail(err);
      return this._fail("no-speech");
    };

    this._emitState("starting");
    try { rec.start(); } catch (ex) {
      // InvalidStateError when a previous session is still winding down
      this._fail(ex?.name === "NotAllowedError" ? "not-allowed" : "unknown");
    }
  }

  /** Combine per-result alternatives into whole-utterance candidates (best first). */
  _alternatives(finals, interim) {
    const out = [];
    if (finals.length) {
      const n = Math.max(...finals.map((f) => f.length));
      for (let k = 0; k < n; k++) {
        const text = finals.map((f) => (f[k] || f[0])?.text || "").join(" ").replace(/\s+/g, " ").trim();
        const conf = finals.reduce((s, f) => s + ((f[k] || f[0])?.confidence ?? 0), 0) / finals.length;
        if (text && !out.some((o) => o.text === text)) out.push({ text, confidence: conf });
      }
    }
    if (!out.length && interim.trim()) out.push({ text: interim.trim(), confidence: 0 });
    return out;
  }

  stop() { if (!this.done && this.rec) this._safe(() => this.rec.stop()); }

  cancel() {
    if (this.done) return;
    this.done = true;
    clearTimeout(this._tNo); clearTimeout(this._tMax);
    const r = this.rec; this.rec = null;
    if (r) this._safe(() => r.abort());
  }

  _emitState(s) { if (!this.done) this._safe(() => this.h.onState?.(s)); }
  _safe(fn) { try { fn(); } catch { /* recogniser already stopped */ } }

  _deliver(payload) {
    if (this.done) return;
    this.done = true;
    this._safe(() => this.h.onFinal?.(payload));
  }

  _fail(code) {
    if (this.done) return;
    this.done = true;
    clearTimeout(this._tNo); clearTimeout(this._tMax);
    const info = code === "unsupported" ? { key: "unsupported", retry: false } : classifyError(code);
    this._safe(() => this.h.onError?.({ code, ...info }));
  }
}

/* ───────────── speaking results aloud ───────────── */

export function ttsSupport(win = globalThis) {
  return !!(win.speechSynthesis && win.SpeechSynthesisUtterance);
}

function loadVoices(synth) {
  return new Promise((resolve) => {
    const have = synth.getVoices();
    if (have.length) return resolve(have);
    const done = () => resolve(synth.getVoices());
    synth.addEventListener?.("voiceschanged", done, { once: true });
    setTimeout(done, 900);
  });
}

/** Resolves { ok } or { ok:false, reason:"no-voice" } so the UI can hide the button instead of reading Bangla in an English voice. */
export async function speak(text, langKey = "bn", win = globalThis) {
  if (!ttsSupport(win)) return { ok: false, reason: "unsupported" };
  const synth = win.speechSynthesis;
  const voices = await loadVoices(synth);
  const wanted = langKey === "bn" ? "bn" : "en";
  const voice = voices.find((v) => v.lang?.toLowerCase().startsWith(wanted));
  if (!voice) return { ok: false, reason: "no-voice" };
  synth.cancel();
  const u = new win.SpeechSynthesisUtterance(text);
  u.voice = voice; u.lang = voice.lang; u.rate = 0.95;
  return new Promise((resolve) => {
    u.onend = () => resolve({ ok: true });
    u.onerror = () => resolve({ ok: false, reason: "error" });
    synth.speak(u);
  });
}

export function stopSpeaking(win = globalThis) { try { win.speechSynthesis?.cancel(); } catch { /* ignore */ } }

export async function hasVoiceFor(langKey, win = globalThis) {
  if (!ttsSupport(win)) return false;
  const voices = await loadVoices(win.speechSynthesis);
  return voices.some((v) => v.lang?.toLowerCase().startsWith(langKey === "bn" ? "bn" : "en"));
}
