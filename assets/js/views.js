/** Panneau latéral et vues principales (pièces, énergie, sécurité). */
import { store } from './store.js';
import { icon } from './icons.js';
import { createCard, h, friendlyName, stateLabel, formatNumber, sparkline } from './cards.js';
import { summarize } from './iso.js';

const WEATHER = {
  'clear-night': ['Nuit dégagée', 'moon'],
  cloudy: ['Nuageux', 'cloud'],
  fog: ['Brouillard', 'cloud'],
  hail: ['Grêle', 'rain'],
  lightning: ['Orageux', 'zap'],
  'lightning-rainy': ['Orages et pluie', 'zap'],
  partlycloudy: ['Partiellement nuageux', 'cloud'],
  pouring: ['Fortes pluies', 'rain'],
  rainy: ['Pluvieux', 'rain'],
  snowy: ['Neigeux', 'cloud'],
  'snowy-rainy': ['Pluie et neige', 'rain'],
  sunny: ['Ensoleillé', 'sun'],
  windy: ['Venteux', 'fan'],
  exceptional: ['Conditions exceptionnelles', 'alert']
};

/** Registre des cartes montées : permet des mises à jour ciblées. */
export class CardHost {
  constructor() { this.cards = new Map(); }

  reset() { this.cards.clear(); }

  card(entityId) {
    const card = createCard(entityId);
    const bucket = this.cards.get(entityId) || [];
    bucket.push(card);
    this.cards.set(entityId, bucket);
    const entity = store.get(entityId);
    if (entity) card.update(entity);
    else card.el.classList.add('is-missing');
    return card.el;
  }

  update(entity) {
    this.cards.get(entity.entity_id)?.forEach((c) => {
      try { c.update(entity); } catch (err) { console.error(err); }
    });
  }
}

// --- Panneau latéral -----------------------------------------------------

export function renderPanel(container, ctx, host) {
  container.replaceChildren(
    ctx.roomId ? roomPanel(ctx, host) : overviewPanel(ctx, host)
  );
}

function roomPanel(ctx, host) {
  const floor = ctx.floor;
  const room = floor.rooms.find((r) => r.id === ctx.roomId);
  if (!room) return overviewPanel(ctx, host);

  const info = summarize(room, store.entities);
  const ids = room.entities || [];
  const controls = ids.filter((id) => !/^(sensor|binary_sensor)\./.test(id));
  const sensors = ids.filter((id) => /^(sensor|binary_sensor)\./.test(id));
  const lightIds = ids.filter((id) => id.startsWith('light.'));

  return h('div', { class: 'panel-inner' }, [
    h('header', { class: 'panel-head' }, [
      h('button', {
        class: 'ibtn', type: 'button', 'aria-label': 'Retour à la vue d’ensemble',
        html: icon('chevronLeft'), onclick: () => ctx.selectRoom(null)
      }),
      h('div', {}, [
        h('h2', { class: 'panel-title', text: room.name }),
        h('p', { class: 'panel-sub', text: `${floor.name} · ${ids.length} appareil${ids.length > 1 ? 's' : ''}` })
      ]),
      h('span', { class: 'panel-badge', html: icon(room.icon || 'grid') })
    ]),

    info.temp != null || info.lightsTotal ? h('div', { class: 'room-stats' }, [
      info.temp != null ? stat(icon('thermometer'), `${formatNumber(info.temp)}°`, 'Température') : null,
      info.lightsTotal ? stat(icon('bulb'), `${info.lightsOn}/${info.lightsTotal}`, 'Lumières') : null
    ]) : null,

    lightIds.length ? h('div', { class: 'btn-row btn-row--stretch' }, [
      h('button', {
        class: 'btn', type: 'button', html: `${icon('bulb')}<span>Tout allumer</span>`,
        onclick: () => store.call('light', 'turn_on', { entity_id: lightIds })
      }),
      h('button', {
        class: 'btn btn--ghost', type: 'button', html: `${icon('power')}<span>Tout éteindre</span>`,
        onclick: () => store.call('light', 'turn_off', { entity_id: lightIds })
      })
    ]) : null,

    controls.length ? h('div', { class: 'card-stack' }, controls.map((id) => host.card(id))) : null,
    sensors.length ? section('Mesures', h('div', { class: 'card-grid' }, sensors.map((id) => host.card(id)))) : null
  ]);
}

