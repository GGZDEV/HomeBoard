/**
 * Client Home Assistant (API WebSocket).
 * Docs : https://developers.home-assistant.io/docs/api/websocket
 *
 * Authentification par jeton d'accès longue durée
 * (Profil -> Sécurité -> Jetons d'accès longue durée).
 */
import { store } from './store.js';

export class HomeAssistantBackend {
  constructor({ url, token }) {
    this.baseUrl = normalizeUrl(url);
    this.token = token;
    this.ws = null;
    this.msgId = 1;
    this.pending = new Map();
    this.closedByUser = false;
    this.retry = 0;
  }

  wsUrl() {
    const u = new URL(this.baseUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = u.pathname.replace(/\/$/, '') + '/api/websocket';
    return u.toString();
  }

  connect() {
    return new Promise((resolve, reject) => {
      store.setStatus('connecting', `Connexion à ${this.baseUrl}…`);
      let settled = false;

      let ws;
      try {
        ws = new WebSocket(this.wsUrl());
      } catch (err) {
        store.setStatus('error', `URL invalide : ${err.message}`);
        reject(err);
        return;
      }
      this.ws = ws;

      const fail = (message) => {
        if (settled) return;
        settled = true;
        store.setStatus('error', message);
        reject(new Error(message));
      };

      ws.addEventListener('message', async (event) => {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        switch (msg.type) {
          case 'auth_required':
            ws.send(JSON.stringify({ type: 'auth', access_token: this.token }));
            break;

          case 'auth_invalid':
            fail('Jeton refusé par Home Assistant');
            ws.close();
            break;

          case 'auth_ok': {
            this.retry = 0;
            store.setStatus('connected', this.baseUrl);
            try {
              const states = await this.send({ type: 'get_states' });
              store.setEntities(states);
              await this.send({ type: 'subscribe_events', event_type: 'state_changed' });
            } catch (err) {
              fail(`Erreur d'initialisation : ${err.message}`);
              return;
            }
            if (!settled) { settled = true; resolve(true); }
            break;
          }

          case 'result': {
            const p = this.pending.get(msg.id);
            if (!p) break;
            this.pending.delete(msg.id);
            msg.success ? p.resolve(msg.result) : p.reject(new Error(msg.error?.message || 'Erreur'));
            break;
          }

          case 'event': {
            const data = msg.event?.data;
            if (msg.event?.event_type === 'state_changed' && data?.new_state) {
              store.setEntity(data.new_state);
            }
            break;
          }

          default:
            break;
        }
      });

      ws.addEventListener('error', () => fail('Connexion impossible (URL, HTTPS ou CORS ?)'));

      ws.addEventListener('close', () => {
        this.pending.forEach((p) => p.reject(new Error('Connexion fermée')));
        this.pending.clear();
        if (this.closedByUser) return;
        if (settled) {
          store.setStatus('error', 'Connexion perdue — nouvelle tentative…');
          this.scheduleReconnect();
        } else {
          fail('Connexion fermée avant authentification');
        }
      });
    });
  }

  scheduleReconnect() {
    this.retry = Math.min(this.retry + 1, 5);
    const delay = 1000 * 2 ** (this.retry - 1);
    setTimeout(() => {
      if (this.closedByUser) return;
      this.msgId = 1;
      this.connect().catch(() => {});
    }, delay);
  }

  send(payload) {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket non connecté'));
        return;
      }
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ ...payload, id }));
    });
  }

  callService(domain, service, data = {}) {
    const { entity_id, ...service_data } = data;
    return this.send({
      type: 'call_service',
      domain,
      service,
      service_data,
      target: entity_id ? { entity_id } : undefined
    });
  }

  disconnect() {
    this.closedByUser = true;
    this.ws?.close();
  }
}

function normalizeUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) throw new Error('URL manquante');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

/** Test de connexion rapide, utilisé par la fenêtre de réglages. */
export async function probe({ url, token }) {
  const backend = new HomeAssistantBackend({ url, token });
  try {
    await backend.connect();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    // Un test ne doit jamais laisser de socket ouverte ni de reconnexion en vol.
    backend.disconnect();
  }
}
