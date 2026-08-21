/**
 * Modèle géométrique des pièces.
 *
 * Une pièce est un ensemble de cases de grille — ce qui autorise n'importe
 * quelle forme orthogonale (L, T, U…) et pas seulement des rectangles. Sur
 * disque, cet ensemble est sérialisé en une liste de rectangles (`rects`),
 * beaucoup plus compacte et lisible qu'une liste de cases.
 */

export const key = (x, y) => `${x},${y}`;
export const parseKey = (k) => k.split(',').map(Number);

/** Cases d'une pièce, sous forme de Set de clés « x,y ». */
export function roomCells(room) {
  const cells = new Set();
  for (const [x, y, w, h] of normalizeRects(room)) {
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) cells.add(key(x + i, y + j));
    }
  }
  return cells;
}

/** Accepte l'ancien format (x/y/w/h) comme un rectangle unique. */
export function normalizeRects(room) {
  if (Array.isArray(room.rects) && room.rects.length) {
    return room.rects
      .map((r) => r.map(Number))
      .filter(([, , w, h]) => w > 0 && h > 0);
  }
  if ([room.x, room.y, room.w, room.h].every((v) => Number.isFinite(Number(v)))) {
    return [[Number(room.x), Number(room.y), Number(room.w), Number(room.h)]];
  }
  return [];
}

/**
 * Recompose une liste de rectangles à partir d'un ensemble de cases
 * (balayage glouton : on part de la case la plus haute à gauche, on étend
 * en largeur puis en hauteur tant que les lignes sont pleines).
 */
function rectsFromCells(cells) {
  const remaining = new Set(cells);
  const rects = [];

  while (remaining.size) {
    let ox = Infinity;
    let oy = Infinity;
    for (const k of remaining) {
      const [x, y] = parseKey(k);
      if (y < oy || (y === oy && x < ox)) { ox = x; oy = y; }
    }

    let w = 0;
    while (remaining.has(key(ox + w, oy))) w += 1;

    let h = 1;
    for (;;) {
      let full = true;
      for (let i = 0; i < w; i += 1) {
        if (!remaining.has(key(ox + i, oy + h))) { full = false; break; }
      }
      if (!full) break;
      h += 1;
    }

    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) remaining.delete(key(ox + i, oy + j));
    }
    rects.push([ox, oy, w, h]);
  }

  return rects;
}

export function boundsOfCells(cells) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const k of cells) {
    const [x, y] = parseKey(k);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + 1 > maxX) maxX = x + 1;
    if (y + 1 > maxY) maxY = y + 1;
  }
  return cells.size
    ? { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
    : { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
}

export function floorCells(floor) {
  const all = new Set();
  for (const room of floor?.rooms || []) {
    for (const k of roomCells(room)) all.add(k);
  }
  return all;
}

export function floorBounds(floor) {
  return boundsOfCells(floorCells(floor));
}

/**
 * Case représentative où poser l'étiquette.
 * `biasY` décale la cible vers l'avant de la pièce : le mobilier étant adossé
 * aux murs du fond, l'étiquette se pose ainsi sur le sol dégagé.
 */
export function anchorCell(cells, biasY = 0) {
  let sx = 0;
  let sy = 0;
  for (const k of cells) {
    const [x, y] = parseKey(k);
    sx += x + 0.5;
    sy += y + 0.5;
  }
  const cx = sx / cells.size;
  const cy = sy / cells.size;

  const { maxY } = boundsOfCells(cells);
  const targetY = cy + Math.min(biasY, Math.max(0, (maxY - cy) * 0.7));

  let best = null;
  let bestDist = Infinity;
  for (const k of cells) {
    const [x, y] = parseKey(k);
    const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - targetY) ** 2;
    if (d < bestDist) { bestDist = d; best = [x, y]; }
  }
  return { cell: best || [0, 0], centroid: [cx, cy] };
}

/**
 * Arêtes à extruder en murs : uniquement les côtés « arrière » (nord et
 * ouest), ce qui donne la vue en coupe isométrique classique — on voit
 * l'intérieur des pièces.
 */
export function wallEdges(cells) {
  const north = [];
  const west = [];
  for (const k of cells) {
    const [x, y] = parseKey(k);
    if (!cells.has(key(x, y - 1))) north.push([x, y]);
    if (!cells.has(key(x - 1, y))) west.push([x, y]);
  }
  return { north, west };
}