function overviewPanel(ctx, host) {
  const caps = ctx.caps;
  const favorites = (caps.favorites || []).filter((id) => store.get(id));
  const roomCount = ctx.config.floors.reduce((n, f) => n + f.rooms.length, 0);

  // Rien n'est affiché « au cas où » : chaque carte dépend d'entités trouvées.
  const cards = [
    caps.hasWeather ? weatherCard(caps.weather, caps.outdoor) : null,
    caps.hasEnergy ? energyCard(caps.power, caps.solar) : null,
    caps.hasPresence ? presenceCard(caps.persons) : null,
    caps.alarm ? alarmCard(caps.alarm) : null,
    favorites.length ? section('Favoris', h('div', { class: 'card-stack' }, favorites.map((id) => host.card(id)))) : null
  ].filter(Boolean);

  if (!cards.length) {
    cards.push(h('div', { class: 'empty-state' }, [
      h('span', { class: 'empty-ico', html: icon(roomCount ? 'device' : 'floorplan') }),
      h('h3', { text: roomCount ? 'Aucun appareil rattaché' : 'Votre plan est vide' }),
      h('p', {
        text: roomCount
          ? 'Ouvrez l’éditeur pour placer vos appareils dans les pièces.'
          : 'Ouvrez l’éditeur pour dessiner vos pièces et poser vos appareils.'
      }),
      h('button', {
        class: 'btn', type: 'button', html: `${icon('floorplan')}<span>Ouvrir l’éditeur</span>`,
        onclick: () => ctx.setView('editor')
      })
    ]));
  }

  return h('div', { class: 'panel-inner' }, [
    h('header', { class: 'panel-head' }, [
      h('div', {}, [
        h('h2', { class: 'panel-title', text: 'Vue d’ensemble' }),
        h('p', { class: 'panel-sub', text: 'Touchez une pièce du plan pour la piloter' })
      ])
    ]),
    ...cards
  ]);
}

// --- Cartes de synthèse --------------------------------------------------

function weatherCard(weatherId, outdoorId) {
  const w = store.get(weatherId);
  const out = store.get(outdoorId);
  const [label, ico] = WEATHER[w?.state] || ['Météo', 'cloud'];
  const temp = Number(w?.attributes?.temperature ?? out?.state);

  return h('article', { class: 'hero hero--weather', dataset: { live: weatherId || '' } }, [
    h('div', { class: 'hero-ico', html: icon(ico) }),
    h('div', { class: 'hero-main' }, [
      h('strong', { class: 'hero-value', text: Number.isFinite(temp) ? `${formatNumber(temp)}°` : '—' }),
      h('span', { class: 'hero-label', text: label })
    ]),
    h('dl', { class: 'hero-meta' }, [
      metaItem('Humidité', w?.attributes?.humidity != null ? `${Math.round(w.attributes.humidity)} %` : '—'),
      metaItem('Vent', w?.attributes?.wind_speed != null ? `${Math.round(w.attributes.wind_speed)} km/h` : '—')
    ])
  ]);
}

function energyCard(powerId, solarId) {
  const p = Number(store.get(powerId)?.state);
  const s = Number(store.get(solarId)?.state);
  const net = (Number.isFinite(p) ? p : 0) - (Number.isFinite(s) ? s : 0);
  const ratio = Number.isFinite(p) && p > 0 ? Math.min(1, (Number.isFinite(s) ? s : 0) / p) : 0;

  return h('article', { class: 'card card--energy' }, [
    h('div', { class: 'card-head' }, [
      h('span', { class: 'card-ico', html: icon('zap') }),
      h('div', { class: 'card-title' }, [
        h('h4', { class: 'card-name', text: 'Énergie' }),
        h('p', {
          class: 'card-sub',
          text: net <= 0 ? 'Autonome · surplus solaire' : `Réseau ${formatNumber(net)} W`
        })
      ]),
      h('span', { class: `pill ${net <= 0 ? 'pill--good' : ''}`, text: `${Math.round(ratio * 100)} % solaire` })
    ]),
    h('div', { class: 'card-body' }, [
      h('div', { class: 'energy-rows' }, [
        energyRow('Consommation', p, 'W', 'consumption', store.history[powerId]),
        energyRow('Production', s, 'W', 'solar', store.history[solarId])
      ])
    ])
  ]);
}

