// The journey map: OpenStreetMap tiles laid out by hand, with the whole trip drawn on top —
// you → boarding stop → the bus's real stop-to-stop path → get-off stop → destination.
// No panning and no libraries. It draws only once the box has a real size (so the picture and
// the tiles always agree) and again if the box is resized.

const TILE = 256;
const NS = "http://www.w3.org/2000/svg";

const worldPx = (lat, lng, z) => {
  const scale = TILE * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return { x: ((lng + 180) / 360) * scale, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale };
};

function pickZoom(points, w, h, padX, padTop, padBottom) {
  for (let z = 17; z >= 10; z--) {
    const px = points.map((p) => worldPx(p.lat, p.lng, z));
    const xs = px.map((p) => p.x), ys = px.map((p) => p.y);
    if (Math.max(...xs) - Math.min(...xs) <= w - padX * 2 && Math.max(...ys) - Math.min(...ys) <= h - padTop - padBottom) return z;
  }
  return 10;
}

const el = (name, attrs = {}, kids = []) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) n.append(k);
  return n;
};
const label = (text, x, y, anchor = "middle", cls = "") => {
  const t = el("text", { x: x.toFixed(1), y: y.toFixed(1), "text-anchor": anchor, class: `map-label ${cls}` });
  t.textContent = text;
  return t;
};
const miles = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * @param {HTMLElement} box   needs a CSS height; width comes from layout
 * @param {object} data       { you?, board, alight, dest?, path: [{lat,lng}], color, accuracy?, walkFrom?: bool }
 * @param {object} opts       { tileUrl, attribution, attributionUrl, label, names: {board, alight}, legend: {walk, bus}, still }
 */
export function mountJourneyMap(box, data, opts) {
  let lastW = 0, timer = 0;
  const draw = () => {
    const w = Math.round(box.clientWidth), h = Math.round(box.clientHeight);
    if (!w || !h || w === lastW) return;
    lastW = w;
    paint(box, data, opts, w, h);
  };
  const ro = new ResizeObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 60); });
  ro.observe(box);
  draw();
  return () => ro.disconnect();
}

