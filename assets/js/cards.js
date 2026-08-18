/**
 * Cartes de contrôle par entité.
 * Chaque carte expose { el, update(entity) } pour une mise à jour ciblée
 * (pas de re-rendu global : les curseurs restent utilisables pendant le drag).
 */
import { store } from './store.js';
import { icon, iconForEntity } from './icons.js';

const COLOR_PRESETS = [
  [255, 244, 224], [255, 214, 170], [255, 170, 120],
  [255, 120, 160], [170, 130, 255], [110, 190, 255], [130, 240, 200]
];

const STATE_LABELS = {
  on: 'Allumé', off: 'Éteint', home: 'À la maison', not_home: 'Absent',
  locked: 'Verrouillé', unlocked: 'Déverrouillé', open: 'Ouvert', opening: 'Ouverture',
  closed: 'Fermé', closing: 'Fermeture', playing: 'Lecture', paused: 'En pause',
  idle: 'Inactif', standby: 'Veille', unavailable: 'Indisponible', unknown: 'Inconnu',
  heat: 'Chauffage', cool: 'Climatisation', auto: 'Auto', heat_cool: 'Auto',
  armed_away: 'Armée · absent', armed_home: 'Armée · présent', disarmed: 'Désarmée',
  arming: 'Activation…', triggered: 'Déclenchée', detected: 'Détecté', clear: 'Rien à signaler'
};

const HVAC_LABELS = { off: 'Arrêt', heat: 'Chauffer', cool: 'Refroidir', auto: 'Auto', heat_cool: 'Auto', dry: 'Sec', fan_only: 'Ventil.' };

export function friendlyName(entityId, entity) {
  return entity?.attributes?.friendly_name
    || entityId.split('.')[1].replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function stateLabel(entity) {
  if (!entity) return '—';
  const domain = entity.entity_id.split('.')[0];
  if (domain === 'sensor') {
    const unit = entity.attributes?.unit_of_measurement;
    return unit ? `${formatNumber(entity.state)} ${unit}` : entity.state;
  }
  if (domain === 'binary_sensor') {
    const dc = entity.attributes?.device_class;
    if (dc === 'motion' || dc === 'occupancy') return entity.state === 'on' ? 'Mouvement' : 'Calme';
    if (['door', 'garage_door', 'window', 'opening'].includes(dc)) return entity.state === 'on' ? 'Ouvert' : 'Fermé';
  }
  return STATE_LABELS[entity.state] || entity.state;
}

export function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return Math.abs(n) >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, '');
}

export function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** Mini-courbe SVG à partir d'un tableau de valeurs. */
export function sparkline(values, cls = '') {
  if (!values || values.length < 2) return h('div', { class: `spark spark--empty ${cls}` });
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = 26 - ((v - min) / span) * 22 - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return h('div', {
    class: `spark ${cls}`,
    html: `<svg viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polygon class="spark-fill" points="0,28 ${pts.join(' ')} 100,28"/>
      <polyline class="spark-line" points="${pts.join(' ')}"/>
    </svg>`
  });
}

// --- Fabrique ------------------------------------------------------------

export function createCard(entityId) {
  const domain = entityId.split('.')[0];
  const builder = BUILDERS[domain] || buildGeneric;
  return builder(entityId);
}

function shell(entityId, { modifier = '', accessory = null, body = null } = {}) {
  const entity = store.get(entityId);
  const sub = h('p', { class: 'card-sub', text: stateLabel(entity) });
  const title = h('h4', { class: 'card-name', text: friendlyName(entityId, entity) });
  const ico = h('span', { class: 'card-ico', html: icon(iconForEntity(entityId, entity)) });

  const head = h('div', { class: 'card-head' }, [ico, h('div', { class: 'card-title' }, [title, sub]), accessory]);
  const el = h('article', {
    class: `card card--${domainOf(entityId)} ${modifier}`.trim(),
    dataset: { entity: entityId }
  }, [head, body]);

  return { el, sub, ico, title };
}

const domainOf = (id) => id.split('.')[0];

function toggleButton(entityId, onToggle) {
  const btn = h('button', {
    class: 'switch', type: 'button', 'aria-label': 'Allumer / éteindre',
    onclick: (ev) => { ev.stopPropagation(); onToggle(); }
  }, [h('span', { class: 'switch-knob' })]);
  return btn;
}