/** Segments du contour extérieur, dans les quatre directions. */
export function borderEdges(cells) {
  const edges = [];
  for (const k of cells) {
    const [x, y] = parseKey(k);
    if (!cells.has(key(x, y - 1))) edges.push([[x, y], [x + 1, y]]);
    if (!cells.has(key(x, y + 1))) edges.push([[x, y + 1], [x + 1, y + 1]]);
    if (!cells.has(key(x - 1, y))) edges.push([[x, y], [x, y + 1]]);
    if (!cells.has(key(x + 1, y))) edges.push([[x + 1, y], [x + 1, y + 1]]);
  }
  return edges;
}

/** Profondeur de tri isométrique : la case la plus éloignée du spectateur. */
export function depthKey(cells) {
  let min = Infinity;
  for (const k of cells) {
    const [x, y] = parseKey(k);
    if (x + y < min) min = x + y;
  }
  return min;
}

/**
 * Plus grand rectangle plein contenu dans un ensemble de cases.
 * Sert à poser le mobilier : on est certain de rester dans la pièce, même
 * pour une forme en L ou en U. Méthode classique de l'histogramme.
 */
export function largestRect(cells) {
  if (!cells.size) return null;
  const b = boundsOfCells(cells);
  const heights = new Array(b.w).fill(0);
  let best = null;

  for (let y = b.minY; y < b.maxY; y += 1) {
    for (let i = 0; i < b.w; i += 1) {
      heights[i] = cells.has(key(b.minX + i, y)) ? heights[i] + 1 : 0;
    }

    // Plus grand rectangle sous l'histogramme de la ligne courante.
    const stack = [];
    for (let i = 0; i <= b.w; i += 1) {
      const h = i === b.w ? 0 : heights[i];
      let start = i;
      while (stack.length && stack[stack.length - 1].h >= h) {
        const top = stack.pop();
        const area = top.h * (i - top.i);
        if (!best || area > best.w * best.h) {
          best = { x: b.minX + top.i, y: y - top.h + 1, w: i - top.i, h: top.h };
        }
        start = top.i;
      }
      stack.push({ i: start, h });
    }
  }
  return best;
}

export function translateCells(cells, dx, dy) {
  const out = new Set();
  for (const k of cells) {
    const [x, y] = parseKey(k);
    out.add(key(x + dx, y + dy));
  }
  return out;
}

export function cellsOfRect(x, y, w, h) {
  const out = new Set();
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) out.add(key(x + i, y + j));
  }
  return out;
}

/** Cases occupées par les autres pièces de l'étage. */
export function occupiedCells(floor, exceptRoomId) {
  const taken = new Map();
  for (const room of floor?.rooms || []) {
    if (room.id === exceptRoomId) continue;
    for (const k of roomCells(room)) taken.set(k, room.id);
  }
  return taken;
}

export function collides(cells, taken) {
  for (const k of cells) if (taken.has(k)) return true;
  return false;
}

/**
 * Premier emplacement libre pour poser une nouvelle pièce de w×h.
 * On balaie vers la droite puis vers le bas du plan existant : la pièce
 * apparaît à côté de la maison, jamais dans les coordonnées négatives.
 */
function findFreeSpot(floor, w, h) {
  const taken = occupiedCells(floor, null);
  if (!taken.size) return [0, 0];

  const b = floorBounds(floor);
  for (let y = b.minY; y <= b.maxY + h; y += 1) {
    for (let x = b.minX; x <= b.maxX + w; x += 1) {
      if (!collides(cellsOfRect(x, y, w, h), taken)) return [x, y];
    }
  }
  return [b.minX, b.maxY + 1];
}

/**
 * Emplacement libre le plus proche d'une case souhaitée (recherche en
 * anneaux concentriques) : la nouvelle pièce apparaît là où l'on regarde.
 */
export function findFreeSpotNear(floor, w, h, preferred) {
  const taken = occupiedCells(floor, null);
  const [px, py] = preferred || [0, 0];
  if (!taken.size) return [px, py];

  for (let radius = 0; radius <= 30; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        if (!collides(cellsOfRect(px + dx, py + dy, w, h), taken)) return [px + dx, py + dy];
      }
    }
  }
  return findFreeSpot(floor, w, h);
}

/** Écrit les cases dans la pièce, en les recompactant en rectangles. */
export function setRoomCells(room, cells) {
  room.rects = rectsFromCells(cells);
  delete room.x;
  delete room.y;
  delete room.w;
  delete room.h;
  return room;
}

export function isSingleRect(room) {
  return normalizeRects(room).length === 1;
}
