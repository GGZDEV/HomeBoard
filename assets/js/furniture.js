/**
 * Mobilier isométrique, généré — aucune image, aucun modèle 3D.
 *
 * Chaque meuble est un empilement de boîtes posées dans le plus grand
 * rectangle plein de la pièce, ce qui garantit qu'il reste à l'intérieur,
 * même pour une forme en L. Les tailles sont exprimées en cases de grille,
 * les hauteurs en pixels — comme la hauteur des murs.
 */

/** Faces visibles d'une boîte : le dessus, la face sud et la face est. */
function box(pt, x, y, w, d, h, tone = '') {
  const suffix = tone ? `-${tone}` : '';
  return [
    { cls: `f-top${suffix}`, d: `M${pt(x, y, h)}L${pt(x + w, y, h)}L${pt(x + w, y + d, h)}L${pt(x, y + d, h)}Z` },
    { cls: `f-south${suffix}`, d: `M${pt(x, y + d, 0)}L${pt(x + w, y + d, 0)}L${pt(x + w, y + d, h)}L${pt(x, y + d, h)}Z` },
    { cls: `f-east${suffix}`, d: `M${pt(x + w, y, 0)}L${pt(x + w, y + d, 0)}L${pt(x + w, y + d, h)}L${pt(x + w, y, h)}Z` }
  ];
}

/** Surface plate posée au sol (tapis, bac de douche…). */
function slab(pt, x, y, w, d, cls) {
  return [{ cls, d: `M${pt(x, y)}L${pt(x + w, y)}L${pt(x + w, y + d)}L${pt(x, y + d)}Z` }];
}

// Meubles bas et écartés des murs : le relief doit rester discret face à
// des cloisons de 34 px, sinon la pièce paraît encombrée.
const LAYOUTS = {
  sofa: (pt, r) => {
    const w = Math.min(2.4, r.w - 1.2);
    const x = r.x + (r.w - w) / 2;
    const y = r.y + 0.95;
    const pieces = [
      ...box(pt, x, y, w, 0.26, 13, 'accent'),        // dossier
      ...box(pt, x, y + 0.26, w, 0.78, 7, 'accent')   // assise
    ];
    if (r.h >= 3.4) {
      pieces.unshift(...slab(pt, x - 0.15, y + 1.15, w + 0.3, Math.min(1.8, r.h - 2.4), 'f-rug'));
      pieces.push(...box(pt, x + w / 2 - 0.5, y + 1.7, 1, 0.6, 6));
    }
    return pieces;
  },

  bed: (pt, r) => {
    const w = Math.min(1.9, r.w - 1.1);
    const d = Math.min(2.3, r.h - 1.4);
    const x = r.x + (r.w - w) / 2;
    const y = r.y + 0.85;
    return [
      ...box(pt, x, y, w, 0.18, 16),                     // tête de lit
      ...box(pt, x, y + 0.18, w, d, 7, 'accent'),        // matelas
      ...box(pt, x + 0.16, y + 0.3, w - 0.32, 0.4, 9)    // oreillers
    ];
  },

  cooking: (pt, r) => {
    const w = Math.min(r.w - 1.2, 2.9);
    const x = r.x + 0.7;
    const y = r.y + 0.8;
    const pieces = [...box(pt, x, y, w, 0.58, 12)];                                 // plan de travail
    if (r.h >= 3.6) pieces.push(...box(pt, x, y + 1.7, Math.min(w, 1.9), 0.8, 10)); // îlot
    if (r.w >= 3.4) pieces.push(...box(pt, x + w - 0.66, y + 0.02, 0.62, 0.56, 20)); // réfrigérateur
    return pieces;
  },

  shower: (pt, r) => {
    const pieces = [...box(pt, r.x + 0.7, r.y + 0.85, Math.min(1.6, r.w - 1.3), 0.76, 8)]; // baignoire
    if (r.h >= 3.4) {
      pieces.push(...slab(pt, r.x + 0.7, r.y + 2.1, 0.95, 0.95, 'f-tray'));
      pieces.push(...box(pt, r.x + 0.7, r.y + 2.1, 0.1, 0.95, 19));
    }
    if (r.w >= 3.4) pieces.push(...box(pt, r.x + r.w - 1.3, r.y + 0.85, 0.7, 0.44, 12)); // vasque
    return pieces;
  },

  laptop: (pt, r) => {
    const w = Math.min(1.7, r.w - 1.1);
    const x = r.x + 0.6;
    const y = r.y + 0.85;
    return [
      ...box(pt, x, y, w, 0.6, 11),                       // bureau
      ...box(pt, x + 0.26, y + 0.1, 0.66, 0.08, 18),      // écran
      ...box(pt, x + w / 2 - 0.26, y + 0.95, 0.52, 0.52, 8, 'accent') // siège
    ];
  },

  car: (pt, r) => {
    const w = Math.min(1.6, r.w - 1.4);
    const d = Math.min(3.2, r.h - 1.2);
    const x = r.x + (r.w - w) / 2;
    const y = r.y + (r.h - d) / 2;
    return [
      ...box(pt, x, y, w, d, 7, 'accent'),
      ...box(pt, x + 0.18, y + d * 0.24, w - 0.36, d * 0.4, 13, 'accent')
    ];
  },

  stairs: (pt, r) => {
    const steps = Math.min(6, Math.max(3, Math.floor(r.h - 1)));
    const w = Math.min(1.4, r.w - 0.9);
    const x = r.x + (r.w - w) / 2;
    const pieces = [];
    for (let i = 0; i < steps; i += 1) {
      pieces.push(...box(pt, x, r.y + 0.7 + i * 0.56, w, 0.56, 4 + i * 4));
    }
    return pieces;
  },

  door: (pt, r) => {
    const pieces = [...box(pt, r.x + 0.6, r.y + 0.85, Math.min(1.1, r.w - 1.2), 0.34, 11)];
    if (r.h >= 3) pieces.unshift(...slab(pt, r.x + 0.55, r.y + 1.7, Math.min(1, r.w - 1.1), 0.65, 'f-rug'));
    return pieces;
  },

  tv: (pt, r) => [
    ...box(pt, r.x + 0.7, r.y + 0.85, Math.min(1.7, r.w - 1.4), 0.42, 7),
    ...box(pt, r.x + 0.85, r.y + 0.92, Math.min(1.4, r.w - 1.7), 0.08, 16)
  ],

  coffee: (pt, r) => [
    ...box(pt, r.x + 0.7, r.y + 0.9, Math.min(1.2, r.w - 1.3), Math.min(0.85, r.h - 1.6), 10)
  ]
};

LAYOUTS.speaker = LAYOUTS.tv;

/**
 * @returns liste de { cls, d } à peindre dans la pièce, du fond vers l'avant.
 */
export function furnitureFor(iconName, rect, pt) {
  const layout = LAYOUTS[iconName];
  // Une pièce minuscule reste vide : mieux vaut rien qu'un meuble qui déborde.
  if (!layout || !rect || rect.w < 1.6 || rect.h < 1.6) return [];
  try {
    return layout(pt, rect);
  } catch {
    return [];
  }
}
