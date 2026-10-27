// Minimal Home Assistant WebSocket client.
// Docs: https://developers.home-assistant.io/docs/api/websocket
window.HD = window.HD || {};

HD.HAConnection = class HAConnection {
  // `auth` is either a long-lived token (string) or a provider from auth.js
  // whose getToken() returns a fresh access token on each (re)connection.
  constructor(baseUrl, auth) {
    this.baseUrl = HD.HAConnection.normalizeUrl(baseUrl);
    this.authKind = typeof auth === 'string' ? 'token' : auth.kind;
    this.getToken = typeof auth === 'string' ? () => Promise.resolve(auth) : () => auth.getToken();
    this.auth = auth;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = { state: [], status: [], ready: [] };
    this.closedByUser = false;
    this.retry = 0;
    this.pingTimer = null;
  }

  static normalizeUrl(url) {
    let u = String(url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
    return u;
  }

  get wsUrl() {
    return this.baseUrl.replace(/^http/i, 'ws') + '/api/websocket';
  }

  on(evt, fn) { this.listeners[evt].push(fn); }
  emit(evt, data) { for (const fn of this.listeners[evt]) fn(data); }

  // Resolves once authenticated the first time; rejects on bad token / unreachable host.
  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true;
        err ? reject(err) : resolve();
      };
      this.emit('status', 'connecting');
      let ws;
      try {
        ws = new WebSocket(this.wsUrl);
      } catch (e) {
        done(new Error('Adresse invalide : ' + this.wsUrl));
        return;
      }
      this.ws = ws;

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        const batch = Array.isArray(msg) ? msg : [msg];
        for (const m of batch) this.handle(m, done);
      };
      ws.onerror = () => done(new Error('Impossible de joindre Home Assistant (' + this.wsUrl + ').'));
      ws.onclose = () => {
        clearInterval(this.pingTimer);
        for (const p of this.pending.values()) p.reject(new Error('Connexion fermée'));
        this.pending.clear();
        done(new Error('Connexion fermée par Home Assistant.'));
        if (this.closedByUser || this.authFailed) return;
        this.emit('status', 'reconnecting');
        const delay = Math.min(30000, 1000 * 2 ** this.retry++);
        this.nextTry = Date.now() + delay;
        clearTimeout(this.reconTimer);
        this.reconTimer = setTimeout(() => { this.nextTry = 0; this.connect().catch(() => {}); }, delay);
      };
    });
  }

  async handle(m, done) {
    if (m.type === 'auth_required') {
      const ws = this.ws;
      this.getToken().then(
        (token) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'auth', access_token: token })); },
        (err) => {
          // Refresh token revoked or expired: a new login is needed.
          this.authFailed = !!err.auth;
          this.emit('status', err.auth ? 'auth_invalid' : 'reconnecting');
          done(err);
          ws.close();
        }
      );
    } else if (m.type === 'auth_invalid') {
      this.authFailed = true;
      this.emit('status', 'auth_invalid');
      done(new Error((this.authKind === 'token' ? 'Jeton refusé : ' : 'Session refusée : ') + (m.message || 'auth_invalid')));
      this.ws.close();
    } else if (m.type === 'auth_ok') {
      this.retry = 0;
      this.haVersion = m.ha_version;
      try {
        await this.subscribe('state_changed', (ev) => this.emit('state', ev.data));
      } catch (e) { /* keep going: data still loads */ }
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }).catch(() => {}), 30000);
      this.emit('status', 'connected');
      this.emit('ready');
      done();
    } else if (m.id && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      if (m.type === 'event') { p.onEvent && p.onEvent(m.event); return; }
      if (!p.keep) this.pending.delete(m.id);
      if (m.type === 'pong') p.resolve();
      else if (m.success) p.resolve(m.result);
      else p.reject(new Error((m.error && m.error.message) || 'Erreur Home Assistant'));
    }
  }

  send(payload, opts = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Non connecté'));
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, keep: !!opts.onEvent, onEvent: opts.onEvent });
      this.ws.send(JSON.stringify({ id, ...payload }));
    });
  }

  subscribe(eventType, onEvent) {
    return this.send({ type: 'subscribe_events', event_type: eventType }, { onEvent });
  }

  // Loads everything needed to build the dashboard. Registry calls need an admin user;
  // if they fail we still work, just without rooms.
  async fetchAll() {
    const safe = (p) => p.catch(() => []);
    const [states, areas, devices, entities, config] = await Promise.all([
      this.send({ type: 'get_states' }),
      safe(this.send({ type: 'config/area_registry/list' })),
      safe(this.send({ type: 'config/device_registry/list' })),
      safe(this.send({ type: 'config/entity_registry/list' })),
      this.send({ type: 'get_config' }).catch(() => ({}))
    ]);
    return { states, areas, devices, entities, config };
  }

  // Markdown release notes of an update entity.
  releaseNotes(entityId) {
    return this.send({ type: 'update/release_notes', entity_id: entityId });
  }

  // Try again right away (button of the "connection lost" dialog, network back, screen woken up).
  retryNow() {
    if (this.closedByUser || this.authFailed || !this.reconTimer || !this.nextTry) return;
    clearTimeout(this.reconTimer);
    this.nextTry = 0;
    this.retry = 0;
    this.connect().catch(() => {});
  }

  callService(domain, service, entityIds, data = {}) {
    return this.send({
      type: 'call_service',
      domain,
      service,
      service_data: data,
      target: { entity_id: entityIds }
    });
  }

  // Weather forecast (HA 2023.9+). Events: { type: 'daily'|'hourly'|'twice_daily', forecast: [...] }.
  subscribeForecast(entityId, forecastType, onEvent) {
    return this.send({ type: 'weather/subscribe_forecast', entity_id: entityId, forecast_type: forecastType }, { onEvent });
  }

  // To-do list items (Bring!, shopping list…): HA pushes the whole list again on every change (HA 2024.1+).
  subscribeTodo(entityId, onItems) {
    return this.send({ type: 'todo/item/subscribe', entity_id: entityId }, { onEvent: (ev) => onItems((ev && ev.items) || []) });
  }
  // One read of the list (older HA without the subscription).
  listTodo(entityId) {
    return this.send({ type: 'todo/item/list', entity_id: entityId }).then((r) => (r && r.items) || []);
  }

  // Calendar events between two dates (REST: /api/calendars/<entity>?start=&end=).
  // Works when the page is served by HA (same origin); elsewhere HA's CORS settings decide.
  fetchCalendarEvents(entityId, start, end) {
    return this.getToken().then((token) => fetch(
      this.baseUrl + '/api/calendars/' + encodeURIComponent(entityId) +
        '?start=' + encodeURIComponent(start.toISOString()) + '&end=' + encodeURIComponent(end.toISOString()),
      { headers: { Authorization: 'Bearer ' + token } }
    )).then((r) => {
      if (!r.ok) throw new Error('Calendrier ' + entityId + ' : erreur ' + r.status);
      return r.json();
    });
  }

  // Per-user storage inside Home Assistant: the layout follows you on every screen.
  // Media library of a player (Spotify: playlists, albums…). No id = the root.
  browseMedia(entityId, id, type) {
    return this.send({ type: 'media_player/browse_media', entity_id: entityId, ...(id ? { media_content_id: id, media_content_type: type } : {}) });
  }

  getUserData(key) {
    return this.send({ type: 'frontend/get_user_data', key }).then((r) => (r ? r.value : null));
  }

  setUserData(key, value) {
    return this.send({ type: 'frontend/set_user_data', key, value });
  }

  // Logs out of our own HA session (revokes it); a long-lived token is just forgotten.
  revoke() {
    return this.auth && this.auth.revoke ? this.auth.revoke() : Promise.resolve();
  }

  close() {
    this.closedByUser = true;
    clearInterval(this.pingTimer);
    if (this.ws) this.ws.close();
  }
};
