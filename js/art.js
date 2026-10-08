// All the drawing: painted Dhaka buses, a rickshaw, the logo and the moving street scene.
// Everything is inline SVG driven by CSS variables, so dark mode and each bus's paint job
// come from CSS and nothing extra has to load.

const INK = "#1b1a2e";

/** Six paint jobs, loosely after the buses that actually run in Dhaka. */
export const PAINTS = [
  { name: "sobuj",  b1: "#17a468", band: "#f6f1e1", s1: "#ffc62b", s2: "#f0502d", roof: "#0e7a4c" },
  { name: "golapi", b1: "#ea5aa0", band: "#222a7a", s1: "#ffffff", s2: "#ffc62b", roof: "#1b1a2e" },
  { name: "holud",  b1: "#ffc62b", band: "#f0502d", s1: "#ffffff", s2: "#1b1a2e", roof: "#d9482a" },
  { name: "neel",   b1: "#2d7ff9", band: "#ffffff", s1: "#ffc62b", s2: "#f0502d", roof: "#1a4fb5" },
  { name: "komola", b1: "#f28a2e", band: "#222a7a", s1: "#ffd66b", s2: "#ffffff", roof: "#bf5d17" },
  { name: "beguni", b1: "#7a4ce0", band: "#f6f1e1", s1: "#ffc62b", s2: "#ff7ab6", roof: "#4b2aa0" },
];

export function paintFor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PAINTS[h % PAINTS.length];
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const graphemes = (s) => { try { return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].length; } catch { return [...s].length; } };
const SKIN = ["#f1c9a0", "#d79b6b", "#b97a4b", "#8d5a34", "#e8b88d"];
const SHIRT = ["#2d7ff9", "#f0502d", "#ffffff", "#17a468", "#ffc62b", "#7a4ce0"];

/**
 * A side-on Dhaka bus facing right.
 * mode: "live" keeps wheels turning, "drive" turns them while it arrives, "still" parks it.
 */
