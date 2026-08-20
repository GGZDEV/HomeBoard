/**
 * Jeu d'icônes minimaliste (trait, 24x24) — aucune dépendance externe.
 * Chaque entrée contient uniquement le contenu interne du <svg>.
 */
const PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.6V21h13V9.6"/><path d="M9.5 21v-6h5v6"/>',
  sofa: '<path d="M4 12V8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5V12"/><path d="M2.5 12.6a2 2 0 0 1 4 0V15h11v-2.4a2 2 0 0 1 4 0V18h-19z"/><path d="M5 18v2M19 18v2"/>',
  cooking: '<path d="M4 9h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M2 11h2M20 11h2"/><path d="M9.2 6c0-1.6 1-1.6 1-3M14 6c0-1.6 1-1.6 1-3"/>',
  door: '<path d="M5 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17"/><path d="M3 21h18"/><circle cx="13" cy="12.6" r=".95" fill="currentColor" stroke="none"/>',
  laptop: '<rect x="3.5" y="5.5" width="17" height="11" rx="1.6"/><path d="M2 19.5h20"/>',
  car: '<path d="M3.5 16v-3.6L5.5 7h13l2 5.4V16z"/><path d="M4.5 16v2.4h3V16M16.5 16v2.4h3V16"/><path d="M6.2 12.6h2M15.8 12.6h2"/>',
  bed: '<path d="M3 19V7"/><path d="M3 12.5h18V19"/><path d="M21 12.5a3 3 0 0 0-3-3h-7v3"/><circle cx="7.2" cy="10.6" r="1.9"/>',
  shower: '<path d="M5 14V6.2A2.6 2.6 0 0 1 10.2 6"/><path d="M2.6 14h11.4"/><path d="M6 17.4v.01M9.3 19.4v.01M12.4 17.4v.01M7.6 21.4v.01M11 21.4v.01"/>',
  stairs: '<path d="M3 20.5h4.5V16H12v-4.5h4.5V7H21"/>',
  bulb: '<path d="M9.2 18h5.6"/><path d="M10.2 21h3.6"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
  thermometer: '<path d="M14 14.9V5a2 2 0 1 0-4 0v9.9a4 4 0 1 0 4 0z"/><path d="M12 9.2v5.6"/>',
  power: '<path d="M12 3.2v8.6"/><path d="M7.2 6.4a8 8 0 1 0 9.6 0"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19"/>',
  moon: '<path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11z"/>',
  cloud: '<path d="M7 18.5h10.2a4.2 4.2 0 0 0 .3-8.4 6.2 6.2 0 0 0-11.8 1.7A3.6 3.6 0 0 0 7 18.5z"/>',
  chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  settings: '<path d="M4 7.2h8M16.6 7.2H20"/><path d="M4 12h3.4M12 12h8"/><path d="M4 16.8h8M16.6 16.8H20"/><circle cx="14.3" cy="7.2" r="2.3"/><circle cx="9.7" cy="12" r="2.3"/><circle cx="14.3" cy="16.8" r="2.3"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  tv: '<rect x="3" y="4.5" width="18" height="12.2" rx="2"/><path d="M8.5 20.4h7M12 16.7v3.7"/>',
  speaker: '<rect x="6" y="3" width="12" height="18" rx="2.2"/><circle cx="12" cy="14.6" r="3.1"/><circle cx="12" cy="7.2" r="1.2"/>',
  refresh: '<path d="M20.4 12a8.4 8.4 0 1 1-2.5-6"/><path d="M20.4 3.6v4.8h-4.8"/>',
  alert: '<path d="M12 3.4 21.6 20.4H2.4z"/><path d="M12 10v4.6M12 17.6v.01"/>',
  coffee: '<path d="M4 8h13v5.2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 9.6h1.4a2.6 2.6 0 0 1 0 5.2H17"/><path d="M4 21h14"/>',
  grid: '<rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1.6"/><rect x="13.2" y="3.2" width="7.6" height="7.6" rx="1.6"/><rect x="3.2" y="13.2" width="7.6" height="7.6" rx="1.6"/><rect x="13.2" y="13.2" width="7.6" height="7.6" rx="1.6"/>',
  trash: '<path d="M4 6.8h16"/><path d="M9.5 6.8V4.6h5v2.2"/><path d="M6.3 6.8l1 12.3a1.7 1.7 0 0 0 1.7 1.6h6a1.7 1.7 0 0 0 1.7-1.6l1-12.3"/><path d="M10.2 10.6v6.4M13.8 10.6v6.4"/>',
  pencil: '<path d="M4 20h4.2L19.6 8.6a2.2 2.2 0 0 0-3.1-3.1L5 17z"/><path d="M14.6 7.4l3 3"/>',
  brush: '<path d="M14.6 3.6 20.4 9.4"/><path d="M17.5 6.5 9.2 14.8l-2.4 4.4 4.4-2.4z"/><path d="M6.4 19.4c-1.4 1.4-3.4 1.1-3.4 1.1s-.3-2 1.1-3.4"/>',
  eraser: '<path d="M8.4 20.6h11.2"/><path d="M15.4 4.6 4.6 15.4a1.7 1.7 0 0 0 0 2.4l2.8 2.8h4l9.2-9.2a1.7 1.7 0 0 0 0-2.4l-3-3a1.7 1.7 0 0 0-2.2 0z"/><path d="M10 10 16 16"/>',
  undo: '<path d="M3.6 12a8.4 8.4 0 1 1 2.5 6"/><path d="M3.6 3.6v4.8h4.8"/>',
  move: '<path d="M12 3.4v17.2"/><path d="M9 6.4 12 3.4l3 3M9 17.6l3 3 3-3"/><path d="M3.4 12h17.2"/><path d="M6.4 9 3.4 12l3 3M17.6 9l3 3-3 3"/>',
  floorplan: '<rect x="3.2" y="3.2" width="17.6" height="17.6" rx="2"/><path d="M3.2 13.4h8.2V3.2M11.4 13.4h9.4M15.8 13.4v7.4"/>',
  device: '<rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3"/><circle cx="12" cy="12" r="2.4"/><path d="M12 4.2v2.6M12 17.2v2.6M4.2 12h2.6M17.2 12h2.6"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  check: '<path d="M4.5 12.6 9.5 17.6 19.5 6.8"/>',
  minimize: '<path d="M8 4v4H4M16 20v-4h4"/><path d="M20 8h-4V4M4 16h4v4"/>',
  maximize: '<path d="M4 9V4h5M20 15v5h-5"/><path d="M15 4h5v5M9 20H4v-5"/>'
};

export function icon(name, cls = '') {
  const body = PATHS[name] || PATHS.grid;
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}
