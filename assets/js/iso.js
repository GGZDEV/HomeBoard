/**
 * Rendu « 2.5D » isométrique du plan de la maison.
 *
 * Aucune modélisation 3D : chaque pièce est un simple rectangle (x, y, w, h)
 * décrit dans config/home.json, extrudé en isométrique 2:1 côté client.
 */
import { icon as iconSvg } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_LIGHT = [255, 198, 132];

const el = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  return node;
};

export class IsoStage {
  constructor(container, { onSelect } = {}) {
    this.container = container;
    this.onSelect = onSelect || (() => {});
    this.camera = { x: 0, y: 0, s: 1 };
    this.selected = null;
    this.geometry = null;

    this.svg = el('svg', { class: 'iso', xmlns: SVG_NS, 'aria-label': 'Plan isométrique de la maison' });
    this.defs = el('defs');
    this.camGroup = el('g', { class: 'iso-camera' });
    this.layerBase = el('g', { class: 'iso-base' });
    this.layerRooms = el('g', { class: 'iso-rooms' });
    this.layerTags = el('g', { class: 'iso-tags' });

    this.camGroup.append(this.layerBase, this.layerRooms, this.layerTags);
    this.svg.append(this.defs, this.camGroup);
    container.append(this.svg);

    this.bindInteractions();
  }

  // --- Projection --------------------------------------------------------

  project(gx, gy, gz = 0) {
    const { tw, th } = this.tile;
    return { x: (gx - gy) * (tw / 2), y: (gx + gy) * (th / 2) - gz };
  }

  pt(gx, gy, gz = 0) {
    const p = this.project(gx, gy, gz);
    return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  }

  // --- Rendu -------------------------------------------------------------

  render(floor, ctx) {
    const grid = ctx.config.grid || {};
    this.tile = {
      tw: grid.tileWidth || 66,
      th: grid.tileHeight || 33,
      wall: grid.wallHeight || 40
    };
    this.floor = floor;

    this.defs.replaceChildren();
    this.layerBase.replaceChildren();
    this.layerRooms.replaceChildren();
    this.layerTags.replaceChildren();

    this.buildDefs();
    this.buildSlab(floor);

    // Les pièces sont peintes de la plus lointaine à la plus proche ; les
    // étiquettes vivent dans un calque au-dessus pour ne jamais être masquées.
    const rooms = [...floor.rooms].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const room of rooms) {
      const { group, tag } = this.buildRoom(room, ctx);
      this.layerRooms.append(group);
      this.layerTags.append(tag);
    }

