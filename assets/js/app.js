/** Point d'entrée : assemble le tableau de bord et branche le backend. */
import { store, bus } from './store.js';
import { icon } from './icons.js';
import { h, formatNumber } from './cards.js';
import { IsoStage, summarize } from './iso.js';
import { DemoBackend } from './demo.js';
import { HomeAssistantBackend } from './ha.js';
import { detectCapabilities } from './capabilities.js';
import { PlanEditor } from './editor.js';
import {
  CardHost, renderPanel, renderRoomsView, renderEnergyView, renderSecurityView, WEATHER
} from './views.js';
import { loadSettings, saveSettings, applyTheme, openSettings, validateConfig } from './settings.js';

const NAV = {
  home: { label: 'Maison', icon: 'home' },
  rooms: { label: 'Pièces', icon: 'grid' },
  energy: { label: 'Énergie', icon: 'zap' },
  security: { label: 'Sécurité', icon: 'shield' },
  editor: { label: 'Éditeur', icon: 'floorplan' }
};

const app = {
  config: null,
  defaultConfigText: '',
  caps: null,
  view: 'home',
  floorId: null,
  roomId: null,
  stage: null,
  editor: null,
  host: new CardHost(),
  homeNode: null,
  dirty: false,
  energySignature: ''
};

const ctx = {
  get config() { return app.config; },
  get caps() { return app.caps; },
  get floor() { return app.config.floors.find((f) => f.id === app.floorId) || app.config.floors[0]; },
  get floorId() { return app.floorId; },
  get roomId() { return app.roomId; },
  get entities() { return store.entities; },
  selectRoom,
  setFloor,
  setView
};

// --- Démarrage -----------------------------------------------------------

async function boot() {
  const settings = loadSettings();
  const theme = applyTheme(settings.theme);

  const response = await fetch('config/home.json');
  if (!response.ok) throw new Error(`config/home.json introuvable (${response.status})`);
  app.defaultConfigText = await response.text();

  app.config = resolveConfig(settings);
  app.floorId = app.config.floors[0]?.id || null;
  // Capacités « à vide » : l'interface doit tenir debout avant la connexion.
  refreshCapabilities();

  buildChrome();
  renderThemeIcon(theme);
  await connect(settings);
  refreshCapabilities();
  renderEverything();

  bus.on('entity', onEntityChange);
  bus.on('entities', refreshCapabilities);
  bus.on('status', renderStatus);
  bus.on('toast', showToast);
  window.addEventListener('homeboard-toast', (ev) => showToast({ text: ev.detail.text }));

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && app.roomId) selectRoom(null);
  });
  window.addEventListener('resize', () => {
    app.stage?.applyCamera();
    app.editor?.fitCamera();
  });
}

function resolveConfig(settings) {
  if (settings.configOverride) {
    try {
      validateConfig(settings.configOverride);
      return settings.configOverride;
    } catch (err) {
      console.warn('Plan personnalisé invalide, retour au plan par défaut :', err.message);
    }
  }
  return JSON.parse(app.defaultConfigText);
}

function persistConfig() {
  saveSettings({ configOverride: app.config });
}

async function connect(settings) {
  store.backend?.disconnect?.();
  const useLive = settings.mode === 'live' && settings.url && settings.token;
  const backend = useLive
    ? new HomeAssistantBackend({ url: settings.url, token: settings.token })
    : new DemoBackend();
  store.backend = backend;
  try {
    await backend.connect();
  } catch (err) {
    if (!useLive) throw err;
    showToast({ type: 'error', text: 'Home Assistant injoignable — bascule en mode démo' });
    store.backend = new DemoBackend();
    await store.backend.connect();
  }
}

/** Recalcule ce que l'installation permet d'afficher. */
function refreshCapabilities() {
  const before = app.caps?.views.join(',');
  app.caps = detectCapabilities(store.entities, app.config);
  if (before && before !== app.caps.views.join(',')) {
    renderNav();
    if (!availableViews().includes(app.view)) setView('home');
  }
}

const availableViews = () => [...(app.caps?.views || ['home', 'rooms']), 'editor'];

