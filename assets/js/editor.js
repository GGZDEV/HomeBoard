/**
 * Éditeur de plan visuel.
 *
 * Vue de dessus, à la souris comme au doigt : on pose des pièces, on les
 * déplace, on les redimensionne par les poignées, et on peint des cases pour
 * obtenir n'importe quelle forme (L, T, U…). Le JSON n'est plus qu'un format
 * de sauvegarde — il n'est jamais nécessaire de l'ouvrir.
 */
import { icon, hasIcon } from './icons.js';
import { h, friendlyName, stateLabel, isLight } from './cards.js';
import { autoAssignEntities, unassignedEntities, slugify } from './capabilities.js';
import {
  key, parseKey, roomCells, setRoomCells, boundsOfCells, borderEdges, anchorCell,
  occupiedCells, collides, cellsOfRect, findFreeSpotNear, isSingleRect, normalizeRects,
  translateCells
} from './geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const CELL = 34;
const MIN_SCALE = 0.35;
const MAX_SCALE = 3;

const ROOM_ICONS = [
  'sofa', 'bed', 'cooking', 'shower', 'door', 'laptop', 'car', 'stairs',
  'tv', 'speaker', 'coffee', 'grid'
];

const HANDLES = [
  ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
  ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1],
  ['sw', 0, 1], ['w', 0, 0.5]
];

const svgEl = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  return node;
};

export class PlanEditor {
  constructor(container, { config, entities, onChange, onDone }) {
    this.container = container;
    this.config = config;
    this.entities = entities;
    this.onChange = onChange || (() => {});
    this.onDone = onDone || (() => {});

    this.floorId = config.floors[0]?.id || null;
    this.roomId = null;
    this.tool = 'select';
    this.camera = { x: 0, y: 0, s: 1 };
    this.history = [];
    this.nodes = new Map();
    this.pointers = new Map();

    this.build();
    this.renderFloors();
    this.renderCanvas();
    this.renderInspector();
    requestAnimationFrame(() => this.fitCamera());
  }

  get floor() {
    return this.config.floors.find((f) => f.id === this.floorId) || this.config.floors[0];
  }

  get room() {
    return this.floor?.rooms.find((r) => r.id === this.roomId) || null;
  }

  // --- Structure ---------------------------------------------------------

  build() {
    this.topBar = h('header', { class: 'ed-top' });
    this.dock = h('div', { class: 'ed-dock' });
    this.inspector = h('aside', { class: 'ed-inspector' });
    this.hint = h('div', { class: 'ed-canvas-hint', hidden: true });
    this.canvasWrap = h('div', { class: 'ed-canvas', dataset: { tool: 'select' } });

    this.svg = svgEl('svg', { class: 'ed-svg' });
    this.world = svgEl('g', { class: 'ed-world' });
    this.gridLayer = svgEl('g', { class: 'ed-grid' });
    this.roomLayer = svgEl('g', { class: 'ed-rooms' });
    this.handleLayer = svgEl('g', { class: 'ed-handles' });
    this.world.append(this.gridLayer, this.roomLayer, this.handleLayer);
    this.svg.append(this.world);
    this.canvasWrap.append(this.svg, this.hint, this.dock);

    this.buildDock();
    this.buildGrid();

    this.container.replaceChildren(
      h('div', { class: 'ed' }, [this.topBar, this.canvasWrap, this.inspector])
    );

    this.bindPointer();
  }

  /** Actions toujours disponibles, à portée de pouce sur le plan. */
  buildDock() {
    this.dock.replaceChildren(
      h('button', {
        class: 'btn btn--sm ed-dock-add', type: 'button',
        html: `${icon('plus')}<span>Pièce</span>`,
        onclick: () => this.addRoom()
      }),
      h('button', {
        class: 'ibtn', type: 'button', title: 'Annuler la dernière action',
        'aria-label': 'Annuler', html: icon('undo'), onclick: () => this.undo()
      }),
      h('button', {
        class: 'ibtn', type: 'button', title: 'Recentrer le plan',
        'aria-label': 'Recentrer', html: icon('maximize'), onclick: () => this.fitCamera()
      })
    );
  }

  buildGrid() {
    const span = 2400;
    this.gridLayer.replaceChildren();
    this.gridLayer.insertAdjacentHTML('beforeend', `
      <defs>
        <pattern id="ed-grid-pattern" width="${CELL}" height="${CELL}" patternUnits="userSpaceOnUse">
          <path d="M${CELL} 0H0V${CELL}" fill="none" stroke="var(--ed-grid)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect x="${-span}" y="${-span}" width="${span * 2}" height="${span * 2}" fill="url(#ed-grid-pattern)"/>
      <path d="M${-span} 0H${span}M0 ${-span}V${span}" stroke="var(--ed-axis)" stroke-width="1.5" fill="none"/>
    `);
  }