function slider({ min = 0, max = 100, step = 1, value = 0, label, onInput, onCommit }) {
  const input = h('input', {
    class: 'range', type: 'range', min, max, step, value, 'aria-label': label
  });
  let timer = null;
  input.addEventListener('input', () => {
    input.dataset.active = '1';
    onInput?.(Number(input.value));
    clearTimeout(timer);
    timer = setTimeout(() => onCommit?.(Number(input.value)), 140);
  });
  const release = () => {
    clearTimeout(timer);
    onCommit?.(Number(input.value));
    setTimeout(() => { delete input.dataset.active; }, 600);
  };
  input.addEventListener('change', release);
  input.addEventListener('pointerup', release);
  return input;
}

function iconButton(name, label, onClick, cls = '') {
  return h('button', {
    class: `ibtn ${cls}`.trim(), type: 'button', title: label, 'aria-label': label,
    html: icon(name), onclick: (ev) => { ev.stopPropagation(); onClick(); }
  });
}

// --- Lumières ------------------------------------------------------------

function buildLight(entityId) {
  const entity = store.get(entityId) || {};
  const sw = toggleButton(entityId, () => store.call('light', 'toggle', { entity_id: entityId }));

  const pct = h('span', { class: 'range-value' });
  const bright = slider({
    min: 1, max: 100, value: Math.round(((entity.attributes?.brightness ?? 255) / 255) * 100),
    label: 'Luminosité',
    onInput: (v) => { pct.textContent = `${v} %`; },
    onCommit: (v) => store.call('light', 'turn_on', { entity_id: entityId, brightness: Math.round(v * 2.55) })
  });

  const swatches = h('div', { class: 'swatches' }, COLOR_PRESETS.map(([r, g, b]) => h('button', {
    class: 'swatch', type: 'button', 'aria-label': `Couleur ${r},${g},${b}`,
    style: `--sw: rgb(${r},${g},${b})`,
    onclick: (ev) => {
      ev.stopPropagation();
      store.call('light', 'turn_on', { entity_id: entityId, rgb_color: [r, g, b] });
    }
  })));

  const supportsColor = (entity.attributes?.supported_color_modes || []).some(
    (m) => ['rgb', 'rgbw', 'rgbww', 'hs', 'xy'].includes(m)
  ) || Array.isArray(entity.attributes?.rgb_color);

  const body = h('div', { class: 'card-body' }, [
    h('div', { class: 'range-row' }, [bright, pct]),
    supportsColor ? swatches : null
  ]);

  const { el, sub } = shell(entityId, { accessory: sw, body });

  const update = (e) => {
    const on = e.state === 'on';
    el.classList.toggle('is-on', on);
    sw.classList.toggle('is-on', on);
    sw.setAttribute('aria-pressed', String(on));
    const b = Math.round(((e.attributes?.brightness ?? 255) / 255) * 100);
    sub.textContent = on ? `Allumée · ${b} %` : 'Éteinte';
    pct.textContent = `${b} %`;
    if (!bright.dataset.active) bright.value = b;
    const rgb = e.attributes?.rgb_color;
    el.style.setProperty('--card-accent', rgb ? `rgb(${rgb.join(',')})` : 'var(--warm)');
  };
  return { el, update };
}

// --- Interrupteurs -------------------------------------------------------

function buildSwitch(entityId) {
  const sw = toggleButton(entityId, () => store.call('switch', 'toggle', { entity_id: entityId }));
  const { el, sub } = shell(entityId, { accessory: sw });
  const update = (e) => {
    const on = e.state === 'on';
    el.classList.toggle('is-on', on);
    sw.classList.toggle('is-on', on);
    sw.setAttribute('aria-pressed', String(on));
    sub.textContent = on ? 'En marche' : 'À l’arrêt';
  };
  return { el, update };
}

// --- Thermostat ----------------------------------------------------------

