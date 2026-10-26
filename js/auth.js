// Logging in with Home Assistant's own accounts, so no token has to be typed on each device.
// Tried in order:
//   1. the HA session of the parent window (page shown in the HA sidebar, app included);
//   2. our own session, created once through HA's login page (OAuth, like the HA app);
//   3. the session of the HA interface opened in this same browser ("hassTokens").
// Files in /local are public, so no token is ever stored on the server.
// Docs: https://developers.home-assistant.io/docs/auth_api
window.HD = window.HD || {};

(function () {
  const KEY = 'hd.oauth';
  const STATE_KEY = 'hd.oauth.state';

  // The page is served by Home Assistant itself (/local/...): its login can be used.
  const servedByHA = () => /^\/local\//.test(location.pathname) || /^\/hacsfiles\//.test(location.pathname);
  const hassUrl = () => location.origin;
  const clientId = () => location.origin + '/';

  function read(k, store) {
    try { return JSON.parse((store || localStorage).getItem(k)); } catch (e) { return null; }
  }
  function write(k, v, store) {
    try { (store || localStorage).setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }
  function remove(k, store) {
    try { (store || localStorage).removeItem(k); } catch (e) { /* ignore */ }
  }

  function tokenRequest(params) {
    const body = Object.keys(params).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
    return fetch(hassUrl() + '/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'same-origin'
    }).then((r) => {
      if (!r.ok) {
        const err = new Error(r.status === 400 || r.status === 403 ? 'Session Home Assistant expirée ou révoquée.' : 'Home Assistant a refusé la connexion (' + r.status + ').');
        err.auth = r.status === 400 || r.status === 403;
        throw err;
      }
      return r.json();
    });
  }

  // A session = { hassUrl, clientId, access_token, refresh_token, expires }.
  // Returns a token provider that refreshes the access token when needed.
  function provider(session, persistKey) {
    let refreshing = null;
    return {
      kind: persistKey === KEY ? 'oauth' : 'hass',
      hassUrl: session.hassUrl,
      getToken() {
        if (session.access_token && session.expires > Date.now() + 30000) return Promise.resolve(session.access_token);
        if (!refreshing) {
          refreshing = tokenRequest({ grant_type: 'refresh_token', refresh_token: session.refresh_token, client_id: session.clientId })
            .then((t) => {
              session.access_token = t.access_token;
              session.expires = Date.now() + t.expires_in * 1000;
              if (persistKey === KEY) write(KEY, session);
              refreshing = null;
              return session.access_token;
            }, (err) => { refreshing = null; throw err; });
        }
        return refreshing;
      },
      revoke() {
        if (persistKey !== KEY) return Promise.resolve();
        remove(KEY);
        return tokenRequest({ action: 'revoke', token: session.refresh_token }).catch(() => {});
      }
    };
  }

  // 1. Page embedded in the HA interface (sidebar "Page web"): reuse its live session.
  function fromParent() {
    try {
      if (window.parent === window || !window.parent.hassConnection) return null;
      if (window.parent.location.origin !== location.origin) return null;
      return window.parent.hassConnection.then((hc) => {
        const auth = hc.auth;
        return {
          kind: 'parent',
          hassUrl: auth.data.hassUrl || location.origin,
          getToken() {
            return auth.expired ? auth.refreshAccessToken().then(() => auth.accessToken) : Promise.resolve(auth.accessToken);
          },
          revoke() { return Promise.resolve(); }
        };
      });
    } catch (e) {
      return null; // cross-origin parent
    }
  }

  // 3. HA interface open in this same browser with "Rester connecté".
  function fromHassTokens() {
    const t = read('hassTokens');
    if (!t || !t.refresh_token || !t.clientId) return null;
    return provider({
      hassUrl: t.hassUrl || location.origin, clientId: t.clientId,
      access_token: t.access_token, refresh_token: t.refresh_token, expires: t.expires || 0
    }, null);
  }

  const Auth = {
    servedByHA,

    // Called once at startup. Resolves to a token provider, or null if a login is needed.
    // `allowAuto` = false after an explicit logout, so we don't log straight back in.
    init(allowAuto) {
      if (!servedByHA()) return Promise.resolve(null);
      const q = new URLSearchParams(location.search);
      const code = q.get('code');
      const state = q.get('state');
      if (code) {
        const expected = read(STATE_KEY, sessionStorage);
        remove(STATE_KEY, sessionStorage);
        q.delete('code'); q.delete('state');
        history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '') + location.hash);
        if (!expected || expected !== state) return Promise.reject(new Error('Retour de connexion inattendu, recommencez.'));
        return tokenRequest({ grant_type: 'authorization_code', code, client_id: clientId() }).then((t) => {
          const session = {
            hassUrl: hassUrl(), clientId: clientId(),
            access_token: t.access_token, refresh_token: t.refresh_token, expires: Date.now() + t.expires_in * 1000
          };
          write(KEY, session);
          return provider(session, KEY);
        });
      }
      if (!allowAuto) {
        const own = read(KEY);
        return Promise.resolve(own && own.refresh_token ? provider(own, KEY) : null);
      }
      const parent = fromParent();
      if (parent) return parent;
      const own = read(KEY);
      if (own && own.refresh_token) return Promise.resolve(provider(own, KEY));
      return Promise.resolve(fromHassTokens());
    },

    // Opens HA's login page; it comes back here with ?code=…
    login() {
      const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      write(STATE_KEY, state, sessionStorage);
      // Keep ?v=… so the anti-cache script doesn't reload the page during the exchange.
      const back = location.origin + location.pathname + location.search;
      location.href = hassUrl() + '/auth/authorize?response_type=code' +
        '&client_id=' + encodeURIComponent(clientId()) +
        '&redirect_uri=' + encodeURIComponent(back) +
        '&state=' + encodeURIComponent(state);
    },

    forget() { remove(KEY); }
  };

  HD.Auth = Auth;
})();