export function busSVG({ paint = PAINTS[0], name = "", riders = 4, mode = "still", beam = false, cls = "" } = {}) {
  const P = paint;
  const panes = [];
  for (let i = 0; i < 5; i++) {
    const x = 25 + i * 26;
    const has = i < riders && ((i * 7 + 3) % 5 !== 1 || riders > 3);
    panes.push(`<rect x="${x}" y="25" width="23" height="25" rx="3.5" class="b-glass"/>`);
    if (has) {
      const sk = SKIN[(i * 3 + 1) % SKIN.length], sh = SHIRT[(i * 5 + 2) % SHIRT.length];
      panes.push(`<g class="b-rider" style="--d:${(i * 0.17).toFixed(2)}s"><circle cx="${x + 11.5}" cy="39" r="4.6" fill="${sk}"/><path d="M${x + 3.5} 50 Q${x + 11.5} 40.5 ${x + 19.5} 50Z" fill="${sh}"/></g>`);
    }
    panes.push(`<path d="M${x + 3} 49 L${x + 14} 26 H${x + 19} L${x + 8} 49Z" class="b-shine"/>`);
  }
  const wheel = (cx) => `<g transform="translate(${cx} 90)"><circle r="14.5" fill="${INK}"/><g class="b-spin"><circle r="8.6" fill="#dfe3ea"/><path d="M0-8.4V8.4M-8.4 0H8.4M-5.9-5.9 5.9 5.9M5.9-5.9-5.9 5.9" stroke="#9aa3b2" stroke-width="1.6"/><circle r="2.6" fill="${INK}"/></g></g>`;
  let plate = "";
  if (name) {
    const long = graphemes(name) * 7.8 > 108;
    plate = `<rect x="28" y="56" width="124" height="18.5" rx="9.2" class="b-plate"/><text x="90" y="69.6" text-anchor="middle" class="b-name" ${long ? 'textLength="108" lengthAdjust="spacingAndGlyphs"' : ""}>${esc(name)}</text>`;
  }
  const outline = "M20 88 L14 30 Q14 16 28 16 H180 Q192 16 200 24 L238 54 Q248 60 248 72 V84 Q248 90 242 90 H26 Q20 90 20 88Z";
  return `<svg class="bus-art bus-art--${mode} ${cls}" viewBox="0 0 260 112" style="--b1:${P.b1};--band:${P.band};--s1:${P.s1};--s2:${P.s2};--roof:${P.roof}" aria-hidden="true" focusable="false">
<ellipse cx="130" cy="107" rx="116" ry="3.6" class="b-shadow"/>
<g class="b-puffs"><circle cx="7" cy="80" r="3"/><circle cx="7" cy="80" r="3"/><circle cx="7" cy="80" r="3"/></g>
<g class="b-all">
${beam ? `<path class="b-beam" d="M248 62 L330 40 L330 100 L248 78Z"/>` : ""}
<path class="b-body" d="${outline}"/>
<path class="b-band" d="M17.3 60 H238 Q247 62 248 72 V84 Q248 90 242 90 H26 Q20 90 20 88Z"/>
<path d="M118 90 Q196 88 246 58 V68 Q214 90 176 90Z" fill="var(--s1)"/>
<path d="M150 90 Q206 86 247 68 V76 Q220 90 190 90Z" fill="var(--s2)"/>
<rect x="21" y="10" width="172" height="9" rx="4.5" fill="var(--roof)" stroke="${INK}" stroke-width="2"/>
<rect x="22" y="22" width="134" height="31" rx="5" fill="${INK}"/>
${panes.join("")}
<g><rect x="159" y="22" width="26" height="62" rx="3" class="b-door"/><rect x="162" y="25" width="9.5" height="29" rx="2" class="b-glass"/><rect x="173" y="25" width="9.5" height="29" rx="2" class="b-glass"/><path d="M172.3 25V84" stroke="${INK}" stroke-width="1.6"/><rect x="167" y="66" width="11" height="3" rx="1.5" fill="${INK}"/></g>
<path d="M190 24 H198 Q203 24 207 28 L234 54 H190Z" class="b-glass"/>
<path d="M192 50 L204 26 H208 L196 50Z" class="b-shine"/>
<g class="b-driver"><circle cx="199" cy="42.5" r="4.8" fill="#c58a5b"/><path d="M193.5 38.6 Q199 33.6 204.6 38.6Z" fill="${INK}"/></g>
<path d="M205 36 L213 34 V45 L205 44Z" fill="${INK}"/>
${plate}
<path d="${outline}" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
<ellipse cx="242.5" cy="69.5" rx="4.2" ry="5.4" class="b-light"/>
<rect x="13" y="64" width="5" height="11" rx="1.6" fill="#f0502d"/>
<rect x="239" y="83" width="11" height="5.5" rx="2.2" fill="${INK}"/>
<path d="M44 90 A18 18 0 0 1 80 90Z M184 90 A18 18 0 0 1 220 90Z" fill="${INK}"/>
${wheel(62)}${wheel(202)}
</g>
</svg>`;
}