function buildClimate(entityId) {
  const entity = store.get(entityId) || { attributes: {} };
  const target = h('strong', { class: 'thermo-target' });
  const current = h('span', { class: 'thermo-current' });

  const step = (delta) => {
    const e = store.get(entityId);
    const min = Number(e.attributes?.min_temp ?? 7);
    const max = Number(e.attributes?.max_temp ?? 35);
    const next = clamp(Number(e.attributes?.temperature ?? 20) + delta, min, max);
    target.textContent = `${next.toFixed(1).replace(/\.0$/, '')}°`;
    store.call('climate', 'set_temperature', { entity_id: entityId, temperature: next });
  };

  const modes = (entity.attributes?.hvac_modes || ['off', 'heat', 'auto']).map((m) => h('button', {
    class: 'chip', type: 'button', dataset: { mode: m }, text: HVAC_LABELS[m] || m,
    onclick: (ev) => { ev.stopPropagation(); store.call('climate', 'set_hvac_mode', { entity_id: entityId, hvac_mode: m }); }
  }));

  const body = h('div', { class: 'card-body' }, [
    h('div', { class: 'thermo' }, [
      iconButton('minus', 'Diminuer', () => step(-0.5), 'ibtn--round'),
      h('div', { class: 'thermo-read' }, [target, current]),
      iconButton('plus', 'Augmenter', () => step(0.5), 'ibtn--round')
    ]),
    h('div', { class: 'chips' }, modes)
  ]);

  const { el, sub } = shell(entityId, { body });

  const update = (e) => {
    const t = Number(e.attributes?.temperature);
    const c = Number(e.attributes?.current_temperature);
    target.textContent = Number.isFinite(t) ? `${formatNumber(t)}°` : '—';
    current.textContent = Number.isFinite(c) ? `mesure ${formatNumber(c)}°` : '';
    sub.textContent = stateLabel(e);
    el.classList.toggle('is-on', e.state !== 'off');
    el.classList.toggle('is-heating', e.state === 'heat');
    el.classList.toggle('is-cooling', e.state === 'cool');
    for (const chip of el.querySelectorAll('.chip')) {
      chip.classList.toggle('is-active', chip.dataset.mode === e.state);
    }
  };
  return { el, update };
}

// --- Volets / portails ---------------------------------------------------

function buildCover(entityId) {
  const pos = h('span', { class: 'range-value' });
  const range = slider({
    min: 0, max: 100, value: 100, label: 'Position',
    onInput: (v) => { pos.textContent = `${v} %`; },
    onCommit: (v) => store.call('cover', 'set_cover_position', { entity_id: entityId, position: v })
  });

  const body = h('div', { class: 'card-body' }, [
    h('div', { class: 'range-row' }, [range, pos]),
    h('div', { class: 'btn-row' }, [
      iconButton('chevronUp', 'Ouvrir', () => store.call('cover', 'open_cover', { entity_id: entityId })),
      iconButton('minus', 'Stop', () => store.call('cover', 'stop_cover', { entity_id: entityId })),
      iconButton('chevronDown', 'Fermer', () => store.call('cover', 'close_cover', { entity_id: entityId }))
    ])
  ]);

  const { el, sub } = shell(entityId, { body });

  const update = (e) => {
    const p = Number(e.attributes?.current_position);
    const value = Number.isFinite(p) ? p : (e.state === 'open' ? 100 : 0);
    if (!range.dataset.active) range.value = value;
    pos.textContent = `${Math.round(value)} %`;
    sub.textContent = value >= 99 ? 'Ouvert' : value <= 1 ? 'Fermé' : `Ouvert à ${Math.round(value)} %`;
    el.classList.toggle('is-on', value > 1);
  };
  return { el, update };
}

// --- Média ---------------------------------------------------------------

function buildMedia(entityId) {
  const title = h('p', { class: 'media-title' });
  const artist = h('p', { class: 'media-artist' });
  const playBtn = iconButton('play', 'Lecture / pause',
    () => store.call('media_player', 'media_play_pause', { entity_id: entityId }), 'ibtn--primary');

  const vol = slider({
    min: 0, max: 100, value: 20, label: 'Volume',
    onCommit: (v) => store.call('media_player', 'volume_set', { entity_id: entityId, volume_level: v / 100 })
  });

  const body = h('div', { class: 'card-body' }, [
    h('div', { class: 'media-meta' }, [title, artist]),
    h('div', { class: 'btn-row btn-row--center' }, [
      iconButton('prev', 'Précédent', () => store.call('media_player', 'media_previous_track', { entity_id: entityId })),
      playBtn,
      iconButton('next', 'Suivant', () => store.call('media_player', 'media_next_track', { entity_id: entityId }))
    ]),
    h('div', { class: 'range-row range-row--vol' }, [
      h('span', { class: 'range-ico', html: icon('volume') }), vol
    ])
  ]);

  const { el, sub } = shell(entityId, { body });

  const update = (e) => {
    const playing = e.state === 'playing';
    el.classList.toggle('is-on', playing || e.state === 'paused');
    title.textContent = e.attributes?.media_title || (e.state === 'off' ? 'Éteint' : 'Rien en cours');
    artist.textContent = e.attributes?.media_artist || e.attributes?.source || '';
    playBtn.innerHTML = icon(playing ? 'pause' : 'play');
    sub.textContent = stateLabel(e);
    const v = Number(e.attributes?.volume_level);
    if (Number.isFinite(v) && !vol.dataset.active) vol.value = Math.round(v * 100);
  };
  return { el, update };
}

