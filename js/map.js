// The map: slippy-map tiles laid out by hand, with the trip (or the whole bus network) drawn on top.
// No panning and no libraries. It draws only once its box has a real size — so tiles and overlay
// always agree — and again if the box is resized.

const TILE = 256;
const NS = "http://www.w3.org/2000/svg";

const worldPx = (lat, lng, z) => {
  const scale = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
};

function pickZoom(points, w, h, padX, padTop, padBottom) {
  for (let z = 17; z >= 9; z--) {
    const px = points.map((p) => worldPx(p.lat, p.lng, z));
    const xs = px.map((p) => p.x), ys = px.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) <= w - padX * 2 && Math.max(...ys) - Math.min(...ys) <= h - padTop - padBottom) return z;
  }
  return 9;
}

const el = (name, attrs = {}, kids = []) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) n.append(k);
  return n;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Catmull-Rom through the stops: the same points, without the sharp corners of a straight-line join. */
function curve(pts) {
  if (pts.length < 3) return pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    d += ` C${(p1.x + (p2.x - p0.x) / 6).toFixed(1)} ${(p1.y + (p2.y - p0.y) / 6).toFixed(1)} ${(p2.x - (p3.x - p1.x) / 6).toFixed(1)} ${(p2.y - (p3.y - p1.y) / 6).toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}
const line = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

/** Redraw whenever the box gets a (new) size. Returns a function that stops watching. */
function watch(box, paint) {
  let lw = 0, lh = 0, timer = 0;
  const draw = () => {
    const w = Math.round(box.clientWidth), h = Math.round(box.clientHeight);
    if (!w || !h || (w === lw && h === lh)) return;
    lw = w; lh = h;
    box.replaceChildren();
    paint(w, h);
  };
  const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 60); });
  ro.observe(box);
  draw();
  return () => { clearTimeout(timer); ro.disconnect(); };
}

function tileLayer(opts, z, left, top, w, h) {
  const layer = document.createElement("div");
  layer.className = "map-tiles";
  layer.setAttribute("aria-hidden", "true");
  const n = 2 ** z, retina = (window.devicePixelRatio || 1) > 1.4;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const x = ((tx % n) + n) % n;
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.width = img.height = TILE;
      img.style.transform = `translate(${Math.round(tx * TILE - left)}px, ${Math.round(ty * TILE - top)}px)`;
      img.src = opts.tileUrl.replace("{s}", "abcd"[(x + ty) % 4]).replace("{z}", z).replace("{x}", x).replace("{y}", ty).replace("{r}", retina ? "@2x" : "");
      img.onload = () => img.classList.add("in");
      img.onerror = () => img.remove(); // offline: the soft backdrop and the overlay still work
      layer.append(img);
    }
  }
  return layer;
}

function credit(opts) {
  const a = document.createElement("a");
  a.className = "map-credit";
  a.href = opts.attributionUrl;
  a.target = "_blank";
  a.rel = "noopener";
  a.textContent = opts.attribution;
  return a;
}

/** A label on a white pill, kept inside the box. */
function pill(svg, text, x, y, anchor, w, cls = "") {
  const g = el("g", { class: `map-pill ${cls}` });
  const t = el("text", { x: 9, y: 0, class: "map-pill__t" });
  t.textContent = text;
  g.append(t);
  svg.append(g);
  const b = t.getBBox();
  const W = b.width + 18, H = b.height + 8;
  g.insertBefore(el("rect", { x: 0, y: b.y - 4, width: W.toFixed(1), height: H.toFixed(1), rx: (H / 2).toFixed(1) }), t);
  const left = Math.max(6, Math.min(w - 6 - W, anchor === "end" ? x - W : anchor === "start" ? x : x - W / 2));
  g.setAttribute("transform", `translate(${left.toFixed(1)} ${(y - (b.y + b.height / 2)).toFixed(1)})`);
}

const PIN = {
  on: "M-5.4 -5.4h10.8a1.7 1.7 0 0 1 1.7 1.7v6.9h-14.2v-6.9a1.7 1.7 0 0 1 1.7-1.7ZM-7.1 -0.7h14.2M-4.3 4.6v1.9M4.3 4.6v1.9",
  off: "M-4.6 7V-6.4M-4.6 -6h9.6l-2.4 3.5 2.4 3.5h-9.6",
};

/**
 * The trip: you → boarding stop → the bus's stop-to-stop path → get-off stop → destination.
 * @param {object} data  { you?, board?, alight?, dest?, path?: [{lat,lng}], base?, color, accuracy?, walkOnly? }
 * @param {object} opts  { tileUrl, attribution, attributionUrl, label, names: {board, alight}, legend: {bus, walk}, still, padTop, padBottom }
 */
export function mountJourneyMap(box, data, opts) {
  return watch(box, (w, h) => {
    const { you, board, alight, dest } = data;
    const walkOnly = !!data.walkOnly;
    const path = walkOnly ? [] : data.path?.length > 1 ? data.path : [board, alight];
    const marks = [you, dest, board, alight, ...path].filter(Boolean); // the faint base route may run off the edge
    const padX = 40, padTop = opts.padTop ?? 64, padBottom = opts.padBottom ?? 44;
    const z = Math.min(pickZoom(marks, w, h, padX, padTop, padBottom), 16);
    const px = marks.map((m) => worldPx(m.lat, m.lng, z));
    const minX = Math.min(...px.map((p) => p.x)), maxX = Math.max(...px.map((p) => p.x));
    const minY = Math.min(...px.map((p) => p.y)), maxY = Math.max(...px.map((p) => p.y));
    const left = (minX + maxX) / 2 - w / 2;
    const top = (minY + maxY) / 2 - (padTop + (h - padTop - padBottom) / 2);
    const at = (m) => { const p = worldPx(m.lat, m.lng, z); return { x: p.x - left, y: p.y - top }; };

    const svg = el("svg", { class: "map-overlay", viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": opts.label });
    const color = data.color || "#0b7a52";
    const P = path.map(at);
    const d = curve(P);
    const B = board ? at(board) : null, A = alight ? at(alight) : null;

    const walk = (p, q) => svg.append(el("path", { d: line([p, q]), class: "map-walk-halo" }), el("path", { d: line([p, q]), class: "map-walk" }));
    if (walkOnly) { if (you && dest) walk(at(you), at(dest)); }
    else {
      if (you && dist(at(you), B) > 8) walk(at(you), B);
      if (dest && dist(A, at(dest)) > 8) walk(A, at(dest));
    }

    if (data.base?.length > 1) svg.append(el("path", { d: curve(data.base.map(at)), class: "map-route-base", stroke: color }));
    if (!walkOnly) {
      svg.append(el("path", { d, class: "map-route-halo" }), el("path", { d, class: "map-route", stroke: color, pathLength: "1" }));
      if (!opts.still) svg.append(el("path", { d, class: "map-flow" }));
      P.slice(1, -1).forEach((p) => svg.append(el("circle", { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 3.2, class: "map-dot", stroke: color })));
    }

    if (you) {
      const p = at(you);
      const g = el("g", { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})` });
      if (data.accuracy && data.accuracy > 30) {
        const r = Math.min(120, (data.accuracy * (2 ** z) * TILE) / (40075016.686 * Math.cos((you.lat * Math.PI) / 180)));
        g.append(el("circle", { r: r.toFixed(1), class: "map-acc" }));
      }
      g.append(el("circle", { r: 16, class: "map-you-ring" }), el("circle", { r: 7.5, class: "map-you" }));
      svg.append(g);
    }
    if (dest) {
      const p = at(dest);
      const g = el("g", { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, class: "map-drop" });
      g.append(el("path", { d: "M0 0 C-10 -12 -11 -17 -11 -21 a11 11 0 0 1 22 0 c0 4 -1 9 -11 21Z", class: "map-dest" }), el("circle", { cy: -21, r: 4.2, fill: "#fff" }));
      svg.append(g);
    }

    const pin = (p, kind) => {
      const g = el("g", { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, class: `map-drop map-pin map-pin--${kind}` });
      g.append(el("circle", { r: 13, class: "map-pin-c" }), el("path", { d: PIN[kind], class: "map-pin-g" }));
      return g;
    };
    const box0 = document.createElement("div");
    box0.className = "map-world";
    box0.append(tileLayer(opts, z, left, top, w, h), svg);
    box.append(box0);
    if (!walkOnly) {
      svg.append(pin(B, "on"), pin(A, "off"));
      const crowd = Math.abs(B.x - A.x) < 130 && Math.abs(B.y - A.y) < 30;
      pill(svg, opts.names.board, crowd ? B.x - 20 : B.x, crowd ? B.y : B.y - 28, crowd ? "end" : "middle", w, "map-pill--on");
      pill(svg, opts.names.alight, crowd ? A.x + 20 : A.x, crowd ? A.y : A.y - 28, crowd ? "start" : "middle", w, "map-pill--off");
    }

    const legend = document.createElement("div");
    legend.className = "map-legend";
    if (!walkOnly) {
      const sw = document.createElement("span");
      sw.className = "lg lg--bus";
      sw.style.setProperty("--c", color);
      legend.append(sw, opts.legend.bus);
    }
    if (walkOnly || (you && dist(at(you), B) > 8) || (dest && dist(A, at(dest)) > 8)) {
      const s = document.createElement("span");
      s.className = "lg lg--walk";
      legend.append(s, opts.legend.walk);
    }
    box.append(legend, credit(opts));
  });
}

/**
 * The home map: a slice of Dhaka with the bus stops appearing outward from the centre.
 * (Stops, not buses — nothing here claims to be live.)
 * @param {object} data  { center: {lat,lng}, stops: [{lat,lng}] }
 */
export function mountNetworkMap(box, data, opts) {
  return watch(box, (w, h) => {
    const z = w < 700 ? 12 : 13;
    const c = worldPx(data.center.lat, data.center.lng, z);
    const left = c.x - w / 2, top = c.y - h * 0.42;
    const svg = el("svg", { class: "map-overlay", viewBox: `0 0 ${w} ${h}`, "aria-hidden": "true" });
    for (const s of data.stops) {
      const p = worldPx(s.lat, s.lng, z);
      const x = p.x - left, y = p.y - top;
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
      const delay = (Math.hypot(x - w / 2, y - h * 0.42) / 260 + Math.random() * 0.25).toFixed(2);
      svg.append(el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 4.2, class: "net-stop", style: `animation-delay:${delay}s` }));
    }
    const world = document.createElement("div");
    world.className = "map-world map-world--drift";
    world.append(tileLayer(opts, z, left, top, w, h), svg);
    box.append(world, credit(opts));
  });
}