function energyRow(label, value, unit, tone, history) {
  return h('div', { class: `energy-row energy-row--${tone}` }, [
    h('div', { class: 'energy-head' }, [
      h('span', { class: 'energy-label', text: label }),
      h('strong', { class: 'energy-value', text: Number.isFinite(value) ? `${formatNumber(value)} ${unit}` : '—' })
    ]),
    sparkline(history, `spark--${tone}`)
  ]);
}

function presenceCard(personIds = []) {
  const persons = personIds.map((id) => store.get(id)).filter(Boolean);
  if (!persons.length) return null;
  return h('article', { class: 'card card--presence' }, [
    h('div', { class: 'card-head' }, [
      h('span', { class: 'card-ico', html: icon('person') }),
      h('div', { class: 'card-title' }, [
        h('h4', { class: 'card-name', text: 'Présence' }),
        h('p', {
          class: 'card-sub',
          text: `${persons.filter((p) => p.state === 'home').length} personne(s) à la maison`
        })
      ])
    ]),
    h('div', { class: 'card-body' }, [
      h('ul', { class: 'people' }, persons.map((p) => h('li', {
        class: `person ${p.state === 'home' ? 'is-home' : ''}`
      }, [
        h('span', { class: 'avatar', text: friendlyName(p.entity_id, p).charAt(0).toUpperCase() }),
        h('span', { class: 'person-name', text: friendlyName(p.entity_id, p) }),
        h('span', { class: 'person-state', text: stateLabel(p) })
      ])))
    ])
  ]);
}

function alarmCard(alarmId) {
  const a = store.get(alarmId);
  if (!a) return null;
  const armed = a.state.startsWith('armed');
  return h('article', { class: `card card--alarm ${armed ? 'is-armed' : ''}` }, [
    h('div', { class: 'card-head' }, [
      h('span', { class: 'card-ico', html: icon('shield') }),
      h('div', { class: 'card-title' }, [
        h('h4', { class: 'card-name', text: 'Alarme' }),
        h('p', { class: 'card-sub', text: stateLabel(a) })
      ])
    ]),
    h('div', { class: 'card-body' }, [
      h('div', { class: 'btn-row btn-row--stretch' }, [
        h('button', {
          class: `btn ${armed ? 'btn--ghost' : ''}`, type: 'button', text: 'Armer',
          onclick: () => store.call('alarm_control_panel', 'alarm_arm_away', { entity_id: alarmId })
        }),
        h('button', {
          class: `btn ${armed ? '' : 'btn--ghost'}`, type: 'button', text: 'Désarmer',
          onclick: () => store.call('alarm_control_panel', 'alarm_disarm', { entity_id: alarmId })
        })
      ])
    ])
  ]);
}

// --- Vues principales ----------------------------------------------------

export function renderRoomsView(container, ctx, host) {
  if (!ctx.config.floors.some((f) => f.rooms.length)) {
    container.replaceChildren(h('div', { class: 'view' }, [
      viewHead('Pièces', 'Aucune pièce pour l’instant'),
      h('div', { class: 'empty-state' }, [
        h('span', { class: 'empty-ico', html: icon('floorplan') }),
        h('h3', { text: 'Dessinez votre maison' }),
        h('p', { text: 'L’éditeur de plan permet de poser vos pièces en quelques gestes.' }),
        h('button', {
          class: 'btn', type: 'button', html: `${icon('floorplan')}<span>Ouvrir l’éditeur</span>`,
          onclick: () => ctx.setView('editor')
        })
      ])
    ]));
    return;
  }

  const sections = ctx.config.floors.map((floor) => section(
    floor.name,
    h('div', { class: 'tile-grid' }, floor.rooms.map((room) => {
      const info = summarize(room, store.entities);
      return h('button', {
        class: `tile ${info.lightsOn ? 'is-lit' : ''}`, type: 'button',
        style: info.lightsOn ? `--tile-accent: rgb(${info.color.join(',')})` : '',
        onclick: () => { ctx.setFloor(floor.id); ctx.selectRoom(room.id); ctx.setView('home'); }
      }, [
        h('span', { class: 'tile-ico', html: icon(room.icon || 'grid') }),
        h('span', { class: 'tile-name', text: room.name }),
        h('span', { class: 'tile-meta', text: info.meta || '—' }),
        h('span', { class: 'tile-pucks', html: info.pucks.map((p) => icon(p.icon)).join('') })
      ]);
    }))
  ));
  container.replaceChildren(h('div', { class: 'view' }, [
    viewHead('Pièces', 'Toutes les pièces de la maison, tous étages confondus'),
    ...sections
  ]));
}

