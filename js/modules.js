// Module catalog. Each module type says which entities it can show (auto + picker)
// and how it renders. Layout (position, size, chosen entities) lives in layout.js.
window.HD = window.HD || {};

(function () {
  const IC = HD.IC;
  const M = HD.Model;

  // ---------- shared UI helpers ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (path, size = 20, sw = 1.8) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"></path></svg>`;
  const plural = (n, one, many) => n + ' ' + (n > 1 ? many : one);
  const head = (title, right = '') => `<div class="mod-head"><h2>${esc(title)}</h2>${right ? `<span class="muted small">${right}</span>` : ''}</div>`;
  const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  const dom = (d) => (st) => M.domainOf(st.entity_id) === d;
  HD.UI = { esc, icon, plural, head, avg };

  const TONES = [
    { id: 'chaud', name: 'Blanc chaud', color: '#FFC27A', label: 'Blanc chaud · 2700 K', kelvin: 2700 },
    { id: 'neutre', name: 'Blanc neutre', color: '#FFF1DC', label: 'Blanc neutre · 4000 K', kelvin: 4000 },
    { id: 'froid', name: 'Blanc froid', color: '#DCEBFF', label: 'Blanc froid · 6500 K', kelvin: 6500 },
    { id: 'rose', name: 'Ambiance rose', color: '#FF8FB1', label: 'Couleur · Rose', rgb: [255, 143, 177] }
  ];

  const ACCENTS = ['#FF9F0A', '#0A84FF', '#30D158', '#BF5AF2', '#FF375F', '#64D2FF', '#FFD60A', '#AC8E68'];

  // Temperature zones for thermometers: cold / comfort / warm / hot. Thresholds are per module.
  const ZONES = [
    { id: 'froid', name: 'Froid', color: '#64D2FF' },
    { id: 'confort', name: 'Confort', color: '#30D158' },
    { id: 'chaud', name: 'Chaud', color: '#FF9F0A' },
    { id: 'tres', name: 'Très chaud', color: '#FF453A' }
  ];
  const TEMP_DEFAULTS = { tLo: 18, tHi: 24, tHot: 27 };
  function tempThresholds(o = {}) {
    const n = (k) => (isFinite(Number(o[k])) && o[k] !== '' && o[k] != null ? Number(o[k]) : TEMP_DEFAULTS[k]);
    return { lo: n('tLo'), hi: n('tHi'), hot: n('tHot') };
  }
  // On by default; a module can switch it off (options.tempColors === false).
  const tempColorsOn = (o) => !o || o.tempColors !== false;
  function tempZone(t, o) {
    if (t == null || !isFinite(t) || !tempColorsOn(o)) return null;
    o = o || {};
    const th = tempThresholds(o);
    return t < th.lo ? ZONES[0] : t <= th.hi ? ZONES[1] : t <= th.hot ? ZONES[2] : ZONES[3];
  }

  function empty(msg) {
    return `<div class="mod-empty"><p class="muted small">${esc(msg)}</p><button class="btn-glass sm" data-act="mod-config">Choisir des appareils</button></div>`;
  }

  // ---------- Thermostat ----------
  function climate(m, list, c) {
    const st = list[0];
    const title = m.title || (c.global ? M.shortName(st) : 'Climat');
    const a = st.attributes;
    const target = c.targetTemp(st);
    const min = Number(a.min_temp != null ? a.min_temp : 7), max = Number(a.max_temp != null ? a.max_temp : 35);
    const isOff = st.state === 'off';
    let hum = a.current_humidity;
    if (hum == null) {
      const room = M.roomOf(c.index, st.entity_id);
      const h = room.ids.map((id) => c.states.get(id)).find((s) => s && M.isHumidity(s) && M.isAvail(s));
      if (h) hum = h.state;
    }
    const modes = (a.hvac_modes || []).slice().sort((x, y) => (x === 'off') - (y === 'off')).slice(0, 4);
    const btns = (cls) => `
      <button class="card hov round-btn ${cls}" aria-label="Baisser la température" data-act="temp" data-arg="-1" data-key="${m.id}:temp-" ${target == null ? 'disabled' : ''}>${icon(IC.minus, 20, 2.2)}</button>
      <button class="card hov round-btn ${cls}" aria-label="Monter la température" data-act="temp" data-arg="1" data-key="${m.id}:temp+" ${target == null ? 'disabled' : ''}>${icon(IC.plus, 20, 2.2)}</button>`;
    const seg = modes.length ? `<div class="segmented" style="grid-template-columns: repeat(${modes.length}, minmax(0, 1fr))">
      ${modes.map((x) => `<button aria-pressed="${st.state === x}" class="${st.state === x ? 'is-on' : ''}" data-act="mode" data-arg="${esc(x)}" data-key="${m.id}:mode:${esc(x)}">${esc(M.HVAC[x] || x)}</button>`).join('')}
    </div>` : '';
    const zc = a.current_temperature != null ? tempZone(Number(a.current_temperature), m.options) : null;
    const cur = a.current_temperature != null ? `Actuel <span${zc ? ` style="color: ${zc.color}; font-weight: 600"` : ''}>${esc(M.fmtNum(a.current_temperature))}°</span>` : '';
    const right = hum != null ? 'Hum. ' + esc(M.fmtNum(hum, 0)) + ' %' : '';

    if (m.h < 3) {
      return head(title, right) + `
      <div class="climate-compact">
        <div class="stack"><span class="dial-temp sm">${target == null ? '–' : esc(M.fmtNum(target))}°</span><span class="muted small">${cur}</span></div>
        <div class="dial-btns">${btns('')}</div>
      </div>${seg}`;
    }
    const ARC = 386.4;
    const f = target == null ? 0 : Math.max(0, Math.min(1, (target - min) / (max - min || 1)));
    return head(title, right) + `
    <div class="dial">
      <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="Consigne ${target == null ? 'inconnue' : esc(M.fmtNum(target)) + ' degrés'}">
        <circle cx="100" cy="100" r="82" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="14" stroke-linecap="round" stroke-dasharray="386.4 515.2" transform="rotate(135 100 100)"></circle>
        <circle cx="100" cy="100" r="82" fill="none" stroke="${isOff ? 'rgba(255,255,255,0.35)' : 'var(--accent)'}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(ARC * f).toFixed(1)} 515.2" transform="rotate(135 100 100)"></circle>
      </svg>
      <div class="dial-center"><span class="dial-temp">${target == null ? '–' : esc(M.fmtNum(target))}°</span><span class="muted small">${cur}</span></div>
    </div>
    <div class="dial-btns">${btns('lg')}</div>${seg}`;
  }

  // ---------- Lights ----------
  function lightState(lights) {
    const on = lights.filter((l) => l.state === 'on');
    const bri = on.length ? Math.round(on.reduce((s, l) => s + (l.attributes.brightness || 255), 0) / on.length / 2.55) : 0;
    const caps = lights.map(M.lightCaps);
    const tones = TONES.filter((t) => (t.kelvin ? caps.some((x) => x.ct) : caps.some((x) => x.color)));
    let tone = null;
    const ref = on[0];
    if (ref) {
      const a = ref.attributes;
      if (a.color_mode === 'color_temp' && a.color_temp_kelvin) {
        tone = tones.filter((t) => t.kelvin).sort((x, y) => Math.abs(x.kelvin - a.color_temp_kelvin) - Math.abs(y.kelvin - a.color_temp_kelvin))[0] || null;
      } else if (a.color_mode && !['brightness', 'onoff', 'color_temp'].includes(a.color_mode)) {
        tone = tones.find((t) => t.rgb) || null;
      }
    }
    return { on, bri, tones, tone };
  }

  function lights(m, list, c) {
    const ls = lightState(list);
    const sub = !ls.on.length ? 'Éteint' : ls.tone ? ls.tone.label : plural(ls.on.length, 'lampe allumée', 'lampes allumées');
    const title = m.title || (list.length > 1 ? `Éclairage · ${list.length} lampes` : M.shortName(list[0], c.roomName));
    return `
    <div class="row-between">
      <div class="row">
        <button class="light-icon${ls.on.length ? '' : ' is-off'}" data-act="lights-toggle" data-key="${m.id}:lt" aria-label="${ls.on.length ? 'Éteindre' : 'Allumer'} l'éclairage" aria-pressed="${ls.on.length > 0}">${icon(IC.bulb, 20, 1.9)}</button>
        <div class="stack"><h2>${esc(title)}</h2><span class="muted small">${esc(sub)}</span></div>
      </div>
      <span class="big-num" data-bri-num>${ls.bri} %</span>
    </div>
    <label class="slider">
      <span class="slider-fill" data-bri-fill style="width: ${ls.bri}%"></span>
      <input class="range" type="range" min="0" max="100" value="${ls.bri}" data-act="bri" data-key="${m.id}:bri" aria-label="Luminosité">
    </label>
    ${ls.tones.length && m.h > 1 ? `<div class="row tones">
      ${ls.tones.map((t) => `<button class="tone${ls.tone && ls.tone.id === t.id ? ' is-on' : ''}" aria-label="${t.name}" aria-pressed="${!!(ls.tone && ls.tone.id === t.id)}" data-act="tone" data-arg="${t.id}" data-key="${m.id}:tone:${t.id}"><span style="background: ${t.color}"></span></button>`).join('')}
    </div>` : ''}`;
  }

  // ---------- Scenes ----------
  function scenes(m, list, c) {
    const latest = list.filter((s) => isFinite(Date.parse(s.state))).sort((a, b) => Date.parse(b.state) - Date.parse(a.state))[0];
    return head(m.title || 'Scènes') + `<div class="scene-list" data-scroll="${m.id}">
    ${list.map((s) => {
      const sel = latest && latest.entity_id === s.entity_id;
      const name = M.shortName(s, c.roomName);
      const when = M.relTime(s.state);
      return `<button class="scene-btn${sel ? ' is-on' : ''}" aria-pressed="${!!sel}" data-act="scene" data-arg="${esc(s.entity_id)}" data-key="${m.id}:${esc(s.entity_id)}">
        <span class="scene-ic">${icon(M.sceneIcon(name), 18, 1.9)}</span>
        <span class="stack"><span>${esc(name)}</span><span class="scene-detail">${esc(when ? 'Activée ' + when : 'Jamais activée')}</span></span>
      </button>`;
    }).join('')}</div>`;
  }

  // ---------- Device tiles ----------
  function devices(m, list, c) {
    const items = list.map((st) => {
      const d = M.describe(st, c.global ? null : c.roomName);
      if (c.global) d.room = M.roomOf(c.index, st.entity_id).name;
      return d;
    }).sort((x, y) => (x.unavailable ? 1 : 0) - (y.unavailable ? 1 : 0));
    const tiles = items.map((d) => {
      const cls = `tile${d.on ? ' is-on' : ''}${d.unavailable ? ' is-unavail' : ''}`;
      const inner = `<span class="tile-ic">${icon(d.icon)}</span>
        <span class="stack"><span class="tile-name">${esc(d.name)}</span><span class="tile-status">${esc(d.room ? d.room + ' · ' + d.status : d.status)}</span></span>`;
      return d.action && !d.unavailable
        ? `<button class="${cls}" aria-pressed="${d.on}" data-act="dev" data-arg="${esc(d.id)}" data-key="${m.id}:${esc(d.id)}">${inner}</button>`
        : `<div class="${cls}" role="group" aria-label="${esc(d.name)} : ${esc(d.status)}">${inner}</div>`;
    }).join('');
    return (m.title ? head(m.title) : '') + `<div class="devices" data-scroll="${m.id}">${tiles}</div>`;
  }

  // ---------- Thermometers ----------
  function temperature(m, list, c) {
    const unit = (list[0] && list[0].attributes.unit_of_measurement) || '°C';
    const group = (m.options && m.options.group) || (c.global ? 'room' : 'sensor');
    let rows;
    if (group === 'room') {
      const byRoom = new Map();
      for (const st of list) {
        const r = M.roomOf(c.index, st.entity_id);
        // Sensors without a room (e.g. outdoor) keep their own row and name.
        const key = r.id === '__autres' ? st.entity_id : r.id;
        if (!byRoom.has(key)) byRoom.set(key, { room: r.id === '__autres' ? { id: r.id, name: M.shortName(st), sensor: true } : r, temps: [], hums: [] });
        const g = byRoom.get(key);
        if (M.isAvail(st)) g.temps.push(Number(st.state));
        const h = M.humidityFor(st, c.states, c.index);
        if (h != null) g.hums.push(h);
      }
      rows = c.roomOrder([...byRoom.values()], (g) => g.room.id).map((g) => ({
        key: g.room.sensor ? g.room.name : g.room.id, label: g.room.name, sub: g.temps.length > 1 ? plural(g.temps.length, 'capteur', 'capteurs') : '',
        temp: avg(g.temps), hum: avg(g.hums), room: g.room.sensor ? null : g.room.id
      }));
    } else {
      rows = list.map((st) => ({
        key: st.entity_id, label: M.shortName(st, c.global ? null : c.roomName),
        sub: c.global ? M.roomOf(c.index, st.entity_id).name : '',
        temp: M.isAvail(st) ? Number(st.state) : null, hum: M.humidityFor(st, c.states, c.index)
      }));
    }
    const temps = rows.map((r) => r.temp).filter((t) => t != null);
    const mean = avg(temps);
    const title = m.title || (c.global ? 'Températures' : 'Température');

    // Single value, or a small box: one big number.
    if (rows.length === 1 || (m.h === 1 && m.w === 1)) {
      const hums = rows.map((r) => r.hum).filter((h) => h != null);
      const sub = rows.length === 1 ? rows[0].label : 'Moyenne · ' + plural(rows.length, 'capteur', 'capteurs');
      const z = tempZone(mean, m.options);
      return head(title, hums.length ? 'Hum. ' + M.fmtNum(avg(hums), 0) + ' %' : '') + `
      <div class="temp-big"><span class="dial-temp"${z ? ` style="color: ${z.color}"` : ''}>${mean == null ? '–' : esc(M.fmtNum(mean))}<small>${esc(unit)}</small></span>
      <span class="muted small">${esc(sub)}${z ? ` · <span style="color: ${z.color}">${z.name}</span>` : ''}</span></div>`;
    }
    const lo = Math.min(...temps), hi = Math.max(...temps);
    const scaleLo = Math.min(lo, 15), scaleHi = Math.max(hi, 28);
    const right = temps.length ? `Moy. ${esc(M.fmtNum(mean))}° · ${esc(M.fmtNum(lo))}–${esc(M.fmtNum(hi))}°` : '';
    return head(title, right) + `<ul class="temp-list" data-scroll="${m.id}">
    ${rows.map((r) => {
      const pct = r.temp == null ? 0 : Math.round(((r.temp - scaleLo) / (scaleHi - scaleLo || 1)) * 100);
      const z = tempZone(r.temp, m.options);
      const tag = r.room ? `button class="temp-row hov" data-act="open-room" data-arg="${esc(r.room)}" data-key="${m.id}:${esc(r.key)}"` : 'div class="temp-row"';
      return `<li><${tag}>
        <span class="stack"><span class="tile-name">${esc(r.label)}</span><span class="muted small">${[r.sub, r.hum != null ? 'Hum. ' + M.fmtNum(r.hum, 0) + ' %' : ''].filter(Boolean).map(esc).join(' · ')}</span></span>
        <span class="temp-bar" aria-hidden="true"><span style="width: ${Math.max(4, pct)}%${z ? '; background: ' + z.color : ''}"></span></span>
        <span class="temp-val"${z ? ` style="color: ${z.color}" title="${z.name}"` : ''}>${r.temp == null ? '–' : esc(M.fmtNum(r.temp)) + '°'}</span>
      </${r.room ? 'button' : 'div'}></li>`;
    }).join('')}</ul>`;
  }

  // ---------- Any sensor ----------
  function sensor(m, list, c) {
    const tiles = list.map((st) => {
      const d = M.describe(st);
      const val = M.isAvail(st) ? (M.domainOf(st.entity_id) === 'sensor' ? M.fmtNum(st.state) : d.status) : '–';
      const unit = M.domainOf(st.entity_id) === 'sensor' ? st.attributes.unit_of_measurement || '' : '';
      return `<div class="value-tile">
        <span class="muted small">${esc(M.shortName(st, c.global ? null : c.roomName))}</span>
        <span class="big-num">${esc(val)}${unit ? `<small> ${esc(unit)}</small>` : ''}</span>
      </div>`;
    }).join('');
    return head(m.title || 'Capteurs') + `<div class="value-grid" data-scroll="${m.id}">${tiles}</div>`;
  }

  // ---------- Energy ----------
  function energy(m, list, c) {
    const toW = (s) => (s.attributes.unit_of_measurement === 'kW' ? Number(s.state) * 1000 : Number(s.state));
    const power = list.filter((s) => s.attributes.device_class === 'power' && M.isAvail(s)).sort((a, b) => toW(b) - toW(a));
    const total = list.filter((s) => s.attributes.device_class === 'energy' && M.isAvail(s));
    const maxW = Math.max(1, ...power.map(toW));
    const row = (s, bar) => `<li class="energy-row">
      <span class="row-between"><span class="stack"><span class="tile-name">${esc(M.shortName(s))}</span><span class="muted small">${esc(M.roomOf(c.index, s.entity_id).name)}</span></span>
      <span class="big-num sm">${esc(M.fmtNum(s.state))}<small> ${esc(s.attributes.unit_of_measurement || '')}</small></span></span>
      ${bar ? `<span class="meter"><span style="width: ${Math.round((toW(s) / maxW) * 100)}%"></span></span>` : ''}
    </li>`;
    return head(m.title || 'Énergie', power.length ? esc(M.fmtNum(power.reduce((a, s) => a + toW(s), 0) / 1000, 2)) + ' kW cumulés' : '') +
      `<ul class="energy-list" data-scroll="${m.id}">${power.map((s) => row(s, true)).join('')}${total.map((s) => row(s, false)).join('')}</ul>`;
  }

  // ---------- Weather ----------
  const WX_ICON = {
    sunny: 'sun', 'clear-night': 'moon', cloudy: 'cloud', partlycloudy: 'partly', fog: 'fog',
    rainy: 'rain', pouring: 'rain', 'snowy-rainy': 'snow', snowy: 'snow', hail: 'snow',
    lightning: 'storm', 'lightning-rainy': 'storm', windy: 'wind', 'windy-variant': 'wind', exceptional: 'spark'
  };
  const wxIcon = (cond) => IC[WX_ICON[cond]] || IC.cloud;

  function dayLabel(iso, i) {
    const d = new Date(iso);
    if (!isFinite(d)) return '';
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Auj.';
    const s = d.toLocaleDateString('fr-FR', { weekday: 'short' });
    return i === 0 && d - today < 0 ? 'Auj.' : s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Daily items (twice_daily is folded into one entry per day).
  function dailyItems(fc) {
    if (!fc || !fc.items || fc.type === 'hourly') return [];
    if (fc.type !== 'twice_daily') return fc.items;
    const byDay = new Map();
    for (const f of fc.items) {
      const k = new Date(f.datetime).toDateString();
      const g = byDay.get(k) || { datetime: f.datetime, condition: f.condition, temperature: -Infinity, templow: Infinity, precipitation_probability: 0 };
      g.temperature = Math.max(g.temperature, f.temperature);
      g.templow = Math.min(g.templow, f.templow != null ? f.templow : f.temperature);
      g.precipitation_probability = Math.max(g.precipitation_probability, f.precipitation_probability || 0);
      if (f.is_daytime) g.condition = f.condition;
      byDay.set(k, g);
    }
    return [...byDay.values()];
  }

  function weather(m, list, c) {
    const st = list[0];
    const a = st.attributes;
    const unit = a.temperature_unit || '°C';
    const fc = c.forecast ? c.forecast(st) : null;
    const days = dailyItems(fc);
    const today = days[0];
    const extra = [
      today && today.templow != null ? `${M.fmtNum(today.templow, 0)}° / ${M.fmtNum(today.temperature, 0)}°` : '',
      a.humidity != null ? 'Hum. ' + M.fmtNum(a.humidity, 0) + ' %' : '',
      m.w > 1 && a.wind_speed != null ? 'Vent ' + M.fmtNum(a.wind_speed, 0) + ' ' + (a.wind_speed_unit || 'km/h') : ''
    ].filter(Boolean).join(' · ');
    const z = tempZone(Number(a.temperature), m.options);

    // More room = more forecast: a row of days when wide, a list when tall.
    let more = '';
    if (days.length && m.w >= 2) {
      const n = Math.min(days.length, m.w === 2 ? 5 : 7);
      more = `<span class="fc-row" style="grid-template-columns: repeat(${n}, minmax(0, 1fr))">${days.slice(0, n).map((f, i) => `
        <span class="fc-day"><span class="muted small">${esc(dayLabel(f.datetime, i))}</span>${icon(wxIcon(f.condition), 22, 1.7)}
        <span class="fc-hi">${esc(M.fmtNum(f.temperature, 0))}°</span><span class="muted small">${f.templow != null ? esc(M.fmtNum(f.templow, 0)) + '°' : ''}</span></span>`).join('')}</span>`;
    } else if (days.length && m.h >= 3) {
      more = `<span class="fc-list">${days.slice(1, m.h === 3 ? 4 : 6).map((f, i) => `
        <span class="fc-line"><span class="fc-name">${esc(dayLabel(f.datetime, i + 1))}</span>${icon(wxIcon(f.condition), 18, 1.7)}
        <span class="muted small">${f.templow != null ? esc(M.fmtNum(f.templow, 0)) + '°' : ''}</span><span class="fc-hi">${esc(M.fmtNum(f.temperature, 0))}°</span></span>`).join('')}</span>`;
    }
    const hint = fc && fc.items ?'<span class="fc-hint muted small">Touchez pour les prévisions détaillées</span>' : '';
    return head(m.title || 'Météo', esc(M.shortName(st))) + `
    <button class="weather-tap" data-act="weather-open" data-arg="${esc(st.entity_id)}" data-key="${m.id}:wx" aria-label="Prévisions détaillées ${esc(M.shortName(st))}">
      <span class="weather">
        <span class="weather-ic">${icon(wxIcon(st.state), 32, 1.6)}</span>
        <span class="stack"><span class="dial-temp sm"${z ? ` style="color: ${z.color}"` : ''}>${esc(M.fmtNum(a.temperature, 0))}<small>${esc(unit)}</small></span>
        <span class="muted small">${esc(M.WEATHER[st.state] || st.state)}${extra ? ' · ' + esc(extra) : ''}</span></span>
      </span>
      ${more}${m.h >= 2 && !more ? hint : ''}
    </button>`;
  }

  // ---------- Calendar ----------
  const CAL_COLORS = ['#0A84FF', '#FF9F0A', '#30D158', '#BF5AF2', '#FF375F', '#64D2FF', '#FFD60A'];

  // HA gives { dateTime } for timed events and { date: 'YYYY-MM-DD' } for all-day ones (end exclusive).
  function parseWhen(w) {
    if (!w) return null;
    if (w.dateTime) return new Date(w.dateTime);
    const p = String(w.date || w).split('-').map(Number);
    return p.length === 3 ? new Date(p[0], p[1] - 1, p[2]) : new Date(w);
  }
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const hm = (d) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const shortDate = (d) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

  function calEvents(list, raw) {
    const out = [];
    list.forEach((st, i) => {
      const items = (raw && raw[st.entity_id]) || [];
      for (const ev of items) {
        const start = parseWhen(ev.start), end = parseWhen(ev.end) || start;
        if (!start || !isFinite(start)) continue;
        out.push({
          cal: st.entity_id, calName: M.shortName(st), color: CAL_COLORS[i % CAL_COLORS.length],
          title: ev.summary || '(Sans titre)', start, end, allDay: !!(ev.start && ev.start.date && !ev.start.dateTime),
          location: ev.location || '', description: ev.description || ''
        });
      }
    });
    return out.sort((a, b) => a.start - b.start || (b.allDay - a.allDay));
  }

  function dayTitle(d) {
    const today = startOfDay(new Date());
    const diff = Math.round((startOfDay(d) - today) / 86400000);
    if (diff === 0) return "Aujourd'hui";
    if (diff === 1) return 'Demain';
    const s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function whenLabel(ev) {
    const now = new Date();
    if (ev.allDay) {
      const lastDay = new Date(ev.end.getTime() - 1);
      return startOfDay(lastDay) > startOfDay(ev.start) ? "Jusqu'au " + shortDate(lastDay) : 'Journée';
    }
    if (ev.start <= now && ev.end > now) return 'En cours · jusqu\'à ' + hm(ev.end);
    const sameDay = startOfDay(ev.end).getTime() === startOfDay(ev.start).getTime();
    return hm(ev.start) + ' – ' + (sameDay ? hm(ev.end) : shortDate(ev.end) + ' ' + hm(ev.end));
  }

  function calendar(m, list, c) {
    const days = Number(m.options && m.options.days) || 7;
    const data = c.calendar(list, days);
    const events = calEvents(list, data.raw).filter((ev) => ev.end > new Date());
    c.rememberEvents(m.id, events);
    const legend = list.length > 1 && m.w > 1
      ? list.map((st, i) => `<span class="cal-legend"><i style="background: ${CAL_COLORS[i % CAL_COLORS.length]}"></i>${esc(M.shortName(st))}</span>`).join('') : '';
    const title = m.title || 'Agenda';
    if (!events.length) {
      const msg = data.error ? data.error : data.loading ? 'Chargement des événements…' : `Rien de prévu ${days === 1 ? "aujourd'hui" : 'sur les ' + days + ' prochains jours'}.`;
      return head(title, legend) + `<div class="mod-empty"><p class="muted small">${esc(msg)}</p></div>`;
    }
    const item = (ev, idx) => `<li><button class="cal-ev" data-act="event-open" data-arg="${esc(m.id)}|${idx}" data-key="${m.id}:ev${idx}" style="--cal: ${ev.color}">
      <span class="cal-bar" aria-hidden="true"></span>
      <span class="stack grow"><span class="cal-title">${esc(ev.title)}</span>
      <span class="muted small">${esc(whenLabel(ev))}${ev.location ? ' · ' + esc(ev.location) : ''}${list.length > 1 && m.w === 1 ? ' · ' + esc(ev.calName) : ''}</span></span>
    </button></li>`;
    // Small box: only the next event.
    if (m.h === 1) return head(title, dayTitle(events[0].start < new Date() ? new Date() : events[0].start)) + `<ul class="cal-list">${item(events[0], 0)}</ul>`;
    // Agenda grouped by day (ongoing events count for today).
    const today = startOfDay(new Date());
    let html = '', lastDay = null;
    events.forEach((ev, idx) => {
      const day = ev.start < today ? today : startOfDay(ev.start);
      if (!lastDay || day.getTime() !== lastDay.getTime()) {
        html += `${lastDay ? '</ul>' : ''}<h3 class="cal-day">${esc(dayTitle(day))}</h3><ul class="cal-list">`;
        lastDay = day;
      }
      html += item(ev, idx);
    });
    return head(title, legend) + `<div class="cal-scroll" data-scroll="${m.id}">${html}</ul></div>`;
  }

  // ---------- Notes ----------
  function notes(m) {
    const o = m.options || {};
    const when = o.updated ? M.relTime(new Date(o.updated).toISOString()) : null;
    return head(m.title || 'Notes', when ? 'Modifiée ' + esc(when) : '') +
      `<textarea class="note" data-act="note" data-key="${m.id}:note" data-scroll="${m.id}:note" placeholder="Écrire une note… (courses, rappels, code wifi invités)" aria-label="${esc(m.title || 'Notes')}">${esc(o.text || '')}</textarea>`;
  }

  // ---------- Rooms overview ----------
  function rooms(m, list, c) {
    const sums = c.roomSummaries();
    return head(m.title || 'Pièces') + `<div class="room-cards" data-scroll="${m.id}">
    ${sums.map((v) => `
      <button class="card hov room-card" data-act="open-room" data-arg="${esc(v.room.id)}" data-key="${m.id}:${esc(v.room.id)}">
        <span class="row-between"><span class="room-card-name">${esc(v.room.name)}</span>${v.temp != null ? (() => {
          const z = tempZone(v.temp, m.options);
          return `<span class="${z ? 'room-temp' : 'muted'}"${z ? ` style="color: ${z.color}" title="${z.name}"` : ''}>${esc(M.fmtNum(v.temp))}°</span>`;
        })() : ''}</span>
        <span class="room-icons" aria-hidden="true">${v.activeIcons.slice(0, 5).map((p) => `<span class="mini-ic">${icon(p, 16)}</span>`).join('')}</span>
        <span class="muted small">${plural(v.active, 'actif', 'actifs')} sur ${v.total}</span>
      </button>`).join('')}</div>`;
  }

  // ---------- Automations & scripts ----------
  function automations(m, list, c) {
    const items = list.slice().sort((a, b) => M.shortName(a).localeCompare(M.shortName(b), 'fr')).map((s) => {
      const name = M.shortName(s);
      if (M.domainOf(s.entity_id) === 'script') {
        return `<li><button class="list-item hov" data-act="script" data-arg="${esc(s.entity_id)}" data-key="${m.id}:${esc(s.entity_id)}">
          <span class="scene-ic">${icon(IC.play, 16, 1.9)}</span>
          <span class="stack grow"><span>${esc(name)}</span><span class="muted small">${s.state === 'on' ? 'En cours…' : 'Script · lancer'}</span></span></button></li>`;
      }
      const on = s.state === 'on';
      const when = M.relTime(s.attributes.last_triggered);
      return `<li><div class="list-item">
        <span class="scene-ic">${icon(IC.robot, 18, 1.9)}</span>
        <span class="stack grow"><span>${esc(name)}</span><span class="muted small">${esc(when ? 'Déclenchée ' + when : 'Jamais déclenchée')}</span></span>
        <button class="switch${on ? ' is-on' : ''}" role="switch" aria-checked="${on}" aria-label="Activer ${esc(name)}" data-act="auto-toggle" data-arg="${esc(s.entity_id)}" data-key="${m.id}:${esc(s.entity_id)}"><span></span></button>
      </div></li>`;
    }).join('');
    return head(m.title || 'Automatisations') + `<ul class="auto-list" data-scroll="${m.id}">${items}</ul>`;
  }

  // ---------- catalog ----------
  // auto: entities picked automatically within the scope; pick: what the picker offers.
  const T = {
    climate: { name: 'Thermostat', desc: 'Consigne, modes et humidité d\'un thermostat ou d\'une clim.', icon: IC.snow, w: 1, h: 4, single: true,
      pick: dom('climate'), render: climate },
    lights: { name: 'Éclairage', desc: 'Intensité et teinte d\'un groupe de lampes.', icon: IC.bulb, w: 2, h: 2,
      auto: (s) => dom('light')(s) && M.isAvail(s) && M.lightCaps(s).dimmable, pick: dom('light'), render: lights },
    temperature: { name: 'Températures', desc: 'Vos thermomètres, par capteur ou moyennés par pièce, avec l\'humidité.', icon: IC.thermo, w: 2, h: 2,
      pick: M.isTemp, render: temperature, options: true },
    devices: { name: 'Appareils', desc: 'Tuiles à toucher : prises, volets, serrures, médias, capteurs de sécurité…', icon: IC.grid, w: 2, h: 2,
      pick: (s) => M.isGridEntity(s), render: devices, bare: true },
    scenes: { name: 'Scènes', desc: 'Lancer une scène Home Assistant.', icon: IC.spark, w: 1, h: 4, pick: dom('scene'), render: scenes },
    sensor: { name: 'Capteurs', desc: 'N\'importe quelle valeur : CO₂, luminosité, batterie, consommation…', icon: IC.dot, w: 1, h: 2, manual: true,
      pick: (s) => ['sensor', 'binary_sensor', 'input_number', 'counter'].includes(M.domainOf(s.entity_id)), render: sensor },
    energy: { name: 'Énergie', desc: 'Puissance instantanée et consommation.', icon: IC.bolt, w: 2, h: 2,
      pick: (s) => M.isSensorClass(s, 'power') || M.isSensorClass(s, 'energy'), render: energy },
    weather: { name: 'Météo', desc: 'Conditions actuelles ; agrandi, les prévisions de la semaine. Touchez-le pour le détail.', icon: IC.cloud, w: 2, h: 2, single: true, pick: dom('weather'), render: weather },
    calendar: { name: 'Calendrier', desc: 'Agenda des prochains jours depuis vos calendriers Home Assistant (Google, iCal, local…).', icon: IC.calendar, w: 2, h: 3,
      pick: dom('calendar'), render: calendar },
    notes: { name: 'Notes', desc: 'Un mémo libre : liste de courses, rappels, code wifi invités… Enregistré dans votre compte.', icon: IC.note, w: 1, h: 2, noEntities: true, render: notes },
    automations: { name: 'Automatisations', desc: 'Activer/désactiver les automatisations, lancer les scripts.', icon: IC.robot, w: 2, h: 4,
      pick: (s) => ['automation', 'script'].includes(M.domainOf(s.entity_id)), render: automations },
    rooms: { name: 'Pièces', desc: 'Résumé de chaque pièce ; un clic ouvre la pièce.', icon: IC.home, w: 4, h: 2, noEntities: true, render: rooms }
  };

  HD.Modules = { types: T, lightState, TONES, ACCENTS, ZONES, tempThresholds, tempZone, tempColorsOn, wxIcon, dayLabel, dailyItems, whenLabel, dayTitle };
})();
