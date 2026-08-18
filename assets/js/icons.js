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
  droplet: '<path d="M12 3.4s6 6.3 6 10.1a6 6 0 0 1-12 0c0-3.8 6-10.1 6-10.1z"/>',
  power: '<path d="M12 3.2v8.6"/><path d="M7.2 6.4a8 8 0 1 0 9.6 0"/>',
  play: '<path d="M8 5.4v13.2L19 12z"/>',
  pause: '<path d="M9.2 5v14M14.8 5v14"/>',
  prev: '<path d="M18.5 5.2v13.6L8.5 12z"/><path d="M6 5.2v13.6"/>',
  next: '<path d="M5.5 5.2v13.6L15.5 12z"/><path d="M18 5.2v13.6"/>',
  volume: '<path d="M11 5 6.6 9H3v6h3.6L11 19z"/><path d="M14.8 9.4a3.6 3.6 0 0 1 0 5.2M17.4 6.9a7.2 7.2 0 0 1 0 10.2"/>',
  lock: '<rect x="4.5" y="10.4" width="15" height="10.1" rx="2.2"/><path d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8"/>',
  unlock: '<rect x="4.5" y="10.4" width="15" height="10.1" rx="2.2"/><path d="M8 10.4V7.6a4 4 0 0 1 7.4-2.1"/>',
  shield: '<path d="M12 3 20 6v6.1c0 4.5-3.3 7.8-8 8.9-4.7-1.1-8-4.4-8-8.9V6z"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0"/>',
  wifi: '<path d="M2.6 9.2a14 14 0 0 1 18.8 0"/><path d="M6 12.6a9 9 0 0 1 12 0"/><path d="M9.4 16a4.2 4.2 0 0 1 5.2 0"/><circle cx="12" cy="19.4" r=".9" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.2v2.4M12 19.4v2.4M2.2 12h2.4M19.4 12h2.4M5 5l1.7 1.7M17.3 17.3 19 19M19 5l-1.7 1.7M6.7 17.3 5 19"/>',
  moon: '<path d="M20.4 14.6A8.6 8.6 0 0 1 9.4 3.6a8.6 8.6 0 1 0 11 11z"/>',
  cloud: '<path d="M7 18.5h10.2a4.2 4.2 0 0 0 .3-8.4 6.2 6.2 0 0 0-11.8 1.7A3.6 3.6 0 0 0 7 18.5z"/>',
  rain: '<path d="M7 16h10a4 4 0 0 0 .3-8 6 6 0 0 0-11.4 1.6A3.5 3.5 0 0 0 7 16z"/><path d="M8.6 19l-.9 2.4M12.4 19l-.9 2.4M16.2 19l-.9 2.4"/>',
  zap: '<path d="M13.2 2.4 4.6 13.6h6.2L10 21.6l8.8-11.4h-6.4z"/>',
  chevronLeft: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  chevronRight: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  chevronUp: '<path d="M5.5 14.5 12 8l6.5 6.5"/>',
  chevronDown: '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13"/>',
  minus: '<path d="M5.5 12h13"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  blinds: '<path d="M3 4h18"/><path d="M4.6 4v9.4M19.4 4v9.4"/><path d="M4.6 7.2h14.8M4.6 10.3h14.8M4.6 13.4h14.8"/><path d="M12 13.4v4"/><circle cx="12" cy="19" r="1.6"/>',
  fan: '<circle cx="12" cy="12" r="1.9"/><path d="M12 10.1c1-3 3-4.6 4.6-3.5C18 7.6 17 11 12 12"/><path d="M12 13.9c-1 3-3 4.6-4.6 3.5C6 16.4 7 13 12 12"/><path d="M13.9 12c3 1 4.6 3 3.5 4.6C16.4 18 13 17 12 12"/><path d="M10.1 12c-3-1-4.6-3-3.5-4.6C7.6 6 11 7 12 12"/>',
  tv: '<rect x="3" y="4.5" width="18" height="12.2" rx="2"/><path d="M8.5 20.4h7M12 16.7v3.7"/>',
  speaker: '<rect x="6" y="3" width="12" height="18" rx="2.2"/><circle cx="12" cy="14.6" r="3.1"/><circle cx="12" cy="7.2" r="1.2"/>',
  motion: '<circle cx="13.6" cy="4.6" r="1.9"/><path d="M8.6 21.4 11.4 15 9 12.6l.9-4.4 3.6 2.1 2.5 1.4"/><path d="M11.4 15l3.6 2 1.1 4.4"/><path d="M6 9.9 9.9 8.2"/>',
  activity: '<path d="M3 12.4h4l2.8-7.6 4.4 15.2 2.8-7.6H21"/>',
  refresh: '<path d="M20.4 12a8.4 8.4 0 1 1-2.5-6"/><path d="M20.4 3.6v4.8h-4.8"/>',
  battery: '<rect x="2.6" y="7.4" width="17" height="9.2" rx="2.2"/><path d="M21.6 10.4v3.2"/><rect x="5" y="9.8" width="7" height="4.4" rx="1.1" fill="currentColor" stroke="none"/>',
  leaf: '<path d="M4.4 20c-1.2-8 4-13.4 15.6-14.4C20 15.6 15 20.6 7.4 20.6c-1.6 0-3-.2-3-.6z"/><path d="M8 16.4c2.6-3.2 5.4-5.4 8.4-6.9"/>',
  alert: '<path d="M12 3.4 21.6 20.4H2.4z"/><path d="M12 10v4.6M12 17.6v.01"/>',
  coffee: '<path d="M4 8h13v5.2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 9.6h1.4a2.6 2.6 0 0 1 0 5.2H17"/><path d="M4 21h14"/>',
  eye: '<path d="M2.4 12S6 5.6 12 5.6 21.6 12 21.6 12 18 18.4 12 18.4 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="3"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 12.4 12 17.4l9-5"/><path d="M3 16.6 12 21.6l9-5"/>',
  grid: '<rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1.6"/><rect x="13.2" y="3.2" width="7.6" height="7.6" rx="1.6"/><rect x="3.2" y="13.2" width="7.6" height="7.6" rx="1.6"/><rect x="13.2" y="13.2" width="7.6" height="7.6" rx="1.6"/>',
  plug: '<path d="M9 7.4V3M15 7.4V3"/><path d="M6.4 7.4h11.2v3.8a5.6 5.6 0 0 1-11.2 0z"/><path d="M12 16.8V21.4"/>',
  search: '<circle cx="11" cy="11" r="6.4"/><path d="M15.8 15.8 20.5 20.5"/>',
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