/** A cycle rickshaw facing left. */
export function rickshawSVG({ hood = "#f0502d", hood2 = "#ffc62b", cls = "" } = {}) {
  const wheel = (cx) => `<g transform="translate(${cx} 66)"><g class="b-spin"><circle r="11" fill="none" stroke="${INK}" stroke-width="2.6"/><path d="M0-11V11M-11 0H11M-7.8-7.8 7.8 7.8M7.8-7.8-7.8 7.8" stroke="${INK}" stroke-width="1"/></g></g>`;
  return `<svg class="rick-art ${cls}" viewBox="0 0 120 84" aria-hidden="true" focusable="false">
<ellipse cx="60" cy="80" rx="48" ry="2.6" class="b-shadow"/>
<g class="r-all">
<path d="M58 40 Q58 14 86 14 Q108 14 108 40Z" fill="${hood}" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
<path d="M72 15 Q68 26 68 40M86 14 V40M100 17 Q104 28 104 40" stroke="${hood2}" stroke-width="3" fill="none"/>
<rect x="62" y="40" width="46" height="14" rx="4" fill="${hood2}" stroke="${INK}" stroke-width="2.4"/>
<circle cx="88" cy="30" r="5" fill="#b97a4b"/><path d="M80 40 Q88 29 96 40Z" fill="#2d7ff9"/>
<path d="M62 54 L40 54 L28 36 H20" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
<g class="r-rider"><circle cx="24" cy="24" r="5.2" fill="#d79b6b"/><path d="M16 40 Q23 26 31 36 L34 44 L28 46Z" fill="#ffffff" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/></g>
${wheel(34)}${wheel(96)}
</g></svg>`;
}

