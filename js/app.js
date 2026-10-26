// Dashboard UI: pages made of modules the user can add, move, resize and configure.
(function () {
  const IC = HD.IC;
  const M = HD.Model;
  const T = HD.Modules.types;
  const L = HD.Layout;
  const { esc, icon, plural, avg } = HD.UI;
  const ACCENTS = ['#FF9F0A', '#0A84FF', '#30D158', '#BF5AF2', '#FF375F', '#64D2FF'];
  const TABS = [
    { id: 'home', label: 'Accueil', icon: IC.home },
    { id: 'rooms', label: 'Pièces', icon: IC.grid },
    { id: 'auto', label: 'Automatisations', icon: IC.spark },
    { id: 'energy', label: 'Énergie', icon: IC.bolt },
    { id: 'settings', label: 'Réglages', icon: IC.gear }
  ];
  const PAGE_TITLES = { home: null, auto: 'Automatisations', energy: 'Énergie' };

  // ---------- persistence ----------
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  let tab = store.get('hd.tab', 'rooms');
  if (!TABS.some((t) => t.id === tab)) tab = 'rooms';
  const app = {
    conn: null, index: null, states: new Map(), config: {},
    status: 'idle', error: null, toast: null,
    tab, room: store.get('hd.room', null),
    editing: false, modal: null, dragId: null,
    pendingTemp: {}, dragging: false, renderQueued: false
  };
  const $app = document.getElementById('app');

  function showToast(msg) {
    app.toast = msg;
    render();
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => { app.toast = null; render(); }, 4000);
  }

  function call(domain, service, ids, data) {
    if (!app.conn) return;
    app.conn.callService(domain, service, ids, data).catch((e) => showToast('Échec : ' + e.message));
  }

  // ---------- connection ----------
  async function loadAll() {
    try {
      const data = await app.conn.fetchAll();
      app.config = data.config || {};
      app.states = new Map(data.states.map((s) => [s.entity_id, s]));
      app.index = M.buildIndex(data);
      await L.pullRemote();
      app.status = 'connected';
      app.error = null;
    } catch (e) {
      app.error = e.message;
    }
    render();
  }

  function startConnection(conn, demo) {
    if (app.conn) app.conn.close();
    app.conn = conn;
    app.status = 'connecting';
    app.error = null;
    L.init(conn, demo);
    conn.on('status', (s) => { if (app.conn === conn) { app.status = s === 'connected' && !app.index ? 'connecting' : s; queueRender(); } });
    conn.on('ready', () => { if (app.conn === conn) loadAll(); });
    conn.on('state', (ev) => {
      if (app.conn !== conn || !ev) return;
      if (ev.new_state) app.states.set(ev.entity_id, ev.new_state);
      else app.states.delete(ev.entity_id);
      if (app.index && ev.new_state) M.addEntity(app.index, ev.entity_id);
      queueRender();
    });
    render();
    return conn.connect().catch((e) => {
      if (app.conn !== conn) return;
      app.status = 'error';
      app.error = e.message;
      app.conn = null;
      conn.close(); // stop background reconnect attempts
      if (conn.authFailed && conn.authKind === 'oauth') HD.Auth.forget(); // dead session: log in again
      render();
    });
  }

  // Connect with a Home Assistant session (sidebar, this device's session, or HA's own login).
  function connectWithHA(allowAuto) {
    app.status = 'connecting';
    app.error = null;
    render();
    return HD.Auth.init(allowAuto).then((p) => {
      if (p) {
        store.del('hd.noauto');
        startConnection(new HD.HAConnection(p.hassUrl, p), false);
        return true;
      }
      app.status = 'idle';
      render();
      return false;
    }, (e) => {
      app.status = 'error';
      app.error = e.message;
      render();
      return false;
    });
  }

  function connectSaved() {
    const saved = store.get('hd.conn', null);
    if (saved && saved.demo) startConnection(new HD.DemoConnection(), true);
    else if (saved && saved.url && saved.token) startConnection(new HD.HAConnection(saved.url, saved.token), false);
    else if (HD.Auth.servedByHA()) connectWithHA(!store.get('hd.noauto', false));
    else render();
  }

  function logout() {
    const conn = app.conn;
    if (conn) { if (conn.revoke) conn.revoke(); conn.close(); }
    Object.assign(app, { conn: null, index: null, states: new Map(), status: 'idle', editing: false, modal: null });
    store.del('hd.conn');
    // Don't silently reuse the HA session right after an explicit logout.
    if (HD.Auth.servedByHA()) store.set('hd.noauto', true);
    render();
  }

  const AUTH_LABEL = {
    parent: "Session de l'interface Home Assistant",
    oauth: 'Compte Home Assistant (session de cet appareil)',
    hass: 'Session Home Assistant de ce navigateur',
    token: "Jeton d'accès longue durée"
  };

  const isDemo = () => app.conn && app.conn.baseUrl === 'demo';

  // ---------- rooms ----------
  const relevant = (st) => Object.values(T).some((t) => t.pick && t.pick(st));

  function orderedRooms() {
    if (!app.index) return [];
    const order = L.data.rooms.order;
    const pos = (id) => { const i = order.indexOf(id); return i < 0 ? 1000 + app.index.rooms.findIndex((r) => r.id === id) : i; };
    return app.index.rooms
      .filter((r) => r.ids.some((id) => { const s = app.states.get(id); return s && relevant(s); }))
      .sort((a, b) => pos(a.id) - pos(b.id));
  }
  const visibleRooms = () => orderedRooms().filter((r) => !L.data.rooms.hidden[r.id]);

  function roomOrder(items, keyFn) {
    const ids = orderedRooms().map((r) => r.id);
    const pos = (id) => { const i = ids.indexOf(id); return i < 0 ? 999 : i; };
    return items.slice().sort((a, b) => pos(keyFn(a)) - pos(keyFn(b)));
  }

  function sortByRoom(list) {
    const ids = orderedRooms().map((r) => r.id);
    const pos = (st) => { const r = M.roomOf(app.index, st.entity_id); const i = ids.indexOf(r.id); return i < 0 ? 999 : i; };
    return list.slice().sort((a, b) => pos(a) - pos(b) || M.shortName(a).localeCompare(M.shortName(b), 'fr'));
  }

  function roomTemp(room) {
    const temps = room.ids.map((id) => app.states.get(id)).filter((s) => s && M.isTemp(s) && M.isAvail(s)).map((s) => Number(s.state));
    if (temps.length) return avg(temps);
    const c = room.ids.map((id) => app.states.get(id)).find((s) => s && M.domainOf(s.entity_id) === 'climate' && s.attributes.current_temperature != null);
    return c ? Number(c.attributes.current_temperature) : null;
  }

  function roomSummaries() {
    return visibleRooms().map((room) => {
      const grid = room.ids.map((id) => app.states.get(id)).filter((s) => s && M.isGridEntity(s)).map((s) => M.describe(s));
      const active = grid.filter((g) => g.on && g.action);
      return { room, total: grid.length, active: active.length, activeIcons: active.map((g) => g.icon), temp: roomTemp(room) };
    });
  }

  function currentRoom() {
    const rooms = visibleRooms();
    let r = rooms.find((x) => x.id === app.room);
    if (!r) { r = rooms[0] || null; app.room = r ? r.id : null; }
    return r;
  }

  function env(room) {
    return { states: app.states, index: app.index, room: room || null, sortByRoom };
  }

  function pageKey() {
    if (app.tab === 'rooms') { const r = currentRoom(); return r ? 'room:' + r.id : null; }
    return app.tab;
  }

  function pageRoom() { return app.tab === 'rooms' ? currentRoom() : null; }

  function outdoorTemp() {
    const src = L.data.outdoor || 'auto';
    if (src === 'none' || !app.index) return null;
    const read = (st) => {
      if (!st || !M.isAvail(st)) return null;
      if (M.domainOf(st.entity_id) === 'weather') return st.attributes.temperature != null ? Number(st.attributes.temperature) : null;
      return Number(st.state);
    };
    if (src !== 'auto') return read(app.states.get(src));
    const all = [...app.index.visible].map((id) => app.states.get(id)).filter(Boolean);
    const outside = all.find((s) => M.isTemp(s) && /exterieur|outdoor|outside|dehors|jardin/.test(M.normalize(s.entity_id + ' ' + s.attributes.friendly_name)));
    if (outside) return read(outside);
    const w = all.find((s) => M.domainOf(s.entity_id) === 'weather');
    return w ? read(w) : null;
  }

  // ---------- render ----------
  function queueRender() {
    if (app.renderQueued) return;
    app.renderQueued = true;
    // setTimeout rather than requestAnimationFrame: rAF is paused in background tabs.
    setTimeout(() => { app.renderQueued = false; render(); }, 16);
  }

  function render() {
    if (app.dragging) { app.renderAfterDrag = true; return; }
    document.documentElement.style.setProperty('--accent', L.data.accent);
    M.setNames(L.data.names);
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.key : null;
    const caret = active && active.tagName === 'INPUT' && active.type === 'text' ? active.selectionStart : null;
    const scrollers = {};
    $app.querySelectorAll('[data-scroll]').forEach((el) => { scrollers[el.dataset.scroll] = el.scrollTop; });

    if (!app.index) $app.innerHTML = loginView();
    else $app.innerHTML = shell(app.tab === 'settings' ? pageSettings() : pageModules()) + (app.modal ? modalView() : '');

    $app.querySelectorAll('[data-scroll]').forEach((el) => { if (scrollers[el.dataset.scroll]) el.scrollTop = scrollers[el.dataset.scroll]; });
    if (focusKey) {
      const el = $app.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret);
      }
    }
    if (app.modal && app.modal.search) filterPicker(app.modal.search);
  }

  function loginView() {
    const saved = store.get('hd.conn', {}) || {};
    const defUrl = saved.url || (location.protocol.startsWith('http') && !/^(localhost|127\.)/.test(location.hostname) ? location.origin : 'http://homeassistant.local:8123');
    const busy = app.status === 'connecting';
    const viaHA = HD.Auth.servedByHA();
    const head = `
  <div class="login-head">
    <span class="login-badge">${icon(IC.home, 26)}</span>
    <h1>Connexion à Home Assistant</h1>
    <p class="muted">Le tableau de bord se construit à partir des pièces et appareils trouvés sur votre serveur.</p>
  </div>`;
    if (viaHA && busy && !saved.token) {
      return `<main class="glass login">${head}<p class="muted" role="status">Connexion avec votre compte Home Assistant…</p></main>`;
    }
    // Served by Home Assistant: use its accounts; the token form becomes an advanced option.
    const haLogin = viaHA ? `
  <div class="login-form">
    <button class="btn-solid lg" type="button" data-act="ha-login" data-key="ha-login">${icon(IC.home, 18, 2)} Se connecter avec Home Assistant</button>
    <p class="hint">Avec votre compte Home Assistant habituel. Une seule fois par appareil : la session se renouvelle ensuite toute seule. Depuis la barre latérale de Home Assistant, aucune connexion n'est demandée.</p>
    ${app.error ? `<p class="error" role="alert">${esc(app.error)}</p>` : ''}
    <button class="btn-glass" type="button" data-act="demo">Essayer la démo</button>
  </div>` : '';
    return `
<main class="glass login">${head}${haLogin}
  ${viaHA ? '<details class="advanced"><summary>Utiliser un jeton d\'accès (avancé)</summary>' : ''}
  <form id="login-form" class="login-form">
    <label class="field"><span>Adresse du serveur</span>
      <input name="url" type="url" required value="${esc(defUrl)}" placeholder="http://homeassistant.local:8123" autocomplete="url"></label>
    <label class="field"><span>Jeton d'accès longue durée</span>
      <input name="token" type="password" required value="${esc(saved.token || '')}" placeholder="eyJhbGciOi…" autocomplete="off"></label>
    <p class="hint">Dans Home Assistant : votre profil › Sécurité › Jetons d'accès longue durée › Créer un jeton. Le jeton reste dans ce navigateur.</p>
    ${app.error && !viaHA ? `<p class="error" role="alert">${esc(app.error)}</p>` : ''}
    <div class="login-actions">
      <button class="${viaHA ? 'btn-glass' : 'btn-solid'}" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Connexion…' : 'Se connecter avec le jeton'}</button>
      ${viaHA ? '' : '<button class="btn-glass" type="button" data-act="demo">Essayer la démo</button>'}
    </div>
  </form>
  ${viaHA ? '</details>' : ''}
</main>`;
  }

  function shell(content) {
    const status = app.status === 'reconnecting' ? '<div class="banner" role="status">Connexion perdue, reconnexion…</div>' : '';
    return `
<nav class="glass rail" aria-label="Navigation principale">
  ${TABS.map((t) => `<button class="rail-btn${t.id === app.tab ? ' is-on' : ''}" aria-label="${t.label}" title="${t.label}" ${t.id === app.tab ? 'aria-current="page"' : ''} data-act="tab" data-arg="${t.id}" data-key="tab:${t.id}">${icon(t.icon, 22)}</button>`).join('')}
</nav>
<main class="glass panel${app.editing ? ' is-editing' : ''}">${status}${content}</main>
<div class="grabber" aria-hidden="true"><span class="dot"></span><span class="bar"></span></div>
${app.toast ? `<div class="toast" role="alert">${esc(app.toast)}</div>` : ''}`;
  }

  // ---------- fullscreen (Android tablets: no app to install) ----------
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const fsSupported = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  function enterFs() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* refused: needs a tap */ }
  }
  function exitFs() {
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (ex) { const p = ex.call(document); if (p && p.catch) p.catch(() => {}); }
  }
  ['fullscreenchange', 'webkitfullscreenchange'].forEach((ev) => document.addEventListener(ev, () => queueRender()));
  // "Plein écran automatique": any tap re-enters fullscreen (browsers only allow it after a tap).
  document.addEventListener('pointerup', () => {
    if (store.get('hd.autofs', false) && fsSupported() && !fsEl()) enterFs();
  }, true);

  function header(title, summary, editable) {
    const t = outdoorTemp();
    const fs = fsSupported() && !app.editing
      ? `<button class="card hov round-btn" data-act="fullscreen" data-key="fullscreen" aria-label="${fsEl() ? 'Quitter le plein écran' : 'Plein écran'}" title="${fsEl() ? 'Quitter le plein écran' : 'Plein écran'}">${icon(fsEl() ? IC.shrink : IC.expand, 19, 2)}</button>` : '';
    return `
<header class="page-head">
  <div class="titles"><h1>${esc(title)}</h1><p class="muted">${esc(summary)}</p></div>
  <div class="head-actions">
    ${t != null && !app.editing ? `<div class="card chip">${icon(IC.cloud)}<span>Extérieur ${esc(M.fmtNum(t, 0))}°</span></div>` : ''}
    ${fs}
    ${editable && app.editing ? `<button class="btn-glass" data-act="add-open" data-key="add-open">${icon(IC.plus, 18, 2)} Module</button>` : ''}
    ${editable ? `<button class="${app.editing ? 'btn-solid' : 'card hov round-btn'}" data-act="edit-toggle" data-key="edit-toggle" aria-label="${app.editing ? 'Terminer la personnalisation' : 'Personnaliser cette page'}" title="Personnaliser">${app.editing ? icon(IC.check, 18, 2.2) + ' Terminé' : icon(IC.pencil, 19)}</button>` : ''}
  </div>
</header>`;
  }

  // ----- module pages -----
  function pageSummary(key, room, mods) {
    if (room) {
      const grid = room.ids.map((id) => app.states.get(id)).filter((s) => s && M.isGridEntity(s)).map((s) => M.describe(s));
      const active = grid.filter((g) => g.on && g.action).length;
      const clim = room.ids.map((id) => app.states.get(id)).find((s) => s && M.domainOf(s.entity_id) === 'climate' && M.isAvail(s));
      const target = clim ? targetTemp(clim) : null;
      const t = roomTemp(room);
      return plural(active, 'appareil actif', 'appareils actifs') +
        (t != null ? ' · ' + M.fmtNum(t) + '°' : '') +
        (target != null ? ' · consigne ' + M.fmtNum(target) + '°' : '');
    }
    if (key === 'home') {
      const sums = roomSummaries();
      return plural(sums.reduce((s, v) => s + v.active, 0), 'appareil actif', 'appareils actifs') + ' · ' + plural(sums.length, 'pièce', 'pièces');
    }
    return plural(mods.length, 'module', 'modules');
  }

  function pageModules() {
    const room = pageRoom();
    const key = pageKey();
    if (app.tab === 'rooms' && !room) {
      return header('Pièces', 'Aucune pièce') + emptyState('Aucun appareil trouvé dans vos pièces.', 'Assignez vos appareils à des zones dans Home Assistant, ou réaffichez des pièces dans Réglages.');
    }
    if (room) store.set('hd.room', room.id);
    const e = env(room);
    const mods = L.modules(key, e);
    const title = room ? room.name : PAGE_TITLES[key] || app.config.location_name || 'Maison';
    const tabs = room ? `
<div class="room-tabs" role="tablist" aria-label="Pièces">
  ${visibleRooms().map((r) => `<button role="tab" class="pill${r.id === room.id ? ' is-on' : ''}" aria-selected="${r.id === room.id}" data-act="room" data-arg="${esc(r.id)}" data-key="room:${esc(r.id)}">${esc(r.name)}</button>`).join('')}
</div>` : '';
    const ctx = {
      states: app.states, index: app.index, global: !room, roomName: room ? room.name : null,
      targetTemp, roomSummaries, roomOrder
    };
    const body = mods.map((m) => moduleView(m, ctx, e)).join('') +
      (app.editing ? `<button class="mod add-tile" style="grid-column: span 1; grid-row: span 2" data-act="add-open" data-key="add-tile">${icon(IC.plus, 26, 2)}<span>Ajouter un module</span></button>` : '');
    const hint = app.editing ? `<p class="edit-hint muted small">Glissez les modules pour les réordonner · ${icon(IC.width, 14)} largeur · ${icon(IC.height, 14)} hauteur · ${icon(IC.gear, 14)} appareils et titre${L.isCustom(key) ? ' · <button class="link-btn" data-act="page-reset">Revenir à la disposition automatique</button>' : ''}</p>` : '';
    return header(title, pageSummary(key, room, mods), true) + tabs + hint +
      (mods.length || app.editing
        ? `<div class="mods" data-scroll="page:${esc(key)}">${body}</div>`
        : emptyState('Cette page est vide.', 'Touchez le crayon pour ajouter des modules.'));
  }

  function moduleView(m, ctx, e) {
    const t = T[m.type];
    const list = L.resolve(m, e);
    let inner;
    if (!t.noEntities && !list.length) {
      inner = HD.UI.head(m.title || t.name) + `<div class="mod-empty"><p class="muted small">${t.manual ? 'Aucun capteur choisi.' : 'Aucun appareil compatible ici.'}</p>
        <button class="btn-glass sm" data-act="mod-config" data-key="${m.id}:cfg-empty">Choisir des appareils</button></div>`;
    } else {
      // A module set to "Toute la maison" on a room page behaves like a house-wide one.
      inner = t.render(m, list, m.scope === 'all' && !ctx.global ? { ...ctx, global: true } : ctx);
    }
    const bare = t.bare && !m.title && list.length;
    const tools = app.editing ? `
      <div class="mod-tools">
        <span class="mod-size" aria-hidden="true">${icon(IC.drag, 16, 2.4)} ${m.w}×${m.h}</span>
        <span class="mod-tools-btns">
          <button aria-label="Déplacer avant" data-act="mod-move" data-arg="-1" data-key="${m.id}:mv-">${icon(IC.left, 16, 2.2)}</button>
          <button aria-label="Déplacer après" data-act="mod-move" data-arg="1" data-key="${m.id}:mv+">${icon(IC.right, 16, 2.2)}</button>
          <button aria-label="Changer la largeur (${m.w} sur 4)" data-act="mod-w" data-key="${m.id}:w">${icon(IC.width, 16, 2)}</button>
          <button aria-label="Changer la hauteur (${m.h} sur 4)" data-act="mod-h" data-key="${m.id}:h">${icon(IC.height, 16, 2)}</button>
          <button aria-label="Paramétrer le module" data-act="mod-config" data-key="${m.id}:cfg">${icon(IC.gear, 16, 2)}</button>
          <button aria-label="Supprimer le module" data-act="mod-del" data-key="${m.id}:del">${icon(IC.trash, 16, 2)}</button>
        </span>
      </div>` : '';
    return `<section class="mod ${bare ? 'bare' : 'card'} t-${m.type} w${m.w} h${m.h}${app.dragId === m.id ? ' is-dragging' : ''}" data-mod="${esc(m.id)}" aria-label="${esc(m.title || t.name)}"
      style="grid-column: span ${m.w}; grid-row: span ${m.h}; --h: ${m.h}${/^#[0-9a-f]{6}$/i.test(m.options.accent || '') ? '; --accent: ' + m.options.accent : ''}" ${app.editing ? 'draggable="true"' : ''}>
      <div class="mod-body"${app.editing ? ' inert' : ''}>${inner}</div>${tools}</section>`;
  }

  function emptyState(title, hint) {
    return `<div class="empty card"><p>${esc(title)}</p>${hint ? `<p class="muted small">${esc(hint)}</p>` : ''}</div>`;
  }

  function targetTemp(st) {
    const p = app.pendingTemp[st.entity_id];
    if (p) return p.value;
    const t = st.attributes.temperature;
    return t == null ? null : Number(t);
  }

  // ----- modals -----
  function modalView() {
    const md = app.modal;
    let title, body, foot;
    if (md.kind === 'add') {
      const e = env(pageRoom());
      const scope = pageRoom() ? 'room' : 'all';
      title = 'Ajouter un module';
      body = `<div class="type-grid">${Object.entries(T).map(([type, t]) => {
        const n = t.noEntities ? null : t.manual ? null : L.resolve({ type, scope, entities: null }, e).length;
        const found = t.manual ? 'À choisir' : n == null ? '' : n ? plural(n, 'trouvé', 'trouvés') + (scope === 'room' ? ' ici' : '') : 'Rien trouvé' + (scope === 'room' ? ' ici' : '');
        return `<button class="type-card hov" data-act="add-type" data-arg="${type}" data-key="add:${type}">
          <span class="scene-ic">${icon(t.icon, 18, 1.9)}</span>
          <span class="stack"><span class="type-name">${t.name}</span><span class="muted small">${esc(t.desc)}</span>${found ? `<span class="type-found${n === 0 ? ' is-none' : ''}">${found}</span>` : ''}</span>
        </button>`;
      }).join('')}</div>`;
      foot = `<button class="btn-glass" data-act="modal-close" data-key="modal-close">Annuler</button>`;
    } else {
      const d = md.draft;
      const t = T[d.type];
      const room = pageRoom();
      const seg = (act, value, opts) => `<div class="segmented inline" role="group">${opts.map(([v, label]) =>
        `<button type="button" class="${value === v ? 'is-on' : ''}" aria-pressed="${value === v}" data-act="${act}" data-arg="${v}" data-key="${act}:${v}">${label}</button>`).join('')}</div>`;
      title = t.name;
      const auto = !Array.isArray(d.entities);
      let picker = '';
      if (!t.noEntities) {
        // One row per entity: checkbox (manual mode), editable label, room, live value.
        const row = (s, withCheck, checked) => {
          const r = M.roomOf(app.index, s.entity_id).name;
          const val = M.describe(s).status;
          const custom = md.names[s.entity_id] || '';
          const hay = M.normalize([custom, M.baseName(s), r, s.entity_id].join(' '));
          return `<li data-search="${esc(hay)}"><div class="pick-row${checked ? ' is-on' : ''}">
            ${withCheck ? `<input type="checkbox" value="${esc(s.entity_id)}" ${checked ? 'checked' : ''} data-act="pick" data-key="pick:${esc(s.entity_id)}" ${t.single ? 'data-single="1"' : ''} aria-label="Afficher ${esc(custom || M.baseName(s))}">` : ''}
            <span class="stack grow">
              <input class="rename" type="text" value="${esc(custom)}" placeholder="${esc(M.baseName(s))}" maxlength="80" data-act="rename" data-arg="${esc(s.entity_id)}" data-key="rn:${esc(s.entity_id)}" aria-label="Libellé de ${esc(M.baseName(s))}">
              <span class="muted small">${esc(r)} · ${esc(s.entity_id)}</span>
            </span>
            <span class="muted small pick-val">${esc(val)}</span>
          </div></li>`;
        };
        const search = `<label class="search">${icon(IC.search, 16, 2)}<input type="text" placeholder="Rechercher (nom, pièce, entité)…" value="${esc(md.search || '')}" data-act="picker-search" data-key="picker-search" aria-label="Rechercher un appareil"></label>`;
        const renameHint = '<p class="muted small">Touchez un nom pour le renommer. Les libellés s\'appliquent dans tous les modules ; laissez vide pour le nom Home Assistant.</p>';
        picker = `
        <div class="field-row">
          <span class="field-label">Appareils</span>
          ${t.manual ? '' : `<label class="check-line"><span>Automatique : tous les appareils compatibles ${d.scope === 'room' && room ? 'de la pièce' : 'de la maison'}</span>
            <button type="button" class="switch${auto ? ' is-on' : ''}" role="switch" aria-checked="${auto}" data-act="draft-auto" data-key="draft-auto"><span></span></button></label>`}
        </div>`;
        if (auto) {
          const shown = L.resolve(d, env(room));
          picker += `<p class="muted small">${plural(shown.length, 'appareil affiché', 'appareils affichés')} ; les nouveaux appareils apparaîtront tout seuls.</p>
          ${renameHint}${shown.length > 6 ? search : ''}
          <ul class="picker" data-scroll="picker">${shown.map((s) => row(s, false, true)).join('')}</ul>`;
        } else {
          const cands = sortByRoom([...app.index.visible].map((id) => app.states.get(id)).filter((s) => s && t.pick(s)));
          const chosen = new Set(d.entities || []);
          picker += `${renameHint}${search}
          <ul class="picker" data-scroll="picker">
            ${cands.length ? cands.map((s) => row(s, true, chosen.has(s.entity_id))).join('') : '<li class="muted small">Aucune entité compatible trouvée sur Home Assistant.</li>'}
          </ul>
          <p class="muted small">${plural(chosen.size, 'sélectionné', 'sélectionnés')}${t.single ? ' (un seul affiché)' : ''}</p>`;
        }
      }
      // Accent color of this module (empty = the page's color).
      const accent = d.options.accent || '';
      const colors = `<div class="field-row"><span class="field-label">Couleur</span>
        <div class="row wrap swatches">
          <button type="button" class="tone tone-default${!accent ? ' is-on' : ''}" aria-pressed="${!accent}" aria-label="Couleur par défaut" title="Par défaut" data-act="draft-accent" data-arg="" data-key="da:"><span style="background: ${L.data.accent}"></span></button>
          ${HD.Modules.ACCENTS.map((c) => `<button type="button" class="tone${accent === c ? ' is-on' : ''}" aria-pressed="${accent === c}" aria-label="Couleur ${c}" data-act="draft-accent" data-arg="${c}" data-key="da:${c}"><span style="background: ${c}"></span></button>`).join('')}
        </div></div>`;
      // Thermometers: color by temperature with editable thresholds.
      let tempColors = '';
      if (d.type === 'temperature') {
        const th = HD.Modules.tempThresholds(d.options);
        const Z = HD.Modules.ZONES;
        const num = (k, v) => `<input class="num" type="number" step="0.5" value="${v}" data-act="draft-opt" data-arg="${k}" data-key="opt:${k}" aria-label="Seuil ${k}">`;
        tempColors = `
        <div class="field-row"><span class="field-label">Couleur selon la température</span>
          <button type="button" class="switch${d.options.tempColors ? ' is-on' : ''}" role="switch" aria-checked="${!!d.options.tempColors}" data-act="draft-tempcolors" data-key="draft-tempcolors"><span></span></button></div>
        ${d.options.tempColors ? `<div class="zones">
          <span class="zone"><i style="background: ${Z[0].color}"></i>${Z[0].name} &lt; ${num('tLo', th.lo)}°</span>
          <span class="zone"><i style="background: ${Z[1].color}"></i>${Z[1].name} jusqu'à ${num('tHi', th.hi)}°</span>
          <span class="zone"><i style="background: ${Z[2].color}"></i>${Z[2].name} jusqu'à ${num('tHot', th.hot)}°</span>
          <span class="zone"><i style="background: ${Z[3].color}"></i>${Z[3].name} au-delà</span>
        </div>` : ''}`;
      }
      body = `
        <label class="field"><span>Titre</span><input type="text" value="${esc(d.title)}" placeholder="${esc(t.name)}" data-act="draft-title" data-key="draft-title"></label>
        ${room && !t.noEntities ? `<div class="field-row"><span class="field-label">Portée</span>${seg('draft-scope', d.scope, [['room', 'Cette pièce'], ['all', 'Toute la maison']])}</div>` : ''}
        <div class="field-row"><span class="field-label">Largeur</span>${seg('draft-w', String(d.w), [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']])}</div>
        <div class="field-row"><span class="field-label">Hauteur</span>${seg('draft-h', String(d.h), [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']])}</div>
        ${t.options ? `<div class="field-row"><span class="field-label">Affichage</span>${seg('draft-group', d.options.group || (d.scope === 'all' ? 'room' : 'sensor'), [['sensor', 'Par capteur'], ['room', 'Moyenne par pièce']])}</div>` : ''}
        ${colors}
        ${tempColors}
        ${picker}`;
      foot = `<button class="btn-glass danger" data-act="mod-del" data-arg="${esc(d.id)}" data-key="modal-del">${icon(IC.trash, 16, 2)} Supprimer</button>
        <span class="grow"></span>
        <button class="btn-glass" data-act="modal-close" data-key="modal-close">Annuler</button>
        <button class="btn-solid" data-act="modal-save" data-key="modal-save">Enregistrer</button>`;
    }
    return `<div class="modal-backdrop" data-act="modal-close">
      <div class="glass modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" data-stop>
        <header class="modal-head"><h2>${esc(title)}</h2><button class="card hov round-btn" aria-label="Fermer" data-act="modal-close" data-key="modal-x">${icon(IC.x, 18, 2)}</button></header>
        <div class="modal-body" data-scroll="modal">${body}</div>
        <footer class="modal-foot">${foot}</footer>
      </div></div>`;
  }

  function filterPicker(q) {
    const n = M.normalize(q.trim());
    $app.querySelectorAll('.picker li[data-search]').forEach((li) => { li.hidden = !!n && !li.dataset.search.includes(n); });
  }

  // ----- Réglages -----
  function pageSettings() {
    const all = [...app.index.visible].map((id) => app.states.get(id)).filter(Boolean);
    const count = (fn) => all.filter(fn).length;
    const found = [
      ['Thermomètres', count(M.isTemp)], ['Capteurs d\'humidité', count(M.isHumidity)],
      ['Thermostats', count((s) => M.domainOf(s.entity_id) === 'climate')],
      ['Lampes', count((s) => M.domainOf(s.entity_id) === 'light')],
      ['Autres appareils', count((s) => M.isGridEntity(s) && !['light', 'climate'].includes(M.domainOf(s.entity_id)))],
      ['Scènes', count((s) => M.domainOf(s.entity_id) === 'scene')],
      ['Automatisations & scripts', count((s) => ['automation', 'script'].includes(M.domainOf(s.entity_id)))],
      ['Capteurs d\'énergie', count((s) => M.isSensorClass(s, 'power') || M.isSensorClass(s, 'energy'))]
    ].filter(([, n]) => n > 0);
    const rooms = orderedRooms();
    const outdoorOpts = all.filter((s) => M.isTemp(s) || M.domainOf(s.entity_id) === 'weather');
    const src = L.data.outdoor || 'auto';
    const sync = isDemo() ? 'Démo : enregistrée dans ce navigateur'
      : { synced: 'Synchronisée avec votre compte Home Assistant', saving: 'Enregistrement…', error: 'Échec de la synchro, gardée dans ce navigateur', local: 'Enregistrée dans ce navigateur' }[L.syncState];

    return header('Réglages', isDemo() ? 'Mode démo' : `Connecté à ${app.conn ? app.conn.baseUrl : ''}`, false) + `
<div class="scroll settings" data-scroll="settings">
  <section class="list-section">
    <h2>Pièces</h2>
    <p class="muted small">Ordre et visibilité des onglets. Chaque pièce a sa propre disposition de modules.</p>
    <ul class="room-admin">
    ${rooms.map((r, i) => {
      const hidden = !!L.data.rooms.hidden[r.id];
      return `<li class="card list-item${hidden ? ' is-dim' : ''}">
        <span class="stack grow"><span>${esc(r.name)}</span><span class="muted small">${L.isCustom('room:' + r.id) ? 'Disposition personnalisée' : 'Disposition automatique'}${hidden ? ' · masquée' : ''}</span></span>
        <button class="icon-btn" aria-label="Monter ${esc(r.name)}" data-act="room-move" data-arg="${esc(r.id)}|-1" data-key="rm-${esc(r.id)}-" ${i === 0 ? 'disabled' : ''}>${icon(IC.up, 18, 2)}</button>
        <button class="icon-btn" aria-label="Descendre ${esc(r.name)}" data-act="room-move" data-arg="${esc(r.id)}|1" data-key="rm-${esc(r.id)}+" ${i === rooms.length - 1 ? 'disabled' : ''}>${icon(IC.down, 18, 2)}</button>
        <button class="icon-btn" aria-label="${hidden ? 'Afficher' : 'Masquer'} ${esc(r.name)}" aria-pressed="${hidden}" data-act="room-hide" data-arg="${esc(r.id)}" data-key="rh-${esc(r.id)}">${icon(hidden ? IC.eyeOff : IC.eye, 18, 1.9)}</button>
        ${L.isCustom('room:' + r.id) ? `<button class="btn-glass sm" data-act="page-reset" data-arg="room:${esc(r.id)}" data-key="rr-${esc(r.id)}">Réinitialiser</button>` : ''}
      </li>`;
    }).join('')}
    </ul>
  </section>

  <section class="list-section">
    <h2>Température extérieure (en-tête)</h2>
    <label class="select-wrap"><span class="sr-only">Source de la température extérieure</span>
      <select data-act="outdoor" data-key="outdoor">
        <option value="auto" ${src === 'auto' ? 'selected' : ''}>Automatique (capteur « extérieur », sinon météo)</option>
        <option value="none" ${src === 'none' ? 'selected' : ''}>Ne pas afficher</option>
        ${sortByRoom(outdoorOpts).map((s) => `<option value="${esc(s.entity_id)}" ${src === s.entity_id ? 'selected' : ''}>${esc(M.shortName(s))} — ${esc(M.roomOf(app.index, s.entity_id).name)}</option>`).join('')}
      </select>
    </label>
  </section>

  <section class="list-section">
    <h2>Disposition</h2>
    <p class="muted small">${esc(sync)}. Touchez le crayon sur une page pour ajouter, déplacer, redimensionner ou paramétrer ses modules.</p>
    <div class="row wrap">
      <button class="btn-glass" data-act="export" data-key="export">${icon(IC.download, 16, 2)} Exporter</button>
      <button class="btn-glass" data-act="import" data-key="import">${icon(IC.upload, 16, 2)} Importer</button>
      <button class="btn-glass danger" data-act="reset-all" data-key="reset-all">${icon(IC.refresh, 16, 2)} Tout réinitialiser</button>
      <input type="file" accept="application/json,.json" id="import-file" hidden>
    </div>
  </section>

  <section class="list-section">
    <h2>Cet appareil</h2>
    <div class="card list-item">
      <span class="stack grow"><span>Plein écran automatique</span><span class="muted small">${fsSupported() ? 'Le premier toucher passe la page en plein écran, et y revient si on en sort. Réglage propre à cet appareil.' : 'Ce navigateur ne permet pas le plein écran.'}</span></span>
      <button class="switch${store.get('hd.autofs', false) ? ' is-on' : ''}" role="switch" aria-checked="${!!store.get('hd.autofs', false)}" aria-label="Plein écran automatique" data-act="autofs" data-key="autofs" ${fsSupported() ? '' : 'disabled'}><span></span></button>
    </div>
  </section>

  <section class="list-section">
    <h2>Couleur d'accent par défaut</h2>
    <p class="muted small">Chaque module peut avoir sa propre couleur (⚙ en mode personnalisation).</p>
    <div class="row wrap">${ACCENTS.map((c) => `<button class="tone${L.data.accent === c ? ' is-on' : ''}" aria-label="Accent ${c}" aria-pressed="${L.data.accent === c}" data-act="accent" data-arg="${c}" data-key="accent:${c}"><span style="background: ${c}"></span></button>`).join('')}</div>
  </section>

  <section class="list-section">
    <h2>Trouvé sur Home Assistant</h2>
    <div class="found-grid">${found.map(([n, v]) => `<div class="card found"><span class="big-num sm">${v}</span><span class="muted small">${n}</span></div>`).join('')}</div>
  </section>

  <section class="list-section">
    <h2>Connexion</h2>
    <div class="card list-item">
      <span class="stack grow"><span>${isDemo() ? 'Données de démonstration' : esc(app.conn ? app.conn.baseUrl : '')}</span><span class="muted small">${[app.conn && AUTH_LABEL[app.conn.authKind], app.conn && app.conn.haVersion ? 'Home Assistant ' + esc(app.conn.haVersion) : ''].filter(Boolean).join(' · ')}</span></span>
      <button class="btn-glass" data-act="reload" data-key="reload">${icon(IC.refresh, 16)} Recharger</button>
      <button class="btn-glass" data-act="logout" data-key="logout">${icon(IC.logout, 16)} ${isDemo() ? 'Quitter la démo' : 'Se déconnecter'}</button>
    </div>
  </section>
</div>`;
  }

  // ---------- module lookup & layout edits ----------
  function moduleOf(el) {
    const host = el.closest('[data-mod]');
    if (!host) return null;
    const room = pageRoom();
    const e = env(room);
    const m = L.modules(pageKey(), e).find((x) => x.id === host.dataset.mod);
    return m ? { m, list: L.resolve(m, e) } : null;
  }

  function editPage(fn) {
    const key = pageKey();
    if (!key) return;
    const mods = L.materialize(key, env(pageRoom()));
    fn(mods);
    L.save();
    render();
  }

  function moduleIndex(mods, id) { return mods.findIndex((x) => x.id === id); }

  function openConfig(id) {
    const m = L.modules(pageKey(), env(pageRoom())).find((x) => x.id === id);
    if (!m) return;
    app.modal = { kind: 'config', id, draft: JSON.parse(JSON.stringify(m)), search: '', names: { ...L.data.names } };
    render();
  }

  // ---------- device actions ----------
  function changeTemp(st, dir) {
    const a = st.attributes;
    const step = Number(a.target_temp_step) || (a.temperature_unit === '°F' ? 1 : 0.5);
    const cur = targetTemp(st);
    const next = Math.max(Number(a.min_temp != null ? a.min_temp : 7), Math.min(Number(a.max_temp != null ? a.max_temp : 35), Math.round((cur + dir * step) * 10) / 10));
    const p = app.pendingTemp[st.entity_id] || {};
    clearTimeout(p.timer);
    // Batch quick taps into one service call.
    app.pendingTemp[st.entity_id] = {
      value: next,
      timer: setTimeout(() => {
        call('climate', 'set_temperature', st.entity_id, { temperature: next });
        setTimeout(() => { delete app.pendingTemp[st.entity_id]; queueRender(); }, 1500);
      }, 600)
    };
    render();
  }

  function setTone(lights, id) {
    const t = HD.Modules.TONES.find((x) => x.id === id);
    if (!t) return;
    const targets = lights.filter((l) => (t.kelvin ? M.lightCaps(l).ct : M.lightCaps(l).color)).map((l) => l.entity_id);
    if (targets.length) call('light', 'turn_on', targets, t.kelvin ? { color_temp_kelvin: t.kelvin } : { rgb_color: t.rgb });
  }

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const actions = {
    tab(arg) { app.tab = arg; app.editing = false; store.set('hd.tab', arg); render(); },
    room(arg) { app.room = arg; render(); },
    'open-room'(arg) { app.room = arg; app.tab = 'rooms'; app.editing = false; store.set('hd.tab', 'rooms'); render(); },

    // device controls (inside modules)
    temp(arg, el) { const x = moduleOf(el); if (x && x.list[0]) changeTemp(x.list[0], Number(arg)); },
    mode(arg, el) { const x = moduleOf(el); if (x && x.list[0]) call('climate', 'set_hvac_mode', x.list[0].entity_id, { hvac_mode: arg }); },
    'lights-toggle'(arg, el) {
      const x = moduleOf(el);
      if (!x || !x.list.length) return;
      call('light', x.list.some((l) => l.state === 'on') ? 'turn_off' : 'turn_on', x.list.map((l) => l.entity_id));
    },
    tone(arg, el) { const x = moduleOf(el); if (x) setTone(x.list, arg); },
    scene(arg) { call('scene', 'turn_on', arg); },
    dev(arg) {
      const st = app.states.get(arg);
      const d = st && M.describe(st);
      if (d && d.action) call(d.action[0], d.action[1], arg);
    },
    'auto-toggle'(arg) { call('automation', 'toggle', arg); },
    script(arg) { call('script', 'turn_on', arg); },

    // layout editing
    'edit-toggle'() { app.editing = !app.editing; render(); },
    'add-open'() { app.modal = { kind: 'add' }; render(); },
    'add-type'(type) {
      const scope = pageRoom() ? 'room' : 'all';
      const m = L.newModule(type, scope);
      if (type === 'temperature' && scope === 'all') m.options.group = 'room';
      editPage((mods) => mods.push(m));
      app.editing = true;
      const t = T[type];
      const n = t.noEntities ? 1 : L.resolve(m, env(pageRoom())).length;
      app.modal = null;
      if (!n) openConfig(m.id); else render();
    },
    'mod-move'(arg, el) {
      const id = el.closest('[data-mod]').dataset.mod;
      editPage((mods) => {
        const i = moduleIndex(mods, id), j = i + Number(arg);
        if (i < 0 || j < 0 || j >= mods.length) return;
        [mods[i], mods[j]] = [mods[j], mods[i]];
      });
    },
    'mod-w'(arg, el) { const id = el.closest('[data-mod]').dataset.mod; editPage((mods) => { const m = mods[moduleIndex(mods, id)]; if (m) m.w = m.w % 4 + 1; }); },
    'mod-h'(arg, el) { const id = el.closest('[data-mod]').dataset.mod; editPage((mods) => { const m = mods[moduleIndex(mods, id)]; if (m) m.h = m.h % 4 + 1; }); },
    'mod-config'(arg, el) { openConfig(el.closest('[data-mod]').dataset.mod); },
    'mod-del'(arg, el) {
      const id = arg || el.closest('[data-mod]').dataset.mod;
      app.modal = null;
      editPage((mods) => { const i = moduleIndex(mods, id); if (i >= 0) mods.splice(i, 1); });
    },
    'page-reset'(arg) {
      L.resetPage(arg || pageKey());
      showToast('Disposition automatique rétablie.');
    },

    // config dialog
    'modal-close'() { app.modal = null; render(); },
    'draft-scope'(arg) { app.modal.draft.scope = arg; render(); },
    'draft-w'(arg) { app.modal.draft.w = Number(arg); render(); },
    'draft-h'(arg) { app.modal.draft.h = Number(arg); render(); },
    'draft-group'(arg) { app.modal.draft.options.group = arg; render(); },
    'draft-auto'() {
      const d = app.modal.draft;
      if (Array.isArray(d.entities)) d.entities = null;
      else d.entities = L.resolve({ ...d, entities: null }, env(pageRoom())).map((s) => s.entity_id);
      render();
    },
    'draft-accent'(arg) {
      if (arg) app.modal.draft.options.accent = arg;
      else delete app.modal.draft.options.accent;
      render();
    },
    'draft-tempcolors'() { const o = app.modal.draft.options; o.tempColors = !o.tempColors; render(); },
    'modal-save'() {
      const d = app.modal.draft;
      // Labels are shared by all modules: store them next to the layout.
      const names = {};
      for (const [k, v] of Object.entries(app.modal.names)) if (v && v.trim()) names[k] = v.trim();
      L.data.names = names;
      app.modal = null;
      editPage((mods) => { const i = moduleIndex(mods, d.id); if (i >= 0) mods[i] = d; });
    },

    // settings
    'room-hide'(id) {
      if (L.data.rooms.hidden[id]) delete L.data.rooms.hidden[id];
      else L.data.rooms.hidden[id] = true;
      L.save(); render();
    },
    'room-move'(arg) {
      const [id, dir] = arg.split('|');
      const ids = orderedRooms().map((r) => r.id);
      const i = ids.indexOf(id), j = i + Number(dir);
      if (i < 0 || j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      L.data.rooms.order = ids;
      L.save(); render();
    },
    accent(arg) { L.data.accent = arg; L.save(); render(); },
    export() { download('maison-disposition.json', L.exportJson()); },
    import() { const f = document.getElementById('import-file'); if (f) f.click(); },
    'reset-all'() {
      if (!confirm('Revenir à la disposition automatique sur toutes les pages ?')) return;
      L.resetAll(); showToast('Disposition réinitialisée.');
    },
    reload() { loadAll(); },
    fullscreen() { if (fsEl()) exitFs(); else enterFs(); },
    autofs() {
      const on = !store.get('hd.autofs', false);
      store.set('hd.autofs', on);
      if (on && !fsEl()) enterFs();
      render();
    },
    logout() { logout(); },
    demo() { store.set('hd.conn', { demo: true }); startConnection(new HD.DemoConnection(), true); },
    // Reuse an HA session if there is one, otherwise open HA's login page (comes back with ?code=…).
    'ha-login'() {
      store.del('hd.noauto');
      store.del('hd.conn');
      connectWithHA(true).then((ok) => { if (!ok && !app.error) HD.Auth.login(); });
    }
  };

  // ---------- events ----------
  $app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    // Clicks inside the dialog must not reach the backdrop's close action.
    if (el.classList.contains('modal-backdrop') && e.target.closest('[data-stop]')) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el.dataset.arg, el); }
  });

  $app.addEventListener('submit', (e) => {
    if (e.target.id !== 'login-form') return;
    e.preventDefault();
    const fd = new FormData(e.target);
    const url = HD.HAConnection.normalizeUrl(fd.get('url'));
    const token = String(fd.get('token') || '').trim();
    if (location.protocol === 'https:' && url.startsWith('http:')) {
      app.error = 'Cette page est en HTTPS : le navigateur bloque une connexion vers un serveur en HTTP. Utilisez l\'adresse HTTPS de Home Assistant.';
      render();
      return;
    }
    store.set('hd.conn', { url, token });
    store.del('hd.noauto');
    startConnection(new HD.HAConnection(url, token), false);
  });

  $app.addEventListener('input', (e) => {
    const act = e.target.dataset.act;
    if (act === 'bri') {
      // Brightness: move the fill live, send to Home Assistant on release.
      app.dragging = true;
      const host = e.target.closest('[data-mod]');
      const fill = host.querySelector('[data-bri-fill]');
      const num = host.querySelector('[data-bri-num]');
      if (fill) fill.style.width = e.target.value + '%';
      if (num) num.textContent = e.target.value + ' %';
    } else if (act === 'draft-title') {
      app.modal.draft.title = e.target.value;
    } else if (act === 'rename') {
      app.modal.names[e.target.dataset.arg] = e.target.value;
    } else if (act === 'draft-opt') {
      app.modal.draft.options[e.target.dataset.arg] = e.target.value === '' ? '' : Number(e.target.value);
    } else if (act === 'picker-search') {
      app.modal.search = e.target.value;
      filterPicker(e.target.value);
    }
  });

  $app.addEventListener('change', (e) => {
    const t = e.target;
    const act = t.dataset.act;
    if (act === 'bri') {
      app.dragging = false;
      const x = moduleOf(t);
      if (x && x.list.length) {
        const ids = x.list.map((l) => l.entity_id);
        const pct = Number(t.value);
        if (pct <= 0) call('light', 'turn_off', ids);
        else call('light', 'turn_on', ids, { brightness_pct: pct });
      }
      if (app.renderAfterDrag) { app.renderAfterDrag = false; queueRender(); }
    } else if (act === 'pick') {
      const d = app.modal.draft;
      let ids = Array.isArray(d.entities) ? d.entities.slice() : [];
      if (t.checked) ids = t.dataset.single ? [t.value] : ids.concat(t.value);
      else ids = ids.filter((x) => x !== t.value);
      d.entities = ids;
      render();
    } else if (act === 'outdoor') {
      L.data.outdoor = t.value; L.save(); render();
    } else if (t.id === 'import-file' && t.files[0]) {
      // FileReader rather than File.text(): works on older Android browsers.
      const reader = new FileReader();
      reader.onload = () => {
        try { L.importJson(String(reader.result)); showToast('Disposition importée.'); } catch (err) { showToast('Import impossible : ' + err.message); }
      };
      reader.onerror = () => showToast('Import impossible : fichier illisible.');
      reader.readAsText(t.files[0]);
    }
  });

  // Drag & drop to reorder modules in edit mode.
  $app.addEventListener('dragstart', (e) => {
    const host = e.target.closest && e.target.closest('[data-mod]');
    if (!app.editing || !host) return;
    app.dragId = host.dataset.mod;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', app.dragId);
    host.classList.add('is-dragging');
  });
  $app.addEventListener('dragover', (e) => {
    if (!app.dragId) return;
    const host = e.target.closest('[data-mod]');
    if (host && host.dataset.mod !== app.dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  });
  $app.addEventListener('drop', (e) => {
    const host = e.target.closest('[data-mod]');
    const from = app.dragId;
    app.dragId = null;
    if (!host || !from || host.dataset.mod === from) { render(); return; }
    e.preventDefault();
    const to = host.dataset.mod;
    editPage((mods) => {
      const i = moduleIndex(mods, from);
      if (i < 0) return;
      const [m] = mods.splice(i, 1);
      const j = moduleIndex(mods, to);
      const rect = host.getBoundingClientRect();
      const after = e.clientX > rect.left + rect.width / 2;
      mods.splice(after ? j + 1 : j, 0, m);
    });
  });
  $app.addEventListener('dragend', () => { if (app.dragId) { app.dragId = null; render(); } });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && app.modal) { app.modal = null; render(); }
  });

  // Refresh relative times ("il y a 5 min") once a minute.
  setInterval(() => { if (app.index && !app.modal) queueRender(); }, 60000);

  document.documentElement.style.setProperty('--accent', L.data.accent);
  connectSaved();
})();
