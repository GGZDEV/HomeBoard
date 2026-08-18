/** Réglages persistés (localStorage) + fenêtre de configuration. */
import { store, bus } from './store.js';
import { icon } from './icons.js';
import { h, friendlyName, stateLabel } from './cards.js';
import { probe } from './ha.js';

const KEY = 'homeboard.settings';

const DEFAULTS = {
  mode: 'demo',       // 'demo' | 'live'
  url: '',
  token: '',
  theme: 'auto',      // 'auto' (préférence système) | 'dark' | 'light'
  configOverride: null
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  // Navigation privée, iframe cloisonnée… : l'absence de stockage ne doit pas
  // faire tomber l'interface, on continue simplement sans persistance.
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('Réglages non persistés :', err.message);
  }
  return next;
}

/** Applique un thème et renvoie celui réellement retenu ('dark' | 'light'). */
export function applyTheme(theme) {
  const resolved = theme === 'light' || theme === 'dark'
    ? theme
    : (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

export function openSettings({ onApply, defaultConfigText }) {
  const settings = loadSettings();
  const root = document.getElementById('modal-root');

  const modeInputs = ['demo', 'live'].map((mode) => h('label', {
    class: `radio ${settings.mode === mode ? 'is-active' : ''}`
  }, [
    h('input', { type: 'radio', name: 'mode', value: mode, checked: settings.mode === mode }),
    h('span', { class: 'radio-title', text: mode === 'demo' ? 'Mode démonstration' : 'Home Assistant' }),
    h('span', {
      class: 'radio-desc',
      text: mode === 'demo'
        ? 'Maison fictive animée, aucune connexion requise.'
        : 'Connexion temps réel via l’API WebSocket.'
    })
  ]));

  // Servi depuis Home Assistant lui-même ? L'origine courante est le bon défaut.
  const suggestedUrl = settings.url || (/^https?:$/.test(location.protocol) ? location.origin : '');
  const urlInput = h('input', {
    class: 'field', type: 'text', placeholder: 'http://homeassistant.local:8123', value: suggestedUrl
  });
  const tokenInput = h('input', {
    class: 'field', type: 'password', placeholder: 'Jeton d’accès longue durée', value: settings.token
  });
  const testResult = h('p', { class: 'hint' });

  const testBtn = h('button', {
    class: 'btn btn--ghost', type: 'button', html: `${icon('refresh')}<span>Tester la connexion</span>`,
    onclick: async (ev) => {
      const btn = ev.currentTarget;
      btn.disabled = true;
      testResult.className = 'hint';
      testResult.textContent = 'Connexion en cours…';
      const res = await probe({ url: urlInput.value, token: tokenInput.value });
      testResult.className = `hint ${res.ok ? 'hint--ok' : 'hint--error'}`;
      testResult.textContent = res.ok ? 'Connexion réussie 🎉' : `Échec : ${res.error}`;
      btn.disabled = false;
    }
  });

  const connectionTab = h('div', { class: 'tab-panel' }, [
    h('div', { class: 'radio-group' }, modeInputs),
    h('div', { class: 'form-grid' }, [
      h('label', { class: 'form-label', text: 'URL du serveur' }), urlInput,
      h('label', { class: 'form-label', text: 'Jeton d’accès' }), tokenInput
    ]),
    h('div', { class: 'btn-row' }, [testBtn]),
    testResult,
    h('p', {
      class: 'hint',
      html: 'Le jeton se crée dans Home Assistant : <strong>Profil → Sécurité → Jetons d’accès longue durée</strong>. '
        + 'Il reste stocké uniquement dans ce navigateur.'
    })
  ]);

  // --- Onglet Plan -------------------------------------------------------
  const planText = h('textarea', {
    class: 'field field--code', spellcheck: 'false', rows: 18
  });
  planText.value = settings.configOverride
    ? JSON.stringify(settings.configOverride, null, 2)
    : defaultConfigText;

  const planResult = h('p', { class: 'hint' });

  const planTab = h('div', { class: 'tab-panel' }, [
    h('p', {
      class: 'hint',
      html: 'Chaque pièce est un rectangle sur une grille : <code>x</code>, <code>y</code> (coin haut-gauche), '
        + '<code>w</code>, <code>h</code> (largeur, profondeur). Aucune modélisation 3D : la vue isométrique est générée automatiquement.'
    }),
    planText,
    h('div', { class: 'btn-row' }, [
      h('button', {
        class: 'btn', type: 'button', html: `${icon('check')}<span>Valider et appliquer</span>`,
        onclick: () => {
          try {
            const parsed = JSON.parse(planText.value);
            validateConfig(parsed);
            saveSettings({ configOverride: parsed });
            planResult.className = 'hint hint--ok';
            planResult.textContent = 'Plan appliqué.';
            onApply?.({ reloadConfig: true });
          } catch (err) {
            planResult.className = 'hint hint--error';
            planResult.textContent = `JSON invalide : ${err.message}`;
          }
        }
      }),
      h('button', {
        class: 'btn btn--ghost', type: 'button', html: `${icon('refresh')}<span>Revenir au plan d’origine</span>`,
        onclick: () => {
          planText.value = defaultConfigText;
          saveSettings({ configOverride: null });
          planResult.className = 'hint hint--ok';
          planResult.textContent = 'Plan d’origine restauré.';
          onApply?.({ reloadConfig: true });
        }
      })
    ]),
    planResult
  ]);

  // --- Onglet Entités ----------------------------------------------------
  const search = h('input', { class: 'field', type: 'search', placeholder: 'Filtrer les entités…' });
  const list = h('div', { class: 'entity-list' });

  const renderList = () => {
    const q = search.value.trim().toLowerCase();
    const rows = Object.values(store.entities)
      .filter((e) => !q || e.entity_id.toLowerCase().includes(q)
        || friendlyName(e.entity_id, e).toLowerCase().includes(q))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id))
      .slice(0, 200)
      .map((e) => h('button', {
        class: 'entity-row', type: 'button', title: 'Copier l’identifiant',
        onclick: () => {
          navigator.clipboard?.writeText(e.entity_id);
          bus.emit('toast', { type: 'ok', text: `${e.entity_id} copié` });
        }
      }, [
        h('code', { class: 'entity-id', text: e.entity_id }),
        h('span', { class: 'entity-state', text: stateLabel(e) }),
        h('span', { class: 'entity-copy', html: icon('copy') })
      ]));
    list.replaceChildren(...(rows.length ? rows : [h('p', { class: 'hint', text: 'Aucune entité.' })]));
  };
  search.addEventListener('input', renderList);

  const entitiesTab = h('div', { class: 'tab-panel' }, [
    h('p', { class: 'hint', text: 'Cliquez sur une entité pour copier son identifiant et le coller dans le plan.' }),
    search, list
  ]);
  renderList();

  // --- Assemblage --------------------------------------------------------
  const tabs = [
    ['Connexion', connectionTab],
    ['Plan de la maison', planTab],
    ['Entités', entitiesTab]
  ];
  const body = h('div', { class: 'modal-body' });
  const tabBar = h('div', { class: 'tabs' }, tabs.map(([label, panel], i) => h('button', {
    class: `tab ${i === 0 ? 'is-active' : ''}`, type: 'button', text: label,
    onclick: (ev) => {
      tabBar.querySelectorAll('.tab').forEach((t) => t.classList.remove('is-active'));
      ev.currentTarget.classList.add('is-active');
      body.replaceChildren(panel);
    }
  })));
  body.replaceChildren(tabs[0][1]);

  const close = () => { root.replaceChildren(); document.removeEventListener('keydown', onKey); };
  const onKey = (ev) => { if (ev.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const save = () => {
    const mode = connectionTab.querySelector('input[name="mode"]:checked')?.value || 'demo';
    saveSettings({ mode, url: urlInput.value.trim(), token: tokenInput.value.trim() });
    close();
    onApply?.({ reconnect: true });
  };

  const modal = h('div', { class: 'modal-backdrop', onclick: (ev) => { if (ev.target === ev.currentTarget) close(); } }, [
    h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Réglages' }, [
      h('header', { class: 'modal-head' }, [
        h('h2', { text: 'Réglages' }),
        h('button', { class: 'ibtn', type: 'button', 'aria-label': 'Fermer', html: icon('close'), onclick: close })
      ]),
      tabBar,
      body,
      h('footer', { class: 'modal-foot' }, [
        h('button', { class: 'btn btn--ghost', type: 'button', text: 'Annuler', onclick: close }),
        h('button', { class: 'btn', type: 'button', html: `${icon('check')}<span>Enregistrer</span>`, onclick: save })
      ])
    ])
  ]);

  connectionTab.addEventListener('change', () => {
    connectionTab.querySelectorAll('.radio').forEach((r) => {
      r.classList.toggle('is-active', r.querySelector('input').checked);
    });
  });

  root.replaceChildren(modal);
  urlInput.focus();
}

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('objet attendu');
  if (!Array.isArray(cfg.floors) || !cfg.floors.length) throw new Error('« floors » doit être une liste non vide');
  cfg.floors.forEach((floor, i) => {
    if (!floor.id) throw new Error(`floors[${i}].id manquant`);
    if (!Array.isArray(floor.rooms) || !floor.rooms.length) throw new Error(`floors[${i}].rooms vide`);
    floor.rooms.forEach((room, j) => {
      for (const key of ['id', 'name']) {
        if (!room[key]) throw new Error(`floors[${i}].rooms[${j}].${key} manquant`);
      }
      for (const key of ['x', 'y', 'w', 'h']) {
        if (!Number.isFinite(Number(room[key]))) {
          throw new Error(`floors[${i}].rooms[${j}].${key} doit être un nombre`);
        }
      }
    });
  });
  return true;
}