/** The app mark: a bus seen from the front, on a yellow sun. */
export function logoSVG(size = 36) {
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="19" fill="#ffc62b" stroke="${INK}" stroke-width="2.4"/><rect x="9.5" y="9" width="21" height="20" rx="5" fill="#17a468" stroke="${INK}" stroke-width="2.4"/><rect x="12.5" y="12.5" width="15" height="8.5" rx="2.4" fill="#cfeeff" stroke="${INK}" stroke-width="1.8"/><circle cx="14.6" cy="25.2" r="1.9" fill="#ffc62b" stroke="${INK}" stroke-width="1.2"/><circle cx="25.4" cy="25.2" r="1.9" fill="#ffc62b" stroke="${INK}" stroke-width="1.2"/><path d="M13 31.5v3M27 31.5v3" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/></svg>`;
}

/* ───────────── the street scene ───────────── */

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Buildings that add up to exactly `w`, so copies placed side by side join without a seam. */
function skyline({ seed, w = 600, h, min, max, cls, windows = false, towers = false }) {
  const r = rng(seed);
  const widths = [];
  for (let x = 0; x < w;) { const bw = 26 + Math.round(r() * 34); widths.push(bw); x += bw; }
  const k = w / widths.reduce((a, b) => a + b, 0);
  let x = 0, out = "";
  for (const raw of widths) {
    const bw = raw * k, bh = Math.round(min + r() * (max - min));
    out += `<rect x="${x.toFixed(1)}" y="${h - bh}" width="${(bw + 0.6).toFixed(1)}" height="${bh}" class="${cls}"/>`;
    if (towers && r() > 0.55) out += `<path d="M${(x + bw / 2).toFixed(1)} ${h - bh}v-${6 + Math.round(r() * 12)}" class="ant"/>`;
    if (windows) {
      const cols = Math.max(1, Math.floor((bw - 8) / 9)), rows = Math.floor((bh - 10) / 11);
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) if (r() > 0.42)
        out += `<rect x="${(x + 5 + i * 9).toFixed(1)}" y="${h - bh + 7 + j * 11}" width="4.6" height="6" rx="1" class="win ${r() > 0.8 ? "win--on" : ""}"/>`;
    }
    x += bw;
  }
  return out;
}

const mosque = (x, base) => `<g transform="translate(${x} ${base})" class="mq"><rect x="-30" y="-30" width="60" height="30"/><path d="M-22 -30 A22 22 0 0 1 22 -30Z"/><rect x="-1.2" y="-60" width="2.4" height="9"/><rect x="-44" y="-62" width="9" height="62"/><path d="M-46 -62 L-39.5 -76 L-33 -62Z"/><rect x="35" y="-62" width="9" height="62"/><path d="M33 -62 L39.5 -76 L46 -62Z"/><path class="mq-door" d="M-7 0 V-12 A7 7 0 0 1 7 -12 V0Z"/></g>`;

export function heroScene() {
  const far = `<svg class="sc-svg" viewBox="0 0 600 110" width="600" height="110">${skyline({ seed: 7, h: 110, min: 40, max: 98, cls: "bld-far", towers: true })}</svg>`;
  let flyover = `<rect x="0" y="86" width="600" height="9" class="fly"/><rect x="0" y="82" width="600" height="4" class="fly-rail"/>`;
  for (let x = 0; x < 600; x += 150) flyover += `<rect x="${x + 70}" y="95" width="9" height="45" class="fly"/>`;
  const mid = `<svg class="sc-svg" viewBox="0 0 600 140" width="600" height="140">${skyline({ seed: 21, h: 140, min: 48, max: 118, cls: "bld-mid", windows: true, towers: true })}${mosque(300, 140)}${flyover}</svg>`;
  const trees = [40, 214, 392, 540].map((x, i) => `<g transform="translate(${x} 84)"><rect x="-2.5" y="-30" width="5" height="30" class="trunk"/><circle cx="0" cy="-42" r="${i % 2 ? 17 : 21}" class="leaf"/><circle cx="-11" cy="-34" r="11" class="leaf"/><circle cx="12" cy="-35" r="12" class="leaf"/></g>`).join("");
  const poles = [120, 480].map((x) => `<g transform="translate(${x} 84)"><rect x="-1.5" y="-62" width="3" height="62" class="pole"/><path d="M0 -62 H13" class="pole-arm"/><circle cx="14" cy="-60" r="3.6" class="lamp"/></g>`).join("");
  const board = `<g transform="translate(300 84)"><rect x="-34" y="-52" width="68" height="24" rx="4" class="board"/><rect x="-1.5" y="-28" width="3" height="28" class="pole"/><rect x="-24" y="-28" width="3" height="28" class="pole"/><rect x="21" y="-28" width="3" height="28" class="pole"/><text x="0" y="-35" text-anchor="middle" class="board-t">কেমনে যাবো?</text></g>`;
  const near = `<svg class="sc-svg" viewBox="0 0 600 84" width="600" height="84">${trees}${poles}${board}</svg>`;
  const rep = (svg) => svg.repeat(6);
  return `<div class="scene" aria-hidden="true">
  <div class="sc-sky"><span class="sc-sun"></span><span class="sc-cloud c1"></span><span class="sc-cloud c2"></span><span class="sc-cloud c3"></span><span class="sc-stars"></span></div>
  <div class="sc-layer sc-far"><div class="track" style="--p:600px;--t:150s">${rep(far)}</div></div>
  <div class="sc-layer sc-mid"><div class="track" style="--p:600px;--t:70s">${rep(mid)}</div></div>
  <div class="sc-layer sc-near"><div class="track" style="--p:600px;--t:26s">${rep(near)}</div></div>
  <div class="sc-road"><div class="lane"></div></div>
  <div class="sc-veh sc-pass">${busSVG({ paint: PAINTS[1], riders: 5, mode: "live", beam: true })}</div>
  <div class="sc-veh sc-rick">${rickshawSVG()}</div>
  <button class="sc-veh sc-hero" type="button" tabindex="-1" aria-hidden="true">${busSVG({ paint: PAINTS[0], name: "কেমনে যাবো", riders: 5, mode: "live", beam: true })}<span class="honk" data-honk>পিঁ পিঁ!</span></button>
</div>`;
}

/** A short two-note horn on tap. Silent if the browser blocks audio. */
let ac;
export function honk() {
  try {
    ac = ac || new (window.AudioContext || window.webkitAudioContext)();
    const now = ac.currentTime;
    [0, 0.2].forEach((d, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "square"; o.frequency.value = i ? 392 : 330;
      g.gain.setValueAtTime(0.0001, now + d);
      g.gain.exponentialRampToValueAtTime(0.05, now + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.16);
      o.connect(g).connect(ac.destination);
      o.start(now + d); o.stop(now + d + 0.18);
    });
  } catch { /* no sound is fine */ }
}
