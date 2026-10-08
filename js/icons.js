// One consistent icon set: 24px grid, 2px round stroke, drawn inline so nothing extra loads.
const P = {
  mic: '<path d="M12 2.5a3.2 3.2 0 0 0-3.2 3.2v6.1a3.2 3.2 0 0 0 6.4 0V5.7A3.2 3.2 0 0 0 12 2.5Z"/><path d="M19 10.8v1a7 7 0 0 1-14 0v-1"/><path d="M12 18.8v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  locate: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.6"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  swap: '<path d="M7 4v16"/><path d="m3 8 4-4 4 4"/><path d="M17 20V4"/><path d="m13 16 4 4 4-4"/>',
  walk: '<circle cx="13.5" cy="4.5" r="2"/><path d="m9 21 2.2-6.2-2.5-2.3 1.6-5 3.4 1.5 2.3 3.2 2.5.4"/><path d="m14.2 9.7-.6 3.6 2.6 2.3 1 5.4"/><path d="m8.7 12.5-3 .2"/>',
  rickshaw: '<circle cx="5.5" cy="17" r="3.2"/><circle cx="18.5" cy="17" r="2.4"/><path d="M5.5 17 9 8.5h6l2.2 8.5"/><path d="M9 8.5C9 5.5 11 4 14 4"/><path d="M12 17h4.6"/>',
  bus: '<rect x="3" y="3.5" width="18" height="14.5" rx="3"/><path d="M3 11h18"/><path d="M7.5 7.2h9"/><circle cx="7.5" cy="14.6" r=".8" fill="currentColor"/><circle cx="16.5" cy="14.6" r=".8" fill="currentColor"/><path d="M6.5 18v2.2M17.5 18v2.2"/>',
  arrow: '<path d="M4.5 12h15"/><path d="m13.5 6 6 6-6 6"/>',
  back: '<path d="M19.5 12h-15"/><path d="m10.5 6-6 6 6 6"/>',
  check: '<path d="m4.5 12.8 5 5 10-11"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m6 9.5 6 6 6-6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  flag: '<path d="M5 21.5V3.5"/><path d="M5 4.5h12.5l-2.2 4 2.2 4H5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.4 2"/>',
  map: '<path d="M9 4 3 6.2v13.6L9 17.6l6 2.2 6-2.2V4L15 6.2 9 4Z"/><path d="M9 4v13.6M15 6.2v13.6"/>',
  speaker: '<path d="M4 9.5v5h3.6L12.5 19V5L7.6 9.5H4Z"/><path d="M16 9a4.2 4.2 0 0 1 0 6"/><path d="M18.6 6.4a8 8 0 0 1 0 11.2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>',
  shield: '<path d="M12 21.5s7.5-3.6 7.5-9.6V5.6L12 2.8 4.5 5.6v6.3c0 6 7.5 9.6 7.5 9.6Z"/><path d="m8.8 11.8 2.3 2.3 4.2-4.6"/>',
  warn: '<path d="M12 3.5 2.8 19.5h18.4L12 3.5Z"/><path d="M12 10v4.4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>',
  pin: '<path d="M12 21.5S5 14.8 5 9.6a7 7 0 0 1 14 0c0 5.2-7 11.9-7 11.9Z"/><circle cx="12" cy="9.6" r="2.4"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  refresh: '<path d="M20 11.5A8 8 0 0 0 5.6 7"/><path d="M5.5 3.5V7.2H9"/><path d="M4 12.5A8 8 0 0 0 18.4 17"/><path d="M18.5 20.5v-3.7H15"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8L12 3.5Z"/>',
};

export function icon(name, { size = 24, cls = "", label = null } = {}) {
  const span = document.createElement("span");
  span.className = "ico " + cls;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true" focusable="false"'}>${P[name] || ""}</svg>`;
  return span;
}
