// Small marks only: the logo, a crisp bus glyph and the colour each route is drawn in.
// No illustrations — the map and the data carry the screen.

/** Muted, print-safe route colours; every one has 4.5:1 contrast with white text. */
export const PALETTE = ["#0b7a52", "#1f6feb", "#c2410c", "#7c3aed", "#be185d", "#0e7490", "#4d7c0f", "#a16207", "#3949ab", "#b4237a"];

export function routeColor(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Front-on bus, one colour, drawn on a 24px grid. */
export function busGlyph(size = 20) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="4" y="3" width="16" height="15" rx="3.2"/><path d="M4 11h16"/><path d="M8 7h8"/><circle cx="8.2" cy="14.6" r=".9" fill="currentColor" stroke="none"/><circle cx="15.8" cy="14.6" r=".9" fill="currentColor" stroke="none"/><path d="M6.8 18v2.2M17.2 18v2.2"/></svg>`;
}

export function logoSVG(size = 32) {
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="9" fill="#0b7a52"/><g transform="translate(4 4)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="15" rx="3.2"/><path d="M4 11h16M8 7h8M6.8 18v2.2M17.2 18v2.2"/><circle cx="8.2" cy="14.6" r=".9" fill="#fff" stroke="none"/><circle cx="15.8" cy="14.6" r=".9" fill="#fff" stroke="none"/></g></svg>`;
}