    this.measureTags();
    this.fit();
  }

  buildDefs() {
    this.defs.insertAdjacentHTML('beforeend', `
      <linearGradient id="iso-floor" x1="0" y1="0" x2="0.4" y2="1">
        <stop offset="0%" stop-color="var(--iso-floor-1)"/>
        <stop offset="100%" stop-color="var(--iso-floor-2)"/>
      </linearGradient>
      <linearGradient id="iso-wall-a" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--iso-wall-a1)"/>
        <stop offset="100%" stop-color="var(--iso-wall-a2)"/>
      </linearGradient>
      <linearGradient id="iso-wall-b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--iso-wall-b1)"/>
        <stop offset="100%" stop-color="var(--iso-wall-b2)"/>
      </linearGradient>
      <linearGradient id="iso-slab" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--iso-slab-1)"/>
        <stop offset="100%" stop-color="var(--iso-slab-2)"/>
      </linearGradient>
      <radialGradient id="iso-ground">
        <stop offset="0%" stop-color="var(--iso-ground)" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="var(--iso-ground)" stop-opacity="0"/>
      </radialGradient>
    `);
  }

  buildSlab(floor) {
    const bounds = floorBounds(floor);
    const { minX, minY, maxX, maxY } = bounds;
    const depth = 16;

    const A = this.pt(minX, minY);
    const B = this.pt(maxX, minY);
    const C = this.pt(maxX, maxY);
    const D = this.pt(minX, maxY);
    const Cd = this.pt(maxX, maxY, -depth);
    const Dd = this.pt(minX, maxY, -depth);
    const Bd = this.pt(maxX, minY, -depth);

    const center = this.project((minX + maxX) / 2, (minY + maxY) / 2);
    const rx = ((maxX - minX) + (maxY - minY)) * this.tile.tw * 0.36;
    const ry = ((maxX - minX) + (maxY - minY)) * this.tile.th * 0.42;

    this.layerBase.append(
      el('ellipse', {
        class: 'iso-ground', cx: center.x, cy: center.y + 26,
        rx, ry, fill: 'url(#iso-ground)'
      }),
      el('polygon', { class: 'slab-face', points: `${D} ${C} ${Cd} ${Dd}`, fill: 'url(#iso-slab)' }),
      el('polygon', { class: 'slab-face slab-face--right', points: `${C} ${B} ${Bd} ${Cd}`, fill: 'url(#iso-slab)' }),
      el('polygon', { class: 'slab-top', points: `${A} ${B} ${C} ${D}`, fill: 'var(--iso-slab-top)' })
    );
  }

  buildRoom(room, ctx) {
    const info = summarize(room, ctx.entities);
    const { wall } = this.tile;
    const { x, y, w, h } = room;

    const A = this.pt(x, y);
    const B = this.pt(x + w, y);
    const C = this.pt(x + w, y + h);
    const D = this.pt(x, y + h);
    const Au = this.pt(x, y, wall);
    const Bu = this.pt(x + w, y, wall);
    const Du = this.pt(x, y + h, wall);

    const g = el('g', {
      class: `room${info.lightsOn ? ' is-lit' : ''}`,
      'data-room': room.id,
      tabindex: '0',
      role: 'button',
      'aria-label': `${room.name}${info.temp != null ? `, ${info.temp} degrés` : ''}`
    });

    g.append(el('polygon', { class: 'room-floor', points: `${A} ${B} ${C} ${D}`, fill: 'url(#iso-floor)' }));

    if (info.lightsOn) {
      const gradId = `glow-${this.floor.id}-${room.id}`;
      const [r, gr, b] = info.color;
      this.defs.insertAdjacentHTML('beforeend', `
        <radialGradient id="${gradId}">
          <stop offset="0%" stop-color="rgb(${r},${gr},${b})" stop-opacity="${(0.30 + info.brightness * 0.45).toFixed(2)}"/>
          <stop offset="55%" stop-color="rgb(${r},${gr},${b})" stop-opacity="${(0.10 + info.brightness * 0.16).toFixed(2)}"/>
          <stop offset="100%" stop-color="rgb(${r},${gr},${b})" stop-opacity="0"/>
        </radialGradient>
      `);
      const c = this.project(x + w / 2, y + h / 2);
      g.append(
        el('polygon', {
          class: 'room-tint', points: `${A} ${B} ${C} ${D}`,
          fill: `rgb(${r},${gr},${b})`, opacity: (0.06 + info.brightness * 0.14).toFixed(3)
        }),
        el('ellipse', {
          class: 'room-glow', cx: c.x, cy: c.y,
          rx: (w + h) * this.tile.tw * 0.22, ry: (w + h) * this.tile.th * 0.26,
          fill: `url(#${gradId})`
        })
      );
    }

    g.append(
      el('polygon', { class: 'wall wall--left', points: `${A} ${D} ${Du} ${Au}`, fill: 'url(#iso-wall-b)' }),
      el('polygon', { class: 'wall wall--right', points: `${A} ${B} ${Bu} ${Au}`, fill: 'url(#iso-wall-a)' }),
      el('polyline', { class: 'wall-rim', points: `${Du} ${Au} ${Bu}`, fill: 'none' }),
      el('polygon', { class: 'room-outline', points: `${A} ${B} ${C} ${D}`, fill: 'none' })
    );

    if (info.lightsOn) {
      const [r, gr, b] = info.color;
      g.querySelector('.room-outline').style.setProperty('--lit', `rgb(${r},${gr},${b})`);
      g.classList.add('is-lit');
    }

    return { group: g, tag: this.buildTag(room, info) };
  }

  buildTag(room, info) {
    const c = this.project(room.x + room.w / 2, room.y + room.h / 2);
    const tag = el('g', {
      class: `room-tag${info.lightsOn ? ' is-lit' : ''}${info.alert ? ' is-alert' : ''}`,
      'data-room': room.id,
      transform: `translate(${c.x.toFixed(1)}, ${c.y.toFixed(1)})`
    });

    tag.append(el('rect', { class: 'tag-plate', rx: 12, x: -62, y: -18, width: 124, height: 36 }));

    tag.insertAdjacentHTML('beforeend',
      `<g class="tag-icon" transform="translate(-52,-8) scale(0.66)">${iconInner(room.icon || 'grid')}</g>`);

    const name = el('text', { class: 'tag-name', x: -32, y: info.meta ? -3 : 4.5 });
    name.textContent = room.name;
    tag.append(name);

    if (info.meta) {
      const meta = el('text', { class: 'tag-meta', x: -32, y: 9.5 });
      meta.textContent = info.meta;
      tag.append(meta);
    }

    // Les équipements actifs sont alignés à droite, dans l'étiquette :
    // une seule boîte par pièce, donc beaucoup moins de chevauchements.
    if (info.pucks.length) {
      const pucks = el('g', { class: 'tag-pucks' });
      info.pucks.forEach((puck, i) => {
        pucks.insertAdjacentHTML('beforeend',
          `<g class="puck puck--${puck.tone}" transform="translate(${i * 17},-6.5) scale(0.55)">${iconInner(puck.icon)}</g>`);
      });
      tag.append(pucks);
    }

    return tag;
  }

  /** Ajuste la largeur des étiquettes au texte réellement rendu. */
  measureTags() {
    for (const tag of this.layerTags.querySelectorAll('.room-tag')) {
      const plate = tag.querySelector('.tag-plate');
      const texts = [...tag.querySelectorAll('text')];
      const pucks = tag.querySelector('.tag-pucks');
      const puckCount = pucks ? pucks.children.length : 0;

      let textW = 0;
      for (const t of texts) {
        try { textW = Math.max(textW, t.getBBox().width); } catch { /* non rendu */ }
      }

      const puckW = puckCount ? puckCount * 17 + 6 : 0;
      const width = Math.max(104, Math.round(34 + textW + puckW + 14));
      plate.setAttribute('width', width);
      plate.setAttribute('x', -width / 2);

      const left = -width / 2;
      tag.querySelector('.tag-icon').setAttribute('transform', `translate(${left + 10},-8) scale(0.66)`);
      const textX = left + 32;
      for (const t of texts) t.setAttribute('x', textX);
      if (pucks) pucks.setAttribute('transform', `translate(${(width / 2 - puckW + 3).toFixed(1)}, 0)`);
    }
  }

  // --- Caméra ------------------------------------------------------------

  fit() {
    // On cadre sur les pièces et leurs étiquettes : l'ombre au sol, volontairement
    // très large, ne doit pas éloigner la caméra.
    const box = this.layerRooms.getBBox();
    const tagBox = this.layerTags.getBBox();
    const pad = 46;
    const minX = Math.min(box.x, tagBox.x) - pad;
    const minY = Math.min(box.y, tagBox.y) - pad;
    const maxX = Math.max(box.x + box.width, tagBox.x + tagBox.width) + pad;
    const maxY = Math.max(box.y + box.height, tagBox.y + tagBox.height) + pad;
    this.viewBox = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    this.svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.applyCamera();
  }

  applyCamera() {
    const { x, y, s } = this.camera;
    const cx = this.viewBox ? this.viewBox.x + this.viewBox.w / 2 : 0;
    const cy = this.viewBox ? this.viewBox.y + this.viewBox.h / 2 : 0;
    this.camGroup.setAttribute(
      'transform',
      `translate(${cx + x} ${cy + y}) scale(${s}) translate(${-cx} ${-cy})`
    );
  }

  zoom(delta) {
    this.camera.s = clamp(this.camera.s * delta, 0.55, 2.8);
    this.applyCamera();
  }

  resetCamera() {
    this.camera = { x: 0, y: 0, s: 1 };
    this.applyCamera();
  }

  select(roomId) {
    this.selected = roomId;
    const nodes = [
      ...this.layerRooms.querySelectorAll('.room'),
      ...this.layerTags.querySelectorAll('.room-tag')
    ];
    for (const node of nodes) {
      node.classList.toggle('is-selected', node.dataset.room === roomId);
      node.classList.toggle('is-dimmed', Boolean(roomId) && node.dataset.room !== roomId);
    }
  }

  bindInteractions() {
    const svg = this.svg;

    svg.addEventListener('click', (ev) => {
      const room = ev.target.closest?.('.room');
      if (this.dragged) return;
      this.onSelect(room ? room.dataset.room : null);
    });

    svg.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const room = ev.target.closest?.('.room');
      if (!room) return;
      ev.preventDefault();
      this.onSelect(room.dataset.room);
    });

    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoom(ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    let start = null;
    svg.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      start = { px: ev.clientX, py: ev.clientY, cx: this.camera.x, cy: this.camera.y };
      this.dragged = false;
    });

    svg.addEventListener('pointermove', (ev) => {
      if (!start) return;
      const scale = this.viewBox ? this.viewBox.w / svg.clientWidth : 1;
      const dx = (ev.clientX - start.px) * scale;
      const dy = (ev.clientY - start.py) * scale;
      // La capture du pointeur n'est prise qu'au vrai début du glisser : sinon
      // elle redirigerait l'événement « click » vers le <svg> et casserait la
      // sélection des pièces.
      if (!this.dragged && Math.hypot(dx, dy) > 4) {
        this.dragged = true;
        svg.classList.add('is-panning');
        try { svg.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      }
      if (!this.dragged) return;
      this.camera.x = start.cx + dx;
      this.camera.y = start.cy + dy;
      this.applyCamera();
    });

    const endDrag = (ev) => {
      if (!start) return;
      start = null;
      svg.classList.remove('is-panning');
      try { svg.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      setTimeout(() => { this.dragged = false; }, 0);
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);
  }
}