  // --- Étages ------------------------------------------------------------

  renderFloors() {
    const tabs = this.config.floors.map((floor) => h('button', {
      class: `ed-floor ${floor.id === this.floorId ? 'is-active' : ''}`, type: 'button',
      onclick: () => {
        this.floorId = floor.id;
        this.roomId = null;
        this.renderFloors();
        this.renderCanvas();
        this.renderInspector();
        this.fitCamera();
      }
    }, [h('span', { text: floor.name })]));

    const tabsNode = h('div', { class: 'ed-floor-tabs' }, tabs);
    requestAnimationFrame(() => {
      tabsNode.classList.toggle('is-scrollable', tabsNode.scrollWidth > tabsNode.clientWidth + 1);
    });

    this.topBar.replaceChildren(
      tabsNode,
      h('button', {
        class: 'ibtn ed-menu-btn', type: 'button', title: 'Plus d’actions',
        'aria-label': 'Plus d’actions', html: icon('settings'),
        onclick: (ev) => this.openMenu(ev.currentTarget)
      }),
      h('button', {
        class: 'btn btn--sm ed-done', type: 'button',
        html: `${icon('check')}<span>Terminer</span>`,
        'aria-label': 'Terminer', onclick: () => this.onDone()
      })
    );
  }

  /** Actions rares : gestion des étages et rattachement automatique. */
  openMenu(anchor) {
    const items = [
      ['pencil', 'Renommer l’étage', () => this.renameFloor()],
      ['copy', 'Dupliquer l’étage', () => this.duplicateFloor()],
      ['plus', 'Ajouter un étage', () => this.addFloor()],
      ['trash', 'Supprimer l’étage', () => this.deleteFloor()],
      ['device', 'Rattacher les appareils', () => this.autoAssign()]
    ];

    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
    };
    const onOutside = (ev) => {
      if (menu.contains(ev.target) || ev.target === anchor) return;
      close();
      // Le même appui ne doit pas enchaîner sur un geste dans le plan.
      if (this.svg.contains(ev.target)) this.menuJustClosed = true;
    };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };

    const menu = h('div', { class: 'ed-menu', role: 'menu' }, items.map(([ico, label, run]) => h('button', {
      class: `ed-menu-item ${label.startsWith('Supprimer') ? 'is-danger' : ''}`,
      type: 'button', role: 'menuitem',
      html: `${icon(ico)}<span>${label}</span>`,
      onclick: () => { close(); run(); }
    })));

    // Attaché au document et positionné sous le bouton : ni rogné par le
    // canevas, ni masqué par la feuille de la pièce sélectionnée.
    document.body.append(menu);
    const a = anchor.getBoundingClientRect();
    menu.style.top = `${Math.round(a.bottom + 8)}px`;
    menu.style.right = `${Math.round(window.innerWidth - a.right)}px`;

    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
  }

  addFloor() {
    this.snapshot();
    const n = this.config.floors.length + 1;
    const floor = { id: uniqueId('etage', this.config.floors), name: `Niveau ${n}`, rooms: [] };
    this.config.floors.push(floor);
    this.floorId = floor.id;
    this.roomId = null;
    this.commit();
  }

  duplicateFloor() {
    const source = this.floor;
    if (!source) return;
    this.snapshot();
    const copy = {
      id: uniqueId(`${source.id}_copie`, this.config.floors),
      name: `${source.name} (copie)`,
      rooms: source.rooms.map((room) => ({
        ...room,
        id: `${room.id}_c${Math.random().toString(36).slice(2, 6)}`,
        rects: normalizeRects(room).map((r) => [...r]),
        entities: []
      }))
    };
    this.config.floors.push(copy);
    this.floorId = copy.id;
    this.roomId = null;
    this.commit();
  }

  deleteFloor() {
    if (this.config.floors.length <= 1) {
      this.toast('Il faut garder au moins un étage.');
      return;
    }
    this.snapshot();
    this.config.floors = this.config.floors.filter((f) => f.id !== this.floorId);
    this.floorId = this.config.floors[0].id;
    this.roomId = null;
    this.commit();
  }

  renameFloor() {
    const floor = this.floor;
    if (!floor) return;
    openPrompt({
      title: 'Nom de l’étage', value: floor.name,
      onSubmit: (value) => {
        this.snapshot();
        floor.name = value.trim() || floor.name;
        this.commit();
      }
    });
  }

  // --- Pièces ------------------------------------------------------------

  addRoom() {
    const floor = this.floor;
    if (!floor) return;
    this.snapshot();
    const [cx, cy] = this.visibleCenterCell();
    const [x, y] = findFreeSpotNear(floor, 4, 3, [cx - 2, cy - 1]);
    const room = {
      id: uniqueId('piece', floor.rooms),
      name: `Pièce ${floor.rooms.length + 1}`,
      icon: 'grid',
      rects: [[x, y, 4, 3]],
      entities: []
    };
    floor.rooms.push(room);
    this.roomId = room.id;
    this.tool = 'select';
    this.commit();
    this.ensureVisible(roomCells(room));
    this.focusName();
  }

  duplicateRoom() {
    const room = this.room;
    if (!room) return;
    this.snapshot();
    const cells = roomCells(room);
    const bounds = boundsOfCells(cells);
    const taken = occupiedCells(this.floor, null);

    let placed = null;
    for (let d = 1; d < 40 && !placed; d += 1) {
      for (const [dx, dy] of [[bounds.w + 0, 0], [0, bounds.h], [-bounds.w, 0], [0, -bounds.h]]) {
        const candidate = translateCells(cells, dx * d, dy * d);
        if (!collides(candidate, taken)) { placed = candidate; break; }
      }
    }

    const copy = {
      ...room,
      id: uniqueId(`${room.id}_copie`, this.floor.rooms),
      name: `${room.name} (copie)`,
      entities: []
    };
    setRoomCells(copy, placed || translateCells(cells, bounds.w, bounds.h));
    this.floor.rooms.push(copy);
    this.roomId = copy.id;
    this.commit();
    this.ensureVisible(roomCells(copy));
  }

  deleteRoom() {
    const room = this.room;
    if (!room) return;
    this.snapshot();
    this.floor.rooms = this.floor.rooms.filter((r) => r.id !== room.id);
    this.roomId = null;
    this.commit();
  }

  // --- Rendu du plan -----------------------------------------------------

  renderCanvas() {
    this.roomLayer.replaceChildren();
    this.handleLayer.replaceChildren();
    this.nodes.clear();

    (this.floor?.rooms || []).forEach((room, index) => {
      const cells = roomCells(room);
      if (!cells.size) return;

      const group = svgEl('g', {
        class: `ed-room${room.id === this.roomId ? ' is-selected' : ''}`,
        'data-room': room.id,
        style: `--room-hue: ${(index * 57 + 200) % 360}`
      });

      const fill = svgEl('path', { class: 'ed-room-fill', d: cellsPath(cells) });
      const edge = svgEl('path', { class: 'ed-room-edge', d: edgesPath(cells), fill: 'none' });
      group.append(fill, edge);

      const { cell } = anchorCell(cells);
      const label = svgEl('g', {
        class: 'ed-room-label',
        transform: `translate(${(cell[0] + 0.5) * CELL}, ${(cell[1] + 0.5) * CELL})`
      });
      label.insertAdjacentHTML('beforeend',
        `<g class="ed-room-ico" transform="translate(-9,-24) scale(0.75)">${iconInner(room.icon || 'grid')}</g>`);
      const text = svgEl('text', { class: 'ed-room-name', y: 6 });
      text.textContent = room.name;
      label.append(text);
      const size = svgEl('text', { class: 'ed-room-size', y: 20 });
      const b = boundsOfCells(cells);
      size.textContent = isSingleRect(room) ? `${b.w} × ${b.h}` : `${cells.size} cases`;
      label.append(size);
      group.append(label);

      this.roomLayer.append(group);
      this.nodes.set(room.id, { group, fill, edge, label });
    });

    this.renderHandles();
  }

  renderHandles() {
    this.handleLayer.replaceChildren();
    const room = this.room;
    if (!room || this.tool !== 'select') return;
    if (!isSingleRect(room)) return;

    const [x, y, w, hgt] = normalizeRects(room)[0];
    for (const [name, fx, fy] of HANDLES) {
      const cx = (x + w * fx) * CELL;
      const cy = (y + hgt * fy) * CELL;
      this.handleLayer.append(svgEl('rect', {
        class: 'ed-handle', 'data-handle': name,
        x: cx - 11, y: cy - 11, width: 22, height: 22, rx: 7
      }));
    }
  }

  /** Redessine une seule pièce pendant un geste (déplacement, poignée…). */
  previewRoom(roomId, cells, invalid) {
    const node = this.nodes.get(roomId);
    if (!node) return;
    node.fill.setAttribute('d', cellsPath(cells));
    node.edge.setAttribute('d', edgesPath(cells));
    node.group.classList.toggle('is-invalid', Boolean(invalid));
    const { cell } = anchorCell(cells);
    node.label.setAttribute('transform',
      `translate(${(cell[0] + 0.5) * CELL}, ${(cell[1] + 0.5) * CELL})`);
  }

  // --- Caméra ------------------------------------------------------------

  applyCamera() {
    const { x, y, s } = this.camera;
    this.world.setAttribute('transform', `translate(${x} ${y}) scale(${s})`);
  }

  fitCamera() {
    const rect = this.canvasWrap.getBoundingClientRect();
    if (!rect.width) return;

    const cells = new Set();
    for (const room of this.floor?.rooms || []) {
      for (const k of roomCells(room)) cells.add(k);
    }

    if (!cells.size) {
      this.camera = { x: rect.width / 2 - CELL * 3, y: rect.height / 2 - CELL * 3, s: 1 };
      this.applyCamera();
      return;
    }

    const b = boundsOfCells(cells);
    const pad = 40;
    const dock = 88; // hauteur réservée à la barre d'actions flottante
    const usableH = rect.height - pad - dock;
    const scale = clamp(
      Math.min((rect.width - pad * 2) / (b.w * CELL), usableH / (b.h * CELL)),
      MIN_SCALE, 1.6
    );
    this.camera = {
      s: scale,
      x: rect.width / 2 - (b.minX + b.w / 2) * CELL * scale,
      y: (pad + usableH / 2) - (b.minY + b.h / 2) * CELL * scale
    };
    this.applyCamera();
  }

  /** Case au centre de la zone visible : point de départ des ajouts. */
  visibleCenterCell() {
    const rect = this.svg.getBoundingClientRect();
    return this.cellAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  /**
   * Fait glisser la caméra pour qu'un ensemble de cases reste entièrement
   * visible. Sur mobile, l'inspecteur remonte par-dessus le plan : la hauteur
   * qu'il occupe est retirée de la zone utile.
   */
  ensureVisible(cells) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !cells.size) return;

    const inset = this.inspectorInset();
    const b = boundsOfCells(cells);
    const step = CELL * this.camera.s;
    const margin = 40;
    const usableBottom = rect.height - inset - margin;

    const left = this.camera.x + b.minX * step;
    const top = this.camera.y + b.minY * step;
    const right = this.camera.x + b.maxX * step;
    const bottom = this.camera.y + b.maxY * step;

    let dx = 0;
    let dy = 0;
    if (left < margin) dx = margin - left;
    else if (right > rect.width - margin) dx = Math.max(rect.width - margin - right, margin - left);
    if (top < margin) dy = margin - top;
    else if (bottom > usableBottom) dy = Math.max(usableBottom - bottom, margin - top);

    if (dx || dy) {
      this.camera.x += dx;
      this.camera.y += dy;
      this.applyCamera();
    }
  }

  /** Hauteur masquée par l'inspecteur quand il se superpose au plan. */
  inspectorInset() {
    if (!this.inspector.isConnected) return 0;
    const style = getComputedStyle(this.inspector);
    if (style.position !== 'fixed' || style.display === 'none') return 0;
    const sheet = this.inspector.getBoundingClientRect();
    const canvas = this.canvasWrap.getBoundingClientRect();
    return Math.max(0, canvas.bottom - sheet.top);
  }

  cellAt(clientX, clientY) {
    const rect = this.svg.getBoundingClientRect();
    const x = (clientX - rect.left - this.camera.x) / (CELL * this.camera.s);
    const y = (clientY - rect.top - this.camera.y) / (CELL * this.camera.s);
    return [Math.floor(x), Math.floor(y)];
  }

  // --- Gestes ------------------------------------------------------------

  setTool(tool) {
    this.tool = tool;
    for (const btn of this.container.querySelectorAll('.ed-tool')) {
      btn.classList.toggle('is-active', btn.dataset.tool === tool);
    }
    this.canvasWrap.dataset.tool = tool;
    this.renderHandles();
  }

  bindPointer() {
    const svg = this.svg;
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      this.zoomAt(ev.clientX, ev.clientY, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
    }, { passive: false });

    svg.addEventListener('pointerdown', (ev) => this.onPointerDown(ev));
    svg.addEventListener('pointermove', (ev) => this.onPointerMove(ev));
    svg.addEventListener('pointerup', (ev) => this.onPointerUp(ev));
    svg.addEventListener('pointercancel', (ev) => this.onPointerUp(ev));
  }

  zoomAt(clientX, clientY, factor) {
    const rect = this.svg.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const next = clamp(this.camera.s * factor, MIN_SCALE, MAX_SCALE);
    const ratio = next / this.camera.s;
    this.camera.x = px - (px - this.camera.x) * ratio;
    this.camera.y = py - (py - this.camera.y) * ratio;
    this.camera.s = next;
    this.applyCamera();
  }

  /** Un geste d'édition ne doit jamais être détourné par un second doigt. */
  static EDIT_GESTURES = ['move', 'resize', 'paint', 'erase'];

  /**
   * Vrai seulement si une modification est réellement engagée. Tant que le
   * premier doigt n'a rien bougé, un second doigt doit pouvoir zoomer —
   * sinon poser le pouce sur une pièce empêcherait tout pincement.
   */
  isEditing() {
    return Boolean(this.gesture && this.gesture.moved
      && PlanEditor.EDIT_GESTURES.includes(this.gesture.type));
  }

  /** Instantané pris au premier changement réel, pas au premier contact. */
  ensureSnapshot(gesture) {
    if (gesture.snapped) return;
    gesture.snapped = true;
    this.snapshot();
  }

  onPointerDown(ev) {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;

    // Le pointeur qui vient de fermer le menu ne doit pas enchaîner sur un geste.
    if (this.menuJustClosed) {
      this.menuJustClosed = false;
      return;
    }

    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (this.pointers.size >= 2) {
      // Déplacement, poignée ou pinceau en cours : l'édition prime sur le zoom,
      // le doigt supplémentaire est simplement ignoré.
      if (this.isEditing()) return;
      this.startPinch();
      return;
    }

    const handle = ev.target.closest?.('.ed-handle');
    const roomNode = ev.target.closest?.('.ed-room');
    const cell = this.cellAt(ev.clientX, ev.clientY);
    this.activeId = ev.pointerId;

    if (handle && this.room) {
      this.gesture = {
        type: 'resize', handle: handle.dataset.handle,
        rect: normalizeRects(this.room)[0], roomId: this.roomId,
        taken: occupiedCells(this.floor, this.roomId), moved: false
      };
      this.capture(ev);
      return;
    }

    if (this.tool !== 'select' && this.room) {
      // Sinon on peindrait la pièce sélectionnée en croyant en choisir une autre.
      if (roomNode && roomNode.dataset.room !== this.roomId) {
        this.select(roomNode.dataset.room);
        this.gesture = null;
        return;
      }
      this.gesture = {
        type: this.tool, roomId: this.roomId,
        cells: roomCells(this.room),
        taken: occupiedCells(this.floor, this.roomId), moved: false
      };
      this.capture(ev);
      this.applyBrush(cell);
      return;
    }

    if (roomNode) {
      const roomId = roomNode.dataset.room;
      if (roomId !== this.roomId) this.select(roomId);
      this.gesture = {
        type: 'move', roomId, origin: cell, delta: [0, 0], moved: false,
        cells: roomCells(this.floor.rooms.find((r) => r.id === roomId)),
        taken: occupiedCells(this.floor, roomId)
      };
      this.capture(ev);
      return;
    }

    this.gesture = { type: 'pan', x: ev.clientX, y: ev.clientY, cam: { ...this.camera }, moved: false };
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.activeId = null;
    this.gesture = {
      type: 'pinch',
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      scale: this.camera.s,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      cam: { ...this.camera }
    };
  }

  capture(ev) {
    try { this.svg.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
  }

  onPointerMove(ev) {
    if (!this.pointers.has(ev.pointerId)) return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const g = this.gesture;
    if (!g) return;

    if (g.type === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const next = clamp(g.scale * (dist / g.dist), MIN_SCALE, MAX_SCALE);
      const ratio = next / g.cam.s;
      const rect = this.svg.getBoundingClientRect();
      const px = g.mid.x - rect.left;
      const py = g.mid.y - rect.top;
      this.camera.s = next;
      this.camera.x = g.cam.x + (mid.x - g.mid.x) - (px - g.cam.x) * (ratio - 1);
      this.camera.y = g.cam.y + (mid.y - g.mid.y) - (py - g.cam.y) * (ratio - 1);
      this.applyCamera();
      return;
    }

    // Tous les autres gestes appartiennent au doigt qui les a commencés.
    if (this.activeId !== null && ev.pointerId !== this.activeId) return;

    if (g.type === 'pan') {
      const dx = ev.clientX - g.x;
      const dy = ev.clientY - g.y;
      if (Math.hypot(dx, dy) > 4) g.moved = true;
      this.camera.x = g.cam.x + dx;
      this.camera.y = g.cam.y + dy;
      this.applyCamera();
      return;
    }

    const cell = this.cellAt(ev.clientX, ev.clientY);

    if (g.type === 'move') {
      const dx = cell[0] - g.origin[0];
      const dy = cell[1] - g.origin[1];
      if (dx === g.delta[0] && dy === g.delta[1]) return;
      g.delta = [dx, dy];
      if (dx || dy) {
        g.moved = true;
        this.ensureSnapshot(g);
      }
      const next = translateCells(g.cells, dx, dy);
      g.preview = next;
      this.previewRoom(g.roomId, next, collides(next, g.taken));
      return;
    }

    if (g.type === 'resize') {
      const next = resizeRect(g.rect, g.handle, cell);
      if (sameRect(next, g.lastRect)) return;
      if (sameRect(next, g.rect)) return;
      g.lastRect = next;
      g.moved = true;
      this.ensureSnapshot(g);
      const cells = cellsOfRect(...next);
      g.preview = cells;
      this.previewRoom(g.roomId, cells, collides(cells, g.taken));
      return;
    }

    if (g.type === 'paint' || g.type === 'erase') this.applyBrush(cell);
  }

  applyBrush(cell) {
    const g = this.gesture;
    if (!g || (g.type !== 'paint' && g.type !== 'erase')) return;
    const k = key(cell[0], cell[1]);

    if (g.type === 'paint') {
      if (g.cells.has(k) || g.taken.has(k)) return;
      g.cells.add(k);
    } else {
      if (!g.cells.has(k) || g.cells.size <= 1) return;
      g.cells.delete(k);
    }
    g.moved = true;
    this.ensureSnapshot(g);
    g.preview = new Set(g.cells);
    this.previewRoom(g.roomId, g.cells, false);
  }

  onPointerUp(ev) {
    const wasActive = this.activeId === ev.pointerId;
    this.pointers.delete(ev.pointerId);
    try { this.svg.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }

    const g = this.gesture;
    if (!g) return;

    // Un doigt se lève pendant un pincement : on repasse proprement en
    // déplacement de vue avec celui qui reste, plutôt que de rester bloqué.
    if (g.type === 'pinch') {
      if (this.pointers.size >= 2) return;
      const remaining = [...this.pointers.entries()][0];
      this.gesture = remaining
        ? { type: 'pan', x: remaining[1].x, y: remaining[1].y, cam: { ...this.camera }, moved: true }
        : null;
      this.activeId = remaining ? remaining[0] : null;
      return;
    }

    if (!wasActive && this.pointers.size > 0) return;

    this.gesture = null;
    this.activeId = null;

    if (g.type === 'pan') {
      if (!g.moved) this.select(null);
      return;
    }

    const room = this.floor.rooms.find((r) => r.id === g.roomId);
    if (!room) return;

    if (!g.moved || !g.preview) {
      this.renderCanvas();
      return;
    }

    if ((g.type === 'move' || g.type === 'resize') && collides(g.preview, g.taken)) {
      if (g.snapped) this.history.pop();
      this.toast('Impossible : la pièce en chevaucherait une autre.');
      this.renderCanvas();
      return;
    }

    setRoomCells(room, g.preview);
    this.commit();
  }

  select(roomId) {
    this.roomId = roomId;
    if (!roomId) this.tool = 'select';
    this.canvasWrap.dataset.tool = this.tool;
    for (const [id, node] of this.nodes) {
      node.group.classList.toggle('is-selected', id === roomId);
    }
    this.renderHandles();
    this.renderInspector();

    // La feuille vient de s'ouvrir : on dégage la pièce de dessous.
    const room = this.room;
    if (room) requestAnimationFrame(() => this.ensureVisible(roomCells(room)));
  }

  // --- Inspecteur --------------------------------------------------------

  renderInspector() {
    const room = this.room;
    this.container.querySelector('.ed')?.classList.toggle('has-selection', Boolean(room));

    if (!room) {
      this.inspector.replaceChildren(h('div', { class: 'ed-inspector-inner' }, [
        h('div', { class: 'ed-empty' }, [
          h('span', { class: 'ed-empty-ico', html: icon('floorplan') }),
          h('h3', { text: 'Aucune pièce sélectionnée' }),
          h('p', {
            text: 'Touchez une pièce pour la modifier, ou ajoutez-en une avec le '
              + 'bouton « Pièce » en bas du plan.'
          })
        ])
      ]));
      return;
    }

    const cells = roomCells(room);
    const b = boundsOfCells(cells);

    const nameInput = h('input', {
      class: 'field', type: 'text', value: room.name, 'aria-label': 'Nom de la pièce'
    });
    nameInput.addEventListener('change', () => {
      this.snapshot();
      room.name = nameInput.value.trim() || room.name;
      this.commit({ keepInspector: true });
    });
    this.nameInput = nameInput;

    const icons = h('div', { class: 'ed-icons' }, ROOM_ICONS.map((name) => h('button', {
      class: `ed-icon ${room.icon === name ? 'is-active' : ''}`, type: 'button',
      'aria-label': `Icône ${name}`, html: icon(name),
      onclick: () => {
        this.snapshot();
        room.icon = name;
        this.commit();
      }
    })));

    const entityRows = (room.entities || []).map((id) => {
      const entity = this.entities[id];
      return h('li', { class: `ed-entity ${entity ? '' : 'is-missing'}` }, [
        h('span', {
          class: 'ed-entity-ico',
          html: icon(entity ? (isLight(id) ? 'bulb' : 'thermometer') : 'alert')
        }),
        h('div', { class: 'ed-entity-body' }, [
          h('strong', { text: entity ? friendlyName(id, entity) : id }),
          h('span', { text: entity ? `${id} · ${stateLabel(entity)}` : 'entité absente de Home Assistant' })
        ]),
        h('button', {
          class: 'ibtn ibtn--sm', type: 'button', 'aria-label': 'Retirer', title: 'Retirer',
          html: icon('close'),
          onclick: () => {
            this.snapshot();
            room.entities = room.entities.filter((e) => e !== id);
            this.commit();
          }
        })
      ]);
    });

    const tool = (name, iconName, label) => h('button', {
      class: `ed-tool ${this.tool === name ? 'is-active' : ''}`, type: 'button',
      dataset: { tool: name }, title: label, 'aria-label': label,
      onclick: () => this.setTool(name)
    }, [
      h('span', { class: 'ed-tool-ico', html: icon(iconName) }),
      h('span', { class: 'ed-tool-label', text: label })
    ]);

    this.inspector.replaceChildren(h('div', { class: 'ed-inspector-inner' }, [
      h('header', { class: 'ed-inspector-head' }, [
        h('h3', { text: 'Pièce' }),
        h('button', {
          class: 'ibtn ibtn--sm', type: 'button', 'aria-label': 'Fermer', title: 'Fermer',
          html: icon('close'), onclick: () => this.select(null)
        })
      ]),
      nameInput,
      // Ces trois outils n'agissent que sur la pièce sélectionnée : leur place
      // est ici, pas dans une barre d'outils globale.
      h('div', { class: 'ed-tool-group' }, [
        tool('select', 'move', 'Déplacer'),
        tool('paint', 'brush', 'Agrandir'),
        tool('erase', 'eraser', 'Rogner')
      ]),
      h('p', {
        class: 'ed-hint',
        text: isSingleRect(room)
          ? `${b.w} × ${b.h} cases — tirez les poignées pour redimensionner`
          : `${cells.size} cases (forme libre) — « Agrandir » et « Rogner » ajustent le contour`
      }),
      icons,
      h('section', { class: 'ed-section' }, [
        h('div', { class: 'ed-section-head' }, [
          h('h4', { text: `Appareils (${(room.entities || []).length})` }),
          h('button', {
            class: 'btn btn--sm btn--ghost', type: 'button', html: `${icon('plus')}<span>Ajouter</span>`,
            onclick: () => this.pickEntity(room)
          })
        ]),
        entityRows.length
          ? h('ul', { class: 'ed-entities' }, entityRows)
          : h('p', { class: 'ed-hint', text: 'Aucun appareil dans cette pièce.' })
      ]),
      h('div', { class: 'btn-row btn-row--stretch' }, [
        h('button', {
          class: 'btn btn--ghost btn--sm', type: 'button', html: `${icon('copy')}<span>Dupliquer</span>`,
          onclick: () => this.duplicateRoom()
        }),
        h('button', {
          class: 'btn btn--ghost btn--sm btn--danger', type: 'button', html: `${icon('trash')}<span>Supprimer</span>`,
          onclick: () => this.deleteRoom()
        })
      ])
    ]));
  }

  focusName() {
    requestAnimationFrame(() => this.nameInput?.select());
  }

  pickEntity(room) {
    const available = unassignedEntities(this.config, this.entities);
    if (!available.length) {
      this.toast('Toutes les lumières et températures détectées sont déjà placées.');
      return;
    }
    openEntityPicker({
      entities: available,
      onPick: (id) => {
        this.snapshot();
        room.entities = [...(room.entities || []), id];
        this.commit();
      }
    });
  }

  autoAssign() {
    this.snapshot();
    const { assigned } = autoAssignEntities(this.config, this.entities);
    if (!assigned) {
      this.history.pop();
      this.toast('Aucune lumière ni température ne correspond au nom d’une pièce.');
      return;
    }
    this.commit();
    this.toast(`${assigned} appareil${assigned > 1 ? 's' : ''} rattaché${assigned > 1 ? 's' : ''}.`);
  }

  // --- Historique et sauvegarde -----------------------------------------

  snapshot() {
    this.history.push(JSON.stringify(this.config.floors));
    if (this.history.length > 40) this.history.shift();
  }

  undo() {
    const previous = this.history.pop();
    if (!previous) {
      this.toast('Rien à annuler.');
      return;
    }
    this.config.floors = JSON.parse(previous);
    if (!this.config.floors.some((f) => f.id === this.floorId)) {
      this.floorId = this.config.floors[0]?.id || null;
    }
    if (!this.room) this.roomId = null;
    this.commit({ skipHistory: true });
  }

  commit({ keepInspector = false } = {}) {
    this.renderFloors();
    this.renderCanvas();
    if (!keepInspector) this.renderInspector();
    this.onChange(this.config);
  }

  toast(text) {
    window.dispatchEvent(new CustomEvent('homeboard-toast', { detail: { text } }));
  }
}

