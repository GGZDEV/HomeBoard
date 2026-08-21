/**
 * Rendu « 2.5D » isométrique du plan de la maison.
 *
 * Aucune modélisation 3D : chaque pièce est un ensemble de cases de grille
 * (voir geometry.js), extrudé en isométrique 2:1 côté client. Le sol et les
 * murs d'une pièce sont tracés en un seul `path` chacun, ce qui évite les
 * coutures d'anticrénelage entre cases voisines.
 */
import { icon as iconSvg } from './icons.js';
import {
  key, parseKey, roomCells, wallEdges, borderEdges, anchorCell, depthKey, floorBounds, floorCells
} from './geometry.js';

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
    this.pointers = new Map();

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

  /** Losange d'une case, en sous-chemin fermé. */
  cellPath(x, y, z = 0) {
    return `M${this.pt(x, y, z)}L${this.pt(x + 1, y, z)}L${this.pt(x + 1, y + 1, z)}L${this.pt(x, y + 1, z)}Z`;
  }

  // --- Rendu -------------------------------------------------------------

  render(floor, ctx) {
    const grid = ctx.config.grid || {};
    this.tile = {
      tw: grid.tileWidth || 66,
      th: grid.tileHeight || 33,
      wall: grid.wallHeight || 34
    };
    this.floor = floor;

    this.defs.replaceChildren();
    this.layerBase.replaceChildren();
    this.layerRooms.replaceChildren();
    this.layerTags.replaceChildren();

    const rooms = (floor?.rooms || [])
      .map((room) => ({ room, cells: roomCells(room) }))
      .filter(({ cells }) => cells.size);

    if (!rooms.length) {
      this.viewBox = { x: -200, y: -120, w: 400, h: 240 };
      this.svg.setAttribute('viewBox', '-200 -120 400 240');
      return;
    }

    this.buildDefs(floor);
    this.buildSlab(floor);

    // Peinture du fond vers l'avant : la pièce la plus éloignée d'abord.
    rooms.sort((a, b) => depthKey(a.cells) - depthKey(b.cells));
    for (const { room, cells } of rooms) {
      const { group, tag } = this.buildRoom(room, cells, ctx);
      this.layerRooms.append(group);
      this.layerTags.append(tag);
    }

    this.measureTags();
    this.fit();
  }

  buildDefs(floor) {
    // Dégradés en coordonnées utilisateur : une seule lumière pour tout
    // l'étage, quelle que soit la taille des pièces.
    const b = floorBounds(floor);
    const top = this.project(b.minX, b.minY).y;
    const bottom = this.project(b.maxX, b.maxY).y;

    this.defs.insertAdjacentHTML('beforeend', `
      <linearGradient id="iso-floor" gradientUnits="userSpaceOnUse" x1="0" y1="${top}" x2="0" y2="${bottom}">
        <stop offset="0%" stop-color="var(--iso-floor-1)"/>
        <stop offset="100%" stop-color="var(--iso-floor-2)"/>
      </linearGradient>
      <linearGradient id="iso-wall-a" gradientUnits="userSpaceOnUse" x1="0" y1="${top - this.tile.wall}" x2="0" y2="${bottom}">
        <stop offset="0%" stop-color="var(--iso-wall-a1)"/>
        <stop offset="100%" stop-color="var(--iso-wall-a2)"/>
      </linearGradient>
      <linearGradient id="iso-wall-b" gradientUnits="userSpaceOnUse" x1="0" y1="${top - this.tile.wall}" x2="0" y2="${bottom}">
        <stop offset="0%" stop-color="var(--iso-wall-b1)"/>
        <stop offset="100%" stop-color="var(--iso-wall-b2)"/>
      </linearGradient>
      <radialGradient id="iso-ground">
        <stop offset="0%" stop-color="var(--iso-ground)" stop-opacity="0.5"/>
        <stop offset="100%" stop-color="var(--iso-ground)" stop-opacity="0"/>
      </radialGradient>
    `);
  }

  buildSlab(floor) {
    const cells = floorCells(floor);
    const depth = 15;

    const top = [];
    const sides = [];
    for (const k of cells) {
      const [x, y] = parseKey(k);
      top.push(this.cellPath(x, y, -depth));
      // Faces visibles du socle : les bords sud et est.
      if (!cells.has(key(x, y + 1))) {
        sides.push(`M${this.pt(x, y + 1)}L${this.pt(x + 1, y + 1)}L${this.pt(x + 1, y + 1, -depth)}L${this.pt(x, y + 1, -depth)}Z`);
      }
      if (!cells.has(key(x + 1, y))) {
        sides.push(`M${this.pt(x + 1, y)}L${this.pt(x + 1, y + 1)}L${this.pt(x + 1, y + 1, -depth)}L${this.pt(x + 1, y, -depth)}Z`);
      }
    }

    const b = floorBounds(floor);
    const center = this.project((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);

    this.layerBase.append(
      el('ellipse', {
        class: 'iso-ground', cx: center.x, cy: center.y + 26,
        rx: (b.w + b.h) * this.tile.tw * 0.34,
        ry: (b.w + b.h) * this.tile.th * 0.4,
        fill: 'url(#iso-ground)'
      }),
      el('path', { class: 'slab-bottom', d: top.join(''), fill: 'var(--iso-slab-2)' }),
      el('path', { class: 'slab-face', d: sides.join(''), fill: 'var(--iso-slab-1)' })
    );
  }

  buildRoom(room, cells, ctx) {
    const info = summarize(room, ctx.entities, cells);
    const { wall } = this.tile;

    const floorPath = [];
    for (const k of cells) {
      const [x, y] = parseKey(k);
      floorPath.push(this.cellPath(x, y));
    }

    const { north, west } = wallEdges(cells);
    const northPath = north.map(([x, y]) =>
      `M${this.pt(x, y)}L${this.pt(x + 1, y)}L${this.pt(x + 1, y, wall)}L${this.pt(x, y, wall)}Z`).join('');
    const westPath = west.map(([x, y]) =>
      `M${this.pt(x, y)}L${this.pt(x, y + 1)}L${this.pt(x, y + 1, wall)}L${this.pt(x, y, wall)}Z`).join('');
    const rimPath = [
      ...north.map(([x, y]) => `M${this.pt(x, y, wall)}L${this.pt(x + 1, y, wall)}`),
      ...west.map(([x, y]) => `M${this.pt(x, y, wall)}L${this.pt(x, y + 1, wall)}`)
    ].join('');

    const g = el('g', {
      class: `room${info.lightsOn ? ' is-lit' : ''}`,
      'data-room': room.id,
      tabindex: '0',
      role: 'button',
      'aria-label': `${room.name}${info.temp != null ? `, ${info.temp} degrés` : ''}`
    });

    const floorNode = el('path', { class: 'room-floor', d: floorPath.join(''), fill: 'url(#iso-floor)' });
    g.append(floorNode);

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
      const [ccx, ccy] = info.centroid;
      const c = this.project(ccx, ccy);
      const spread = Math.sqrt(cells.size);
      g.append(
        el('path', {
          class: 'room-tint', d: floorPath.join(''),
          fill: `rgb(${r},${gr},${b})`, opacity: (0.06 + info.brightness * 0.14).toFixed(3)
        }),
        el('ellipse', {
          class: 'room-glow', cx: c.x, cy: c.y,
          rx: spread * this.tile.tw * 0.62, ry: spread * this.tile.th * 0.72,
          fill: `url(#${gradId})`
        })
      );
    }

    // Le contour ne suit que le pourtour de la pièce : tracer le chemin des
    // cases dessinerait toutes les jointures internes.
    const outlineD = borderEdges(cells)
      .map(([[x1, y1], [x2, y2]]) => `M${this.pt(x1, y1)}L${this.pt(x2, y2)}`)
      .join('');
    const outline = el('path', { class: 'room-outline', d: outlineD, fill: 'none' });
    if (info.lightsOn) outline.style.setProperty('--lit', `rgb(${info.color.join(',')})`);

    g.append(
      el('path', { class: 'wall wall--left', d: westPath, fill: 'url(#iso-wall-b)' }),
      el('path', { class: 'wall wall--right', d: northPath, fill: 'url(#iso-wall-a)' }),
      el('path', { class: 'wall-rim', d: rimPath, fill: 'none' }),
      outline
    );

    return { group: g, tag: this.buildTag(room, info) };
  }

  buildTag(room, info) {
    const [ax, ay] = info.anchor;
    const c = this.project(ax + 0.5, ay + 0.5);
    const tag = el('g', {
      class: `room-tag${info.lightsOn ? ' is-lit' : ''}`,
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

    return tag;
  }

  /** Ajuste la largeur des étiquettes au texte réellement rendu. */
  measureTags() {
    for (const tag of this.layerTags.querySelectorAll('.room-tag')) {
      const plate = tag.querySelector('.tag-plate');
      const texts = [...tag.querySelectorAll('text')];

      let textW = 0;
      for (const t of texts) {
        try { textW = Math.max(textW, t.getBBox().width); } catch { /* non rendu */ }
      }

      const width = Math.max(104, Math.round(34 + textW + 14));
      plate.setAttribute('width', width);
      plate.setAttribute('x', -width / 2);

      const left = -width / 2;
      tag.querySelector('.tag-icon').setAttribute('transform', `translate(${left + 10},-8) scale(0.66)`);
      for (const t of texts) t.setAttribute('x', left + 32);
    }
  }

  // --- Caméra ------------------------------------------------------------

  fit() {
    const box = this.layerRooms.getBBox();
    const tagBox = this.layerTags.getBBox();
    const pad = 40;
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
    this.camera.s = clamp(this.camera.s * delta, 0.5, 3);
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

  /** Rapport entre unités du viewBox et pixels écran. */
  viewScale() {
    return this.viewBox && this.svg.clientWidth
      ? this.viewBox.w / this.svg.clientWidth
      : 1;
  }

  bindInteractions() {
    const svg = this.svg;

    svg.addEventListener('click', (ev) => {
      if (this.dragged) return;
      const room = ev.target.closest?.('.room');
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

    const gesture = { mode: null, start: null };

    const points = () => [...this.pointers.values()];
    const spread = () => {
      const [a, b] = points();
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const midpoint = () => {
      const [a, b] = points();
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    svg.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      // Un relâchement perdu laisserait un pointeur fantôme : on repart net.
      if (ev.isPrimary && this.pointers.size) {
        this.pointers.clear();
        gesture.mode = null;
      }
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this.dragged = false;

      if (this.pointers.size === 1) {
        gesture.mode = 'pan';
        gesture.start = { x: ev.clientX, y: ev.clientY, cx: this.camera.x, cy: this.camera.y };
      } else if (this.pointers.size === 2) {
        // Pincer pour zoomer : indispensable sur téléphone et tablette.
        gesture.mode = 'pinch';
        const mid = midpoint();
        gesture.start = {
          dist: spread(), scale: this.camera.s,
          x: mid.x, y: mid.y, cx: this.camera.x, cy: this.camera.y
        };
      }
    });

    svg.addEventListener('pointermove', (ev) => {
      if (!this.pointers.has(ev.pointerId)) return;
      this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      const scale = this.viewScale();

      if (gesture.mode === 'pinch' && this.pointers.size >= 2) {
        const mid = midpoint();
        this.camera.s = clamp(gesture.start.scale * (spread() / gesture.start.dist), 0.5, 3);
        this.camera.x = gesture.start.cx + (mid.x - gesture.start.x) * scale;
        this.camera.y = gesture.start.cy + (mid.y - gesture.start.y) * scale;
        this.dragged = true;
        this.applyCamera();
        return;
      }

      if (gesture.mode !== 'pan' || !gesture.start) return;
      const dx = (ev.clientX - gesture.start.x) * scale;
      const dy = (ev.clientY - gesture.start.y) * scale;

      // La capture n'est prise qu'au vrai début du glisser : sinon elle
      // redirigerait le « click » vers le <svg> et casserait la sélection.
      if (!this.dragged && Math.hypot(dx, dy) > 5) {
        this.dragged = true;
        svg.classList.add('is-panning');
        try { svg.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      }
      if (!this.dragged) return;

      this.camera.x = gesture.start.cx + dx;
      this.camera.y = gesture.start.cy + dy;
      this.applyCamera();
    });

    const endPointer = (ev) => {
      this.pointers.delete(ev.pointerId);
      try { svg.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
      if (this.pointers.size === 0) {
        gesture.mode = null;
        svg.classList.remove('is-panning');
        setTimeout(() => { this.dragged = false; }, 0);
      } else if (this.pointers.size === 1) {
        const [only] = points();
        gesture.mode = 'pan';
        gesture.start = { x: only.x, y: only.y, cx: this.camera.x, cy: this.camera.y };
      }
    };
    // Écoute sur la fenêtre : le doigt peut se lever hors du plan.
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);
  }
}

// --- Utilitaires ---------------------------------------------------------

/**
 * Contenu d'une icône, prêt à être injecté dans un <g>. Les attributs de
 * présentation du <svg> d'origine sont réappliqués, sinon les tracés
 * seraient rendus en aplat noir.
 */
function iconInner(name) {
  const inner = iconSvg(name).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  return `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
}

/**
 * Résumé d'une pièce : ses lumières et sa température, rien de plus.
 */
export function summarize(room, entities, cells = roomCells(room)) {
  const list = (room.entities || []).map((id) => entities[id]).filter(Boolean);

  const lights = list.filter((e) => e.entity_id.startsWith('light.'));
  const onLights = lights.filter((e) => e.state === 'on');

  const sensor = list.find(
    (e) => e.attributes?.device_class === 'temperature' && Number.isFinite(Number(e.state))
  );
  const temp = sensor ? Number(sensor.state) : null;

  const rgb = onLights
    .map((e) => e.attributes?.rgb_color)
    .filter((c) => Array.isArray(c) && c.length === 3);
  const color = rgb.length
    ? rgb.reduce((acc, c) => acc.map((v, i) => v + c[i] / rgb.length), [0, 0, 0]).map(Math.round)
    : DEFAULT_LIGHT;

  const brightness = onLights.length
    ? Math.max(...onLights.map((e) => (Number(e.attributes?.brightness) || 255) / 255))
    : 0;

  const parts = [];
  if (temp != null) parts.push(`${temp.toFixed(1)}°`);
  if (onLights.length) parts.push(`${onLights.length} allumée${onLights.length > 1 ? 's' : ''}`);
  else if (lights.length) parts.push(`${lights.length} lumière${lights.length > 1 ? 's' : ''}`);

  const { cell, centroid } = anchorCell(cells);

  return {
    entities: list,
    lights: lights.map((e) => e.entity_id),
    lightsOn: onLights.length,
    lightsTotal: lights.length,
    color,
    brightness,
    temp,
    meta: parts.join(' · '),
    anchor: cell,
    centroid
  };
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