// --- Squelette de l'interface -------------------------------------------

function buildChrome() {
  app.homeNode = buildHomeView();
  renderNav();
  setView('home');
}

function renderNav() {
  const rail = document.getElementById('rail');
  rail.replaceChildren(
    h('div', { class: 'brand-mark', html: icon('home') }),
    h('nav', { class: 'nav', 'aria-label': 'Navigation principale' }, availableViews().map((view) => h('button', {
      class: `nav-btn ${view === app.view ? 'is-active' : ''}`, type: 'button',
      dataset: { view }, title: NAV[view].label, onclick: () => setView(view)
    }, [
      h('span', { class: 'nav-ico', html: icon(NAV[view].icon) }),
      h('span', { class: 'nav-label', text: NAV[view].label })
    ])))
  );
}

function buildHomeView() {
  const canvas = h('div', { class: 'stage-canvas', id: 'canvas' });
  const floors = h('div', { class: 'floor-switch', id: 'floors' });
  const scenes = h('div', { class: 'scene-bar', id: 'scenes' });

  const node = h('div', { class: 'stage' }, [
    h('div', { class: 'stage-top' }, [
      floors,
      h('div', { class: 'stage-tools' }, [
        toolButton('minimize', 'Dézoomer', () => app.stage.zoom(1 / 1.18)),
        toolButton('refresh', 'Recentrer', () => app.stage.resetCamera()),
        toolButton('maximize', 'Zoomer', () => app.stage.zoom(1.18))
      ])
    ]),
    canvas,
    scenes
  ]);

  app.stage = new IsoStage(canvas, { onSelect: selectRoom });
  return node;
}

function toolButton(name, label, onClick) {
  return h('button', {
    class: 'ibtn', type: 'button', title: label, 'aria-label': label, html: icon(name), onclick: onClick
  });
}

// --- Rendu ---------------------------------------------------------------

function renderEverything() {
  renderTopbar();
  renderView();
  renderPanelNow();
  renderStatus({ status: store.status, message: store.statusMessage });
}

function renderView() {
  const root = document.getElementById('view-root');
  app.host.reset();

  for (const btn of document.querySelectorAll('.nav-btn[data-view]')) {
    btn.classList.toggle('is-active', btn.dataset.view === app.view);
  }
  document.getElementById('app').classList.toggle('is-editing', app.view === 'editor');

  if (app.view !== 'editor') app.editor = null;

  switch (app.view) {
    case 'home':
      root.replaceChildren(app.homeNode);
      renderFloors();
      renderScenes();
      app.stage.render(ctx.floor, ctx);
      app.stage.select(app.roomId);
      break;
    case 'rooms':
      renderRoomsView(root, ctx, app.host);
      break;
    case 'energy':
      renderEnergyView(root, ctx, app.host);
      break;
    case 'security':
      renderSecurityView(root, ctx, app.host);
      break;
    case 'editor':
      app.editor = new PlanEditor(root, {
        config: app.config,
        entities: store.entities,
        onChange: () => {
          persistConfig();
          refreshCapabilities();
          renderTopbar();
        },
        onDone: () => {
          app.roomId = null;
          setView('home');
          showToast({ text: 'Plan enregistré.' });
        }
      });
      break;
    default:
      break;
  }
}

function renderPanelNow() {
  const panel = document.getElementById('panel');
  if (app.view === 'editor') {
    panel.replaceChildren();
    document.getElementById('app').classList.remove('has-room');
    return;
  }
  renderPanel(panel, ctx, app.host);
  document.getElementById('app').classList.toggle('has-room', Boolean(app.roomId));
}

function renderFloors() {
  const holder = document.getElementById('floors');
  if (!holder) return;
  const floors = app.config.floors;
  holder.hidden = floors.length < 2;
  holder.replaceChildren(...floors.map((floor) => {
    const lit = floor.rooms.reduce((n, r) => n + summarize(r, store.entities).lightsOn, 0);
    return h('button', {
      class: `floor-btn ${floor.id === app.floorId ? 'is-active' : ''}`, type: 'button',
      onclick: () => setFloor(floor.id)
    }, [
      h('span', { class: 'floor-name', text: floor.name }),
      lit ? h('span', { class: 'floor-dot', title: `${lit} lumière(s) allumée(s)` }) : null
    ]);
  }));
}