// --- Rendu utilitaire ----------------------------------------------------

function cellsPath(cells) {
  const parts = [];
  for (const k of cells) {
    const [x, y] = parseKey(k);
    parts.push(`M${x * CELL} ${y * CELL}h${CELL}v${CELL}h${-CELL}Z`);
  }
  return parts.join('');
}

function edgesPath(cells) {
  return borderEdges(cells)
    .map(([[x1, y1], [x2, y2]]) => `M${x1 * CELL} ${y1 * CELL}L${x2 * CELL} ${y2 * CELL}`)
    .join('');
}

/**
 * Contenu d'une icône, prêt à être injecté dans un <g>. Les attributs de
 * présentation du <svg> d'origine sont réappliqués, sinon les tracés
 * seraient rendus en aplat noir.
 */
function iconInner(name) {
  const inner = icon(hasIcon(name) ? name : 'grid')
    .replace(/^<svg[^>]*>/, '')
    .replace(/<\/svg>$/, '');
  return `<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
}

function resizeRect([x, y, w, h], handle, [cx, cy]) {
  let x1 = x;
  let y1 = y;
  let x2 = x + w;
  let y2 = y + h;

  if (handle.includes('w')) x1 = Math.min(cx, x2 - 1);
  if (handle.includes('e')) x2 = Math.max(cx + 1, x1 + 1);
  if (handle.includes('n')) y1 = Math.min(cy, y2 - 1);
  if (handle.includes('s')) y2 = Math.max(cy + 1, y1 + 1);

  return [x1, y1, x2 - x1, y2 - y1];
}

function sameRect(a, b) {
  return Boolean(a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);
}

function uniqueId(base, collection) {
  const slug = slugify(base) || 'element';
  const used = new Set(collection.map((item) => item.id));
  if (!used.has(slug)) return slug;
  let n = 2;
  while (used.has(`${slug}_${n}`)) n += 1;
  return `${slug}_${n}`;
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

// --- Petites fenêtres ----------------------------------------------------

function openEntityPicker({ entities, onPick }) {
  const root = document.getElementById('modal-root');
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Rechercher un appareil…' });
  const list = h('div', { class: 'entity-list' });

  const close = () => root.replaceChildren();

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const rows = entities
      .filter((e) => !q || e.entity_id.toLowerCase().includes(q)
        || friendlyName(e.entity_id, e).toLowerCase().includes(q))
      .slice(0, 150)
      .map((e) => h('button', {
        class: 'entity-row', type: 'button',
        onclick: () => { onPick(e.entity_id); close(); }
      }, [
        h('div', { class: 'entity-main' }, [
          h('strong', { text: friendlyName(e.entity_id, e) }),
          h('code', { class: 'entity-id', text: e.entity_id })
        ]),
        h('span', { class: 'entity-state', text: stateLabel(e) })
      ]));
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'hint', text: 'Aucun résultat.' })]));
  };
  search.addEventListener('input', draw);
  draw();

  root.replaceChildren(h('div', {
    class: 'modal-backdrop', onclick: (ev) => { if (ev.target === ev.currentTarget) close(); }
  }, [
    h('div', { class: 'modal modal--sm', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ajouter un appareil' }, [
      h('header', { class: 'modal-head' }, [
        h('h2', { text: 'Ajouter un appareil' }),
        h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Fermer', html: icon('close'), onclick: close })
      ]),
      h('div', { class: 'modal-body' }, [search, list])
    ])
  ]));
  requestAnimationFrame(() => search.focus());
}

function openPrompt({ title, value, onSubmit }) {
  const root = document.getElementById('modal-root');
  const input = h('input', { class: 'field', type: 'text', value });
  const close = () => root.replaceChildren();
  const submit = () => { onSubmit(input.value); close(); };

  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') submit(); });

  root.replaceChildren(h('div', {
    class: 'modal-backdrop', onclick: (ev) => { if (ev.target === ev.currentTarget) close(); }
  }, [
    h('div', { class: 'modal modal--sm', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      h('header', { class: 'modal-head' }, [h('h2', { text: title })]),
      h('div', { class: 'modal-body' }, [input]),
      h('footer', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn--ghost', type: 'button', text: 'Annuler', onclick: close }),
        h('button', { class: 'btn', type: 'button', text: 'Valider', onclick: submit })
      ])
    ])
  ]));
  requestAnimationFrame(() => input.select());
}
