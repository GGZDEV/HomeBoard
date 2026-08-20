/**
 * Cartes de contrôle.
 *
 * Le produit ne couvre volontairement que deux domaines : les lumières
 * (pilotables) et les températures (en lecture). Chaque carte expose
 * { el, update(entity) } pour une mise à jour ciblée — les curseurs restent
 * donc utilisables pendant qu'on les manipule.
 */
import { store } from './store.js';
import { icon } from './icons.js';

const COLOR_PRESETS = [
  [255, 244, 224], [255, 214, 170], [255, 170, 120],
  [255, 120, 160], [170, 130, 255], [110, 190, 255], [130, 240, 200]
];

export const isLight = (entityId) => entityId.startsWith('light.');

export function friendlyName(entityId, entity) {
  return entity?.attributes?.friendly_name
    || entityId.split('.')[1].replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

export function stateLabel(entity) {
  if (!entity) return '—';
  if (entity.entity_id.startsWith('light.')) return entity.state === 'on' ? 'Allumée' : 'Éteinte';
  if (entity.state === 'unavailable') return 'Indisponible';
  const unit = entity.attributes?.unit_of_measurement;
  return unit ? `${formatNumber(entity.state)} ${unit}` : entity.state;
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
function sparkline(values, cls = '') {
  if (!values || values.length < 3) return h('div', { class: `spark spark--empty ${cls}` });
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
  return isLight(entityId) ? buildLight(entityId) : buildTemperature(entityId);
}

function shell(entityId, { modifier = '', accessory = null, body = null, iconName } = {}) {
  const entity = store.get(entityId);
  const sub = h('p', { class: 'card-sub', text: stateLabel(entity) });
  const title = h('h4', { class: 'card-name', text: friendlyName(entityId, entity) });
  const ico = h('span', { class: 'card-ico', html: icon(iconName) });

  const head = h('div', { class: 'card-head' }, [ico, h('div', { class: 'card-title' }, [title, sub]), accessory]);
  const el = h('article', {
    class: `card card--${isLight(entityId) ? 'light' : 'temp'} ${modifier}`.trim(),
    dataset: { entity: entityId }
  }, [head, body]);

  return { el, sub, ico, title };
}

function slider({ value = 0, label, onInput, onCommit }) {
  const input = h('input', {
    class: 'range', type: 'range', min: 1, max: 100, step: 1, value, 'aria-label': label
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

// --- Lumières ------------------------------------------------------------

function buildLight(entityId) {
  const entity = store.get(entityId) || {};

  const sw = h('button', {
    class: 'switch', type: 'button', 'aria-label': 'Allumer ou éteindre',
    onclick: (ev) => { ev.stopPropagation(); store.call('light', 'toggle', { entity_id: entityId }); }
  }, [h('span', { class: 'switch-knob' })]);

  const pct = h('span', { class: 'range-value' });
  const bright = slider({
    value: Math.round(((entity.attributes?.brightness ?? 255) / 255) * 100),
    label: 'Luminosité',
    onInput: (v) => { pct.textContent = `${v} %`; },
    onCommit: (v) => store.call('light', 'turn_on', { entity_id: entityId, brightness: Math.round(v * 2.55) })
  });

  const swatches = h('div', { class: 'swatches' }, COLOR_PRESETS.map(([r, g, b]) => h('button', {
    class: 'swatch', type: 'button', 'aria-label': `Teinte ${r}, ${g}, ${b}`,
    style: `--sw: rgb(${r},${g},${b})`,
    onclick: (ev) => {
      ev.stopPropagation();
      store.call('light', 'turn_on', { entity_id: entityId, rgb_color: [r, g, b] });
    }
  })));

  const supportsColor = (entity.attributes?.supported_color_modes || []).some(
    (m) => ['rgb', 'rgbw', 'rgbww', 'hs', 'xy'].includes(m)
  ) || Array.isArray(entity.attributes?.rgb_color);

  const supportsBrightness = supportsColor
    || entity.attributes?.brightness != null
    || (entity.attributes?.supported_color_modes || []).some((m) => m !== 'onoff');

  const body = (supportsBrightness || supportsColor)
    ? h('div', { class: 'card-body' }, [
      supportsBrightness ? h('div', { class: 'range-row' }, [bright, pct]) : null,
      supportsColor ? swatches : null
    ])
    : null;

  const { el, sub } = shell(entityId, { accessory: sw, body, iconName: 'bulb' });

  const update = (e) => {
    const on = e.state === 'on';
    el.classList.toggle('is-on', on);
    sw.classList.toggle('is-on', on);
    sw.setAttribute('aria-pressed', String(on));

    const b = Math.round(((e.attributes?.brightness ?? 255) / 255) * 100);
    sub.textContent = on && supportsBrightness ? `Allumée · ${b} %` : stateLabel(e);
    pct.textContent = `${b} %`;
    if (!bright.dataset.active) bright.value = b;

    const rgb = e.attributes?.rgb_color;
    el.style.setProperty('--card-accent', rgb ? `rgb(${rgb.join(',')})` : 'var(--warm)');
  };
  return { el, update };
}

// --- Températures --------------------------------------------------------

function buildTemperature(entityId) {
  const value = h('strong', { class: 'sensor-value' });
  const spark = h('div', { class: 'sensor-spark' });
  const body = h('div', { class: 'card-body card-body--sensor' }, [value, spark]);
  const { el, sub } = shell(entityId, { modifier: 'card--compact', body, iconName: 'thermometer' });

  const update = (e) => {
    const unit = e.attributes?.unit_of_measurement || '°C';
    value.innerHTML = `${formatNumber(e.state)}<span class="sensor-unit">${unit}</span>`;
    sub.textContent = 'Température';
    const history = store.history[entityId];
    spark.replaceChildren(sparkline(history));
  };
  return { el, update };
}
