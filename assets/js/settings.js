/** Réglages persistés (localStorage) + fenêtre de connexion et sauvegarde. */
import { icon } from './icons.js';
import { h } from './cards.js';
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

export function openSettings({ onApply, currentConfig, defaultConfigText }) {
  const settings = loadSettings();
  const root = document.getElementById('modal-root');

  // --- Onglet Connexion --------------------------------------------------
  const modeInputs = ['demo', 'live'].map((mode) => h('label', {
    class: `radio ${settings.mode === mode ? 'is-active' : ''}`
  }, [
    h('input', { type: 'radio', name: 'mode', value: mode, checked: settings.mode === mode }),
    h('span', { class: 'radio-title', text: mode === 'demo' ? 'Démonstration' : 'Home Assistant' }),
    h('span', {
      class: 'radio-desc',
      text: mode === 'demo'
        ? 'Maison fictive animée, aucune connexion requise.'
        : 'Connexion temps réel via l’API WebSocket.'
    })
  ]));

  const suggestedUrl = settings.url || (/^https?:$/.test(location.protocol) ? location.origin : '');
  const urlInput = h('input', {
    class: 'field', type: 'text', inputmode: 'url', autocapitalize: 'off', autocorrect: 'off',
    placeholder: 'http://homeassistant.local:8123', value: suggestedUrl
  });
  const tokenInput = h('input', {
    class: 'field', type: 'password', placeholder: 'Jeton d’accès longue durée', value: settings.token
  });
  const testResult = h('p', { class: 'hint' });

  const connectionTab = h('div', { class: 'tab-panel' }, [
    h('div', { class: 'radio-group' }, modeInputs),
    h('div', { class: 'form-grid' }, [
      h('label', { class: 'form-label', text: 'URL du serveur' }), urlInput,
      h('label', { class: 'form-label', text: 'Jeton d’accès' }), tokenInput
    ]),
    h('div', { class: 'btn-row' }, [
      h('button', {
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
      })
    ]),
    testResult,
    h('p', {
      class: 'hint',
      html: 'Le jeton se crée dans Home Assistant : <strong>Profil → Sécurité → Jetons d’accès '
        + 'longue durée</strong>. Il reste stocké uniquement dans ce navigateur.'
    })
  ]);

  // --- Onglet Sauvegarde -------------------------------------------------
  const planResult = h('p', { class: 'hint' });
  const planText = h('textarea', { class: 'field field--code', spellcheck: 'false', rows: 10 });
  planText.value = JSON.stringify(currentConfig, null, 2);

  const backupTab = h('div', { class: 'tab-panel' }, [
    h('p', {
      class: 'hint',
      text: 'Le plan se dessine dans l’éditeur. Cette zone sert uniquement à le sauvegarder '
        + 'ailleurs, ou à récupérer un plan copié depuis un autre appareil.'
    }),
    h('div', { class: 'btn-row' }, [
      h('button', {
        class: 'btn btn--ghost', type: 'button', html: `${icon('copy')}<span>Copier le plan</span>`,
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(planText.value);
            planResult.className = 'hint hint--ok';
            planResult.textContent = 'Plan copié dans le presse-papiers.';
          } catch {
            planText.select();
            planResult.className = 'hint';
            planResult.textContent = 'Copie automatique refusée : le texte est sélectionné, faites Ctrl+C.';
          }
        }
      }),
      h('button', {
        class: 'btn btn--ghost', type: 'button', html: `${icon('check')}<span>Restaurer ce plan</span>`,
        onclick: () => {
          try {
            const parsed = JSON.parse(planText.value);
            validateConfig(parsed);
            saveSettings({ configOverride: parsed });
            planResult.className = 'hint hint--ok';
            planResult.textContent = 'Plan restauré.';
            onApply?.({ reloadConfig: true });
          } catch (err) {
            planResult.className = 'hint hint--error';
            planResult.textContent = `Plan invalide : ${err.message}`;
          }
        }
      })
    ]),
    planText,
    h('div', { class: 'btn-row' }, [
      h('button', {
        class: 'btn btn--ghost', type: 'button', html: `${icon('refresh')}<span>Revenir au plan de démonstration</span>`,
        onclick: () => {
          saveSettings({ configOverride: null });
          planText.value = defaultConfigText;
          planResult.className = 'hint hint--ok';
          planResult.textContent = 'Plan de démonstration restauré.';
          onApply?.({ reloadConfig: true });
        }
      })
    ]),
    planResult
  ]);

  // --- Assemblage --------------------------------------------------------
  const tabs = [['Connexion', connectionTab], ['Sauvegarde', backupTab]];
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

  connectionTab.addEventListener('change', () => {
    connectionTab.querySelectorAll('.radio').forEach((r) => {
      r.classList.toggle('is-active', r.querySelector('input').checked);
    });
  });

  root.replaceChildren(h('div', {
    class: 'modal-backdrop', onclick: (ev) => { if (ev.target === ev.currentTarget) close(); }
  }, [
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
  ]));
}

export function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('objet attendu');
  if (!Array.isArray(cfg.floors) || !cfg.floors.length) throw new Error('« floors » doit être une liste non vide');
  cfg.floors.forEach((floor, i) => {
    if (!floor.id) throw new Error(`floors[${i}].id manquant`);
    if (!Array.isArray(floor.rooms)) throw new Error(`floors[${i}].rooms doit être une liste`);
    floor.rooms.forEach((room, j) => {
      if (!room.id || !room.name) throw new Error(`floors[${i}].rooms[${j}] : id et name obligatoires`);
      const rects = room.rects || (room.w ? [[room.x, room.y, room.w, room.h]] : null);
      if (!Array.isArray(rects) || !rects.length) {
        throw new Error(`floors[${i}].rooms[${j}] : géométrie manquante`);
      }
      rects.forEach((rect) => {
        if (!Array.isArray(rect) || rect.length !== 4 || rect.some((v) => !Number.isFinite(Number(v)))) {
          throw new Error(`floors[${i}].rooms[${j}] : rectangle invalide`);
        }
      });
    });
  });
  return true;
}