// --- Utilitaires ---------------------------------------------------------

function iconInner(name) {
  const html = iconSvg(name);
  return html.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

function floorBounds(floor) {
  const xs = floor.rooms.flatMap((r) => [r.x, r.x + r.w]);
  const ys = floor.rooms.flatMap((r) => [r.y, r.y + r.h]);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys)
  };
}

/** Résumé d'une pièce à partir des entités qui lui sont rattachées. */
export function summarize(room, entities) {
  const list = (room.entities || []).map((id) => entities[id]).filter(Boolean);

  const lights = list.filter((e) => e.entity_id.startsWith('light.'));
  const onLights = lights.filter((e) => e.state === 'on');
  const climate = list.find((e) => e.entity_id.startsWith('climate.'));
  const tempSensor = list.find((e) => e.attributes?.device_class === 'temperature');
  const humidity = list.find((e) => e.attributes?.device_class === 'humidity');
  const media = list.find((e) => e.entity_id.startsWith('media_player.') && e.state === 'playing');
  const openCover = list.find((e) => e.entity_id.startsWith('cover.') && e.state === 'open');
  const motion = list.find((e) => e.attributes?.device_class === 'motion' && e.state === 'on');
  const openDoor = list.find(
    (e) => ['door', 'garage_door', 'window', 'opening'].includes(e.attributes?.device_class) && e.state === 'on'
  );
  const unlocked = list.find((e) => e.entity_id.startsWith('lock.') && e.state === 'unlocked');
  const activeSwitch = list.find((e) => e.entity_id.startsWith('switch.') && e.state === 'on');

  let temp = null;
  if (tempSensor && Number.isFinite(Number(tempSensor.state))) temp = Number(tempSensor.state);
  else if (climate && Number.isFinite(Number(climate.attributes?.current_temperature))) {
    temp = Number(climate.attributes.current_temperature);
  }

  const rgb = onLights
    .map((e) => e.attributes?.rgb_color)
    .filter((c) => Array.isArray(c) && c.length === 3);
  const color = rgb.length
    ? rgb.reduce((acc, c) => acc.map((v, i) => v + c[i] / rgb.length), [0, 0, 0]).map(Math.round)
    : DEFAULT_LIGHT;

  const brightness = onLights.length
    ? Math.max(...onLights.map((e) => (Number(e.attributes?.brightness) || 255) / 255))
    : 0;

  const metaParts = [];
  if (temp != null) metaParts.push(`${temp.toFixed(1)}°`);
  if (humidity && Number.isFinite(Number(humidity.state))) metaParts.push(`${Math.round(Number(humidity.state))} %`);
  if (onLights.length) metaParts.push(`${onLights.length} allumée${onLights.length > 1 ? 's' : ''}`);
  if (!metaParts.length && list.length) metaParts.push(`${list.length} appareil${list.length > 1 ? 's' : ''}`);

  const pucks = [];
  if (onLights.length) pucks.push({ icon: 'bulb', tone: 'warm' });
  if (media) pucks.push({ icon: media.entity_id.includes('tv') ? 'tv' : 'speaker', tone: 'accent' });
  if (climate && climate.state !== 'off') pucks.push({ icon: 'thermometer', tone: 'heat' });
  if (openCover) pucks.push({ icon: 'blinds', tone: 'muted' });
  if (activeSwitch) pucks.push({ icon: 'plug', tone: 'muted' });
  if (motion) pucks.push({ icon: 'motion', tone: 'accent' });
  if (openDoor || unlocked) pucks.push({ icon: 'unlock', tone: 'alert' });

  return {
    entities: list,
    lightsOn: onLights.length,
    lightsTotal: lights.length,
    color,
    brightness,
    temp,
    meta: metaParts.slice(0, 2).join(' · '),
    pucks: pucks.slice(0, 4),
    alert: Boolean(openDoor || unlocked)
  };
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
