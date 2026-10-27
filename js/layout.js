// User layout: which modules each page shows, their size, order and chosen entities.
// Pages without a saved layout get one generated from the detected devices, so new rooms
// and devices show up on their own until the user customizes that page.
window.HD = window.HD || {};

(function () {
  const M = HD.Model;
  const T = HD.Modules.types;
  const REMOTE_KEY = 'maison_dashboard';

  const uid = () => 'm' + Math.random().toString(36).slice(2, 9);
  const blank = () => ({ v: 1, pages: {}, rooms: { order: [], hidden: {} }, accent: '#F5C542', names: {} });

  const L = {
    data: blank(),
    storageKey: 'hd.layout',
    conn: null,
    remoteTimer: null,
    syncState: 'local', // local | synced | saving | error

    // ---------- persistence ----------
    init(conn, demo) {
      this.conn = conn;
      this.storageKey = demo ? 'hd.layout.demo' : 'hd.layout';
      this.data = this.sanitize(readLocal(this.storageKey)) || blank();
      this.syncState = 'local';
    },

    async pullRemote() {
      if (!this.conn || !this.conn.getUserData) return;
      try {
        const remote = this.sanitize(await this.conn.getUserData(REMOTE_KEY));
        if (remote) { this.data = remote; writeLocal(this.storageKey, remote); }
        this.syncState = 'synced';
      } catch (e) {
        this.syncState = 'local';
      }
    },

    save() {
      writeLocal(this.storageKey, this.data);
      if (!this.conn || !this.conn.setUserData) return;
      clearTimeout(this.remoteTimer);
      this.syncState = 'saving';
      this.remoteTimer = setTimeout(() => {
        this.conn.setUserData(REMOTE_KEY, this.data)
          .then(() => { this.syncState = 'synced'; })
          .catch(() => { this.syncState = 'error'; });
      }, 800);
    },

    sanitize(d) {
      if (!d || typeof d !== 'object' || d.v !== 1 || typeof d.pages !== 'object') return null;
      const out = blank();
      out.accent = typeof d.accent === 'string' && /^#[0-9a-f]{6}$/i.test(d.accent) ? d.accent : out.accent;
      // The old default orange becomes the new design's yellow, unless the user picked it on purpose.
      if (out.accent === '#FF9F0A' && !d.accentSet) out.accent = '#F5C542';
      if (d.accentSet) out.accentSet = true;
      if (d.hero === false) out.hero = false; // home screen (tablet design) on by default
      if (d.memo && typeof d.memo.text === 'string') {
        out.memo = { text: d.memo.text.slice(0, 20000), updated: Number(d.memo.updated) || 0,
          history: Array.isArray(d.memo.history) ? d.memo.history.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.slice(0, 200)).slice(0, 20) : [] };
        if (typeof d.memo.list === 'string' && d.memo.list) out.memo.list = d.memo.list.slice(0, 120);
      }
      if (typeof d.outdoor === 'string') out.outdoor = d.outdoor;
      if (d.names && typeof d.names === 'object') {
        for (const [k, v] of Object.entries(d.names)) if (typeof v === 'string' && v.trim()) out.names[k] = v.trim().slice(0, 80);
      }
      if (d.rooms) {
        out.rooms.order = Array.isArray(d.rooms.order) ? d.rooms.order.filter((x) => typeof x === 'string') : [];
        out.rooms.hidden = d.rooms.hidden && typeof d.rooms.hidden === 'object' ? { ...d.rooms.hidden } : {};
      }
      for (const [key, page] of Object.entries(d.pages)) {
        if (!page || !Array.isArray(page.modules)) continue;
        out.pages[key] = {
          ...(page.homeBlocks ? { homeBlocks: true } : {}),
          modules: page.modules.filter((m) => m && T[m.type] && !T[m.type].headerOnly).map(cleanModule)
        };
      }
      // Home header: items placed in three zones (date, clock, chips, modules in their header version).
      if (d.header && Array.isArray(d.header.items)) {
        out.header = { items: d.header.items.filter((m) => m && T[m.type]).map((m) => ({ ...cleanModule(m), zone: ZONES.includes(m.zone) ? m.zone : 'right' })) };
      }
      // Background: a preset, a color, or a picture (dimmed for legibility).
      if (d.bg && typeof d.bg === 'object') {
        const b = {};
        if (typeof d.bg.preset === 'string') b.preset = d.bg.preset;
        if (typeof d.bg.color === 'string' && /^#[0-9a-f]{6}$/i.test(d.bg.color)) b.color = d.bg.color;
        if (typeof d.bg.image === 'string' && /^(data:image\/|https?:)/.test(d.bg.image)) b.image = d.bg.image;
        b.dim = isFinite(Number(d.bg.dim)) ? Math.max(0, Math.min(0.8, Number(d.bg.dim))) : 0.35;
        out.bg = b;
      }
      // The home screen used to be fixed above the user's modules: its blocks are now modules,
      // placed once in front of the ones already saved (after that, the user's choices stay).
      const more = out.pages['home-more'];
      if (more && !more.homeBlocks) {
        more.modules = this.homeBlocks().map((m, i) => ({ ...m, id: 'h-' + m.type + '-' + i })).concat(more.modules);
        more.homeBlocks = true;
      }
      return out;
    },

    // Home screen of the design « Dashboard Maison » (Large: 4 columns, 2 rows of cards):
    // weather | rooms | shopping list | notes, then agenda (2 wide) | music | trains.
    homeBlocks() {
      const mod = (type, w, h) => ({ ...this.newModule(type, 'all'), w, h });
      return [mod('home-weather', 1, 2), mod('home-rooms', 1, 2), mod('home-notes', 1, 2), mod('notes', 1, 2),
        mod('home-agenda', 2, 2), mod('media', 1, 2), mod('transit', 1, 2)];
    },

    exportJson() { return JSON.stringify(this.data, null, 2); },
    importJson(text) {
      const d = this.sanitize(JSON.parse(text));
      if (!d) throw new Error('Fichier de disposition invalide.');
      this.data = d;
      this.save();
    },

    // ---------- pages ----------
    isCustom(key) { return !!this.data.pages[key]; },

    modules(key, env) {
      return this.data.pages[key] ? this.data.pages[key].modules : this.defaults(key, env);
    },

    // Called before the first edit of a page: freeze the generated layout so it can be changed.
    materialize(key, env) {
      if (!this.data.pages[key]) this.data.pages[key] = { modules: this.defaults(key, env), ...(key === 'home-more' ? { homeBlocks: true } : {}) };
      return this.data.pages[key].modules;
    },

    resetPage(key) { delete this.data.pages[key]; this.save(); },
    // Layout only: accent and custom labels are kept.
    resetAll() { const { accent, accentSet, names, memo, bg } = this.data; this.data = blank(); Object.assign(this.data, { accent, accentSet, names, memo }); if (bg) this.data.bg = bg; this.save(); },

    // ---------- home header ----------
    // Items of the header, created on first use: date left, clock center, chips right.
    headerItems() {
      if (!this.data.header) {
        const it = (type, zone) => ({ ...this.newModule(type, 'all'), zone });
        this.data.header = { items: [it('h-date', 'left'), it('h-clock', 'center'), it('h-temps', 'right'), it('h-fullscreen', 'right')] };
      }
      return this.data.header.items;
    },

    newModule(type, scope) {
      const t = T[type];
      return { id: uid(), type, title: '', w: t.w, h: t.h, scope, entities: t.manual ? [] : null, options: {} };
    },

    // ---------- entity resolution ----------
    resolve(m, env) {
      const t = T[m.type];
      if (!t || t.noEntities) return [];
      const get = (id) => env.states.get(id);
      let list;
      if (Array.isArray(m.entities)) {
        list = m.entities.map(get).filter(Boolean);
      } else {
        // Update entities are "config" ones (hidden from the rest of the dashboard): look at all of them.
        const pool = t.allStates ? [...env.states.keys()] : m.scope === 'room' && env.room ? env.room.ids : [...env.index.visible];
        list = pool.map(get).filter((s) => s && (t.auto || t.pick)(s));
        if (m.type === 'scenes' && !list.length && m.scope === 'room') {
          // No scene assigned to this room: offer the house-wide ones.
          list = [...env.index.visible].filter((id) => !env.index.areaOf.get(id)).map(get).filter((s) => s && t.pick(s));
        }
        if (m.scope === 'all') list = env.sortByRoom(list);
      }
      return t.single ? list.slice(0, 1) : list;
    },

    // ---------- generated layouts ----------
    // Stable ids so focus/scroll survive re-renders of a generated page.
    defaults(key, env) {
      return this.generate(key, env).map((m, i) => ({ ...m, id: 'd-' + key.replace(/[^a-z0-9_-]/gi, '_') + '-' + m.type + '-' + i }));
    },

    generate(key, env) {
      const mod = (type, w, h, scope, extra = {}) => ({ ...this.newModule(type, scope), w, h, ...extra });
      const has = (type, scope, room) => this.resolve({ type, scope, entities: null }, { ...env, room }).length > 0;

      if (key.startsWith('room:')) {
        const room = env.room;
        const hasClimate = has('climate', 'room', room);
        const hasTemp = has('temperature', 'room', room);
        const hasScenes = has('scenes', 'room', room);
        const center = [];
        if (has('lights', 'room', room)) center.push(mod('lights', 2, 2, 'room'));
        if (has('devices', 'room', room)) center.push(mod('devices', 2, 2, 'room'));
        const left = hasClimate ? mod('climate', 1, 4, 'room') : hasTemp ? mod('temperature', 1, 4, 'room') : null;
        const right = hasScenes ? mod('scenes', 1, 4, 'room') : hasClimate && hasTemp ? mod('temperature', 1, 4, 'room') : null;
        const out = [left, ...center, right].filter(Boolean);
        if (hasClimate && hasTemp && hasScenes) out.push(mod('temperature', 2, 2, 'room'));
        if (!center.length) out.forEach((m) => { m.w = 2; });
        return out;
      }
      if (key === 'home-more') return this.homeBlocks();
      if (key === 'home') {
        // Row 1: temperatures + weather (wide enough for the week's forecast); then rooms, then energy.
        const row = [];
        if (has('temperature', 'all')) row.push(mod('temperature', 2, 2, 'all', { options: { group: 'room' } }));
        if (has('weather', 'all')) row.push(mod('weather', 2, 2, 'all'));
        if (row.length) row[0].w += 4 - row.reduce((s, m) => s + m.w, 0);
        const out = [...row];
        if (has('calendar', 'all')) out.push(mod('calendar', 4, 2, 'all'));
        out.push(mod('rooms', 4, 2, 'all'));
        if (has('energy', 'all')) out.push(mod('energy', 4, 2, 'all'));
        return out;
      }
      if (key === 'auto') {
        return [has('scenes', 'all') && mod('scenes', 2, 4, 'all'), has('automations', 'all') && mod('automations', 2, 4, 'all')].filter(Boolean);
      }
      if (key === 'updates') return [mod('updates', 4, 4, 'all')];
      if (key === 'server') return [mod('pve-node', 2, 4, 'all'), mod('pve-guests', 2, 4, 'all')];
      if (key === 'energy') {
        return [has('energy', 'all') && mod('energy', 4, 4, 'all')].filter(Boolean);
      }
      return [];
    }
  };

  const ZONES = ['left', 'center', 'right'];
  function cleanModule(m) {
    return {
      id: typeof m.id === 'string' ? m.id : uid(),
      type: m.type,
      title: typeof m.title === 'string' ? m.title : '',
      w: clamp(m.w, 1, 4), h: clamp(m.h, 1, 4),
      scope: m.scope === 'room' ? 'room' : 'all',
      entities: Array.isArray(m.entities) ? m.entities.filter((x) => typeof x === 'string') : null,
      options: m.options && typeof m.options === 'object' ? { ...m.options } : {}
    };
  }
  function clamp(v, lo, hi) { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
  function readLocal(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

  HD.Layout = L;
})();
