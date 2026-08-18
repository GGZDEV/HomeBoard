/** Petit bus d'événements + état global partagé. */

const listeners = new Map();

export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => bus.off(evt, fn);
  },
  off(evt, fn) {
    listeners.get(evt)?.delete(fn);
  },
  emit(evt, payload) {
    listeners.get(evt)?.forEach((fn) => {
      try { fn(payload); } catch (err) { console.error(`[bus:${evt}]`, err); }
    });
  }
};

export const store = {
  /** entity_id -> { entity_id, state, attributes } */
  entities: {},
  /** Configuration de la maison (config/home.json ou surcharge locale). */
  config: null,
  /** Backend actif (démo ou Home Assistant). */
  backend: null,
  /** 'idle' | 'connecting' | 'connected' | 'demo' | 'error' */
  status: 'idle',
  statusMessage: '',
  floorId: null,
  roomId: null,
  /** Historique glissant : entity_id -> number[] */
  history: {},

  setEntities(list) {
    const next = {};
    for (const e of list) next[e.entity_id] = e;
    store.entities = next;
    for (const e of list) pushHistory(e);
    bus.emit('entities', store.entities);
  },

  setEntity(entity) {
    if (!entity?.entity_id) return;
    store.entities[entity.entity_id] = entity;
    pushHistory(entity);
    bus.emit('entity', entity);
    bus.emit('entities', store.entities);
  },

  get(entityId) {
    return store.entities[entityId] || null;
  },

  setStatus(status, message = '') {
    store.status = status;
    store.statusMessage = message;
    bus.emit('status', { status, message });
  },

  call(domain, service, data = {}) {
    if (!store.backend) return Promise.resolve();
    return Promise.resolve(store.backend.callService(domain, service, data))
      .catch((err) => {
        console.error('[call_service]', domain, service, err);
        bus.emit('toast', { type: 'error', text: `Échec de ${domain}.${service}` });
      });
  }
};

const HISTORY_LEN = 60;

function pushHistory(entity) {
  const value = Number(entity.state);
  if (!Number.isFinite(value)) return;
  const buf = store.history[entity.entity_id] || (store.history[entity.entity_id] = []);
  if (buf[buf.length - 1] !== value || buf.length === 0) buf.push(value);
  if (buf.length > HISTORY_LEN) buf.splice(0, buf.length - HISTORY_LEN);
}

export function seedHistory(entityId, values) {
  store.history[entityId] = values.slice(-HISTORY_LEN);
}
