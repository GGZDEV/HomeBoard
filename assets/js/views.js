/** Panneau latéral (vue d'ensemble ou pièce) et vue « Pièces ». */
import { store } from './store.js';
import { icon } from './icons.js';
import { createCard, h, formatNumber, isLight } from './cards.js';
import { summarize } from './iso.js';

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

// --- Panneau -------------------------------------------------------------

export function renderPanel(container, ctx, host) {
  container.replaceChildren(ctx.roomId ? roomPanel(ctx, host) : overviewPanel(ctx, host));
}

function roomPanel(ctx, host) {
  const room = ctx.floor.rooms.find((r) => r.id === ctx.roomId);
  if (!room) return overviewPanel(ctx, host);

  const info = summarize(room, store.entities);
  const ids = (room.entities || []).filter((id) => store.get(id));
  const lights = ids.filter(isLight);
  const sensors = ids.filter((id) => !isLight(id));

  return h('div', { class: 'panel-inner' }, [
    h('header', { class: 'panel-head' }, [
      h('button', {
        class: 'ibtn', type: 'button', 'aria-label': 'Retour à la vue d’ensemble',
        html: icon('chevronLeft'), onclick: () => ctx.selectRoom(null)
      }),
      h('div', {}, [
        h('h2', { class: 'panel-title', text: room.name }),
        h('p', { class: 'panel-sub', text: ctx.floor.name })
      ]),
      h('span', { class: 'panel-badge', html: icon(room.icon || 'grid') })
    ]),

    info.temp != null || lights.length ? h('div', { class: 'room-stats' }, [
      info.temp != null ? stat(icon('thermometer'), `${formatNumber(info.temp)}°`, 'Température') : null,
      lights.length ? stat(icon('bulb'), `${info.lightsOn}/${lights.length}`, 'Lumières allumées') : null
    ]) : null,

    lights.length > 1 ? h('div', { class: 'btn-row btn-row--stretch' }, [
      h('button', {
        class: 'btn', type: 'button', html: `${icon('bulb')}<span>Tout allumer</span>`,
        onclick: () => store.call('light', 'turn_on', { entity_id: lights })
      }),
      h('button', {
        class: 'btn btn--ghost', type: 'button', html: `${icon('power')}<span>Tout éteindre</span>`,
        onclick: () => store.call('light', 'turn_off', { entity_id: lights })
      })
    ]) : null,

    lights.length ? h('div', { class: 'card-stack' }, lights.map((id) => host.card(id))) : null,
    sensors.length ? section('Températures', h('div', { class: 'card-grid' }, sensors.map((id) => host.card(id)))) : null,

    ids.length ? null : h('div', { class: 'empty-state' }, [
      h('span', { class: 'empty-ico', html: icon('device') }),
      h('h3', { text: 'Aucun appareil ici' }),
      h('p', { text: 'Ajoutez des lumières ou un capteur de température à cette pièce depuis l’éditeur.' }),
      h('button', {
        class: 'btn', type: 'button', html: `${icon('floorplan')}<span>Ouvrir l’éditeur</span>`,
        onclick: () => ctx.setView('editor')
      })
    ])
  ]);
}

function overviewPanel(ctx, host) {
  const caps = ctx.caps;
  const rooms = ctx.config.floors.flatMap((floor) => floor.rooms);
  const placed = rooms.some((room) => (room.entities || []).some((id) => store.get(id)));

  if (!placed) {
    return h('div', { class: 'panel-inner' }, [
      h('header', { class: 'panel-head' }, [
        h('div', {}, [
          h('h2', { class: 'panel-title', text: 'Vue d’ensemble' }),
          h('p', { class: 'panel-sub', text: 'Rien n’est encore rattaché à une pièce' })
        ])
      ]),
      h('div', { class: 'empty-state' }, [
        h('span', { class: 'empty-ico', html: icon('floorplan') }),
        h('h3', { text: rooms.length ? 'Placez vos appareils' : 'Dessinez votre maison' }),
        h('p', {
          text: rooms.length
            ? 'Dans l’éditeur, sélectionnez une pièce et ajoutez-y vos lumières et vos capteurs.'
            : 'L’éditeur permet de poser vos pièces en quelques gestes, puis d’y placer vos appareils.'
        }),
        h('button', {
          class: 'btn', type: 'button', html: `${icon('floorplan')}<span>Ouvrir l’éditeur</span>`,
          onclick: () => ctx.setView('editor')
        })
      ])
    ]);
  }

  const onLights = caps.lightsOn.filter((id) => store.get(id));

  return h('div', { class: 'panel-inner' }, [
    h('header', { class: 'panel-head' }, [
      h('div', {}, [
        h('h2', { class: 'panel-title', text: 'Vue d’ensemble' }),
        h('p', { class: 'panel-sub', text: 'Touchez une pièce du plan pour la piloter' })
      ])
    ]),

    caps.hasLights ? h('article', { class: `hero ${onLights.length ? 'is-on' : ''}` }, [
      h('div', { class: 'hero-ico', html: icon('bulb') }),
      h('div', { class: 'hero-main' }, [
        h('strong', { class: 'hero-value', text: String(onLights.length) }),
        h('span', {
          class: 'hero-label',
          text: onLights.length
            ? `lumière${onLights.length > 1 ? 's' : ''} allumée${onLights.length > 1 ? 's' : ''} sur ${caps.lights.length}`
            : 'tout est éteint'
        })
      ]),
      onLights.length ? h('button', {
        class: 'btn btn--ghost hero-action', type: 'button',
        html: `${icon('power')}<span>Tout éteindre</span>`,
        onclick: () => store.call('light', 'turn_off', { entity_id: caps.lights })
      }) : null
    ]) : null,

    caps.hasTemperature ? temperatureCard(ctx) : null,

    onLights.length
      ? section('Allumées maintenant', h('div', { class: 'card-stack' }, onLights.map((id) => host.card(id))))
      : null
  ]);
}

