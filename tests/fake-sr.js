// Browser-side stand-in for the Web Speech API, so the whole voice flow can be driven without a microphone.
// Load it from the console:  await import('/tests/fake-sr.js').then(m => m.install({ final: [...] }))
// It replays interim words, then one final result with several alternatives — the same event
// shapes Chrome produces — and honours stop() / abort() like the real thing.

export function install(script = {}) {
  const cfg = window.__fake = {
    interims: ["মিরপুর", "মিরপুর ১০ থেকে", "মিরপুর ১০ থেকে মতি"],
    final: ["মিরপুর ১০ থেকে মতিঝিল", "মিরপুর ১০ থেকে মতিজিল"],
    step: 700, error: null, noEnd: false, started: 0, langs: [], ...script,
  };
  const mk = (alts, isFinal) => { const r = alts.map((t) => ({ transcript: t, confidence: 0.9 })); r.isFinal = isFinal; return r; };

  class FakeSR {
    start() {
      cfg.started++; cfg.langs.push(this.lang);
      this.t = [];
      const at = (ms, fn) => this.t.push(setTimeout(fn, ms));
      let ms = 150;
      if (cfg.unsupportedLang && cfg.unsupportedLang === this.lang) {
        at(ms, () => { this.onerror?.({ error: "language-not-supported" }); this.onend?.(); });
        return;
      }
      if (cfg.error === "not-allowed") { at(ms, () => { this.onerror?.({ error: "not-allowed" }); this.onend?.(); }); return; }
      at(ms, () => this.onstart?.());
      if (cfg.error === "no-speech") { ms += 1200; at(ms, () => { this.onerror?.({ error: "no-speech" }); this.onend?.(); }); return; }
      ms += 350; at(ms, () => this.onspeechstart?.());
      for (const i of cfg.interims) { ms += cfg.step; at(ms, () => this.onresult?.({ resultIndex: 0, results: [mk([i], false)] })); }
      ms += cfg.step; at(ms, () => this.onresult?.({ resultIndex: 0, results: [mk(cfg.final, true)] }));
      if (!cfg.noEnd) { ms += 120; at(ms, () => this.onend?.()); }
    }
    stop() {
      this.t.forEach(clearTimeout);
      setTimeout(() => { this.onresult?.({ resultIndex: 0, results: [mk(cfg.final, true)] }); this.onend?.(); }, 40);
    }
    abort() { this.t.forEach(clearTimeout); setTimeout(() => this.onend?.(), 0); }
  }
  window.FakeSR = FakeSR;
  if (window.__kj) window.__kj.V.support = { SR: FakeSR, supported: true, secure: true };
  else window.webkitSpeechRecognition = FakeSR;
  return cfg;
}