/** Icône déduite d'un entity_id / domaine Home Assistant. */
export function iconForEntity(entityId, entity) {
  const domain = String(entityId).split('.')[0];
  const dc = entity?.attributes?.device_class;
  switch (domain) {
    case 'light': return 'bulb';
    case 'switch': return entityId.includes('cafetiere') ? 'coffee' : 'plug';
    case 'climate': return 'thermometer';
    case 'cover': return entityId.includes('garage') ? 'car' : 'blinds';
    case 'lock': return 'lock';
    case 'fan': return 'fan';
    case 'media_player': return entityId.includes('tv') ? 'tv' : 'speaker';
    case 'person': return 'person';
    case 'alarm_control_panel': return 'shield';
    case 'scene': case 'script': return 'zap';
    case 'weather': return 'cloud';
    case 'binary_sensor':
      if (dc === 'motion' || dc === 'occupancy') return 'motion';
      if (dc === 'door' || dc === 'garage_door' || dc === 'opening') return 'door';
      if (dc === 'window') return 'blinds';
      return 'eye';
    case 'sensor':
      if (dc === 'temperature') return 'thermometer';
      if (dc === 'humidity') return 'droplet';
      if (dc === 'power' || dc === 'energy') return 'zap';
      if (dc === 'battery') return 'battery';
      return 'activity';
    default: return 'grid';
  }
}