function paint(box, data, opts, w, h) {
  box.replaceChildren();
  const { you, board, alight, dest } = data;
  const walkOnly = !!data.walkOnly;
  const path = walkOnly ? [] : data.path?.length > 1 ? data.path : [board, alight];
  const marks = [you, dest, board, alight, ...path, ...(data.base || [])].filter(Boolean);
  const padX = 34, padTop = 58, padBottom = 40;
  const z = pickZoom(marks, w, h, padX, padTop, padBottom);
  const px = marks.map((m) => worldPx(m.lat, m.lng, z));
  const minX = Math.min(...px.map((p) => p.x)), maxX = Math.max(...px.map((p) => p.x));
  const minY = Math.min(...px.map((p) => p.y)), maxY = Math.max(...px.map((p) => p.y));
  // centre the trip in the free area (leaving room above for labels, below for the legend)
  const left = (minX + maxX) / 2 - w / 2;
  const top = (minY + maxY) / 2 - (padTop + (h - padTop - padBottom) / 2);
  const at = (m) => { const p = worldPx(m.lat, m.lng, z); return { x: p.x - left, y: p.y - top }; };

  const layer = document.createElement("div");
  layer.className = "map-tiles";
  layer.setAttribute("aria-hidden", "true");
  const n = 2 ** z;
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const img = document.createElement("img");
      img.alt = "";
      img.decoding = "async";
      img.width = img.height = TILE;
      img.style.transform = `translate(${Math.round(tx * TILE - left)}px, ${Math.round(ty * TILE - top)}px)`;
      img.src = opts.tileUrl.replace("{z}", z).replace("{x}", ((tx % n) + n) % n).replace("{y}", ty);
      img.onload = () => img.classList.add("in");
      img.onerror = () => img.remove();
      layer.append(img);
    }
  }

  const svg = el("svg", { class: "map-overlay", viewBox: `0 0 ${w} ${h}`, role: "img", "aria-label": opts.label });
  const color = data.color || "#17a468";
  const line = (pts) => pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const P = path.map(at);
  const d = line(P);
  const B = board ? at(board) : null, A = alight ? at(alight) : null;

  // walking legs
  const walk = (p, q) => svg.append(el("path", { d: line([p, q]), class: "map-walk" }));
  if (walkOnly) { if (you && dest) walk(at(you), at(dest)); }
  else {
    if (you && miles(at(you), B) > 8) walk(at(you), B);
    if (dest && miles(A, at(dest)) > 8) walk(A, at(dest));
  }

  // the bus path (the rest of the route, if given, sits faintly underneath)
  if (data.base?.length > 1) svg.append(el("path", { d: line(data.base.map(at)), class: "map-route-base", stroke: color }));
  if (!walkOnly) {
    svg.append(el("path", { d, class: "map-route-halo" }), el("path", { d, class: "map-route", stroke: color, pathLength: "1" }));
    P.slice(1, -1).forEach((p) => svg.append(el("circle", { cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: 3.4, class: "map-dot", stroke: color })));
  }

  // you / destination
  if (you) {
    const p = at(you);
    const g = el("g", { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})` });
    if (data.accuracy && data.accuracy > 30) {
      const r = Math.min(120, data.accuracy * (2 ** z) * TILE / (40075016.686 * Math.cos((you.lat * Math.PI) / 180)));
      g.append(el("circle", { r: r.toFixed(1), class: "map-acc" }));
    }
    g.append(el("circle", { r: 15, class: "map-you-ring" }), el("circle", { r: 7.5, class: "map-you" }));
    svg.append(g);
  }
  if (dest) {
    const p = at(dest);
    const g = el("g", { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})` });
    g.append(el("path", { d: "M0 0 C-10 -12 -11 -17 -11 -21 a11 11 0 0 1 22 0 c0 4 -1 9 -11 21Z", class: "map-dest" }), el("circle", { cy: -21, r: 4.2, fill: "#fff" }));
    svg.append(g);
  }

  // stop markers with their names
  const crowd = !walkOnly && Math.abs(B.x - A.x) < 120 && Math.abs(B.y - A.y) < 26;
  const marker = (p, kind) => {
    const g = el("g", { transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`, class: `map-pin map-pin--${kind}` });
    g.append(el("circle", { r: 13, class: "map-pin-c" }));
    g.append(kind === "on"
      ? el("path", { d: "M-5.4 -5.2h10.8a1.6 1.6 0 0 1 1.6 1.6v6.6h-14v-6.6a1.6 1.6 0 0 1 1.6-1.6ZM-7 -0.6h14M-4.2 4.4v2M4.2 4.4v2", class: "map-pin-g" })
      : el("path", { d: "M-4.6 7V-6.4M-4.6 -6h9.6l-2.4 3.4 2.4 3.4h-9.6", class: "map-pin-g" }));
    return g;
  };
  const place = (p, text, kind) => {
    const anchor = crowd ? (kind === "on" ? "end" : "start") : "middle";
    const x = crowd ? p.x + (kind === "on" ? -18 : 18) : p.x;
    const y = crowd ? p.y + 5 : p.y - 22;
    svg.append(label(text, Math.max(8, Math.min(w - 8, x)), Math.max(16, y), anchor, `map-label--${kind}`));
  };
  if (!walkOnly) {
    svg.append(marker(B, "on"), marker(A, "off"));
    place(B, opts.names.board, "on");
    place(A, opts.names.alight, "off");
  }

  // the little bus riding the route
  if (!opts.still && P.length > 1 && !walkOnly) {
    const dur = Math.max(5, Math.min(11, P.reduce((s, p, i) => s + (i ? miles(p, P[i - 1]) : 0), 0) / 55)).toFixed(1);
    const bus = el("g", { class: "map-bus" }, [
      el("rect", { x: -13, y: -8.5, width: 26, height: 16, rx: 5, fill: color, stroke: "#fff", "stroke-width": 2.4 }),
      el("rect", { x: -9.5, y: -5, width: 19, height: 6, rx: 1.8, fill: "#e6f6ff" }),
      el("circle", { cx: -6, cy: 5, r: 1.5, fill: "#fff" }), el("circle", { cx: 6, cy: 5, r: 1.5, fill: "#fff" }),
    ]);
    const m = el("animateMotion", { dur: `${dur}s`, repeatCount: "indefinite", path: d, calcMode: "linear" });
    bus.append(m);
    svg.append(bus);
  }

  const legend = document.createElement("div");
  legend.className = "map-legend";
  if (!walkOnly) {
    legend.innerHTML = `<span class="lg lg--bus" style="--c:${color}"></span>`;
    legend.append(opts.legend.bus);
  }
  if (walkOnly || (you && miles(at(you), B) > 8) || (dest && miles(A, at(dest)) > 8)) {
    const s = document.createElement("span");
    s.className = "lg lg--walk";
    legend.append(s, opts.legend.walk);
  }

  const credit = document.createElement("a");
  credit.className = "map-credit";
  credit.href = opts.attributionUrl;
  credit.target = "_blank";
  credit.rel = "noopener";
  credit.textContent = opts.attribution;

  box.append(layer, svg, legend, credit);
}