export function renderEnergyView(container, ctx, host) {
  const caps = ctx.caps;
  const p = Number(store.get(caps.power)?.state);
  const s = Number(store.get(caps.solar)?.state);
  const ratio = Number.isFinite(p) && p > 0 ? Math.min(1, (Number.isFinite(s) ? s : 0) / p) : 0;

  const consumers = Object.values(store.entities)
    .filter((e) => /^(light|switch|media_player)\./.test(e.entity_id) && e.state !== 'off' && e.state !== 'unavailable')
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));

  container.replaceChildren(h('div', { class: 'view' }, [
    viewHead('Énergie', 'Consommation en direct et part d’autoproduction'),
    h('div', { class: 'grid grid--2' }, [
      caps.power && caps.solar ? h('article', { class: 'card card--gauge' }, [
        h('div', { class: 'gauge', html: gaugeSvg(ratio) }),
        h('div', { class: 'gauge-legend' }, [
          h('strong', { text: `${Math.round(ratio * 100)} %` }),
          h('span', { text: 'de la consommation couverte par le solaire' })
        ])
      ]) : null,
      h('div', { class: 'card-stack' }, [
        caps.power ? energyRow('Consommation instantanée', p, 'W', 'consumption', store.history[caps.power]) : null,
        caps.solar ? energyRow('Production solaire', s, 'W', 'solar', store.history[caps.solar]) : null,
        caps.outdoor ? energyRow('Extérieur', Number(store.get(caps.outdoor)?.state), '°C', 'outdoor',
          store.history[caps.outdoor]) : null
      ].filter(Boolean).map((row) => h('article', { class: 'card card--metric' }, [row])))
    ]),
    section(`Appareils actifs (${consumers.length})`,
      h('div', { class: 'card-grid' }, consumers.map((e) => host.card(e.entity_id))))
  ]));
}

export function renderSecurityView(container, ctx, host) {
  const caps = ctx.caps;

  container.replaceChildren(h('div', { class: 'view' }, [
    viewHead('Sécurité', 'Ouvertures, serrures et détecteurs'),
    h('div', { class: 'grid grid--2' },
      [caps.alarm ? alarmCard(caps.alarm) : null, caps.hasPresence ? presenceCard(caps.persons) : null].filter(Boolean)),
    caps.locks.length
      ? section('Serrures', h('div', { class: 'card-stack' }, caps.locks.map((id) => host.card(id)))) : null,
    caps.openings.length
      ? section('Ouvertures', h('div', { class: 'card-grid' }, caps.openings.map((id) => host.card(id)))) : null,
    caps.motions.length
      ? section('Détecteurs de mouvement', h('div', { class: 'card-grid' }, caps.motions.map((id) => host.card(id)))) : null
  ]));
}

// --- Fragments -----------------------------------------------------------

function viewHead(title, sub) {
  return h('header', { class: 'view-head' }, [
    h('h2', { text: title }), h('p', { text: sub })
  ]);
}

function section(title, content) {
  return h('section', { class: 'section' }, [
    h('h3', { class: 'section-title', text: title }), content
  ]);
}

function stat(iconHtml, value, label) {
  return h('div', { class: 'stat' }, [
    h('span', { class: 'stat-ico', html: iconHtml }),
    h('div', {}, [
      h('strong', { class: 'stat-value', text: value }),
      h('span', { class: 'stat-label', text: label })
    ])
  ]);
}

function metaItem(label, value) {
  return h('div', { class: 'hero-meta-item' }, [
    h('dt', { text: label }), h('dd', { text: value })
  ]);
}

function gaugeSvg(ratio) {
  const pct = Math.round(ratio * 100);
  return `<svg viewBox="0 0 140 82" aria-label="Part solaire ${pct} %">
    <path class="gauge-track" d="M14 72 A 56 56 0 0 1 126 72" pathLength="100"/>
    <path class="gauge-fill" d="M14 72 A 56 56 0 0 1 126 72" pathLength="100"
      style="stroke-dasharray: ${pct} 100"/>
  </svg>`;
}

export { WEATHER };