function renderScenes() {
  const holder = document.getElementById('scenes');
  if (!holder) return;
  const scenes = app.caps?.scenes || [];
  holder.hidden = !scenes.length;
  holder.replaceChildren(...scenes.map((scene) => h('button', {
    class: 'scene-btn', type: 'button',
    onclick: () => {
      store.call(scene.id.split('.')[0], 'turn_on', { entity_id: scene.id });
      showToast({ text: `Scène « ${scene.name} » activée` });
    }
  }, [
    h('span', { class: 'scene-ico', html: icon(scene.icon || 'zap') }),
    h('span', { class: 'scene-name', text: scene.name })
  ])));
}

function renderTopbar() {
  const caps = app.caps || {};
  const weather = store.get(caps.weather);
  const [wLabel, wIcon] = WEATHER[weather?.state] || ['Météo', 'cloud'];
  const outdoor = Number(weather?.attributes?.temperature ?? store.get(caps.outdoor)?.state);
  const power = Number(store.get(caps.power)?.state);
  const litCount = Object.values(store.entities)
    .filter((e) => e.entity_id.startsWith('light.') && e.state === 'on').length;
  const home = (caps.persons || []).map((id) => store.get(id)).filter((p) => p?.state === 'home').length;
  const alarm = store.get(caps.alarm);

  // Chaque puce n'apparaît que si l'installation la justifie.
  const chips = [
    caps.hasWeather && Number.isFinite(outdoor) ? chip(wIcon, `${formatNumber(outdoor)}°`, wLabel) : null,
    litCount ? chip('bulb', String(litCount), litCount > 1 ? 'lumières' : 'lumière', true) : null,
    caps.power && Number.isFinite(power) ? chip('zap', `${formatNumber(power)} W`, 'consommation') : null,
    caps.hasPresence ? chip('person', String(home), 'à la maison', home > 0) : null,
    alarm ? chip('shield', alarm.state.startsWith('armed') ? 'Armée' : 'Off', 'alarme',
      alarm.state.startsWith('armed')) : null
  ].filter(Boolean);

  document.getElementById('topbar').replaceChildren(
    h('div', { class: 'brand' }, [
      h('h1', { class: 'brand-title', text: app.config.name || 'Maison' }),
      h('p', { class: 'brand-sub', text: `${greeting()} · ${dateLabel()}` })
    ]),
    chips.length ? h('div', { class: 'stat-chips' }, chips) : null,
    h('div', { class: 'topbar-actions' }, [
      h('button', {
        class: 'status', id: 'status', type: 'button', onclick: showSettings, 'aria-label': 'État de la connexion'
      }, [h('span', { class: 'status-dot' }), h('span', { class: 'status-text' })]),
      h('button', {
        class: 'ibtn', id: 'theme-btn', type: 'button', title: 'Thème clair / sombre',
        'aria-label': 'Basculer le thème', html: icon('moon'), onclick: toggleTheme
      }),
      h('button', {
        class: 'ibtn', type: 'button', title: 'Réglages', 'aria-label': 'Réglages',
        html: icon('settings'), onclick: showSettings
      })
    ])
  );
  renderThemeIcon(document.documentElement.dataset.theme);
  renderStatus({ status: store.status, message: store.statusMessage });
}

function chip(iconName, value, label, active = false) {
  return h('div', { class: `chip-stat ${active ? 'is-active' : ''}` }, [
    h('span', { class: 'chip-ico', html: icon(iconName) }),
    h('div', { class: 'chip-body' }, [h('strong', { text: value }), h('span', { text: label })])
  ]);
}

function renderStatus({ status, message }) {
  const node = document.getElementById('status');
  if (!node) return;
  const labels = {
    demo: 'Démo', connected: 'Connecté', connecting: 'Connexion…', error: 'Hors ligne', idle: '…'
  };
  node.dataset.status = status;
  node.title = message || labels[status] || status;
  node.querySelector('.status-text').textContent = labels[status] || status;
}