function temperatureCard(ctx) {
  const caps = ctx.caps;
  const outdoor = store.get(caps.outdoor);

  const rows = ctx.config.floors.flatMap((floor) => floor.rooms)
    .map((room) => ({ room, info: summarize(room, store.entities) }))
    .filter(({ info }) => info.temp != null)
    .sort((a, b) => b.info.temp - a.info.temp)
    .slice(0, 8);

  return h('article', { class: 'card card--temps' }, [
    h('div', { class: 'card-head' }, [
      h('span', { class: 'card-ico', html: icon('thermometer') }),
      h('div', { class: 'card-title' }, [
        h('h4', { class: 'card-name', text: 'Températures' }),
        h('p', {
          class: 'card-sub',
          text: caps.indoorAverage != null ? `${formatNumber(caps.indoorAverage)}° en moyenne` : 'à l’intérieur'
        })
      ]),
      outdoor ? h('span', { class: 'pill', text: `${formatNumber(outdoor.state)}° dehors` }) : null
    ]),
    rows.length ? h('div', { class: 'card-body' }, [
      h('ul', { class: 'temp-rows' }, rows.map(({ room, info }) => h('li', {
        class: 'temp-row', role: 'button', tabindex: '0',
        onclick: () => ctx.selectRoom(room.id),
        onkeydown: (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          ctx.selectRoom(room.id);
        }
      }, [
        h('span', { class: 'temp-name', text: room.name }),
        h('span', { class: 'temp-bar' }, [
          h('span', { class: 'temp-fill', style: `--fill: ${tempRatio(info.temp)}` })
        ]),
        h('strong', { class: 'temp-value', text: `${formatNumber(info.temp)}°` })
      ])))
    ]) : null
  ]);
}

/** Position d'une température sur une échelle confort 15–27 °C. */
function tempRatio(value) {
  return `${Math.round(Math.min(1, Math.max(0, (value - 15) / 12)) * 100)}%`;
}

// --- Vue « Pièces » ------------------------------------------------------

export function renderRoomsView(container, ctx, host) {
  const hasRooms = ctx.config.floors.some((floor) => floor.rooms.length);

  if (!hasRooms) {
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

  container.replaceChildren(h('div', { class: 'view' }, [
    viewHead('Pièces', 'Toutes les pièces, tous étages confondus'),
    ...ctx.config.floors.filter((floor) => floor.rooms.length).map((floor) => section(
      floor.name,
      h('div', { class: 'tile-grid' }, floor.rooms.map((room) => {
        const info = summarize(room, store.entities);
        return h('button', {
          class: `tile ${info.lightsOn ? 'is-lit' : ''}`, type: 'button',
          style: info.lightsOn ? `--tile-accent: rgb(${info.color.join(',')})` : '',
          onclick: () => { ctx.setFloor(floor.id); ctx.selectRoom(room.id); }
        }, [
          h('span', { class: 'tile-ico', html: icon(room.icon || 'grid') }),
          h('span', { class: 'tile-name', text: room.name }),
          h('span', { class: 'tile-meta', text: info.meta || 'aucun appareil' })
        ]);
      }))
    ))
  ]));
}

// --- Fragments -----------------------------------------------------------

function viewHead(title, sub) {
  return h('header', { class: 'view-head' }, [h('h2', { text: title }), h('p', { text: sub })]);
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