// --- Serrures ------------------------------------------------------------

function buildLock(entityId) {
  const body = h('div', { class: 'card-body' }, [
    h('div', { class: 'btn-row' }, [
      h('button', {
        class: 'btn', type: 'button', html: `${icon('lock')}<span>Verrouiller</span>`,
        onclick: (ev) => { ev.stopPropagation(); store.call('lock', 'lock', { entity_id: entityId }); }
      }),
      h('button', {
        class: 'btn btn--ghost', type: 'button', html: `${icon('unlock')}<span>Ouvrir</span>`,
        onclick: (ev) => { ev.stopPropagation(); store.call('lock', 'unlock', { entity_id: entityId }); }
      })
    ])
  ]);
  const { el, sub, ico } = shell(entityId, { body });
  const update = (e) => {
    const locked = e.state === 'locked';
    el.classList.toggle('is-alert', !locked);
    ico.innerHTML = icon(locked ? 'lock' : 'unlock');
    sub.textContent = stateLabel(e);
  };
  return { el, update };
}

// --- Capteurs ------------------------------------------------------------

function buildSensor(entityId) {
  const value = h('strong', { class: 'sensor-value' });
  const sparkHolder = h('div', { class: 'sensor-spark' });
  const body = h('div', { class: 'card-body card-body--sensor' }, [value, sparkHolder]);
  const { el, sub } = shell(entityId, { modifier: 'card--compact', body });

  const update = (e) => {
    const unit = e.attributes?.unit_of_measurement || '';
    value.innerHTML = `${formatNumber(e.state)}<span class="sensor-unit">${unit}</span>`;
    sub.textContent = e.attributes?.device_class ? deviceClassLabel(e.attributes.device_class) : 'Capteur';
    const hist = store.history[entityId];
    sparkHolder.replaceChildren(hist && hist.length > 2 ? sparkline(hist) : document.createTextNode(''));
  };
  return { el, update };
}

function buildBinarySensor(entityId) {
  const pill = h('span', { class: 'pill' });
  const { el, sub } = shell(entityId, { modifier: 'card--compact', accessory: pill });
  const update = (e) => {
    const active = e.state === 'on';
    el.classList.toggle('is-active', active);
    pill.textContent = stateLabel(e);
    pill.className = `pill ${active ? 'pill--live' : ''}`;
    sub.textContent = deviceClassLabel(e.attributes?.device_class) || 'Détecteur';
  };
  return { el, update };
}

function buildGeneric(entityId) {
  const pill = h('span', { class: 'pill' });
  const { el, sub } = shell(entityId, { modifier: 'card--compact', accessory: pill });
  const update = (e) => {
    pill.textContent = stateLabel(e);
    sub.textContent = entityId;
  };
  return { el, update };
}

const DEVICE_CLASS_LABELS = {
  temperature: 'Température', humidity: 'Humidité', power: 'Puissance', energy: 'Énergie',
  battery: 'Batterie', motion: 'Mouvement', occupancy: 'Présence', door: 'Porte',
  garage_door: 'Porte de garage', window: 'Fenêtre', opening: 'Ouverture',
  illuminance: 'Luminosité', pressure: 'Pression', co2: 'CO₂'
};
function deviceClassLabel(dc) { return DEVICE_CLASS_LABELS[dc] || ''; }

const BUILDERS = {
  light: buildLight,
  switch: buildSwitch,
  fan: buildSwitch,
  climate: buildClimate,
  cover: buildCover,
  media_player: buildMedia,
  lock: buildLock,
  sensor: buildSensor,
  binary_sensor: buildBinarySensor
};

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
