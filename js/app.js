// Dashboard UI: pages made of modules the user can add, move, resize and configure.
(function () {
  const IC = HD.IC;
  const M = HD.Model;
  const T = HD.Modules.types;
  const L = HD.Layout;
  const { esc, icon, plural, avg } = HD.UI;
  const ACCENTS = ['#F5C542', '#FF9F0A', '#0A84FF', '#30D158', '#BF5AF2', '#FF375F', '#64D2FF'];
  const TABS = [
    { id: 'home', label: 'Accueil', icon: IC.home },
    { id: 'rooms', label: 'Pièces', icon: IC.grid },
    { id: 'auto', label: 'Automatisations', icon: IC.spark },
    { id: 'energy', label: 'Énergie', icon: IC.bolt },
    { id: 'server', label: 'Serveur', icon: IC.server },
    { id: 'updates', label: 'Mises à jour', icon: IC.download },
    { id: 'settings', label: 'Réglages', icon: IC.gear }
  ];
  const PAGE_TITLES = { home: null, auto: 'Automatisations', energy: 'Énergie', server: 'Serveur', updates: 'Mises à jour' };

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
    editing: false, modal: null,
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
    app.cal = {}; app.calEvents = {}; app.forecasts = {}; // data from the previous connection
    L.init(conn, demo);
    conn.on('status', (s) => { if (app.conn === conn) { app.status = s === 'connected' && !app.index ? 'connecting' : s; queueRender(); } });
    // Subscriptions die with the socket: forget forecasts so they are re-requested.
    conn.on('ready', () => { if (app.conn === conn) { app.forecasts = {}; loadAll(); } });
    conn.on('state', (ev) => {
      if (app.conn !== conn || !ev) return;
      if (ev.new_state) app.states.set(ev.entity_id, ev.new_state);
      else app.states.delete(ev.entity_id);
      if (app.index && ev.new_state) M.addEntity(app.index, ev.entity_id);
      if (M.domainOf(ev.entity_id) === 'calendar') app.calStamp = (app.calStamp || 0) + 1; // re-read events
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

  // Home screen of the tablet design (weather, rooms, scenes, agenda, notes); can be switched off in Réglages.
  const heroOn = () => L.data.hero !== false;

  function pageKey() {
    if (app.tab === 'rooms') { const r = currentRoom(); return r ? 'room:' + r.id : null; }
    // Under the home screen: the user's own modules (separate from the former home layout).
    if (app.tab === 'home' && heroOn()) return 'home-more';
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

  // force: redraw even while a note field has focus (used right after adding a note).
  function render(force) {
    if (app.dragging) { app.renderAfterDrag = true; return; }
    // Typing a note: redrawing would break the (Android) keyboard; redraw when leaving the note.
    const typing = document.activeElement;
    if (force !== true && typing && typing.classList && (typing.classList.contains('note') || typing.classList.contains('memo-input'))) { app.renderAfterNote = true; return; }
    document.documentElement.style.setProperty('--accent', L.data.accent);
    applyBg();
    M.setNames(L.data.names);
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.key : null;
    const caret = active && active.tagName === 'INPUT' && active.type === 'text' ? active.selectionStart : null;
    const scrollers = {};
    $app.querySelectorAll('[data-scroll]').forEach((el) => { scrollers[el.dataset.scroll] = el.scrollTop; });

    // Updated in place (morph.js): only what changed is touched, so the page never flashes.
    const view = !app.index ? 'login' : app.tab + ':' + (app.tab === 'settings' ? '' : pageKey() || '');
    HD.morph($app, !app.index ? loginView() : shell(app.tab === 'settings' ? pageSettings() : pageModules()) + (app.modal ? modalView() : ''));
    // New page: a short fade-in.
    if (app.lastView && view !== app.lastView) {
      const panel = $app.querySelector('.panel');
      if (panel) { panel.classList.remove('page-in'); void panel.offsetWidth; panel.classList.add('page-in'); }
    }
    app.lastView = view;

    fitRows(); // before restoring scroll positions, which depend on row heights
    // A list keeps its position; one that now shows something else starts at the top.
    $app.querySelectorAll('[data-scroll]').forEach((el) => { const v = scrollers[el.dataset.scroll] || 0; if (Math.abs(el.scrollTop - v) > 1) el.scrollTop = v; });
    updateFades();
    if (focusKey) {
      const el = $app.querySelector(`[data-key="${CSS.escape(focusKey)}"]`);
      if (el) {
        el.focus({ preventScroll: true });
        if (caret != null && el.setSelectionRange) el.setSelectionRange(caret, caret);
      }
    }
    if (app.modal && app.modal.search) filterPicker(app.modal.search);
  }

  // Fade the edge of a list that has more to show, so a cut row reads as "scroll for more".
  function fade(el) {
    // The module grid itself never fades: its cards must stay whole down to the bottom edge.
    if (el.tagName === 'TEXTAREA' || el.classList.contains('panel') || el.classList.contains('mods')) return;
    const more = el.scrollHeight - el.clientHeight > 4;
    el.classList.toggle('fade-b', more && el.scrollTop + el.clientHeight < el.scrollHeight - 4);
    el.classList.toggle('fade-t', more && el.scrollTop > 4);
  }
  function updateFades() { $app.querySelectorAll('[data-scroll]').forEach(fade); }
  $app.addEventListener('scroll', (e) => { if (e.target.dataset && e.target.dataset.scroll) fade(e.target); }, true);
  // Size grid rows from the space really available, so 4 rows = exactly the visible height:
  // a height-4 module is never cut off, whatever the screen. Stacked (phone) layout: natural heights.
  const STACKED = '(max-width: 860px), (max-height: 620px)';
  function touchFirst() { return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); }
  function fitRows() {
    const mods = $app.querySelector('.mods');
    if (!mods) return;
    if (window.matchMedia && window.matchMedia(STACKED).matches) { mods.style.removeProperty('--row'); return; }
    const cs = getComputedStyle(mods);
    const gap = parseFloat(cs.rowGap) || 16;
    const inner = mods.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    // Exact (fractional) size: the 4th row ends right at the bottom and the 5th starts below the fold.
    mods.style.setProperty('--row', Math.max(72, (inner - 3 * gap) / 4).toFixed(2) + 'px');
  }
  window.addEventListener('resize', () => { fitRows(); updateFades(); });

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
    // Connection lost: the page stays behind a blur, with a clear message in the middle.
    const offline = app.status === 'reconnecting' || app.status === 'connecting';
    const status = offline ? `<div class="conn-overlay" role="alertdialog" aria-modal="true" aria-labelledby="conn-t">
      <div class="conn-card">
        <span class="conn-spin" aria-hidden="true"></span>
        <h2 id="conn-t">Connexion perdue</h2>
        <p class="muted">${navigator.onLine === false ? 'Le Wi-Fi de cette tablette semble coupé.' : 'Home Assistant ne répond plus.'} Reconnexion automatique<span data-retry-in></span>.</p>
        <button class="btn-solid" data-act="conn-retry" data-key="conn-retry">Réessayer maintenant</button>
      </div></div>` : '';
    // Rail flush to the left; Réglages pushed to the bottom.
    const nUpd = updatesPending();
    const btn = (t) => {
      const badge = t.id === 'updates' && nUpd ? `<span class="rail-badge">${nUpd}</span>` : '';
      const label = t.label + (badge ? ' (' + nUpd + ' disponibles)' : '');
      return `<button class="rail-btn${t.id === app.tab ? ' is-on' : ''}" aria-label="${label}" title="${label}" ${t.id === app.tab ? 'aria-current="page"' : ''} data-act="tab" data-arg="${t.id}" data-key="tab:${t.id}">${icon(t.icon, 22)}${badge}</button>`;
    };
    return `
<nav class="rail" aria-label="Navigation principale"${offline ? ' inert' : ''}>
  ${TABS.filter((t) => t.id !== 'settings').map(btn).join('')}
  <span class="rail-spacer"></span>
  ${btn(TABS.find((t) => t.id === 'settings'))}
</nav>
<main class="panel${app.editing ? ' is-editing' : ''}"${offline ? ' inert' : ''}>${content}</main>
${status}
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

  // Lights currently on in the whole house (header chip and Pièces card).
  function lightsOn() {
    if (!app.index) return 0;
    let n = 0;
    for (const id of app.index.visible) { const s = app.states.get(id); if (s && M.domainOf(id) === 'light' && s.state === 'on') n++; }
    return n;
  }
  // Average indoor temperature: rooms only ("Autres" often holds device-internal sensors).
  function indoorTemp() {
    const ts = visibleRooms().filter((r) => r.id !== '__autres').map(roomTemp).filter((t) => t != null);
    return avg(ts);
  }
  // ---------- home header ----------
  // Three zones (left / center / right) of items: date, clock, chips, or any module in its header
  // version. In edit mode items move like modules: dropped on the page they become modules again.
  const hType = (name, desc, ic) => ({ name, desc, icon: ic, w: 1, h: 1, noEntities: true, headerOnly: true, render: () => '' });
  Object.assign(T, {
    'h-date': hType('Date', 'La date du jour, format au choix.', IC.calendar),
    'h-clock': hType('Heure', 'L\'heure, avec ou sans les secondes.', IC.clock),
    'h-lights': hType('Lampes allumées', 'Nombre de lampes allumées dans la maison.', IC.bulb),
    'h-temps': hType('Températures int. / ext.', 'Moyenne intérieure et température extérieure.', IC.thermo),
    'h-fullscreen': hType('Bouton plein écran', 'Passer en plein écran (si le navigateur le permet).', IC.expand)
  });
  // Header fonts (Google Fonts, loaded in index.html): [key, label, CSS stack, single weight].
  const H_FONT_LIST = [
    ['', 'Standard', ''],
    ['outfit', 'Moderne', "'Outfit', sans-serif"],
    ['unbounded', 'Affirmée', "'Unbounded', sans-serif"],
    ['syne', 'Design', "'Syne', sans-serif"],
    ['fraunces', 'Élégante', "'Fraunces', Georgia, serif"],
    ['dmserif', 'Magazine', "'DM Serif Display', Georgia, serif", 400],
    ['cormorant', 'Raffinée', "'Cormorant Garamond', Georgia, serif"],
    ['comfortaa', 'Douce', "'Comfortaa', sans-serif"],
    ['orbitron', 'Futuriste', "'Orbitron', sans-serif"],
    ['righteous', 'Rétro', "'Righteous', sans-serif", 400],
    ['dancing', 'Manuscrite', "'Dancing Script', cursive"]
  ];
  // Fonts of the first version, mapped to their closest new one.
  const FONT_ALIAS = { nunito: 'comfortaa', playfair: 'fraunces', mono: 'outfit', bebas: 'unbounded', caveat: 'dancing' };
  const hFontOf = (k) => H_FONT_LIST.find((f) => f[0] === (FONT_ALIAS[k] || k || '')) || H_FONT_LIST[0];
  const H_SIZES = [['s', 'S', 0.75], ['', 'M', 1], ['l', 'L', 1.3], ['xl', 'XL', 1.7]];
  const H_BASE = { 'h-date': 30, 'h-clock': 40 };
  const DATE_FMTS = ['long', 'full', 'short', 'day', 'num'];
  const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  function fmtDate(d, f) {
    if (f === 'num') return d.toLocaleDateString('fr-FR');
    const o = f === 'short' ? { weekday: 'short', day: 'numeric', month: 'short' }
      : f === 'day' ? { weekday: 'long', day: 'numeric' }
      : f === 'full' ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
      : { weekday: 'long', day: 'numeric', month: 'long' };
    return cap1(d.toLocaleDateString('fr-FR', o));
  }
  const fmtClock = (d, f) => d.toLocaleTimeString('fr-FR', f === 's' ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });

  const isHome = () => pageKey() === 'home-more';
  function headerFind(id) { return L.data.header ? L.data.header.items.find((x) => x.id === id) : null; }

  function homeHeader() {
    const items = L.headerItems();
    const fixed = app.editing
      ? `<button class="btn-glass" data-act="bg-open" data-key="bg-open">${icon(IC.palette, 18, 2)} Fond</button>
         <button class="btn-glass" data-act="add-open" data-key="add-open">${icon(IC.plus, 18, 2)} Module</button>
         <button class="btn-solid" data-act="edit-toggle" data-key="edit-toggle" aria-label="Terminer la personnalisation">${icon(IC.check, 18, 2.2)} Terminé</button>`
      : `<button class="card hov round-btn" data-act="edit-toggle" data-key="edit-toggle" aria-label="Personnaliser cette page" title="Personnaliser">${icon(IC.pencil, 19)}</button>`;
    const zone = (z) => `<div class="hzone hz-${z}" data-hzone="${z}">${items.filter((i) => i.zone === z).map(headerItem).join('')}${z === 'right' ? `<span class="head-fixed">${fixed}</span>` : ''}</div>`;
    return `<header class="page-head is-home${app.editing ? ' is-editing' : ''}">${zone('left')}${zone('center')}${zone('right')}</header>`;
  }

  function headerItem(m) {
    const t = T[m.type];
    if (!t) return '';
    const o = m.options || {};
    const k = (H_SIZES.find((x) => x[0] === (o.hSize || '')) || H_SIZES[1])[2];
    const style = [`font-size: ${Math.round((H_BASE[m.type] || 15) * k)}px`,
      /^#[0-9a-f]{6}$/i.test(o.hColor || '') ? '--hc: ' + o.hColor : '',
      hFontOf(o.hFont)[2] ? 'font-family: ' + hFontOf(o.hFont)[2] : ''].filter(Boolean).join('; ');
    let body;
    try { body = headerChip(m); } catch (e) { body = `<span class="hchip">${icon(t.icon, 18)}${esc(m.title || t.name)}</span>`; }
    const tools = app.editing ? `<span class="hitem-tools">
        <button aria-label="Réglages de ${esc(t.name)}" title="Réglages" data-act="mod-config" data-key="${m.id}:hcfg">${icon(IC.gear, 14, 2)}</button>
        <button aria-label="Retirer ${esc(t.name)} de l'en-tête" title="Retirer" data-act="mod-del" data-key="${m.id}:hdel">${icon(IC.x, 14, 2.2)}</button></span>` : '';
    return `<div class="hitem ht-${m.type}${o.hColor ? ' has-color' : ''}${hFontOf(o.hFont)[3] ? ' hf-regular' : ''}" data-hitem="${esc(m.id)}" data-mod="${esc(m.id)}" style="${style}">
      <div class="hitem-body"${app.editing ? ' inert' : ''}>${body}</div>${tools}</div>`;
  }

  // Header version of each item / module type: one compact line.
  function headerChip(m) {
    const W = HD.Modules;
    const o = m.options || {};
    const t = T[m.type];
    const now = new Date();
    const list = t.noEntities ? [] : L.resolve(m, env(null));
    const chip = (ic, text, attrs = '') => `<span class="hchip"${attrs}>${ic ? icon(ic, 18) : ''}<span class="hchip-text">${text}</span></span>`;
    const btnChip = (ic, text, attrs) => `<button class="hchip is-btn" ${attrs}>${ic ? icon(ic, 18) : ''}<span class="hchip-text">${text}</span></button>`;
    switch (m.type) {
      case 'h-date': return `<h1 class="home-date" data-date="${esc(o.fmt || 'long')}">${esc(fmtDate(now, o.fmt))}</h1>`;
      case 'h-clock': return `<time class="home-clock" data-clock="${esc(o.fmt || '')}">${esc(fmtClock(now, o.fmt))}</time>`;
      case 'h-lights': return chip(IC.bulb, esc(plural(lightsOn(), 'allumé', 'allumés')));
      case 'h-temps': {
        const ti = indoorTemp(), te = outdoorTemp();
        const part = (l, v) => `<span><span class="muted">${l}</span> ${esc(v)}</span>`;
        const txt = [ti != null ? part('Int.', M.fmtNum(ti) + '°') : '', te != null ? part('Ext.', M.fmtNum(te, 0) + '°') : ''].filter(Boolean).join('<i class="hchip-sep" aria-hidden="true"></i>');
        return `<span class="hchip is-temps">${icon(IC.thermo, 18, 2)}<span class="hchip-text">${txt || '—'}</span></span>`;
      }
      case 'h-fullscreen':
        return fsSupported() ? `<button class="card hov round-btn" data-act="fullscreen" data-key="fullscreen" aria-label="${fsEl() ? 'Quitter le plein écran' : 'Plein écran'}">${icon(fsEl() ? IC.shrink : IC.expand, 18, 2)}</button>`
          : (app.editing ? chip(IC.expand, 'Plein écran') : '');
      case 'weather': case 'home-weather': {
        const st = m.type === 'weather' ? list[0] : allStates().find((s) => M.domainOf(s.entity_id) === 'weather');
        if (!st) return chip(IC.cloud, 'Météo');
        return `<button class="hchip is-btn" data-act="weather-open" data-arg="${esc(st.entity_id)}" data-key="${m.id}:hwx">${W.wxArt(st.state, 22)}<span class="hchip-text"><b>${esc(M.fmtNum(st.attributes.temperature, 0))}°</b> ${esc(M.WEATHER[st.state] || '')}</span></button>`;
      }
      case 'temperature': {
        const ts = list.filter((s) => M.isTemp(s) && M.isAvail(s)).map((s) => Number(s.state));
        return chip(IC.thermo, ts.length ? esc(M.fmtNum(avg(ts))) + '°' : '—');
      }
      case 'climate': {
        const st = list[0];
        if (!st) return chip(IC.snow, 'Climat');
        const cur = st.attributes.current_temperature, tg = targetTemp(st);
        return chip(IC.snow, [cur != null ? esc(M.fmtNum(cur)) + '°' : '', tg != null ? '→ ' + esc(M.fmtNum(tg)) + '°' : ''].filter(Boolean).join(' '));
      }
      case 'lights': {
        const on = list.filter((s) => s.state === 'on').length;
        return btnChip(IC.bulb, `${on}/${list.length}`, `data-act="lights-toggle" data-key="${m.id}:hlt" aria-label="${on ? 'Éteindre' : 'Allumer'} ${esc(m.title || 'l\'éclairage')}"`);
      }
      case 'devices': return chip(IC.grid, esc(plural(list.filter((s) => M.describe(s).on).length, 'actif', 'actifs')));
      case 'sensor': case 'energy': {
        const st = m.type === 'energy' ? (list.find((s) => M.isSensorClass(s, 'power')) || list[0]) : list[0];
        if (!st) return chip(t.icon, esc(t.name));
        const u = st.attributes.unit_of_measurement || '';
        const v = isFinite(Number(st.state)) ? M.fmtNum(Number(st.state)) : st.state;
        return chip(t.icon, `${esc(m.title || M.shortName(st))} <b>${esc(v)}${u ? ' ' + esc(u) : ''}</b>`);
      }
      case 'transit': {
        const st = list[0];
        const d = st ? W.departures(st).find((x) => !x.cancelled && x.time > Date.now() - 60000) : null;
        if (!d) return chip(IC.train, 'Aucun départ');
        const mins = Math.max(0, Math.round((d.time - Date.now()) / 60000));
        const line = d.line || W.LINES.C01728;
        return `<span class="hchip"><span class="line-badge sm" style="background: ${line.color}; color: ${line.fg || '#fff'}">${esc(line.name)}</span><span class="hchip-text"><b>${mins === 0 ? 'À quai' : mins + ' min'}</b> ${esc(d.destination || '')}${d.delay >= 1 ? ` <span class="dep-warn">+${d.delay}</span>` : ''}</span></span>`;
      }
      case 'media': {
        const st = list[0];
        if (!st) return chip(IC.music, 'Musique');
        const playing = st.state === 'playing';
        return `<span class="hchip">${icon(IC.music, 18)}<span class="hchip-text">${esc(st.attributes.media_title || (playing ? 'Lecture' : 'En pause'))}</span>
          <button class="hchip-mini" data-act="media-cmd" data-arg="play_pause" data-key="${m.id}:hpp" aria-label="${playing ? 'Pause' : 'Lecture'}">${icon(playing ? IC.pause : IC.play, 16, 2)}</button>
          <button class="hchip-mini" data-act="media-cmd" data-arg="next" data-key="${m.id}:hnx" aria-label="Suivant">${icon(IC.next, 16, 2)}</button></span>`;
      }
      case 'calendar': case 'home-agenda': {
        const cals = m.type === 'calendar' ? list : allStates().filter((s) => M.domainOf(s.entity_id) === 'calendar');
        const data = cals.length ? calendarFor(cals, Number(o.days) || 7) : { raw: {} };
        const evs = W.agendaEvents(W.calEvents(cals, data.raw).filter((ev) => ev.end > now), o);
        app.calEvents = app.calEvents || {};
        app.calEvents[m.id] = evs;
        if (!evs.length) return chip(IC.calendar, 'Rien de prévu');
        const ev = evs[0];
        const when = ev.allDay ? W.dayTitle(ev.start < now ? now : ev.start) : ev.start <= now ? 'En cours' : (ev.start.toDateString() === now.toDateString() ? '' : W.dayTitle(ev.start) + ' ') + ev.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        return btnChip(IC.calendar, `<b>${esc(when)}</b> ${esc(ev.title)}`, `data-act="event-open" data-arg="${esc(m.id)}|0" data-key="${m.id}:hev"`);
      }
      case 'scenes': return `<span class="hchip-group">${list.slice(0, 3).map((s) => btnChip(M.sceneIcon(M.shortName(s)), esc(M.shortName(s)), `data-act="scene" data-arg="${esc(s.entity_id)}" data-key="${m.id}:hsc:${esc(s.entity_id)}"`)).join('')}</span>`;
      case 'home-scenes': return btnChip(IC.power, 'Tout éteindre', `data-act="all-off" data-arg="all" data-key="${m.id}:hoff"`);
      case 'notes': return chip(IC.note, esc((String(o.text || '').split('\n').find((l) => l.trim()) || 'Notes').slice(0, 40)));
      case 'home-notes': return chip(IC.check, esc(plural(memoItems().filter((it) => !it.done).length, 'article', 'articles')));
      case 'rooms': case 'home-rooms': return btnChip(IC.home, esc(plural(visibleRooms().length, 'pièce', 'pièces') + ' · ' + plural(lightsOn(), 'allumé', 'allumés')), `data-act="tab" data-arg="rooms" data-key="${m.id}:hrooms"`);
      case 'automations': return chip(IC.robot, esc(plural(list.filter((s) => s.state === 'on').length, 'active', 'actives')));
      default: return chip(t.icon, esc(m.title || t.name));
    }
  }

  function header(title, summary, editable) {
    const t = outdoorTemp();
    const fs = fsSupported() && !app.editing
      ? `<button class="card hov round-btn" data-act="fullscreen" data-key="fullscreen" aria-label="${fsEl() ? 'Quitter le plein écran' : 'Plein écran'}" title="${fsEl() ? 'Quitter le plein écran' : 'Plein écran'}">${icon(fsEl() ? IC.shrink : IC.expand, 18, 2)}</button>` : '';
    // Home: lights on + indoor/outdoor temperatures; other pages: outdoor only.
    let chips = '';
    if (!app.editing) {
      if (app.tab === 'home') {
        const n = lightsOn(), ti = indoorTemp();
        chips = `<span class="chip">${icon(IC.bulb, 18)}${plural(n, 'allumé', 'allumés')}</span>` +
          (ti != null || t != null ? `<span class="chip">${[ti != null ? 'Int. ' + M.fmtNum(ti) + '°' : '', t != null ? 'Ext. ' + M.fmtNum(t, 0) + '°' : ''].filter(Boolean).join(' · ')}</span>` : '');
      } else if (t != null) {
        chips = `<span class="chip">${icon(IC.cloud, 18)}Ext. ${esc(M.fmtNum(t, 0))}°</span>`;
      }
    }
    return `
<header class="page-head">
  <div class="titles"><h1>${esc(title)}</h1><p class="muted">${esc(summary)}</p></div>
  <div class="head-actions">
    ${chips}
    ${fs}
    ${editable && app.editing ? `<button class="btn-glass" data-act="bg-open" data-key="bg-open">${icon(IC.palette, 18, 2)} Fond</button><button class="btn-glass" data-act="add-open" data-key="add-open">${icon(IC.plus, 18, 2)} Module</button>` : ''}
    ${editable ? `<button class="${app.editing ? 'btn-solid' : 'card hov round-btn'}" data-act="edit-toggle" data-key="edit-toggle" aria-label="${app.editing ? 'Terminer la personnalisation' : 'Personnaliser cette page'}" title="Personnaliser">${app.editing ? icon(IC.check, 18, 2.2) + ' Terminé' : icon(IC.pencil, 19)}</button>` : ''}
  </div>
</header>`;
  }

  // ---------- Proxmox VE: nodes, VMs, containers and storage read from Home Assistant ----------
  // Works with the "Proxmox VE" integration (HACS): one HA device per node / VM / LXC / storage.
  const PVE_RE = /proxmox|(^|[._ ])pve([._ ]|$)/i;
  function fmtDur(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) return '';
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), mn = Math.floor((sec % 3600) / 60);
    return d ? d + ' j ' + h + ' h' : h ? h + ' h ' + mn + ' min' : mn + ' min';
  }
  function proxmox() {
    const idx = app.index;
    const empty = { nodes: [], guests: [], storage: [] };
    if (!idx || !idx.reg) return empty;
    const groups = new Map();
    for (const st of app.states.values()) {
      const r = idx.reg.get(st.entity_id) || {};
      if (r.disabled_by || !['sensor', 'binary_sensor', 'button', 'switch'].includes(M.domainOf(st.entity_id))) continue;
      const dev = r.device_id ? idx.devices.get(r.device_id) : null;
      const hay = (r.platform || '') + ' ' + st.entity_id + ' ' + (dev ? (dev.manufacturer || '') + ' ' + (dev.model || '') : '');
      if (!PVE_RE.test(hay)) continue;
      const key = r.device_id || st.entity_id.split('.')[1].replace(/_(cpu|memory|mem|disk|status|uptime|network|net|start|stop|shutdown|reboot|restart|swap|health|state)(_.*)?$/, '');
      if (!groups.has(key)) groups.set(key, { id: key, dev, ents: [] });
      groups.get(key).ents.push(st);
    }
    const out = { nodes: [], guests: [], storage: [] };
    for (const g of groups.values()) {
      const rawName = g.dev ? g.dev.name_by_user || g.dev.name || '' : g.id.replace(/_/g, ' ');
      const model = g.dev ? g.dev.model || '' : '';
      const txt = (rawName + ' ' + model).toLowerCase();
      const kind = /lxc|container|conteneur/.test(txt) ? 'lxc' : /qemu|virtual|\bvm\b|machine/.test(txt) ? 'qemu' : /storage|stockage/.test(txt) ? 'storage' : 'node';
      const vm = rawName.match(/\((\d{2,})\)/) || rawName.match(/\b(\d{3,})\b/);
      const name = rawName.replace(/^(node|nœud|vm|qemu|lxc|ct|storage|stockage)\s*:?\s*/i, '').replace(/\s*\(\d{2,}\)\s*/, ' ').replace(/^\d{3,}\s+/, '').trim() || rawName;
      const hayOf = (s) => (s.entity_id + ' ' + ((idx.reg.get(s.entity_id) || {}).translation_key || '') + ' ' + (s.attributes.friendly_name || '')).toLowerCase();
      const sensors = g.ents.filter((s) => M.domainOf(s.entity_id) === 'sensor');
      const pct = (s) => s.attributes.unit_of_measurement === '%';
      const find = (re, pred) => sensors.find((s) => re.test(hayOf(s)) && (!pred || pred(s)));
      const num = (s) => { if (!s || !M.isAvail(s)) return null; const v = Number(s.state); return isFinite(v) ? v : null; };
      const cpu = num(find(/cpu/, pct));
      const memUsedS = find(/(mem|ram).*(used|utilis)|(used|utilis).*(mem|ram)/, (s) => !pct(s));
      const memTotS = find(/(mem|ram).*(total|max)|(total|max).*(mem|ram)/, (s) => !pct(s));
      let mem = num(find(/mem|ram/, (s) => pct(s) && !/swap|free|libre/.test(hayOf(s))));
      const memUsed = num(memUsedS), memTotal = num(memTotS);
      if (mem == null && memUsed != null && memTotal) mem = (memUsed / memTotal) * 100;
      const disk = num(find(/disk|rootfs|storage|stockage|used/, (s) => pct(s) && !/swap|mem|ram|cpu/.test(hayOf(s))));
      const upS = find(/uptime|durée|en ligne depuis/);
      let uptime = '';
      if (upS && M.isAvail(upS)) {
        if (upS.attributes.device_class === 'timestamp') uptime = fmtDur((Date.now() - Date.parse(upS.state)) / 1000);
        else {
          const u = upS.attributes.unit_of_measurement || 's';
          const mult = { s: 1, min: 60, h: 3600, d: 86400, j: 86400 }[u] || 1;
          uptime = fmtDur(Number(upS.state) * mult);
        }
      }
      const rate = (s) => (s && M.isAvail(s) ? M.fmtNum(Number(s.state), 1) + ' ' + (s.attributes.unit_of_measurement || '') : '');
      const netIn = rate(find(/network_in|net_?in|in_rate|download|reçu|entrant/));
      const netOut = rate(find(/network_out|net_?out|out_rate|upload|envoy|sortant/));
      const statusS = g.ents.find((s) => M.domainOf(s.entity_id) === 'binary_sensor' && (/status|running|state|etat|état/.test(hayOf(s)) || s.attributes.device_class === 'running'))
        || sensors.find((s) => /status|state|etat|état/.test(hayOf(s)) && !/%/.test(s.attributes.unit_of_measurement || ''));
      let running;
      if (statusS) running = statusS.state === 'on' || /running|online|en marche|started/i.test(statusS.state);
      else running = cpu != null;
      const buttons = {};
      for (const s of g.ents) {
        if (M.domainOf(s.entity_id) !== 'button') continue;
        const h = hayOf(s);
        if (/reboot|restart|redémarr/.test(h)) buttons.reboot = s.entity_id;
        else if (/shutdown|éteindre|arrêt propre/.test(h)) buttons.shutdown = s.entity_id;
        else if (/(^|[._ ])stop|arrêter/.test(h)) buttons.stop = s.entity_id;
        else if (/(^|[._ ])start|démarr/.test(h)) buttons.start = s.entity_id;
      }
      const memUnit = (memTotS && memTotS.attributes.unit_of_measurement) || (memUsedS && memUsedS.attributes.unit_of_measurement) || '';
      const item = { id: g.id, name, kind, vmid: vm ? vm[1] : '', cpu, mem, memUsed, memTotal, memUnit, disk, uptime, netIn, netOut, running, online: statusS ? running : true, buttons };
      if (kind === 'storage') {
        const p = disk != null ? disk : num(find(/./, pct));
        out.storage.push({ name, pct: p, sub: memUsed != null && memTotal ? '' : '' });
      } else if (kind === 'node') { if (cpu != null || mem != null || disk != null || statusS) out.nodes.push(item); }
      else out.guests.push(item);
    }
    return out;
  }

  // ---------- Home Assistant updates ----------
  const updatesPending = () => app.index ? [...app.states.values()].filter((s) => M.domainOf(s.entity_id) === 'update' && s.state === 'on').length : 0;

  // Release notes are Markdown: titles, lists, bold, links — shown as simple text blocks.
  function mdLite(md) {
    const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const out = [];
    let list = false;
    for (const raw of String(md || '').split('\n')) {
      const line = raw.trim();
      const li = line.match(/^[-*]\s+(.*)$/);
      if (li) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(li[1]) + '</li>'); continue; }
      if (list) { out.push('</ul>'); list = false; }
      if (!line) continue;
      const h = line.match(/^#{1,6}\s+(.*)$/);
      out.push(h ? '<h4>' + inline(h[1]) + '</h4>' : '<p>' + inline(line) + '</p>');
    }
    if (list) out.push('</ul>');
    return out.join('');
  }

  const pendingUpdates = () => [...app.states.values()].filter((s) => M.domainOf(s.entity_id) === 'update' && s.state === 'on' && !s.attributes.in_progress).map(HD.Modules.updateInfo);
  // Safe order: add-ons, HACS and devices first, then Supervisor, Core, and the OS last (they restart).
  const updRank = (u) => (/operating_system|_os_update/.test(u.id) ? 3 : /core/.test(u.id) ? 2 : /supervisor/.test(u.id) ? 1 : 0);
  const updateOrder = (list) => list.slice().sort((a, b) => updRank(a) - updRank(b) || a.name.localeCompare(b.name, 'fr'));

  // One install at a time: the next starts when the current one is done (or failed / never started).
  function pumpUpdates() {
    const q = app.updQueue;
    if (!q) return;
    if (q.current) {
      const st = app.states.get(q.current);
      if (st && st.attributes.in_progress) { q.started = true; return; }
      if (st && !q.started && st.state === 'on' && Date.now() - q.at < 20000) return; // not started yet
      if (st && st.state === 'on') q.failed = (q.failed || 0) + 1;
      q.current = null;
    }
    const next = q.list.shift();
    if (!next) {
      app.updQueue = null;
      showToast(q.failed ? plural(q.failed, 'mise à jour n\'a pas abouti', 'mises à jour n\'ont pas abouti') + ' : réessayez-les une par une.' : 'Toutes les mises à jour sont installées.');
      return;
    }
    q.current = next.id; q.started = false; q.at = Date.now(); q.done++;
    call('update', 'install', next.id, next.backup ? { backup: true } : {});
    queueRender();
  }

  function updateAllModal(md) {
    const list = updateOrder(pendingUpdates());
    const seg = (act, value, opts) => `<div class="segmented inline" role="group">${opts.map(([v, label]) =>
      `<button type="button" class="${value === v ? 'is-on' : ''}" aria-pressed="${value === v}" data-act="${act}" data-arg="${esc(v)}" data-key="${act}:${esc(v)}">${label}</button>`).join('')}</div>`;
    const anyBackup = list.some((u) => u.backup);
    const body = `<p class="muted">Installées une par une, dans cet ordre (Home Assistant et le système en dernier, car ils redémarrent) :</p>
      <ol class="upd-order">${list.map((u) => `<li><span>${esc(u.name)}</span><span class="upd-ver">${esc(u.installed)} → <b>${esc(u.latest)}</b></span></li>`).join('')}</ol>
      ${anyBackup ? `<div class="field-row"><span class="field-label">Sauvegarde</span>${seg('upd-backup', md.backup === false ? '' : 'on', [['on', 'Avant de commencer'], ['', 'Non']])}</div>` : ''}
      <p class="muted small">Gardez cette page ouverte jusqu'à la fin : c'est elle qui lance la mise à jour suivante.</p>`;
    const foot = `<span class="grow"></span><button class="btn-glass" data-act="modal-close" data-key="modal-close">Annuler</button>
      <button class="btn-solid" data-act="update-all" data-key="upd-all" ${list.length ? '' : 'disabled'}>${icon(IC.download, 16, 2)} Tout installer (${list.length})</button>`;
    return modalFrame('Tout mettre à jour', body, foot);
  }

  function updateModal(md) {
    const close = `<span class="grow"></span><button class="btn-solid" data-act="modal-close" data-key="modal-close">Fermer</button>`;
    const st = app.states.get(md.entity);
    if (!st) return modalFrame('Mise à jour', '<p class="muted">Entité introuvable.</p>', close);
    const u = HD.Modules.updateInfo(st);
    const seg = (act, value, opts) => `<div class="segmented inline" role="group">${opts.map(([v, label]) =>
      `<button type="button" class="${value === v ? 'is-on' : ''}" aria-pressed="${value === v}" data-act="${act}" data-arg="${esc(v)}" data-key="${act}:${esc(v)}">${label}</button>`).join('')}</div>`;
    if (u.notes && md.notes == null && !md.loading && app.conn && app.conn.releaseNotes) {
      md.loading = true;
      app.conn.releaseNotes(u.id).then((t) => { md.notes = t || ''; }, () => { md.notes = ''; }).then(() => { md.loading = false; if (app.modal === md) render(); });
    }
    const notes = md.notes ? `<div class="upd-notes">${mdLite(md.notes.slice(0, 20000))}</div>` : md.loading ? '<p class="muted small">Chargement des notes de version…</p>' : u.summary ? `<div class="upd-notes">${mdLite(u.summary)}</div>` : '';
    const body = `
      <div class="upd-vers">
        <span><span class="muted small">Installée</span><b>${esc(u.installed)}</b></span>
        ${u.pending || u.busy ? `<span class="upd-arrow">→</span><span><span class="muted small">Disponible</span><b>${esc(u.latest)}</b></span>` : `<span class="upd-uptodate">${icon(IC.check, 16, 2.4)} À jour</span>`}
      </div>
      ${u.busy ? `<div class="upd-prog lg"><i style="width: ${u.pct != null ? Math.max(4, u.pct) : 30}%"${u.pct == null ? ' class="indet"' : ''}></i></div><p class="muted small">Installation en cours${u.pct != null ? ' : ' + Math.round(u.pct) + ' %' : '…'} Home Assistant peut redémarrer à la fin.</p>` : ''}
      ${u.pending && !u.busy && u.backup ? `<div class="field-row"><span class="field-label">Sauvegarde</span>${seg('upd-backup', md.backup === false ? '' : 'on', [['on', 'Avant d\'installer'], ['', 'Non']])}</div>` : ''}
      ${notes}
      ${u.url ? `<p><a class="link-btn" href="${esc(u.url)}" target="_blank" rel="noopener">Notes de version complètes</a></p>` : ''}`;
    const foot = u.pending && !u.busy
      ? `<button class="btn-glass" data-act="update-skip" data-arg="${esc(u.id)}" data-key="upd-skip">Ignorer cette version</button><span class="grow"></span>
         <button class="btn-glass" data-act="modal-close" data-key="modal-close">Plus tard</button>
         <button class="btn-solid" data-act="update-install" data-arg="${esc(u.id)}" data-key="upd-install" ${u.off ? 'disabled' : ''}>${icon(IC.download, 16, 2)} Installer</button>`
      : close;
    return modalFrame(u.name, body, foot);
  }

  // ----- home screen (design « Dashboard Maison – tablette ») -----
  // Three columns filling the screen: weather | rooms + scenes | agenda + notes.
  const allStates = () => [...app.index.visible].map((id) => app.states.get(id)).filter(Boolean);
  const hhmm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const WARN_PATH = 'M12 3 2 20h20z M12 10v4 M12 17v.5';

  // Each block of the home screen is a module: it can be moved, stretched, removed and added
  // back like any other. The default home layout (layout.js) rebuilds the design on the 4×4 grid.
  const homeType = (name, desc, ic, w, h, render) => ({ name, desc, icon: ic, w, h, noEntities: true, bare: true, home: true, render });
  Object.assign(T, {
    'home-weather': homeType('Météo (accueil)', 'Météo actuelle, 5 prochaines heures, 4 jours, lever et coucher du soleil.', IC.cloud, 1, 4, (m) => heroWeather(m)),
    'home-rooms': homeType('Pièces et lumières', 'Chaque pièce avec sa température et ses lampes à allumer d\'un toucher.', IC.home, 2, 3, (m) => heroRooms(m)),
    'home-scenes': homeType('Raccourcis', '« Tout éteindre » et vos trois premières scènes.', IC.spark, 2, 1, () => heroScenes()),
    'home-agenda': homeType('Agenda (accueil)', 'Les prochains jours de vos calendriers ; plusieurs affichages.', IC.calendar, 1, 2, (m) => heroAgenda(m)),
    'home-notes': homeType('Courses', 'Une liste à cocher partagée : courses, choses à faire…', IC.check, 1, 2, (m) => heroNotes(m))
  });

  function heroWeather(m) {
    const W = HD.Modules;
    const w = m ? m.w : 1, h = m ? m.h : 4;
    const st = allStates().find((s) => M.domainOf(s.entity_id) === 'weather');
    if (!st) return `<section class="card hero-card hero-weather"><div class="mod-head"><h2>Météo</h2></div><p class="muted small">Aucune entité météo dans Home Assistant (intégration Météo-France par exemple).</p></section>`;
    const a = st.attributes;
    const days = W.dailyItems(forecastFor(st, 'main'));
    const todayKey = new Date().toDateString();
    const todayFc = days.find((f) => new Date(f.datetime).toDateString() === todayKey);
    const hourlyFc = forecastFor(st, 'hourly');
    // Design « Météo »: 1×1 centered · x×1 a strip · 1×n a column · 2+×2+ complete. Each size its own selection.
    const tiny = w === 1 && h === 1, strip = h === 1 && w >= 2, narrow = w === 1 && h >= 2, big = w >= 2 && h >= 2;
    const nHours = strip ? (w === 2 ? 3 : w === 3 ? 6 : 9) : narrow ? 4 : big ? (w === 2 ? 5 : w === 3 ? 7 : 9) : 0;
    const nDays = tiny || strip ? 0 : h === 2 ? 3 : h === 3 ? 5 : 7;
    const upcoming = days.filter((f) => new Date(f.datetime).toDateString() === todayKey || new Date(f.datetime) > new Date());
    const next = upcoming.slice(0, nDays);
    const hours = nHours && hourlyFc && hourlyFc.items ? hourlyFc.items.filter((x) => Date.parse(x.datetime) > Date.now() - 30 * 60000).slice(0, nHours) : [];
    const lowOf = (f) => (f.templow != null ? f.templow : f.temperature);
    const lo = Math.min(...next.map(lowOf)), hi = Math.max(...next.map((f) => f.temperature));
    const span = hi - lo || 1;
    const t0 = todayFc || days[0];
    const n0 = (v) => esc(M.fmtNum(v, 0)) + '°';
    const range = t0 && t0.templow != null ? n0(t0.templow) + ' / ' + n0(t0.temperature) : '';
    const minMax = t0 && t0.templow != null ? 'Min ' + n0(t0.templow) + ' · Max ' + n0(t0.temperature) : '';
    const cond = esc(M.WEATHER[st.state] || st.state);
    const temp = (size) => `<span class="wh-temp" style="font-size: ${size}px">${n0(a.temperature)}</span>`;
    const hum = a.humidity != null ? esc(M.fmtNum(a.humidity, 0)) + ' %' : null;
    const wind = a.wind_speed != null ? esc(M.fmtNum(a.wind_speed, 0)) + ' ' + esc(a.wind_speed_unit || 'km/h') : null;
    const stat = (ic, color, label, v) => v == null ? '' : `<span class="wh-stat">${icon(ic, 18, 1.8).replace('stroke="currentColor"', `stroke="${color}"`)}<span class="stack"><span class="muted">${label}</span><b>${v}</b></span></span>`;
    const stats = stat(IC.drop, '#8EC5FF', 'Humidité', hum) + stat(IC.wind, 'currentColor', 'Vent', wind);
    const hoursHtml = (boxed) => hours.length ? `<span class="wh-hours${boxed ? ' is-boxed' : ''}">${hours.map((x) =>
        `<span class="wh-hr"><span class="muted">${new Date(x.datetime).getHours()}h</span>${W.wxArt(x.condition || st.state, 22)}<b>${n0(x.temperature)}</b></span>`).join('')}</span>` : '';
    const daysHtml = next.length ? `<span class="wh-days${narrow ? ' is-narrow' : ''}">${next.map((f, i) => {
        const l = lowOf(f);
        const left = ((l - lo) / span) * 100, width = Math.max(4, ((f.temperature - l) / span) * 100);
        return `<span class="wh-day"><span>${esc(W.dayLabel(f.datetime, i))}</span><span class="muted wh-num">${n0(l)}</span>
          <span class="wh-track"><i style="left: ${left.toFixed(1)}%; width: ${Math.min(100 - left, width).toFixed(1)}%"></i></span><b class="wh-num">${n0(f.temperature)}</b></span>`;
      }).join('')}</span>` : '';
    const upd = st.last_updated ? ' · maj. ' + hhmm(new Date(st.last_updated)) : '';
    const title = esc((m && m.title) || 'Météo');
    const headHtml = (meta) => `<span class="mod-head"><span class="h2">${title}</span><span class="muted small">${meta}</span></span>`;
    let inner;
    if (tiny) {
      inner = `<span class="wh-tiny">${W.wxArt(st.state, 48)}${temp(44)}<b class="wh-cond">${cond}</b>${range ? `<span class="muted small wh-num">${range}</span>` : ''}</span>`;
    } else if (strip) {
      inner = `<span class="wh-strip"><span class="wh-strip-now"><span class="h2">${title}</span><span class="wh-now">${W.wxArt(st.state, 44)}${temp(44)}</span>
          <span class="muted small wh-num">${cond}${range ? ' · ' + range : ''}</span></span><span class="wh-sep" aria-hidden="true"></span>${hoursHtml(false)}</span>`;
    } else if (narrow) {
      inner = headHtml(esc(M.shortName(st))) + `<span class="wh-center"><span class="wh-now">${W.wxArt(st.state, 44)}${temp(44)}</span><b class="wh-cond">${cond}</b>${range ? `<span class="muted small wh-num">${range}</span>` : ''}</span>
        ${hoursHtml(true)}
        ${h >= 3 ? `<span class="wh-list">${hum != null ? `<span><span class="muted">Humidité</span><b>${hum}</b></span>` : ''}${wind != null ? `<span><span class="muted">Vent</span><b>${wind}</b></span>` : ''}</span>` : ''}
        ${daysHtml}`;
    } else {
      const statsText = w === 2 && h === 2 && (hum != null || wind != null) ? `<span class="muted small wh-num ell">${[hum != null ? 'Hum. ' + hum : '', wind != null ? 'Vent ' + wind : ''].filter(Boolean).join(' · ')}</span>` : '';
      inner = headHtml(esc(M.shortName(st)) + upd) + `<span class="wh-big-now">${W.wxArt(st.state, 56)}${temp(56)}
          <span class="stack wh-desc"><b class="wh-cond">${cond}</b>${minMax ? `<span class="muted small wh-num">${minMax}</span>` : ''}${statsText}</span>
          ${w >= 3 ? `<span class="wh-stats is-inline">${stats}</span>` : ''}</span>
        ${w === 2 && h >= 3 ? `<span class="wh-stats">${stats}</span>` : ''}
        ${hoursHtml(true)}${daysHtml}`;
    }
    return `<div class="card hero-card hero-weather wxv-${tiny ? 'tiny' : strip ? 'strip' : narrow ? 'narrow' : 'big'}" role="button" tabindex="0" data-act="weather-open" data-arg="${esc(st.entity_id)}" data-key="hero:wx" aria-label="Météo, prévisions détaillées">
      ${inner}
    </div>`;
  }

  // Rooms shown by a "Pièces et lumières" module: the ones picked in ⚙, else all visible rooms.
  function moduleRooms(m) {
    const all = visibleRooms();
    const pick = m && m.options && Array.isArray(m.options.rooms) ? m.options.rooms : null;
    return pick ? all.filter((r) => pick.includes(r.id)) : all;
  }

  // One room for the design « Pièces »: name, state of its lights, temperature, a bulb button.
  function roomInfo(room) {
    const sts = room.ids.map((id) => app.states.get(id)).filter(Boolean);
    const lights = sts.filter((s) => M.domainOf(s.entity_id) === 'light');
    const on = lights.filter((l) => l.state === 'on').length;
    const t = roomTemp(room);
    const z = HD.Modules.tempZone(t, {});
    const hot = !!(z && (z.id === 'chaud' || z.id === 'tres'));
    const sub = !lights.length ? (t == null ? 'Aucun capteur' : 'Aucune lumière')
      : !on ? 'Lumières éteintes' : on + '/' + lights.length + ' ' + (on > 1 ? 'allumées' : 'allumée');
    return { room, t, on, total: lights.length, hot, sub, temp: t == null ? '—' : M.fmtNum(t) + '°' };
  }
  function roomBulb(r) {
    const label = !r.total ? 'Aucune lumière — ' + r.room.name : (r.on ? 'Éteindre' : 'Allumer') + ' — ' + r.room.name;
    return `<button class="bulb${r.on ? ' is-on' : ''}" ${r.total ? '' : 'disabled'} aria-pressed="${!!r.on}" aria-label="${esc(label)}" title="${esc(label)}" data-act="room-toggle" data-arg="${esc(r.room.id)}" data-key="hero:rt:${esc(r.room.id)}">${icon(IC.bulb, 20, 2)}</button>`;
  }
  const roomName = (r, cls) => `<button class="rt-open${cls ? ' ' + cls : ''}" data-act="open-room" data-arg="${esc(r.room.id)}" data-key="hero:room:${esc(r.room.id)}"><span class="rt-name">${esc(r.room.name)}</span>`;
  const tempCls = (r) => 'rt-temp' + (r.hot ? ' is-hot' : r.t == null ? ' is-none' : '');

  function heroRooms(m) {
    const w = m ? m.w : 2, h = m ? m.h : 3;
    const id = esc(m ? m.id : '');
    const rooms = moduleRooms(m).map(roomInfo);
    const ti = indoorTemp();
    const n = lightsOn();
    const avgTxt = ti != null ? 'Moy. ' + M.fmtNum(ti) + '°' : '';
    const nOn = plural(n, 'lumière allumée', 'lumières allumées');
    const allOff = (cls) => `<button class="ghost-btn${cls ? ' ' + cls : ''}" data-act="all-off" data-arg="all" data-key="hero:alloff:${id}${cls || ''}">${icon(IC.power, 18, 2)}Tout éteindre</button>`;
    const tiny = w === 1 && h === 1, strip = h === 1 && w >= 2, narrow = w === 1 && h >= 2;
    const title = esc((m && m.title) || 'Pièces');
    const headHtml = (meta) => `<div class="mod-head"><h2>${title}</h2><span class="muted small">${esc(meta)}</span></div>`;
    let body;
    if (!rooms.length) {
      body = headHtml('') + '<p class="muted small">' + (visibleRooms().length ? 'Aucune pièce choisie : ⚙ › Pièces affichées.' : 'Aucune pièce : assignez vos appareils à des zones dans Home Assistant.') + '</p>';
    } else if (tiny) {
      body = headHtml(avgTxt) + `<div class="rooms-count"><span class="rc-n">${n}</span><span>${n > 1 ? 'lumières<br>allumées' : 'lumière<br>allumée'}</span></div>${allOff('is-full')}`;
    } else if (strip) {
      const k = w === 2 ? 2 : w === 3 ? 3 : 5;
      const shown = rooms.slice(0, k);
      body = headHtml([avgTxt, nOn].filter(Boolean).join(' · ')) + `<div class="rooms-strip">${shown.map((r) => `<div class="rt${r.on ? ' is-on' : ''}">
          <div class="rt-top">${roomName(r)}<span class="muted small ell">${esc(r.sub)}</span></button>${roomBulb(r)}</div>
          <span class="${tempCls(r)}">${esc(r.temp)}</span></div>`).join('')}
        ${rooms.length > k ? `<button class="ghost-btn rooms-more" data-act="tab" data-arg="rooms" data-key="hero:more:${id}"><b>+${rooms.length - k}</b><span class="muted small">pièces</span></button>` : ''}</div>`;
    } else if (narrow) {
      body = headHtml(plural(n, 'allumée', 'allumées')) +
        (h >= 4 && ti != null ? `<div class="rooms-sum is-row"><span class="muted small">Moyenne</span><b>${esc(M.fmtNum(ti))}°</b></div>` : '') +
        `<div class="rooms-list" data-scroll="hero-rooms:${id}">${rooms.map((r) => `<div class="rt is-row${r.on ? ' is-on' : ''}">
          ${roomName(r)}<span class="${tempCls(r)}">${esc(r.temp)}</span></button>${roomBulb(r)}</div>`).join('')}</div>` +
        (h >= 3 ? allOff('is-full') : '');
    } else {
      const hottest = rooms.filter((r) => r.t != null).sort((a, b) => b.t - a.t)[0];
      body = headHtml([avgTxt, nOn].filter(Boolean).join(' · ')) +
        (h >= 3 ? `<div class="rooms-sum">
          <span><span class="muted small">Moyenne</span><b>${ti != null ? esc(M.fmtNum(ti)) + '°' : '—'}</b></span>
          <span><span class="muted small">Lumières</span><b>${esc(plural(n, 'allumée', 'allumées'))}</b></span>
          <span><span class="muted small">Plus chaude</span><b class="ell${hottest && hottest.hot ? ' is-hot' : ''}">${hottest ? esc(hottest.room.name + ' · ' + hottest.temp) : '—'}</b></span></div>` : '') +
        `<div class="rooms-grid" data-scroll="hero-rooms:${id}" style="grid-template-columns: repeat(${w === 2 ? 2 : 3}, minmax(0, 1fr)); --rt-temp: ${h >= 3 ? 32 : 24}px">${rooms.map((r) => `<div class="rt${r.on ? ' is-on' : ''}">
          <div class="rt-top">${roomName(r)}<span class="muted small ell">${esc(r.sub)}</span></button>${roomBulb(r)}</div>
          <span class="rt-bottom"><span class="${tempCls(r)}">${esc(r.temp)}</span>${r.hot ? '<span class="rt-hot">Chaud</span>' : ''}</span></div>`).join('')}
          ${allOff('rt-off')}</div>`;
    }
    return `<section class="card hero-card hero-rooms roomsv-${tiny ? 'tiny' : strip ? 'strip' : narrow ? 'narrow' : 'big'}" aria-label="Pièces">${body}</section>`;
  }

  function heroScenes() {
    const scenes = allStates().filter((s) => M.domainOf(s.entity_id) === 'scene')
      .sort((a, b) => M.shortName(a).localeCompare(M.shortName(b), 'fr')).slice(0, 3);
    const btn = (act, arg, ic, label) => `<button class="scene-chip" data-act="${act}" data-arg="${esc(arg)}" data-key="hero:sc:${esc(arg)}">${icon(ic, 18)}<span>${esc(label)}</span></button>`;
    return `<section class="card hero-scenes" aria-label="Scènes" style="grid-template-columns: repeat(${scenes.length + 1}, minmax(0, 1fr))">
      ${btn('all-off', 'all', IC.power, 'Tout éteindre')}
      ${scenes.map((s) => btn('scene', s.entity_id, M.sceneIcon(M.shortName(s)), M.shortName(s))).join('')}
    </section>`;
  }

  function heroAgenda(m) {
    const W = HD.Modules;
    const o = (m && m.options) || {};
    const days = Number(o.days) || 7;
    const id = m ? m.id : 'hero-agenda';
    const cals = allStates().filter((s) => M.domainOf(s.entity_id) === 'calendar');
    const data = cals.length ? calendarFor(cals, days) : { raw: {} };
    // Traffic info ("RER D : …") belongs to the train module: hidden here unless asked for.
    const events = W.agendaEvents(W.calEvents(cals, data.raw).filter((ev) => ev.end > new Date()), o);
    app.calEvents = app.calEvents || {};
    app.calEvents[id] = events;
    const title = esc((m && m.title) || 'Agenda');
    // Default: the design's "Jours" view; the other views stay available in ⚙.
    if (!o.view || o.view === 'jours') {
      if (!cals.length) {
        return `<section class="card hero-card hero-agenda" aria-label="Agenda"><div class="mod-head"><h2>${title}</h2></div>
          <div class="mod-empty"><span class="empty-ic">${icon(IC.calendar, 22, 1.8)}</span><p class="muted small">Aucun calendrier : connectez Google Agenda dans Home Assistant (« Calendrier distant » ou « Google Calendar »).</p></div></section>`;
      }
      const r = W.calDays(events, { id, w: m ? m.w : 1, h: m ? m.h : 2, days, loading: data.loading && !events.length });
      const tiny = m && m.w === 1 && m.h === 1;
      return `<section class="card hero-card hero-agenda ag-${tiny ? 'tiny' : 'n'}" aria-label="Agenda">
        <div class="mod-head"><h2>${title}</h2>${r.meta ? `<span class="muted small">${esc(r.meta)}</span>` : ''}</div>${r.html}</section>`;
    }
    let list = W.calBody(events, { id, view: o.view, days, multi: cals.length > 1, narrow: !m || m.w === 1 });
    if (!events.length) {
      list = `<p class="muted small">${!cals.length ? 'Aucun calendrier : connectez Google Agenda dans Home Assistant (« Calendrier distant » ou « Google Calendar »).' : data.loading ? 'Chargement…' : days === 1 ? "Rien de prévu aujourd'hui." : 'Rien de prévu sur ' + days + ' jours.'}</p>`;
    }
    return `<section class="card hero-card hero-agenda" aria-label="Agenda">
      <div class="mod-head"><h2>${esc((m && m.title) || 'Agenda')}</h2><span class="muted small">${days === 1 ? "Aujourd'hui" : days + ' jours'}</span></div>
      <div class="agenda-list" data-scroll="agenda:${esc(id)}">${list}</div>
    </section>`;
  }

  // Notes as a checklist: one line per item, "[x] " marks a checked one. Shared through the HA account.
  function memo() {
    if (!L.data.memo) {
      // First time: take over the text of an existing Notes module.
      let text = '';
      Object.values(L.data.pages).forEach((p) => p.modules.forEach((m) => { if (!text && m.type === 'notes' && m.options.text) text = m.options.text; }));
      L.data.memo = { text, updated: 0 };
    }
    return L.data.memo;
  }
  function memoItems() {
    return memo().text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(?:[-*]\s*)?\[( |x|X)\]\s*(.*)$/);
      return m ? { done: m[1] !== ' ', text: m[2] } : { done: false, text: l.replace(/^[-*]\s+/, '') };
    }).filter((it) => it.text);
  }
  function saveMemo(items) {
    L.data.memo = { text: items.map((it) => (it.done ? '[x] ' : '[ ] ') + it.text).join('\n'), updated: Date.now(), history: memo().history || [] };
    L.save();
  }
  // Items cleared once checked come back as "Souvent achetés" suggestions (most recent first).
  function rememberBought(texts) {
    const seen = new Set(texts.map((t) => t.toLowerCase()));
    memo().history = texts.concat((memo().history || []).filter((t) => !seen.has(t.toLowerCase()))).slice(0, 20);
  }

  // Design « Courses »: a checklist. 1×1 the items · x×1 chips (+ an add field from 3 wide) ·
  // 2+ rows a list (2 columns from 3 wide), "Souvent achetés" from 3 rows, the add field at the bottom.
  function heroNotes(mod) {
    const w = mod ? mod.w : 1, h = mod ? mod.h : 2;
    const items = memoItems();
    const left = items.filter((it) => !it.done).length;
    const anyDone = items.some((it) => it.done);
    const tiny = w === 1 && h === 1, strip = h === 1 && w >= 2;
    const count = !items.length ? 'Liste vide' : !left ? 'Tout est pris' : plural(left, 'article', 'articles');
    const meta = anyDone && !tiny ? `<button class="link-btn" data-act="memo-clear" data-key="memo-clear">Effacer les cochées</button>` : esc(count);
    const plus = icon(IC.plus, 18, 2.4);
    const check = (it, i, cls) => `<label class="${cls}${it.done ? ' is-done' : ''}"><input class="chk" type="checkbox" ${it.done ? 'checked' : ''} data-act="memo-check" data-arg="${i}" data-key="memo:${i}"><span>${esc(it.text)}</span></label>`;
    // Only one add field on the page (it keeps the keyboard open between two items).
    const form = (cls) => `<form class="memo-form${cls ? ' ' + cls : ''}" id="memo-form"><label class="sr-only" for="memo-input">Ajouter un article</label>
        <input id="memo-input" class="memo-input" type="text" placeholder="Ajouter un article…" maxlength="200" value="${esc(app.memoDraft || '')}" data-act="memo-draft" data-key="memo-input" enterkeyhint="done" autocomplete="off">
        <button class="add-btn" type="submit" aria-label="Ajouter à la liste" data-key="memo-add">${plus}</button></form>`;
    const headHtml = `<div class="mod-head"><h2>${esc((mod && mod.title) || 'Courses')}</h2><span class="muted small">${meta}</span></div>`;
    let body;
    if (tiny) {
      body = `<ul class="memo-list is-tiny" data-scroll="hero-memo">${items.map((it, i) => `<li>${check(it, i, 'memo-item')}</li>`).join('')}</ul>`;
    } else if (strip) {
      const adding = w === 2 && app.memoAdding;
      body = `<div class="memo-strip">${adding ? form('is-grow') : `<div class="memo-chips" data-scroll="hero-memo">${items.map((it, i) => check(it, i, 'memo-chip')).join('') || '<span class="muted small">Liste vide</span>'}</div>`}
        ${w >= 3 ? form('is-side') : adding ? '' : `<button class="add-btn" data-act="memo-add-open" data-key="memo-add-open" aria-label="Ajouter un article">${plus}</button>`}</div>`;
    } else {
      const have = new Set(items.map((it) => it.text.toLowerCase()));
      const sugg = h >= 3 ? (memo().history || []).filter((t) => !have.has(t.toLowerCase())).slice(0, w >= 3 ? 8 : 4) : [];
      body = `<ul class="memo-list" data-scroll="hero-memo" style="grid-template-columns: repeat(${w >= 3 ? 2 : 1}, minmax(0, 1fr))">${items.map((it, i) => `<li>${check(it, i, 'memo-item')}</li>`).join('')}</ul>
        ${sugg.length ? `<div class="memo-sugg"><span class="sec-label">Souvent achetés</span><div class="memo-sugg-list">${sugg.map((t, i) =>
          `<button class="sugg-btn" data-act="memo-add" data-arg="${esc(t)}" data-key="memo-sugg:${i}">${icon(IC.plus, 14, 2.4)}${esc(t)}</button>`).join('')}</div></div>` : ''}
        ${form('')}`;
    }
    return `<section class="card hero-card hero-notes memov-${tiny ? 'tiny' : strip ? 'strip' : 'list'}" aria-label="Courses">${headHtml}${body}</section>`;
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
    if (key === 'updates') { const n = updatesPending(); return n ? plural(n, 'mise à jour disponible', 'mises à jour disponibles') : 'Tout est à jour'; }
    if (key === 'server') {
      const pve = proxmox();
      if (!pve.nodes.length) return 'Proxmox VE';
      const n = pve.nodes[0];
      return [n.name, n.cpu != null ? 'CPU ' + Math.round(n.cpu) + ' %' : '', pve.guests.length ? pve.guests.filter((g) => g.running).length + '/' + pve.guests.length + ' en marche' : ''].filter(Boolean).join(' · ');
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
      targetTemp, roomSummaries, roomOrder, forecast: (st) => forecastFor(st, 'main'),
      calendar: calendarFor, mediaUrl, updQueue: () => app.updQueue, proxmox: (() => { let v; return () => v || (v = proxmox()); })(),
      rememberEvents: (id, events) => { app.calEvents = app.calEvents || {}; app.calEvents[id] = events; }
    };
    const body = mods.map((m) => moduleView(m, ctx, e)).join('') +
      (app.editing ? `<button class="mod add-tile" style="grid-column: span 1; grid-row: span 2" data-act="add-open" data-key="add-tile">${icon(IC.plus, 26, 2)}<span>Ajouter un module</span></button>` : '');
    const hint = app.editing ? `<p class="edit-hint muted small">${touchFirst() ? 'Maintenez' : 'Attrapez'} un module puis glissez-le sur un autre pour les échanger · étirez son bord droit, son bord bas ou son coin pour le redimensionner · ${icon(IC.palette, 14)} couleurs · ${icon(IC.gear, 14)} appareils, noms et titre${L.isCustom(key) ? ` · <button class="link-btn" data-act="page-reset">${key === 'home-more' ? 'Revenir à l\'écran d\'accueil d\'origine' : 'Revenir à la disposition automatique'}</button>` : ''}</p>` : '';
    // Home: the design's blocks fill the first screen (4 rows), the user's own modules follow below.
    const head = key === 'home-more' ? homeHeader() : header(title, pageSummary(key, room, mods), true);
    return head + tabs + hint +
      (mods.length || app.editing
        ? `<div class="mods" data-scroll="page:${esc(key)}">${body}</div>`
        : emptyState('Cette page est vide.', 'Touchez le crayon pour ajouter des modules.'));
  }

  function moduleView(m, ctx, e) {
    const t = T[m.type];
    const list = L.resolve(m, e);
    let inner;
    if (!t.noEntities && !list.length) {
      // Nothing to show: say why; offer the picker only if HA has something compatible somewhere.
      const anywhere = [...(t.allStates ? app.states.keys() : app.index.visible)].some((id) => { const s = app.states.get(id); return s && t.pick(s); });
      const msg = t.manual ? 'Aucun capteur choisi.' : anywhere ? 'Aucun appareil compatible ici.' : (t.empty || 'Aucun appareil compatible trouvé dans Home Assistant.');
      const nothing = !t.manual && !anywhere;
      const warn = nothing && t.emptyIcon === 'warn';
      inner = HD.UI.head(m.title || (nothing && t.emptyName) || t.name) + `<div class="mod-empty">
        <span class="empty-ic${warn ? ' is-warn' : ''}">${icon(warn ? WARN_PATH : t.icon, 22, 2)}</span>
        ${nothing && t.emptyTitle ? `<p class="empty-title">${esc(t.emptyTitle)}</p>` : ''}
        <p class="muted small">${esc(msg)}</p>
        ${nothing && t.emptyCode ? `<code class="empty-code">${esc(t.emptyCode)}</code>` : ''}
        ${anywhere || t.manual ? `<button class="btn-glass sm" data-act="mod-config" data-key="${m.id}:cfg-empty">Choisir des appareils</button>` : ''}</div>`;
    } else {
      // A module set to "Toute la maison" on a room page behaves like a house-wide one.
      inner = t.render(m, list, m.scope === 'all' && !ctx.global ? { ...ctx, global: true } : ctx);
    }
    const bare = t.bare && (t.home || !m.title) && (list.length || t.noEntities);
    // Edit mode: the whole card is draggable (drop it on another one to swap them), its right edge,
    // bottom edge and corner stretch it on the 4-column grid. Arrow keys work on the grip and handles.
    const tools = app.editing ? `
      <div class="mod-tools">
        <button class="mod-grip" aria-label="Déplacer (flèches gauche / droite)" title="Glisser pour déplacer" data-grip data-key="${m.id}:grip">${icon(IC.drag, 16, 2.6)}<span data-size>${m.w}×${m.h}</span></button>
        <span class="mod-tools-btns">
          <button aria-label="Couleurs du module" title="Couleurs" data-act="mod-colors" data-key="${m.id}:col">${icon(IC.palette, 16, 2)}</button>
          <button aria-label="Paramétrer le module" title="Paramètres" data-act="mod-config" data-key="${m.id}:cfg">${icon(IC.gear, 16, 2)}</button>
          <button aria-label="Supprimer le module" title="Supprimer" data-act="mod-del" data-key="${m.id}:del">${icon(IC.trash, 16, 2)}</button>
        </span>
      </div>
      <button class="rz rz-e" data-rz="e" data-key="${m.id}:rz-e" aria-label="Largeur : ${m.w} sur 4 (flèches gauche / droite)" title="Étirer pour changer la largeur"></button>
      <button class="rz rz-s" data-rz="s" data-key="${m.id}:rz-s" aria-label="Hauteur : ${m.h} sur 4 (flèches haut / bas)" title="Étirer pour changer la hauteur"></button>
      <button class="rz rz-se" data-rz="se" data-key="${m.id}:rz-se" aria-label="Taille : ${m.w} × ${m.h} (flèches)" title="Étirer pour redimensionner"></button>` : '';
    return `<section class="mod ${bare ? 'bare' : 'card'} t-${m.type} w${m.w} h${m.h}" data-mod="${esc(m.id)}" aria-label="${esc(m.title || t.name)}"
      style="grid-column: span ${m.w}; grid-row: span ${m.h}; --h: ${m.h}${/^#[0-9a-f]{6}$/i.test(m.options.accent || '') ? '; --accent: ' + m.options.accent : ''}">
      <div class="mod-body"${app.editing ? ' inert' : ''}>${inner}</div>${tools}</section>`;
  }

  function emptyState(title, hint) {
    return `<div class="empty card"><p>${esc(title)}</p>${hint ? `<p class="muted small">${esc(hint)}</p>` : ''}</div>`;
  }

  // Calendar events for a set of calendars over `days` days, cached and refreshed every 5 min
  // or as soon as a calendar entity changes in HA (app.calStamp).
  function calendarFor(list, days) {
    app.cal = app.cal || {};
    const key = list.map((s) => s.entity_id).join(',') + '|' + days;
    const slot = app.cal[key] || (app.cal[key] = { raw: null, at: 0, loading: false, error: null });
    const stale = Date.now() - slot.at > 5 * 60000 || slot.stamp !== (app.calStamp || 0);
    const conn = app.conn;
    if (stale && !slot.loading && conn && conn.fetchCalendarEvents) {
      slot.loading = true;
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + days * 86400000);
      Promise.all(list.map((st) => conn.fetchCalendarEvents(st.entity_id, start, end)
        .then((items) => [st.entity_id, items, null], (e) => [st.entity_id, [], e])))
        .then((res) => {
          if (app.conn !== conn) return;
          slot.raw = {};
          res.forEach(([id, items]) => { slot.raw[id] = items; });
          const failed = res.filter((r) => r[2]);
          slot.error = failed.length === res.length && failed.length ? 'Impossible de lire les calendriers (' + failed[0][2].message + ').' : null;
          slot.at = Date.now();
          slot.stamp = app.calStamp || 0;
          slot.loading = false;
          queueRender();
        });
    }
    return slot;
  }

  // Weather forecast, subscribed on first use; HA pushes updates. kind: 'main' (daily) or 'hourly'.
  function forecastFor(st, kind) {
    if (!app.conn || !app.conn.subscribeForecast) return null;
    app.forecasts = app.forecasts || {};
    const f = Number(st.attributes.supported_features) || 0;
    const type = kind === 'hourly' ? (f & 2 ? 'hourly' : null) : f & 1 ? 'daily' : f & 4 ? 'twice_daily' : f & 2 ? 'hourly' : null;
    if (!type) return null;
    const key = st.entity_id + ':' + type;
    if (!app.forecasts[key]) {
      const slot = app.forecasts[key] = { type, items: null };
      const conn = app.conn;
      conn.subscribeForecast(st.entity_id, type, (ev) => {
        if (app.conn !== conn || !ev) return;
        slot.items = ev.forecast || [];
        slot.type = ev.type || type;
        queueRender();
      }).catch(() => { slot.error = true; });
    }
    return app.forecasts[key];
  }

  function targetTemp(st) {
    const p = app.pendingTemp[st.entity_id];
    if (p) return p.value;
    const t = st.attributes.temperature;
    return t == null ? null : Number(t);
  }

  // ----- modals -----
  // ---------- background ----------
  const grad = (a, b, c) => `${c} radial-gradient(120% 90% at 15% 0%, ${a} 0%, ${b} 45%, ${c} 100%) no-repeat fixed`;
  const BG_PRESETS = [
    ['chaud', 'Chaud', '#3d3946 linear-gradient(160deg, #7d6553 0%, #5e5049 38%, #4a4351 72%, #3d3946 100%) no-repeat fixed'],
    ['nuit', 'Nuit', grad('#2F4A7A', '#1B2740', '#10141F')],
    ['ocean', 'Océan', grad('#2E7C8A', '#1A4A57', '#0E242C')],
    ['foret', 'Forêt', grad('#4F6B4A', '#2E4234', '#1A231D')],
    ['aurore', 'Aurore', grad('#8A5A8F', '#4E3866', '#241B33')],
    ['ardoise', 'Ardoise', grad('#5B6270', '#3A3F48', '#22252B')],
    ['noir', 'Noir', '#000000']
  ];
  // Mix a #rrggbb color with white (t > 0) or black (t < 0).
  function shade(hex, t) {
    const n = parseInt(hex.slice(1), 16), to = t > 0 ? 255 : 0, k = Math.abs(t);
    const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * k));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function bgCss(b) {
    b = b || {};
    if (b.image) {
      const dim = b.dim != null ? b.dim : 0.35;
      return `#000 linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${b.image.replace(/"/g, '%22')}") center / cover no-repeat fixed`;
    }
    if (b.color) return grad(shade(b.color, 0.25), b.color, shade(b.color, -0.55));
    const p = BG_PRESETS.find((x) => x[0] === b.preset);
    return p ? p[2] : '';
  }
  function applyBg() {
    const css = bgCss(L.data.bg);
    if (css) document.body.style.background = css; else document.body.style.removeProperty('background');
  }
  function setBg(b) { L.data.bg = b; L.save(); applyBg(); render(); }

  function bgModal() {
    const b = L.data.bg || {};
    const cur = b.image ? 'image' : b.color ? 'color' : b.preset || 'chaud';
    const body = `
      <div class="bg-grid">${BG_PRESETS.map(([id, name, css]) => `<button class="bg-swatch${cur === id ? ' is-on' : ''}" aria-pressed="${cur === id}" data-act="bg-preset" data-arg="${id}" data-key="bg:${id}">
        <span class="bg-prev" style="background: ${css.replace(' fixed', '')}"></span><span>${name}</span></button>`).join('')}
      </div>
      <div class="field-row"><span class="field-label">Couleur</span>
        <label class="btn-glass sm color-pick${cur === 'color' ? ' is-on' : ''}"><input type="color" value="${esc(b.color || '#5E4B3E')}" data-act="bg-color" data-key="bg-color"> Choisir une couleur</label></div>
      <div class="field-row"><span class="field-label">Photo</span>
        <label class="btn-glass sm">${icon(IC.upload, 16, 2)} ${b.image ? 'Changer la photo' : 'Choisir une photo'}<input type="file" accept="image/*" id="bg-file" hidden></label>
        ${b.image ? `<button class="btn-glass sm" data-act="bg-preset" data-arg="chaud" data-key="bg-noimg">Retirer</button>` : ''}</div>
      ${b.image ? `<div class="field-row"><span class="field-label">Assombrir</span><input type="range" class="dim-range" min="0" max="80" value="${Math.round((b.dim != null ? b.dim : 0.35) * 100)}" data-act="bg-dim" data-key="bg-dim" aria-label="Assombrir la photo"></div>` : ''}
      <p class="muted small">Le fond est enregistré avec votre disposition (le même sur tous vos écrans). La photo est réduite avant d'être enregistrée.</p>`;
    return modalFrame('Fond d\'écran', body, '<span class="grow"></span><button class="btn-solid" data-act="modal-close" data-key="modal-close">Terminé</button>');
  }

  // A picture becomes a JPEG of at most 1920 px, so it stays light to store and sync.
  function loadBgImage(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1920 / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        const b = L.data.bg || {};
        setBg({ image: cv.toDataURL('image/jpeg', 0.8), dim: b.dim != null ? b.dim : 0.35 });
      };
      img.onerror = () => showToast('Image illisible.');
      img.src = String(reader.result);
    };
    reader.onerror = () => showToast('Image illisible.');
    reader.readAsDataURL(file);
  }

  // Pictures from HA (cover art, library thumbnails) are relative to the server; Spotify's are absolute.
  function mediaUrl(u) {
    if (!u || /^(https?:|data:)/.test(u) || !app.conn || isDemo()) return u || '';
    return app.conn.baseUrl.replace(/\/$/, '') + u;
  }

  // Media library (Spotify: playlists, albums…): folders open, playable items start on the player.
  async function mediaBrowse(entity, item) {
    const md = app.modal = { kind: 'media', entity, stack: (app.modal && app.modal.kind === 'media' ? app.modal.stack : []), node: null, loading: true };
    render();
    try {
      const node = await app.conn.browseMedia(entity, item && item.media_content_id, item && item.media_content_type);
      if (app.modal !== md) return;
      md.node = node; md.loading = false;
      if (item) md.stack = md.stack.concat([item]);
    } catch (e) {
      if (app.modal !== md) return;
      md.loading = false; md.error = e.message;
    }
    render();
  }

  function mediaModal(md) {
    const st = app.states.get(md.entity);
    const node = md.node;
    const kids = node && Array.isArray(node.children) ? node.children : [];
    md.items = kids;
    let body;
    if (md.loading) body = '<p class="muted">Chargement…</p>';
    else if (md.error) body = `<p class="muted">Bibliothèque indisponible : ${esc(md.error)}</p>`;
    else if (!kids.length) body = '<p class="muted">Rien ici.</p>';
    else {
      body = `<div class="media-lib">${kids.map((c, i) => {
        const thumb = c.thumbnail ? `<img src="${esc(mediaUrl(c.thumbnail))}" alt="" loading="lazy">` : icon(c.can_expand && !c.can_play ? IC.list : IC.music, 26, 1.8);
        const act = c.can_play ? 'media-play' : c.can_expand ? 'media-open' : '';
        return `<button class="media-item hov" ${act ? `data-act="${act}" data-arg="${i}"` : 'disabled'} data-key="media-lib:${i}">
          <span class="media-thumb">${thumb}</span><span class="media-item-name">${esc(c.title)}</span></button>`;
      }).join('')}</div>`;
    }
    const where = st && st.attributes.source ? 'Lecture sur ' + st.attributes.source : '';
    const foot = `${md.stack.length ? `<button class="btn-glass" data-act="media-back" data-key="media-back">${icon(IC.left, 16, 2.2)} Retour</button>` : ''}
      <span class="muted small grow">${esc(where)}</span>
      <button class="btn-solid" data-act="modal-close" data-key="modal-close">Fermer</button>`;
    return modalFrame((node && md.stack.length ? node.title : null) || (st && HD.Modules.isSpotify(st) ? 'Spotify' : 'Bibliothèque'), body, foot);
  }

  function modalView() {
    const md = app.modal;
    let title, body, foot;
    if (md.kind === 'weather') return weatherModal(md.entity);
    if (md.kind === 'event') return eventModal(md.ev);
    if (md.kind === 'media') return mediaModal(md);
    if (md.kind === 'bg') return bgModal();
    if (md.kind === 'update') return updateModal(md);
    if (md.kind === 'update-all') return updateAllModal(md);
    if (md.kind === 'add') {
      const e = env(pageRoom());
      const scope = pageRoom() ? 'room' : 'all';
      title = 'Ajouter un module';
      // Header-only items (date, clock…) missing from the home header can be put back.
      const have = isHome() ? L.headerItems().map((x) => x.type) : [];
      const hMissing = isHome() ? Object.entries(T).filter(([type, t]) => t.headerOnly && !have.includes(type)) : [];
      const hSection = hMissing.length ? `<h3 class="field-h">Dans l'en-tête</h3><div class="type-grid">${hMissing.map(([type, t]) => `<button class="type-card hov" data-act="add-header" data-arg="${type}" data-key="addh:${type}">
          <span class="scene-ic">${icon(t.icon, 18, 1.9)}</span><span class="stack"><span class="type-name">${t.name}</span><span class="muted small">${esc(t.desc)}</span></span></button>`).join('')}</div><h3 class="field-h">Sur la page</h3>` : '';
      body = hSection + `<div class="type-grid">${Object.entries(T).filter(([, t]) => !t.headerOnly).map(([type, t]) => {
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
        `<button type="button" class="${value === v ? 'is-on' : ''}" aria-pressed="${value === v}" data-act="${act}" data-arg="${esc(v)}" data-key="${act}:${esc(v)}">${label}</button>`).join('')}</div>`;
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
      // Modules showing temperatures: color by temperature with editable thresholds (on by default).
      let tempColors = '';
      if (['temperature', 'rooms', 'climate', 'weather'].includes(d.type)) {
        const th = HD.Modules.tempThresholds(d.options);
        const Z = HD.Modules.ZONES;
        const on = HD.Modules.tempColorsOn(d.options);
        const num = (k, v) => `<input class="num" type="number" step="0.5" value="${v}" data-act="draft-opt" data-arg="${k}" data-key="opt:${k}" aria-label="Seuil ${k}">`;
        tempColors = `
        <div class="field-row"><span class="field-label">Couleur selon la température</span>
          <button type="button" class="switch${on ? ' is-on' : ''}" role="switch" aria-checked="${on}" data-act="draft-tempcolors" data-key="draft-tempcolors"><span></span></button></div>
        ${on ? `<div class="zones">
          <span class="zone"><i style="background: ${Z[0].color}"></i>${Z[0].name} &lt; ${num('tLo', th.lo)}°</span>
          <span class="zone"><i style="background: ${Z[1].color}"></i>${Z[1].name} jusqu'à ${num('tHi', th.hi)}°</span>
          <span class="zone"><i style="background: ${Z[2].color}"></i>${Z[2].name} jusqu'à ${num('tHot', th.hot)}°</span>
          <span class="zone"><i style="background: ${Z[3].color}"></i>${Z[3].name} au-delà</span>
        </div>` : ''}`;
      }
      if (md.only === 'colors') {
        // Shortcut from the 🎨 button: only the color settings.
        title = 'Couleurs · ' + (d.title || t.name);
        body = `${colors}${tempColors}<p class="muted small">La couleur s'applique aux icônes, barres, cadrans et tuiles allumées de ce module.${tempColors ? ' Les zones colorent les températures affichées (valeur et barre).' : ''}</p>`;
        foot = `<span class="grow"></span>
          <button class="btn-glass" data-act="modal-close" data-key="modal-close">Annuler</button>
          <button class="btn-solid" data-act="modal-save" data-key="modal-save">Enregistrer</button>`;
        return modalFrame(title, body, foot);
      }
      // Item of the home header: its look (color, size, font, date / clock format).
      let hStyle = '';
      if (md.inHeader) {
        const o = d.options;
        const hc = o.hColor || '';
        const now = new Date();
        hStyle = `<h3 class="field-h">Dans l'en-tête</h3>
        <div class="field-row"><span class="field-label">Couleur</span>
          <div class="row wrap swatches">
            <button type="button" class="tone tone-default${!hc ? ' is-on' : ''}" aria-pressed="${!hc}" aria-label="Couleur par défaut" title="Par défaut" data-act="draft-hcolor" data-arg="" data-key="hc:"><span style="background: #fff"></span></button>
            ${['#FFFFFF', '#F5F0E6'].concat(HD.Modules.ACCENTS).filter((c, i, a) => a.indexOf(c) === i).slice(1).map((c) => `<button type="button" class="tone${hc === c ? ' is-on' : ''}" aria-pressed="${hc === c}" aria-label="Couleur ${c}" data-act="draft-hcolor" data-arg="${c}" data-key="hc:${c}"><span style="background: ${c}"></span></button>`).join('')}
            <label class="tone tone-custom" title="Autre couleur"><input type="color" value="${esc(hc || '#ffffff')}" data-act="draft-hcolor-pick" data-key="hc-pick" aria-label="Autre couleur"><span>+</span></label>
          </div></div>
        <div class="field-row"><span class="field-label">Taille</span>${seg('draft-hsize', o.hSize || '', H_SIZES.map(([v, l]) => [v, l]))}</div>
        <div class="field-row field-top"><span class="field-label">Police</span><div class="font-grid">${H_FONT_LIST.map(([v, l, css, wt]) => {
          const on = hFontOf(o.hFont)[0] === v;
          const sample = d.type === 'h-clock' ? fmtClock(now, '') : d.type === 'h-date' ? fmtDate(now, 'short') : 'Aa 21°';
          return `<button type="button" class="font-opt${on ? ' is-on' : ''}" aria-pressed="${on}" data-act="draft-hfont" data-arg="${v}" data-key="hf:${v}"><span class="font-sample" style="${css ? 'font-family: ' + css + ';' : ''}${wt ? ' font-weight: ' + wt : ''}">${esc(sample)}</span><span class="font-name">${l}</span></button>`;
        }).join('')}</div></div>
        ${d.type === 'h-date' ? `<div class="field-row"><span class="field-label">Format</span>${seg('draft-hfmt', o.fmt || 'long', DATE_FMTS.map((f) => [f, esc(fmtDate(now, f))]))}</div>` : ''}
        ${d.type === 'h-clock' ? `<div class="field-row"><span class="field-label">Format</span>${seg('draft-hfmt', o.fmt || '', [['', esc(fmtClock(now, ''))], ['s', esc(fmtClock(now, 's'))]])}</div>` : ''}
        ${t.headerOnly ? '' : '<p class="muted small">Glissé sur la page, il redevient un module complet avec les réglages ci-dessous.</p>'}`;
      }
      if (md.inHeader && t.headerOnly) {
        body = hStyle;
        foot = `<button class="btn-glass danger" data-act="mod-del" data-arg="${esc(d.id)}" data-key="modal-del">${icon(IC.x, 16, 2)} Retirer</button>
          <span class="grow"></span>
          <button class="btn-glass" data-act="modal-close" data-key="modal-close">Annuler</button>
          <button class="btn-solid" data-act="modal-save" data-key="modal-save">Enregistrer</button>`;
        return modalFrame(title, body, foot);
      }
      body = `${hStyle}
        <label class="field"><span>Titre</span><input type="text" value="${esc(d.title)}" placeholder="${esc(t.name)}" data-act="draft-title" data-key="draft-title"></label>
        ${room && !t.noEntities ? `<div class="field-row"><span class="field-label">Portée</span>${seg('draft-scope', d.scope, [['room', 'Cette pièce'], ['all', 'Toute la maison']])}</div>` : ''}
        <div class="field-row"><span class="field-label">Largeur</span>${seg('draft-w', String(d.w), [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']])}</div>
        <div class="field-row"><span class="field-label">Hauteur</span>${seg('draft-h', String(d.h), [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']])}</div>
        ${t.options ? `<div class="field-row"><span class="field-label">Affichage</span>${seg('draft-group', d.options.group || (d.scope === 'all' ? 'room' : 'sensor'), [['sensor', 'Par capteur'], ['room', 'Moyenne par pièce']])}</div>` : ''}
        ${d.type === 'transit' ? (() => {
          const st = L.resolve(d, env(room))[0];
          const dirs = st ? HD.Modules.transitDirections(st) : [];
          return `<div class="field-row"><span class="field-label">Direction</span>${seg('draft-dir', d.options.direction || '', [['', 'Toutes']].concat(dirs.map((x) => [x, esc(x)])))}</div>
            <p class="muted small">« Toutes » : en largeur 2 ou plus, une colonne par direction.</p>`;
        })() : ''}
        ${d.type === 'home-rooms' ? (() => {
          const pick = Array.isArray(d.options.rooms) ? d.options.rooms : null;
          return `<h3 class="field-h">Pièces affichées</h3>
          <div class="room-picks">${visibleRooms().map((r) => {
            const on = !pick || pick.includes(r.id);
            return `<button type="button" class="pick-chip${on ? ' is-on' : ''}" aria-pressed="${on}" data-act="draft-room" data-arg="${esc(r.id)}" data-key="rp:${esc(r.id)}">${on ? icon(IC.check, 14, 2.4) : ''}${esc(r.name)}</button>`;
          }).join('')}${pick ? '<button type="button" class="link-btn" data-act="draft-rooms-all" data-key="rp-all">Toutes</button>' : ''}</div>
          <p class="muted small">L'ordre suit celui des Réglages › Pièces. Les nouvelles pièces s'ajoutent seules tant que « toutes » sont cochées.</p>`;
        })() : ''}
        ${d.type === 'calendar' || d.type === 'home-agenda' ? `<div class="field-row"><span class="field-label">Infos trafic</span>${seg('draft-traffic', d.options.traffic ? 'on' : '', [['', 'Masquées'], ['on', 'Affichées']])}</div>
          <p class="muted small">Les événements « RER D : … », « Ligne D : … » de vos calendriers s'affichent dans le module Départs train / RER.</p>
          <div class="field-row"><span class="field-label">Affichage</span>${seg('draft-view', d.options.view || 'list', HD.Modules.CAL_VIEWS)}</div>
          <p class="muted small">Compact : une ligne par événement (heure + titre). Liste : horaires et lieu. Détaillé : en plus le calendrier et le début de la description. Semaine : une colonne par jour (largeur 2 ou plus, 7 jours au maximum).</p>
          <div class="field-row"><span class="field-label">Période</span>${seg('draft-days', String(d.options.days || 7), [['1', "Aujourd'hui"], ['3', '3 j'], ['7', '7 j'], ['14', '14 j'], ['30', '30 j']])}</div>` : ''}
        ${colors}
        ${tempColors}
        ${picker}`;
      foot = `<button class="btn-glass danger" data-act="mod-del" data-arg="${esc(d.id)}" data-key="modal-del">${icon(IC.trash, 16, 2)} Supprimer</button>
        <span class="grow"></span>
        <button class="btn-glass" data-act="modal-close" data-key="modal-close">Annuler</button>
        <button class="btn-solid" data-act="modal-save" data-key="modal-save">Enregistrer</button>`;
    }
    return modalFrame(title, body, foot);
  }

  // Detailed weather: current details, next 24 hours, the week.
  function weatherModal(id) {
    const close = `<span class="grow"></span><button class="btn-solid" data-act="modal-close" data-key="modal-close">Fermer</button>`;
    const st = app.states.get(id);
    if (!st) return modalFrame('Météo', '<p class="muted">Entité météo introuvable.</p>', close);
    const W = HD.Modules;
    const a = st.attributes;
    const unit = a.temperature_unit || '°C';
    const main = forecastFor(st, 'main');
    const days = W.dailyItems(main);
    const hourlyFc = forecastFor(st, 'hourly');
    const hourly = hourlyFc && hourlyFc.items ? hourlyFc.items.slice(0, 24) : (main && main.type === 'hourly' && main.items ? main.items.slice(0, 24) : []);
    const dir = (b) => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(Number(b) / 45) % 8];
    const facts = [
      ['Ressenti', a.apparent_temperature != null && M.fmtNum(a.apparent_temperature, 0) + '°'],
      ['Humidité', a.humidity != null && M.fmtNum(a.humidity, 0) + ' %'],
      ['Vent', a.wind_speed != null && M.fmtNum(a.wind_speed, 0) + ' ' + (a.wind_speed_unit || 'km/h') + (a.wind_bearing != null ? ' ' + dir(a.wind_bearing) : '')],
      ['Rafales', a.wind_gust_speed != null && M.fmtNum(a.wind_gust_speed, 0) + ' ' + (a.wind_speed_unit || 'km/h')],
      ['Pression', a.pressure != null && M.fmtNum(a.pressure, 0) + ' ' + (a.pressure_unit || 'hPa')],
      ['Point de rosée', a.dew_point != null && M.fmtNum(a.dew_point, 0) + '°'],
      ['Indice UV', a.uv_index != null && M.fmtNum(a.uv_index, 0)],
      ['Visibilité', a.visibility != null && M.fmtNum(a.visibility, 0) + ' ' + (a.visibility_unit || 'km')],
      ['Nuages', a.cloud_coverage != null && M.fmtNum(a.cloud_coverage, 0) + ' %']
    ].filter((f) => f[1]);
    const zNow = W.tempZone(Number(a.temperature), {});
    let body = `
      <div class="wx-now">
        <span class="weather-ic lg">${icon(W.wxIcon(st.state), 40, 1.5)}</span>
        <span class="stack"><span class="dial-temp"${zNow ? ` style="color: ${zNow.color}"` : ''}>${esc(M.fmtNum(a.temperature, 0))}<small>${esc(unit)}</small></span>
        <span class="muted">${esc(M.WEATHER[st.state] || st.state)}${days[0] && days[0].templow != null ? ' · ' + esc(M.fmtNum(days[0].templow, 0)) + '° / ' + esc(M.fmtNum(days[0].temperature, 0)) + '°' : ''}</span></span>
      </div>
      ${facts.length ? `<div class="wx-facts">${facts.map(([k, v]) => `<span class="wx-fact"><span class="muted small">${k}</span><span>${esc(v)}</span></span>`).join('')}</div>` : ''}`;
    if (hourly.length) {
      body += `<h3 class="wx-h">Prochaines heures</h3>
      <div class="wx-hours" data-scroll="wx-hours">${hourly.map((h) => {
        const d = new Date(h.datetime);
        return `<span class="wx-hour"><span class="muted small">${d.getHours()} h</span>${icon(W.wxIcon(h.condition), 22, 1.7)}
          <span class="fc-hi">${esc(M.fmtNum(h.temperature, 0))}°</span>
          <span class="wx-rain">${h.precipitation_probability ? esc(M.fmtNum(h.precipitation_probability, 0)) + ' %' : ''}</span></span>`;
      }).join('')}</div>`;
    }
    if (days.length) {
      const lo = Math.min(...days.map((f) => (f.templow != null ? f.templow : f.temperature)));
      const hi = Math.max(...days.map((f) => f.temperature));
      const span = hi - lo || 1;
      body += `<h3 class="wx-h">${days.length} jours</h3><ul class="wx-days">${days.map((f, i) => {
        const low = f.templow != null ? f.templow : f.temperature;
        const zl = W.tempZone(low, {}) || { color: 'var(--accent)' };
        const zh = W.tempZone(f.temperature, {}) || { color: 'var(--accent)' };
        return `<li class="wx-day">
          <span class="fc-name">${esc(W.dayLabel(f.datetime, i))}</span>
          <span class="wx-day-ic">${icon(W.wxIcon(f.condition), 22, 1.7)}<span class="wx-rain">${f.precipitation_probability ? esc(M.fmtNum(f.precipitation_probability, 0)) + ' %' : ''}</span></span>
          <span class="muted wx-lo">${esc(M.fmtNum(low, 0))}°</span>
          <span class="wx-range"><span style="left: ${((low - lo) / span) * 100}%; width: ${Math.max(6, ((f.temperature - low) / span) * 100)}%; background: linear-gradient(90deg, ${zl.color}, ${zh.color})"></span></span>
          <span class="fc-hi">${esc(M.fmtNum(f.temperature, 0))}°</span>
        </li>`;
      }).join('')}</ul>`;
    } else if (main && !main.items && !main.error) {
      body += '<p class="muted">Chargement des prévisions…</p>';
    } else {
      body += '<p class="muted">Cette entité météo ne fournit pas de prévisions.</p>';
    }
    return modalFrame(M.shortName(st) + ' · Météo', body, close);
  }

  function eventModal(ev) {
    const close = `<span class="grow"></span><button class="btn-solid" data-act="modal-close" data-key="modal-close">Fermer</button>`;
    // Google descriptions may contain HTML: keep the text and the line breaks only.
    const desc = String(ev.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    const body = `
      <div class="ev-cal"><i style="background: ${ev.color}"></i>${esc(ev.calName)}</div>
      <div class="ev-when"><span class="tile-name">${esc(HD.Modules.dayTitle(ev.start))}</span><span class="muted">${esc(HD.Modules.whenLabel(ev))}</span></div>
      ${ev.location ? `<div class="ev-line">${icon(IC.home, 16, 2)}<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}" target="_blank" rel="noopener">${esc(ev.location)}</a></div>` : ''}
      ${desc ? `<p class="ev-desc">${esc(desc)}</p>` : ''}`;
    return modalFrame(ev.title, body, close);
  }

  function modalFrame(title, body, foot) {
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
    <div class="card list-item">
      <span class="stack grow"><span>Écran d'accueil tablette</span><span class="muted small">Météo, pièces, scènes, agenda et notes sur le premier écran de l'Accueil ; vos modules se placent en dessous. Désactivé : l'Accueil redevient une grille de modules.</span></span>
      <button class="switch${heroOn() ? ' is-on' : ''}" role="switch" aria-checked="${heroOn()}" aria-label="Écran d'accueil tablette" data-act="hero-toggle" data-key="hero-toggle"><span></span></button>
    </div>
    <div class="row wrap">
      <button class="btn-glass" data-act="export" data-key="export">${icon(IC.download, 16, 2)} Exporter</button>
      <button class="btn-glass" data-act="import" data-key="import">${icon(IC.upload, 16, 2)} Importer</button>
      <button class="btn-glass danger" data-act="reset-all" data-key="reset-all">${icon(IC.refresh, 16, 2)} Tout réinitialiser</button>
      <input type="file" accept="application/json,.json" id="import-file" hidden>
    </div>
  </section>

  <section class="list-section">
    <h2>Cet appareil</h2>
    <p class="muted small">${esc((() => {
      const ua = navigator.userAgent;
      const b = ua.match(/(SamsungBrowser|Firefox|Edg|Chrome)\/(\d+)/);
      const os = ua.match(/Android [\d.]+|Windows NT [\d.]+|iPhone OS [\d_]+|Mac OS X [\d_]+/);
      return 'Version ' + (window.HD_VERSION || '?') + ' · Navigateur : ' + (b ? b[1].replace('Edg', 'Edge') + ' ' + b[2] : 'inconnu') + (os ? ' · ' + os[0].replace(/_/g, '.') : '') + ' · écran ' + innerWidth + '×' + innerHeight;
    })())}</p>
    <div class="card list-item">
      <span class="stack grow"><span>Plein écran automatique</span><span class="muted small">${fsSupported() ? 'Le premier toucher passe la page en plein écran, et y revient si on en sort. Réglage propre à cet appareil.' : 'Ce navigateur ne permet pas le plein écran.'}</span></span>
      <button class="switch${store.get('hd.autofs', false) ? ' is-on' : ''}" role="switch" aria-checked="${!!store.get('hd.autofs', false)}" aria-label="Plein écran automatique" data-act="autofs" data-key="autofs" ${fsSupported() ? '' : 'disabled'}><span></span></button>
    </div>
  </section>

  <section class="list-section">
    <h2>Fond d'écran</h2>
    <div class="card list-item">
      <span class="bg-prev sm" style="background: ${(bgCss(L.data.bg) || BG_PRESETS[0][2]).replace(' fixed', '')}"></span>
      <span class="stack grow"><span>Couleur ou photo derrière le tableau de bord</span><span class="muted small">Aussi accessible avec le crayon › Fond.</span></span>
      <button class="btn-glass sm" data-act="bg-open" data-key="bg-open">Changer</button>
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
    const m = L.modules(pageKey(), e).find((x) => x.id === host.dataset.mod) || (isHome() && headerFind(host.dataset.mod));
    return m ? { m, list: L.resolve(m, m.zone ? env(null) : e) } : null;
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

  function openConfig(id, only) {
    const inHeader = isHome() && !!headerFind(id);
    const m = inHeader ? headerFind(id) : L.modules(pageKey(), env(pageRoom())).find((x) => x.id === id);
    if (!m) return;
    app.modal = { kind: 'config', id, inHeader, only: only || null, draft: JSON.parse(JSON.stringify(m)), search: '', names: { ...L.data.names } };
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
    'add-header'(type) {
      const zone = type === 'h-date' ? 'left' : type === 'h-clock' ? 'center' : 'right';
      L.headerItems().push({ ...L.newModule(type, 'all'), zone });
      app.modal = null; L.save(); render();
    },
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
    'mod-config'(arg, el) { openConfig(el.closest('[data-mod]').dataset.mod); },
    'mod-del'(arg, el) {
      const id = arg || el.closest('[data-mod]').dataset.mod;
      app.modal = null;
      if (isHome() && headerFind(id)) {
        L.data.header.items = L.data.header.items.filter((x) => x.id !== id);
        L.save(); render();
        return;
      }
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
    'draft-tempcolors'() { const o = app.modal.draft.options; o.tempColors = !HD.Modules.tempColorsOn(o); render(); },
    'mod-colors'(arg, el) { openConfig(el.closest('[data-mod]').dataset.mod, 'colors'); },
    'weather-open'(arg) { app.modal = { kind: 'weather', entity: arg }; render(); },
    'event-open'(arg) {
      const [mod, idx] = arg.split('|');
      const ev = app.calEvents && app.calEvents[mod] && app.calEvents[mod][Number(idx)];
      if (ev) { app.modal = { kind: 'event', ev }; render(); }
    },
    'media-cmd'(arg, el) {
      const x = moduleOf(el);
      const st = x && x.list[0];
      if (!st) return;
      const id = st.entity_id;
      if (arg === 'play_pause') call('media_player', 'media_play_pause', id);
      else if (arg === 'prev') call('media_player', 'media_previous_track', id);
      else if (arg === 'next') call('media_player', 'media_next_track', id);
      else if (arg === 'shuffle') call('media_player', 'shuffle_set', id, { shuffle: !st.attributes.shuffle });
      else if (arg === 'repeat') {
        const order = ['off', 'all', 'one'];
        call('media_player', 'repeat_set', id, { repeat: order[(order.indexOf(st.attributes.repeat || 'off') + 1) % 3] });
      }
    },
    'media-browse'(arg) { app.modal = null; mediaBrowse(arg, null); },
    'media-open'(arg) { const md = app.modal; if (md && md.items) mediaBrowse(md.entity, md.items[Number(arg)]); },
    'media-back'() {
      const md = app.modal;
      if (!md || !md.stack.length) return;
      const stack = md.stack.slice(0, -1);
      const parent = stack[stack.length - 1] || null;
      md.stack = stack.slice(0, -1);
      mediaBrowse(md.entity, parent);
    },
    'media-play'(arg) {
      const md = app.modal;
      const c = md && md.items && md.items[Number(arg)];
      if (!c) return;
      call('media_player', 'play_media', md.entity, { media_content_id: c.media_content_id, media_content_type: c.media_content_type });
      app.modal = null;
      showToast('Lecture : ' + c.title);
      render();
    },
    'bg-open'() { app.modal = { kind: 'bg' }; render(); },
    'bg-preset'(arg) { setBg({ preset: arg }); },
    'draft-hcolor'(arg) { if (arg) app.modal.draft.options.hColor = arg; else delete app.modal.draft.options.hColor; render(); },
    'draft-hsize'(arg) { if (arg) app.modal.draft.options.hSize = arg; else delete app.modal.draft.options.hSize; render(); },
    'draft-hfont'(arg) { if (arg) app.modal.draft.options.hFont = arg; else delete app.modal.draft.options.hFont; render(); },
    'draft-hfmt'(arg) { if (arg) app.modal.draft.options.fmt = arg; else delete app.modal.draft.options.fmt; render(); },
    'draft-view'(arg) { app.modal.draft.options.view = arg; render(); },
    'draft-traffic'(arg) { if (arg) app.modal.draft.options.traffic = true; else delete app.modal.draft.options.traffic; render(); },
    'draft-days'(arg) { app.modal.draft.options.days = Number(arg); render(); },
    'draft-dir'(arg) {
      if (arg) app.modal.draft.options.direction = arg;
      else delete app.modal.draft.options.direction;
      render();
    },
    'modal-save'() {
      const d = app.modal.draft;
      // Labels are shared by all modules: store them next to the layout.
      const names = {};
      for (const [k, v] of Object.entries(app.modal.names)) if (v && v.trim()) names[k] = v.trim();
      L.data.names = names;
      const inHeader = app.modal.inHeader;
      app.modal = null;
      if (inHeader) {
        const items = L.headerItems();
        const i = moduleIndex(items, d.id);
        if (i >= 0) items[i] = d;
        L.save(); render();
        return;
      }
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
    accent(arg) { L.data.accent = arg; L.data.accentSet = true; L.save(); render(); },
    'hero-toggle'() { L.data.hero = !heroOn(); L.save(); render(); },
    // Home screen
    'room-off'(id) {
      const room = app.index.byId.get(id);
      const ids = room ? room.ids.filter((x) => M.domainOf(x) === 'light' && (app.states.get(x) || {}).state === 'on') : [];
      if (ids.length) call('light', 'turn_off', ids);
    },
    'room-toggle'(id) {
      const room = app.index.byId.get(id);
      const lights = room ? room.ids.filter((x) => M.domainOf(x) === 'light' && !M.UNAVAILABLE.includes((app.states.get(x) || {}).state)) : [];
      const on = lights.filter((x) => app.states.get(x).state === 'on');
      if (on.length) call('light', 'turn_off', on);
      else if (lights.length) call('light', 'turn_on', lights);
    },
    'draft-room'(id) {
      const o = app.modal.draft.options;
      const all = visibleRooms().map((r) => r.id);
      const cur = Array.isArray(o.rooms) ? o.rooms.filter((x) => all.includes(x)) : all.slice();
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : cur.concat(id);
      if (next.length === all.length) delete o.rooms; else o.rooms = next;
      render();
    },
    'draft-rooms-all'() { delete app.modal.draft.options.rooms; render(); },
    'update-all-open'() { app.modal = { kind: 'update-all' }; render(); },
    'update-all'() {
      const list = updateOrder(pendingUpdates());
      if (!list.length) return;
      const backup = !(app.modal && app.modal.backup === false);
      // Backup once, before Home Assistant itself (the one that matters to roll back).
      const core = list.find((u) => /core/.test(u.id) && u.backup) || list.find((u) => u.backup);
      app.updQueue = { list: list.map((u) => ({ id: u.id, name: u.name, backup: backup && core === u })), current: null, done: -1, total: list.length };
      app.modal = null;
      pumpUpdates();
      render();
    },
    'update-open'(id) { app.modal = { kind: 'update', entity: id }; render(); },
    'upd-backup'(arg) { if (app.modal) { app.modal.backup = arg === 'on'; render(); } },
    'update-install'(id) {
      const st = app.states.get(id);
      const u = st && HD.Modules.updateInfo(st);
      if (!u) return;
      call('update', 'install', id, u.backup && app.modal && app.modal.backup !== false ? { backup: true } : {});
      app.modal = null;
      showToast('Installation de ' + u.name + ' ' + u.latest + ' lancée.');
    },
    'update-skip'(id) {
      const st = app.states.get(id);
      if (!st || !confirm('Ignorer la version ' + (st.attributes.latest_version || '') + ' ? Elle ne sera plus proposée.')) return;
      call('update', 'skip', id);
      app.modal = null;
      render();
    },
    'pve-press'(id, el) {
      const label = (el && el.dataset.label) || 'Confirmer';
      if (!confirm(label + ' ?')) return;
      call('button', 'press', id);
      showToast(label + ' : demandé à Proxmox.');
    },
    'conn-retry'() { if (app.conn && app.conn.retryNow) app.conn.retryNow(); else location.reload(); },
    'all-off'() { call('light', 'turn_off', 'all'); },
    'memo-clear'() { const items = memoItems(); rememberBought(items.filter((it) => it.done).map((it) => it.text)); saveMemo(items.filter((it) => !it.done)); render(); },
    'memo-add'(text) { if (text) saveMemo(memoItems().concat({ done: false, text })); render(); },
    'memo-add-open'() { app.memoAdding = true; render(true); const i = document.getElementById('memo-input'); if (i) i.focus(); },
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
    if (e.target.id === 'memo-form') {
      e.preventDefault();
      const text = String(app.memoDraft || '').trim();
      if (!text) return;
      saveMemo(memoItems().concat({ done: false, text }));
      app.memoDraft = '';
      const input = document.getElementById('memo-input');
      if (input) input.value = '';
      app.renderAfterNote = false;
      render(true);
      const again = document.getElementById('memo-input');
      if (again) again.focus(); // keep the keyboard open to add the next one
      return;
    }
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
    } else if (act === 'media-vol') {
      app.dragging = true;
      e.target.style.setProperty('--v', e.target.value + '%');
    } else if (act === 'memo-draft') {
      app.memoDraft = e.target.value;
    } else if (act === 'note') {
      // Save the note into the page layout (synced with the HA account), debounced.
      const id = e.target.closest('[data-mod]').dataset.mod;
      const mods = L.materialize(pageKey(), env(pageRoom()));
      const m = mods.find((x) => x.id === id);
      if (m) {
        m.options.text = e.target.value.slice(0, 20000);
        m.options.updated = Date.now();
        clearTimeout(app.noteTimer);
        app.noteTimer = setTimeout(() => L.save(), 700);
      }
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
    } else if (act === 'media-vol') {
      app.dragging = false;
      const x = moduleOf(t);
      if (x && x.list[0]) call('media_player', 'volume_set', x.list[0].entity_id, { volume_level: Number(t.value) / 100 });
      if (app.renderAfterDrag) { app.renderAfterDrag = false; queueRender(); }
    } else if (act === 'media-source') {
      const x = moduleOf(t);
      if (x && x.list[0] && t.value) call('media_player', 'select_source', x.list[0].entity_id, { source: t.value });
    } else if (act === 'memo-check') {
      const items = memoItems();
      const it = items[Number(t.dataset.arg)];
      if (it) { it.done = t.checked; saveMemo(items); }
      render();
    } else if (act === 'pick') {
      const d = app.modal.draft;
      let ids = Array.isArray(d.entities) ? d.entities.slice() : [];
      if (t.checked) ids = t.dataset.single ? [t.value] : ids.concat(t.value);
      else ids = ids.filter((x) => x !== t.value);
      d.entities = ids;
      render();
    } else if (act === 'outdoor') {
      L.data.outdoor = t.value; L.save(); render();
    } else if (act === 'draft-hcolor-pick') {
      app.modal.draft.options.hColor = t.value; render();
    } else if (act === 'bg-color') {
      setBg({ color: t.value });
    } else if (act === 'bg-dim') {
      setBg({ ...(L.data.bg || {}), dim: Number(t.value) / 100 });
    } else if (t.id === 'bg-file' && t.files[0]) {
      loadBgImage(t.files[0]);
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

  // ---------- edit mode: move and resize with mouse or finger ----------
  // Move: drag a card (mouse: right away; finger: hold ~0.3 s first so the page still scrolls)
  // and drop it on another card to swap them. Resize: stretch the right edge, bottom edge or
  // corner; the size snaps to the grid live and the other cards reflow around it.
  let gesture = null;   // current move / resize
  let pending = null;   // pointer down on a card, not yet a move
  let swallowClick = false;

  function gridMetrics(grid) {
    const cs = getComputedStyle(grid);
    const colGap = parseFloat(cs.columnGap) || 0;
    const rowGap = parseFloat(cs.rowGap) || 0;
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 1;
    const inner = grid.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const stacked = cols === 1;
    return {
      stacked, colGap, rowGap: stacked ? 0 : rowGap,
      col: (inner - (cols - 1) * colGap) / cols,
      row: stacked ? 88 : parseFloat(cs.gridAutoRows) || 104 // stacked: min-height = h × 88 px
    };
  }
  const clampSize = (v) => Math.max(1, Math.min(4, v));
  function pageModule(id) { return L.modules(pageKey(), env(pageRoom())).find((x) => x.id === id); }

  // Apply a size to the card without re-rendering (live preview while stretching).
  function previewSize(host, w, h) {
    host.style.gridColumn = 'span ' + w;
    host.style.gridRow = 'span ' + h;
    host.style.setProperty('--h', h);
    host.className = host.className.replace(/\bw\d\b/, 'w' + w).replace(/\bh\d\b/, 'h' + h);
    const label = host.querySelector('[data-size]');
    if (label) label.textContent = w + '×' + h;
  }

  function startResize(e, handle) {
    const host = handle.closest('[data-mod]');
    const m = host && pageModule(host.dataset.mod);
    if (!m) return;
    e.preventDefault();
    const g = gridMetrics(host.parentElement);
    const ghost = document.createElement('div');
    ghost.className = 'rz-ghost';
    document.body.appendChild(ghost);
    gesture = { kind: 'resize', dir: handle.dataset.rz, host, id: m.id, w0: m.w, h0: m.h, w: m.w, h: m.h, x0: e.clientX, y0: e.clientY, g, ghost, pid: e.pointerId };
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    app.dragging = true;
    host.classList.add('is-resizing');
    document.body.classList.add('is-gesture', 'gesture-' + gesture.dir);
    moveResize(e);
  }

  function moveResize(e) {
    const r = gesture, g = r.g;
    const dx = e.clientX - r.x0, dy = e.clientY - r.y0;
    // Raw size under the pointer, from the module's grid size (not its box, which may grow with content).
    const baseW = r.w0 * (g.col + g.colGap) - g.colGap;
    const baseH = r.h0 * (g.row + g.rowGap) - g.rowGap;
    const rawW = r.dir !== 's' && !g.stacked ? Math.max(g.col * 0.6, baseW + dx) : baseW;
    const rawH = r.dir !== 'e' ? Math.max(g.row * 0.6, baseH + dy) : baseH;
    const w = g.stacked ? r.w0 : clampSize(Math.round((rawW + g.colGap) / (g.col + g.colGap)));
    const h = clampSize(Math.round((rawH + g.rowGap) / (g.row + g.rowGap)));
    if (w !== r.w || h !== r.h) { r.w = w; r.h = h; previewSize(r.host, w, h); }
    // The ghost frame follows the pointer exactly; the card itself snaps to the grid.
    const rect = r.host.getBoundingClientRect();
    Object.assign(r.ghost.style, { left: rect.left + 'px', top: rect.top + 'px', width: (g.stacked ? rect.width : rawW) + 'px', height: rawH + 'px' });
  }

  function scroller(host) {
    const s = host.closest('[data-scroll]');
    return s && s.scrollHeight > s.clientHeight + 2 ? s : null;
  }

  function startMove(p) {
    const host = p.host;
    pending = null;
    if (!host.isConnected) return; // redrawn meanwhile
    const sc = scroller(host);
    const fromHeader = !!host.dataset.hitem;
    const hm = fromHeader ? headerFind(host.dataset.hitem) : null;
    gesture = { kind: 'move', host, id: host.dataset.mod, x0: p.x0, y0: p.y0, x: p.x, y: p.y, sc, st0: sc ? sc.scrollTop : window.scrollY, drop: null, pid: p.pid,
      fromHeader, headerOnly: !!(hm && T[hm.type] && T[hm.type].headerOnly) };
    app.dragging = true;
    host.classList.add('is-moving');
    document.body.classList.add('is-gesture');
    if (p.touch && navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* not allowed */ } }
    // Scroll the page / list while the card is held near its top or bottom edge.
    gesture.timer = setInterval(autoScroll, 16);
    updateMove();
  }

  function autoScroll() {
    const g = gesture;
    if (!g || g.kind !== 'move') return;
    const box = g.sc ? g.sc.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const edge = 60;
    let step = 0;
    if (g.y < box.top + edge) step = -Math.ceil((box.top + edge - g.y) / 5);
    else if (g.y > box.bottom - edge) step = Math.ceil((g.y - box.bottom + edge) / 5);
    if (!step) return;
    if (g.sc) g.sc.scrollTop += step; else window.scrollBy(0, step);
    updateMove();
  }

  function updateMove() {
    const g = gesture;
    const scrolled = (g.sc ? g.sc.scrollTop : window.scrollY) - g.st0;
    g.host.style.transform = `translate(${g.x - g.x0}px, ${g.y - g.y0 + scrolled}px)`;
    // Where it would land: a header item (before / after it), the end of a header zone,
    // a page module (swap, or insert when coming from the header) or the end of the page.
    const under = document.elementFromPoint(g.x, g.y);
    let drop = null;
    if (under) {
      const hi = under.closest('[data-hitem]');
      const hz = under.closest('[data-hzone]');
      const pm = under.closest('.mods [data-mod]');
      const grid = under.closest('.mods');
      if (hi && hi !== g.host) {
        const r = hi.getBoundingClientRect();
        drop = { kind: 'head-item', el: hi, zone: hi.closest('[data-hzone]').dataset.hzone, before: g.x < r.left + r.width / 2 };
      } else if (hz) drop = { kind: 'head-zone', el: hz, zone: hz.dataset.hzone };
      else if (pm && pm !== g.host) drop = { kind: 'page-mod', el: pm };
      else if (grid && g.fromHeader) drop = { kind: 'page-end', el: grid };
    }
    if (drop && drop.kind.startsWith('page') && g.headerOnly) drop = null; // date, clock… stay in the header
    const same = (a, b) => (a && b ? a.el === b.el && a.before === b.before : a === b);
    if (!same(drop, g.drop)) {
      if (g.drop) g.drop.el.classList.remove('is-drop-target', 'drop-before', 'drop-after');
      if (drop) drop.el.classList.add('is-drop-target', ...(drop.kind === 'head-item' ? [drop.before ? 'drop-before' : 'drop-after'] : []));
      g.drop = drop;
    }
  }

  // Apply a move: page ↔ page swaps; anything else takes the module out and puts it at the new place.
  function applyDrop(g) {
    const d = g.drop;
    const pageMods = L.materialize(pageKey(), env(pageRoom()));
    const items = isHome() ? L.headerItems() : [];
    if (!g.fromHeader && d.kind === 'page-mod') {
      const i = moduleIndex(pageMods, g.id), j = moduleIndex(pageMods, d.el.dataset.mod);
      if (i >= 0 && j >= 0) [pageMods[i], pageMods[j]] = [pageMods[j], pageMods[i]];
      L.save(); render();
      return;
    }
    const from = g.fromHeader ? items : pageMods;
    const i = moduleIndex(from, g.id);
    if (i < 0) { render(); return; }
    const m = from.splice(i, 1)[0];
    if (d.kind === 'head-item' || d.kind === 'head-zone') {
      m.zone = d.zone;
      let at;
      if (d.kind === 'head-item') { const j = moduleIndex(items, d.el.dataset.hitem); at = j < 0 ? items.length : d.before ? j : j + 1; }
      else { let last = -1; items.forEach((x, k) => { if (x.zone === d.zone) last = k; }); at = last >= 0 ? last + 1 : items.length; }
      items.splice(at, 0, m);
      if (!g.fromHeader) showToast((T[m.type] ? T[m.type].name : 'Module') + " est maintenant dans l'en-tête.");
    } else {
      delete m.zone;
      const j = d.kind === 'page-mod' ? moduleIndex(pageMods, d.el.dataset.mod) : -1;
      pageMods.splice(j >= 0 ? j : pageMods.length, 0, m);
    }
    L.save(); render();
  }

  function endGesture(commit) {
    const g = gesture;
    gesture = null;
    app.dragging = false;
    app.renderAfterDrag = false;
    document.body.classList.remove('is-gesture', 'gesture-e', 'gesture-s', 'gesture-se');
    if (!g) return;
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    if (g.timer) clearInterval(g.timer);
    if (g.ghost) g.ghost.remove();
    if (g.kind === 'resize' && commit && (g.w !== g.w0 || g.h !== g.h0)) {
      editPage((mods) => { const m = mods[moduleIndex(mods, g.id)]; if (m) { m.w = g.w; m.h = g.h; } });
    } else if (g.kind === 'move' && commit && g.drop) {
      applyDrop(g);
    } else {
      render();
    }
  }

  $app.addEventListener('pointerdown', (e) => {
    if (!app.editing || gesture || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const handle = e.target.closest('[data-rz]');
    if (handle) { startResize(e, handle); return; }
    const host = e.target.closest('[data-mod]');
    if (!host) return;
    const grip = e.target.closest('[data-grip]');
    if (!grip && e.target.closest('button, a, input, textarea, select')) return;
    const touch = e.pointerType !== 'mouse';
    pending = { host, pid: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, touch };
    // The grip moves right away; elsewhere a finger has to hold still first (otherwise it scrolls).
    if (grip) { e.preventDefault(); startMove(pending); }
    else if (touch) pending.timer = setTimeout(() => { if (pending) startMove(pending); }, 300);
  });

  document.addEventListener('pointermove', (e) => {
    if (gesture && e.pointerId === gesture.pid) {
      if (gesture.kind === 'resize') moveResize(e);
      else { gesture.x = e.clientX; gesture.y = e.clientY; updateMove(); }
      return;
    }
    if (!pending || e.pointerId !== pending.pid) return;
    pending.x = e.clientX; pending.y = e.clientY;
    const dist = Math.hypot(e.clientX - pending.x0, e.clientY - pending.y0);
    if (pending.touch) { if (dist > 10) { clearTimeout(pending.timer); pending = null; } } // the finger scrolls
    else if (dist > 5) startMove(pending);
  });

  function pointerEnd(e, commit) {
    if (pending && e.pointerId === pending.pid) { clearTimeout(pending.timer); pending = null; }
    if (gesture && e.pointerId === gesture.pid) endGesture(commit);
  }
  document.addEventListener('pointerup', (e) => pointerEnd(e, true));
  document.addEventListener('pointercancel', (e) => pointerEnd(e, false));
  // Once a card is held, the finger drags it instead of scrolling the page.
  document.addEventListener('touchmove', (e) => { if (gesture) e.preventDefault(); }, { passive: false });
  // Long press on a card: no context menu.
  $app.addEventListener('contextmenu', (e) => { if (app.editing && e.target.closest('[data-mod]')) e.preventDefault(); });
  // A drag that ends over a button must not also click it.
  $app.addEventListener('click', (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } }, true);

  // Keyboard: arrows on the grip move the card, arrows on a handle resize it.
  $app.addEventListener('keydown', (e) => {
    if (!app.editing || !/^Arrow/.test(e.key)) return;
    const grip = e.target.closest('[data-grip]');
    const handle = e.target.closest('[data-rz]');
    if (!grip && !handle) return;
    const id = e.target.closest('[data-mod]').dataset.mod;
    e.preventDefault();
    if (grip) {
      const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      editPage((mods) => {
        const i = moduleIndex(mods, id), j = i + d;
        if (i >= 0 && j >= 0 && j < mods.length) [mods[i], mods[j]] = [mods[j], mods[i]];
      });
      return;
    }
    const dir = handle.dataset.rz;
    editPage((mods) => {
      const m = mods[moduleIndex(mods, id)];
      if (!m) return;
      if (dir !== 's' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) m.w = clampSize(m.w + (e.key === 'ArrowRight' ? 1 : -1));
      if (dir !== 'e' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) m.h = clampSize(m.h + (e.key === 'ArrowDown' ? 1 : -1));
    });
  });

  // Leaving a note: save right away and catch up on updates skipped while typing.
  $app.addEventListener('focusout', (e) => {
    if (!e.target.classList || !(e.target.classList.contains('note') || e.target.classList.contains('memo-input'))) return;
    if (app.memoAdding && e.target.classList.contains('memo-input') && !String(app.memoDraft || '').trim()) { app.memoAdding = false; app.renderAfterNote = true; }
    if (app.noteTimer) { clearTimeout(app.noteTimer); app.noteTimer = null; L.save(); }
    if (app.renderAfterNote) { app.renderAfterNote = false; setTimeout(render, 0); }
  });

  // Cards that are clickable without being <button> (old browsers shrink a button's content).
  $app.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.getAttribute && e.target.getAttribute('role') === 'button' && e.target.dataset.act) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gesture) { endGesture(false); return; }
    if (e.key === 'Escape' && app.modal) { app.modal = null; render(); }
  });

  // Every second, without redrawing the page: the home clock (even while a dialog is open
  // or a note is being typed) and the music progress bars.
  setInterval(() => {
    const now = new Date();
    $app.querySelectorAll('[data-clock]').forEach((el) => { const v = fmtClock(now, el.dataset.clock); if (el.textContent !== v) el.textContent = v; });
    $app.querySelectorAll('[data-date]').forEach((el) => { const v = fmtDate(now, el.dataset.date); if (el.textContent !== v) el.textContent = v; });
    if (app.updQueue) pumpUpdates();
    $app.querySelectorAll('[data-retry-in]').forEach((el) => {
      const left = app.conn && app.conn.nextTry ? Math.ceil((app.conn.nextTry - Date.now()) / 1000) : 0;
      const v = left > 0 ? ' dans ' + left + ' s' : ' en cours…';
      if (el.textContent !== v) el.textContent = v;
    });
    $app.querySelectorAll('[data-media-pos]').forEach((el) => {
      if (el.dataset.playing !== '1') return;
      const dur = Number(el.dataset.dur);
      const pos = Math.min(dur, Number(el.dataset.pos) + (Date.now() - Number(el.dataset.at)) / 1000);
      const bar = el.querySelector('i');
      if (bar) bar.style.width = (pos / dur * 100).toFixed(2) + '%';
      const cur = el.querySelector('[data-cur]');
      if (cur) cur.textContent = HD.Modules.mmss(pos);
    });
  }, 1000);

  // Refresh relative times and the header clock on each new minute.
  setTimeout(() => {
    if (app.index && !app.modal) queueRender();
    setInterval(() => { if (app.index && !app.modal) queueRender(); }, 60000);
  }, 60000 - (Date.now() % 60000) + 50);

  // Network back or screen woken up: reconnect now instead of waiting for the next attempt.
  const retrySoon = () => { if (app.conn && app.conn.retryNow && app.status === 'reconnecting') app.conn.retryNow(); };
  window.addEventListener('online', retrySoon);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) retrySoon(); });

  document.documentElement.style.setProperty('--accent', L.data.accent);
  connectSaved();
})();