function renderThemeIcon(theme) {
  const node = document.querySelector('#theme-btn');
  if (node) node.innerHTML = icon(theme === 'light' ? 'sun' : 'moon');
}

// --- Interactions --------------------------------------------------------

function setView(view) {
  app.view = availableViews().includes(view) ? view : 'home';
  renderView();
  renderPanelNow();
}

function setFloor(floorId) {
  if (app.floorId === floorId) return;
  app.floorId = floorId;
  app.roomId = null;
  if (app.view === 'home') {
    renderFloors();
    app.stage.render(ctx.floor, ctx);
    app.stage.select(null);
  }
  renderPanelNow();
}

function selectRoom(roomId) {
  if (roomId && !ctx.floor.rooms.some((r) => r.id === roomId)) {
    const floor = app.config.floors.find((f) => f.rooms.some((r) => r.id === roomId));
    if (floor) app.floorId = floor.id;
  }
  app.roomId = app.roomId === roomId ? null : roomId;
  app.host.reset();
  app.stage?.select(app.roomId);
  renderPanelNow();
  if (app.view !== 'home') setView('home');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  saveSettings({ theme: next });
  applyTheme(next);
  renderThemeIcon(next);
}

function showSettings() {
  openSettings({
    currentConfig: app.config,
    defaultConfigText: app.defaultConfigText,
    onApply: async ({ reconnect, reloadConfig } = {}) => {
      const settings = loadSettings();
      if (reloadConfig) {
        app.config = resolveConfig(settings);
        if (!app.config.floors.some((f) => f.id === app.floorId)) {
          app.floorId = app.config.floors[0]?.id || null;
        }
        app.roomId = null;
      }
      if (reconnect) await connect(settings);
      refreshCapabilities();
      renderNav();
      renderEverything();
    }
  });
}

// --- Mises à jour temps réel --------------------------------------------

let frame = null;
let lastStageRender = 0;

function onEntityChange(entity) {
  app.host.update(entity);
  app.dirty = true;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    if (!app.dirty) return;
    app.dirty = false;
    if (app.view === 'editor') return;

    renderTopbar();

    const now = performance.now();
    if (app.view === 'home' && now - lastStageRender > 350) {
      lastStageRender = now;
      renderFloors();
      app.stage.render(ctx.floor, ctx);
      app.stage.select(app.roomId);
    }

    // La vue Énergie liste les appareils actifs : on ne la reconstruit que si
    // cette liste change réellement, pour ne pas casser un curseur en cours.
    if (app.view === 'energy') {
      const signature = Object.values(store.entities)
        .filter((e) => /^(light|switch|media_player)\./.test(e.entity_id)
          && e.state !== 'off' && e.state !== 'unavailable')
        .map((e) => e.entity_id).join('|');
      if (signature !== app.energySignature) {
        app.energySignature = signature;
        app.host.reset();
        renderEnergyView(document.getElementById('view-root'), ctx, app.host);
        renderPanelNow();
      }
    }
  });
}

// --- Divers --------------------------------------------------------------

function showToast({ type = 'info', text }) {
  const holder = document.getElementById('toasts');
  const toast = h('div', { class: `toast toast--${type}` }, [
    h('span', { class: 'toast-ico', html: icon(type === 'error' ? 'alert' : 'check') }),
    h('span', { text })
  ]);
  holder.append(toast);
  setTimeout(() => toast.classList.add('is-out'), 2600);
  setTimeout(() => toast.remove(), 3100);
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return 'Bonne nuit';
  if (hour < 12) return 'Bonjour';
  if (hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function dateLabel() {
  return new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Démarrage en toute fin de fichier : boot() s'exécute de façon synchrone
// jusqu'au premier await, il ne doit donc rien référencer d'encore indéfini.
boot().catch((err) => {
  console.error(err);
  const node = document.getElementById('boot-error');
  node.textContent = `Erreur de démarrage : ${err.message}`;
  node.hidden = false;
});
