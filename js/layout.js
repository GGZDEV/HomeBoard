// User layout: which modules each page shows, their size, order and chosen entities.
// Pages without a saved layout get one generated from the detected devices, so new rooms
// and devices show up on their own until the user customizes that page.
window.HD = window.HD || {};

(function () {
  const M = HD.Model;
  const T = HD.Modules.types;
  const REMOTE_KEY = 'maison_dashboard';

  const uid = () => 'm' + Math.random().toString(36).slice(2, 9);
  const blank = () => ({ v: 1, pages: {}, rooms: { order: [], hidden: {} }, accent: '#FF9F0A', names: {} });

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
          modules: page.modules.filter((m) => m && T[m.type]).map((m) => ({
            id: typeof m.id === 'string' ? m.id : uid(),
            type: m.type,
            title: typeof m.title === 'string' ? m.title : '',
            w: clamp(m.w, 1, 4), h: clamp(m.h, 1, 4),
            scope: m.scope === 'room' ? 'room' : 'all',
            entities: Array.isArray(m.entities) ? m.entities.filter((x) => typeof x === 'string') : null,
            options: m.options && typeof m.options === 'object' ? { ...m.options } : {}
          }))
        };
      }
      return out;
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
      if (!this.data.pages[key]) this.data.pages[key] = { modules: this.defaults(key, env) };
      return this.data.pages[key].modules;
    },

    resetPage(key) { delete this.data.pages[key]; this.save(); },
    // Layout only: accent and custom labels are kept.
    resetAll() { const { accent, names } = this.data; this.data = blank(); Object.assign(this.data, { accent, names }); this.save(); },

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
        const pool = m.scope === 'room' && env.room ? env.room.ids : [...env.index.visible];
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
      if (key === 'energy') {
        return [has('energy', 'all') && mod('energy', 4, 4, 'all')].filter(Boolean);
      }
      return [];
    }
  };

  function clamp(v, lo, hi) { const n = Math.round(Number(v)); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
  function readLocal(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeLocal(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }

  HD.Layout = L;
})();
