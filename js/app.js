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
    M.setNames(L.data.names);
    const active = document.activeElement;
    const focusKey = active && active.dataset ? active.dataset.key : null;
    const caret = active && active.tagName === 'INPUT' && active.type === 'text' ? active.selectionStart : null;
    const scrollers = {};
    $app.querySelectorAll('[data-scroll]').forEach((el) => { scrollers[el.dataset.scroll] = el.scrollTop; });

    if (!app.index) $app.innerHTML = loginView();
    else $app.innerHTML = shell(app.tab === 'settings' ? pageSettings() : pageModules()) + (app.modal ? modalView() : '');

    fitRows(); // before restoring scroll positions, which depend on row heights
    $app.querySelectorAll('[data-scroll]').forEach((el) => { if (scrollers[el.dataset.scroll]) el.scrollTop = scrollers[el.dataset.scroll]; });
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
  function updateFades() { $app.querySelectorAll('[data-scroll]').forEach(fade); fitPills(); }
  // Room tiles: a row of light buttons that doesn't fit is hidden whole (never cut in half);
  // "Voir les N" goes first (the room name opens the room too), then the last lights; the power button stays.
  function fitPills() {
    $app.querySelectorAll('.room-pills').forEach((box) => {
      const kids = [...box.children];
      kids.forEach((k) => { k.hidden = false; });
      const order = kids.filter((k) => k.classList.contains('ghost'))
        .concat(kids.filter((k) => k.classList.contains('light-pill') && !k.classList.contains('ghost')).reverse());
      for (const k of order) {
        if (box.scrollHeight <= box.clientHeight + 1) break;
        k.hidden = true;
      }
    });
  }
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
    const status = app.status === 'reconnecting' ? '<div class="banner" role="status">Connexion perdue, reconnexion…</div>' : '';
    // Rail flush to the left; Réglages pushed to the bottom.
    const btn = (t) => `<button class="rail-btn${t.id === app.tab ? ' is-on' : ''}" aria-label="${t.label}" title="${t.label}" ${t.id === app.tab ? 'aria-current="page"' : ''} data-act="tab" data-arg="${t.id}" data-key="tab:${t.id}">${icon(t.icon, 22)}</button>`;
    return `
<nav class="rail" aria-label="Navigation principale">
  ${TABS.filter((t) => t.id !== 'settings').map(btn).join('')}
  <span class="rail-spacer"></span>
  ${btn(TABS.find((t) => t.id === 'settings'))}
</nav>
<main class="panel${app.editing ? ' is-editing' : ''}">${status}${content}</main>
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
  function nowLabel() {
    const d = new Date();
    const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    return day.charAt(0).toUpperCase() + day.slice(1) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
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
    ${editable && app.editing ? `<button class="btn-glass" data-act="add-open" data-key="add-open">${icon(IC.plus, 18, 2)} Module</button>` : ''}
    ${editable ? `<button class="${app.editing ? 'btn-solid' : 'card hov round-btn'}" data-act="edit-toggle" data-key="edit-toggle" aria-label="${app.editing ? 'Terminer la personnalisation' : 'Personnaliser cette page'}" title="Personnaliser">${app.editing ? icon(IC.check, 18, 2.2) + ' Terminé' : icon(IC.pencil, 19)}</button>` : ''}
  </div>
</header>`;
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
    'home-weather': homeType('Météo (accueil)', 'Météo actuelle, 5 prochaines heures, 4 jours, lever et coucher du soleil.', IC.cloud, 1, 4, () => heroWeather()),
    'home-rooms': homeType('Pièces et lumières', 'Chaque pièce avec sa température et ses lampes à allumer d\'un toucher.', IC.home, 2, 3, () => heroRooms()),
    'home-scenes': homeType('Raccourcis', '« Tout éteindre » et vos trois premières scènes.', IC.spark, 2, 1, () => heroScenes()),
    'home-agenda': homeType('Agenda (accueil)', 'Les 7 prochains jours de vos calendriers, avec les alertes train.', IC.calendar, 1, 2, () => heroAgenda()),
    'home-notes': homeType('Liste de notes', 'Une liste à cocher partagée (courses, rappels…).', IC.note, 1, 2, () => heroNotes())
  });

  function heroWeather() {
    const W = HD.Modules;
    const st = allStates().find((s) => M.domainOf(s.entity_id) === 'weather');
    if (!st) return `<section class="card hero-card hero-weather"><div class="mod-head"><h2>Météo</h2></div><p class="muted small">Aucune entité météo dans Home Assistant (intégration Météo-France par exemple).</p></section>`;
    const a = st.attributes;
    const days = W.dailyItems(forecastFor(st, 'main'));
    const today = new Date().toDateString();
    const todayFc = days.find((f) => new Date(f.datetime).toDateString() === today);
    const next = days.filter((f) => new Date(f.datetime).toDateString() !== today && new Date(f.datetime) > new Date()).slice(0, 4);
    const hourlyFc = forecastFor(st, 'hourly');
    const hours = hourlyFc && hourlyFc.items ? hourlyFc.items.filter((h) => Date.parse(h.datetime) > Date.now() - 30 * 60000).slice(0, 5) : [];
    const lo = Math.min(...next.map((f) => (f.templow != null ? f.templow : f.temperature)));
    const hi = Math.max(...next.map((f) => f.temperature));
    const span = hi - lo || 1;
    const sun = app.states.get('sun.sun');
    const sunLine = sun && sun.attributes.next_rising && sun.attributes.next_setting
      ? `<span class="hero-foot muted small"><span>Lever ${hhmm(new Date(sun.attributes.next_rising))}</span><span>Coucher ${hhmm(new Date(sun.attributes.next_setting))}</span></span>` : '';
    return `<button class="card hero-card hero-weather" data-act="weather-open" data-arg="${esc(st.entity_id)}" data-key="hero:wx" aria-label="Météo, prévisions détaillées">
      <span class="mod-head"><span class="h2">Météo</span><span class="muted small">${esc(M.shortName(st))}</span></span>
      <span class="wx-hero-now">${W.wxArt(st.state, 56)}
        <span class="stack"><span class="wx-hero-temp">${esc(M.fmtNum(a.temperature, 0))}°</span>
        <span class="wx-hero-sub">${esc(M.WEATHER[st.state] || st.state)}${todayFc && todayFc.templow != null ? ' · ' + esc(M.fmtNum(todayFc.templow, 0)) + '° / ' + esc(M.fmtNum(todayFc.temperature, 0)) + '°' : ''}</span></span>
      </span>
      <span class="wx-hero-chips">
        ${a.humidity != null ? `<span>Hum. ${esc(M.fmtNum(a.humidity, 0))} %</span>` : ''}
        ${a.wind_speed != null ? `<span>Vent ${esc(M.fmtNum(a.wind_speed, 0))} ${esc(a.wind_speed_unit || 'km/h')}</span>` : ''}
      </span>
      ${hours.length ? `<span class="wx-hero-hours" style="grid-template-columns: repeat(${hours.length}, 1fr)">${hours.map((h) =>
        `<span><span class="muted">${new Date(h.datetime).getHours()}h</span><b>${esc(M.fmtNum(h.temperature, 0))}°</b></span>`).join('')}</span>` : ''}
      ${next.length ? `<span class="wx-hero-days">${next.map((f, i) => {
        const l = f.templow != null ? f.templow : f.temperature;
        const a1 = Math.round(((l - lo) / span) * 100), a2 = Math.max(a1 + 6, Math.round(((f.temperature - lo) / span) * 100));
        return `<span class="wx-hero-day"><span class="muted">${esc(W.dayLabel(f.datetime, i + 1))}</span>
          <span class="wx-hero-bar" style="background: linear-gradient(90deg, rgba(255,255,255,0.15) ${a1}%, var(--accent) ${a1}%, var(--accent) ${a2}%, rgba(255,255,255,0.15) ${a2}%)"></span>
          <span class="muted">${esc(M.fmtNum(l, 0))}°</span><b>${esc(M.fmtNum(f.temperature, 0))}°</b></span>`;
      }).join('')}</span>` : ''}
      <span class="grow"></span>
      ${sunLine}
    </button>`;
  }

  function roomCard(room) {
    const sts = room.ids.map((id) => app.states.get(id)).filter(Boolean);
    const lights = sts.filter((s) => M.domainOf(s.entity_id) === 'light');
    const devices = sts.filter(M.isGridEntity);
    const on = lights.filter((l) => l.state === 'on');
    const hums = sts.filter((s) => M.isHumidity(s) && M.isAvail(s)).map((s) => Number(s.state));
    const t = roomTemp(room);
    const z = HD.Modules.tempZone(t, {});
    // Comfort = green dot; cold/warm = colored dot; implausible (very hot) = warning sign.
    const tempHtml = t == null ? '' : z && z.id === 'tres'
      ? `<span class="room-temp-big is-warn" title="Valeur à vérifier">${icon(WARN_PATH, 18, 2)}${esc(M.fmtNum(t))}°</span>`
      : `<span class="room-temp-big"><i style="background: ${z && z.id !== 'confort' ? z.color : 'var(--ok)'}"></i>${esc(M.fmtNum(t))}°</span>`;
    const sub = [hums.length ? 'Hum. ' + M.fmtNum(avg(hums), 0) + ' %' : '', lights.length ? on.length + '/' + lights.length + ' ' + (on.length > 1 ? 'allumés' : 'allumé') : ''].filter(Boolean).join(' · ');
    const shown = lights.slice(0, 3);
    const pills = shown.map((l) => {
      const isOn = l.state === 'on';
      const off = M.UNAVAILABLE.includes(l.state);
      return `<button class="light-pill${isOn ? ' is-on' : ''}" ${off ? 'disabled' : ''} aria-pressed="${isOn}" data-act="dev" data-arg="${esc(l.entity_id)}" data-key="hero:${esc(l.entity_id)}">
        <span class="lp-ic">${icon(IC.bulb, 16, 2)}</span><span class="lp-name">${esc(M.shortName(l, room.name))}</span></button>`;
    }).join('');
    const more = devices.length > shown.length
      ? `<button class="light-pill ghost" data-act="open-room" data-arg="${esc(room.id)}" data-key="hero:more:${esc(room.id)}">Voir les ${devices.length}</button>` : '';
    const power = on.length
      ? `<button class="power-btn" aria-label="Éteindre ${esc(room.name)}" data-act="room-off" data-arg="${esc(room.id)}" data-key="hero:off:${esc(room.id)}">${icon(IC.power, 18)}</button>` : '';
    const empty = !devices.length
      ? `<div class="room-empty">Aucun appareil${room.id !== '__autres' && app.conn && app.conn.baseUrl !== 'demo' ? ` · <a class="btn-mini" href="${esc(app.conn.baseUrl)}/config/areas/area/${encodeURIComponent(room.id)}" target="_blank" rel="noopener">+ Ajouter</a>` : ''}</div>` : '';
    return `<div class="room-tile">
      <div class="room-tile-head">
        <button class="room-tile-name" data-act="open-room" data-arg="${esc(room.id)}" data-key="hero:room:${esc(room.id)}"><span class="rt-name">${esc(room.name)}</span>${sub ? `<span class="muted small">${esc(sub)}</span>` : ''}</button>
        ${tempHtml}
      </div>
      ${empty || `<div class="room-pills">${pills}${more}${power}</div>`}
    </div>`;
  }

  function heroRooms() {
    const rooms = visibleRooms();
    const ti = indoorTemp();
    const n = lightsOn();
    const fits = rooms.length <= 4;
    return `<section class="card hero-card hero-rooms" aria-label="Pièces">
      <div class="mod-head"><h2>Pièces</h2><span class="muted small">${[ti != null ? 'Moy. ' + M.fmtNum(ti) + '°' : '', plural(n, 'allumé', 'allumés')].filter(Boolean).join(' · ')}</span></div>
      <div class="room-grid${fits ? '' : ' is-scroll'}"${fits ? ` style="grid-template-rows: repeat(${Math.max(1, Math.ceil(rooms.length / 2))}, minmax(0, 1fr))"` : ' data-scroll="hero-rooms"'}>
        ${rooms.length ? rooms.map(roomCard).join('') : '<p class="muted small">Aucune pièce : assignez vos appareils à des zones dans Home Assistant.</p>'}
      </div>
    </section>`;
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

  function heroAgenda() {
    const W = HD.Modules;
    const cals = allStates().filter((s) => M.domainOf(s.entity_id) === 'calendar');
    const data = cals.length ? calendarFor(cals, 7) : { raw: {} };
    const events = W.calEvents(cals, data.raw).filter((ev) => ev.end > new Date());
    app.calEvents = app.calEvents || {};
    app.calEvents['hero-agenda'] = events;
    // Real-time train alert (cancellations / delays in the next hour), from the IDFM sensor.
    const tr = allStates().find((s) => M.domainOf(s.entity_id) === 'sensor' && s.attributes.MonitoredStopVisit);
    let alert = '';
    if (tr) {
      const soon = W.departures(tr).filter((d) => d.time < Date.now() + 3600000);
      const cancelled = soon.filter((d) => d.cancelled).length;
      const maxDelay = Math.max(0, ...soon.filter((d) => !d.cancelled).map((d) => d.delay));
      if (cancelled || maxDelay >= 3) {
        const line = (soon[0] && soon[0].line) || W.LINES.C01728;
        const what = [cancelled ? plural(cancelled, 'train supprimé', 'trains supprimés') : '', maxDelay >= 3 ? 'retards jusqu\'à +' + maxDelay + ' min' : ''].filter(Boolean).join(' · ');
        alert = `<div class="agenda-alert">${icon(WARN_PATH, 20, 2)}
          <span class="stack"><span class="cal-title">${esc(line.mode + ' ' + line.name)} · ${esc(M.shortName(tr))} : ${esc(what)}</span><span class="muted small">Dans l'heure qui vient</span></span></div>`;
      }
    }
    let list = '';
    let lastDay = null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (alert) { list += `<h3 class="cal-day">Aujourd'hui</h3>${alert}`; lastDay = today.getTime(); }
    events.forEach((ev, i) => {
      const d = ev.start < today ? new Date(today) : new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate());
      if (d.getTime() !== lastDay) { list += `<h3 class="cal-day">${esc(W.dayTitle(d))}</h3>`; lastDay = d.getTime(); }
      list += `<button class="agenda-ev" data-act="event-open" data-arg="hero-agenda|${i}" data-key="hero:ev${i}"><span class="cal-bar" style="background: ${ev.color}"></span>
        <span class="stack"><span class="cal-title">${esc(ev.title)}</span><span class="muted small">${esc(W.whenLabel(ev))}${ev.location ? ' · ' + esc(ev.location) : ''}</span></span></button>`;
    });
    if (!events.length && !alert) {
      list = `<p class="muted small">${!cals.length ? 'Aucun calendrier : connectez Google Agenda dans Home Assistant (« Calendrier distant » ou « Google Calendar »).' : data.loading ? 'Chargement…' : 'Rien de prévu sur 7 jours.'}</p>`;
    }
    return `<section class="card hero-card hero-agenda" aria-label="Agenda">
      <div class="mod-head"><h2>Agenda</h2><span class="muted small">7 jours</span></div>
      <div class="agenda-list" data-scroll="hero-agenda">${list}</div>
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
    L.data.memo = { text: items.map((it) => (it.done ? '[x] ' : '[ ] ') + it.text).join('\n'), updated: Date.now() };
    L.save();
  }

  function heroNotes() {
    const items = memoItems();
    const m = memo();
    const when = m.updated ? M.relTime(new Date(m.updated).toISOString()) : null;
    const anyDone = items.some((it) => it.done);
    return `<section class="card hero-card hero-notes" aria-label="Notes">
      <div class="mod-head"><h2>Notes</h2><span class="muted small">${anyDone ? '<button class="link-btn" data-act="memo-clear" data-key="memo-clear">Effacer les cochées</button>' : when ? esc(when) : ''}</span></div>
      <ul class="memo-list" data-scroll="hero-memo">${items.map((it, i) => `<li><label class="memo-item${it.done ? ' is-done' : ''}">
        <input type="checkbox" ${it.done ? 'checked' : ''} data-act="memo-check" data-arg="${i}" data-key="memo:${i}"><span>${esc(it.text)}</span></label></li>`).join('')}</ul>
      <form class="memo-form" id="memo-form"><label class="sr-only" for="memo-input">Nouvelle note</label>
        <input id="memo-input" class="memo-input" type="text" placeholder="Ajouter une note…" maxlength="200" value="${esc(app.memoDraft || '')}" data-act="memo-draft" data-key="memo-input" enterkeyhint="done" autocomplete="off"></form>
    </section>`;
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
      targetTemp, roomSummaries, roomOrder, forecast: (st) => forecastFor(st, 'main'),
      calendar: calendarFor, mediaUrl,
      rememberEvents: (id, events) => { app.calEvents = app.calEvents || {}; app.calEvents[id] = events; }
    };
    const body = mods.map((m) => moduleView(m, ctx, e)).join('') +
      (app.editing ? `<button class="mod add-tile" style="grid-column: span 1; grid-row: span 2" data-act="add-open" data-key="add-tile">${icon(IC.plus, 26, 2)}<span>Ajouter un module</span></button>` : '');
    const hint = app.editing ? `<p class="edit-hint muted small">${touchFirst() ? 'Maintenez' : 'Attrapez'} un module puis glissez-le sur un autre pour les échanger · étirez son bord droit, son bord bas ou son coin pour le redimensionner · ${icon(IC.palette, 14)} couleurs · ${icon(IC.gear, 14)} appareils, noms et titre${L.isCustom(key) ? ` · <button class="link-btn" data-act="page-reset">${key === 'home-more' ? 'Revenir à l\'écran d\'accueil d\'origine' : 'Revenir à la disposition automatique'}</button>` : ''}</p>` : '';
    // Home: the design's blocks fill the first screen (4 rows), the user's own modules follow below.
    const head = key === 'home-more' ? header(app.config.location_name || 'Maison', nowLabel(), true) : header(title, pageSummary(key, room, mods), true);
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
      const anywhere = [...app.index.visible].some((id) => { const s = app.states.get(id); return s && t.pick(s); });
      const msg = t.manual ? 'Aucun capteur choisi.' : anywhere ? 'Aucun appareil compatible ici.' : (t.empty || 'Aucun appareil compatible trouvé dans Home Assistant.');
      inner = HD.UI.head(m.title || t.name) + `<div class="mod-empty"><p class="muted small">${esc(msg)}</p>
        ${anywhere || t.manual ? `<button class="btn-glass sm" data-act="mod-config" data-key="${m.id}:cfg-empty">Choisir des appareils</button>` : ''}</div>`;
    } else {
      // A module set to "Toute la maison" on a room page behaves like a house-wide one.
      inner = t.render(m, list, m.scope === 'all' && !ctx.global ? { ...ctx, global: true } : ctx);
    }
    const bare = t.bare && !m.title && (list.length || t.noEntities);
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
      body = `
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
        ${d.type === 'calendar' ? `<div class="field-row"><span class="field-label">Période</span>${seg('draft-days', String(d.options.days || 7), [['1', "Aujourd'hui"], ['3', '3 j'], ['7', '7 j'], ['14', '14 j'], ['30', '30 j']])}</div>` : ''}
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

  function openConfig(id, only) {
    const m = L.modules(pageKey(), env(pageRoom())).find((x) => x.id === id);
    if (!m) return;
    app.modal = { kind: 'config', id, only: only || null, draft: JSON.parse(JSON.stringify(m)), search: '', names: { ...L.data.names } };
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
    accent(arg) { L.data.accent = arg; L.data.accentSet = true; L.save(); render(); },
    'hero-toggle'() { L.data.hero = !heroOn(); L.save(); render(); },
    // Home screen
    'room-off'(id) {
      const room = app.index.byId.get(id);
      const ids = room ? room.ids.filter((x) => M.domainOf(x) === 'light' && (app.states.get(x) || {}).state === 'on') : [];
      if (ids.length) call('light', 'turn_off', ids);
    },
    'all-off'() { call('light', 'turn_off', 'all'); },
    'memo-clear'() { saveMemo(memoItems().filter((it) => !it.done)); render(); },
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
      const fill = e.target.closest('[data-mod]').querySelector('[data-vol-fill]');
      if (fill) fill.style.width = e.target.value + '%';
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
    gesture = { kind: 'move', host, id: host.dataset.mod, x0: p.x0, y0: p.y0, x: p.x, y: p.y, sc, st0: sc ? sc.scrollTop : window.scrollY, target: null, pid: p.pid };
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
    const under = document.elementFromPoint(g.x, g.y);
    let t = under && under.closest('[data-mod]');
    if (t && (t === g.host || t.parentElement !== g.host.parentElement)) t = null;
    if (t !== g.target) {
      if (g.target) g.target.classList.remove('is-drop-target');
      if (t) t.classList.add('is-drop-target');
      g.target = t;
    }
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
    } else if (g.kind === 'move' && commit && g.target) {
      const to = g.target.dataset.mod;
      editPage((mods) => {
        const i = moduleIndex(mods, g.id), j = moduleIndex(mods, to);
        if (i >= 0 && j >= 0) [mods[i], mods[j]] = [mods[j], mods[i]];
      });
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
    if (app.noteTimer) { clearTimeout(app.noteTimer); app.noteTimer = null; L.save(); }
    if (app.renderAfterNote) { app.renderAfterNote = false; setTimeout(render, 0); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gesture) { endGesture(false); return; }
    if (e.key === 'Escape' && app.modal) { app.modal = null; render(); }
  });

  // Music: move the progress bars every second without redrawing the page.
  setInterval(() => {
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

  document.documentElement.style.setProperty('--accent', L.data.accent);
  connectSaved();
})();
