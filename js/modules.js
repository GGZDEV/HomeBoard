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

  const ACCENTS = ['#F5C542', '#FF9F0A', '#0A84FF', '#30D158', '#BF5AF2', '#FF375F', '#64D2FF', '#AC8E68'];

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
    // Narrow module: the average only, so the title stays readable.
    const right = !temps.length ? '' : m.w === 1 ? `Moy. ${esc(M.fmtNum(mean))}°` : `Moy. ${esc(M.fmtNum(mean))}° · ${esc(M.fmtNum(lo))}–${esc(M.fmtNum(hi))}°`;
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
    } else if (days.length && m.h >= 2) {
      more = `<span class="fc-list">${days.slice(1, m.h === 2 ? 3 : m.h === 3 ? 4 : 6).map((f, i) => `
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

  // Traffic info published as calendar events ("RER D : travaux…", "Ligne D : modification…"):
  // the train module shows them; agendas hide them unless the module asks for them (option "traffic").
  const WARN_PATH = 'M12 3 2 20h20z M12 10v4 M12 17v.5';
  const TRAFFIC_RE = /^\s*(RER|Ligne|Transilien|Trains?|TER|M[ée]tro|Tram|Bus)\b[^:]{0,24}:/i;
  const isTraffic = (ev) => TRAFFIC_RE.test(ev.title);
  const agendaEvents = (events, o) => (o && o.traffic ? events : events.filter((ev) => !isTraffic(ev)));

  // Display modes (option "view"), from the densest to the most detailed. "Semaine" needs width 2+.
  const CAL_VIEWS = [['compact', 'Compact'], ['list', 'Liste'], ['detail', 'Détaillé'], ['week', 'Semaine']];
  const cleanDesc = (s) => String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Event list for a calendar module / the home agenda. o: { id, view, days, multi (several calendars), narrow (width 1) }
  function calBody(events, o) {
    let view = o.view || 'list';
    if (view === 'week' && o.narrow) view = 'compact';
    const today = startOfDay(new Date());
    const open = (i) => `data-act="event-open" data-arg="${esc(o.id)}|${i}" data-key="${esc(o.id)}:ev${i}"`;
    if (view === 'week') {
      // One column per day; events spanning several days show in each.
      const n = Math.min(7, Math.max(1, o.days || 7));
      const cols = Array.from({ length: n }, (_, k) => {
        const d0 = new Date(today); d0.setDate(d0.getDate() + k);
        const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
        const evs = events.map((ev, i) => [ev, i]).filter(([ev]) => ev.start < d1 && ev.end > d0);
        const label = k === 0 ? 'Auj.' : cap(d0.toLocaleDateString('fr-FR', { weekday: 'short' }));
        return `<div class="cal-col${k === 0 ? ' is-today' : ''}"><div class="cal-col-head"><span>${esc(label)}</span><b>${d0.getDate()}</b></div>
          <div class="cal-col-body">${evs.map(([ev, i]) => `<button class="cal-chip" ${open(i)} style="--cal: ${ev.color}">
            <span class="cal-chip-time">${ev.allDay || ev.start < d0 ? 'Journée' : hm(ev.start)}</span><span class="cal-chip-title">${esc(ev.title)}</span></button>`).join('')}</div></div>`;
      });
      return `<div class="cal-week" style="grid-template-columns: repeat(${n}, minmax(0, 1fr))">${cols.join('')}</div>`;
    }
    let html = '', last = null;
    events.forEach((ev, i) => {
      const day = ev.start < today ? today : startOfDay(ev.start);
      if (last !== day.getTime()) {
        html += `${last != null ? '</ul>' : ''}<h3 class="cal-day">${esc(dayTitle(day))}</h3><ul class="cal-list${view === 'compact' ? ' is-compact' : ''}">`;
        last = day.getTime();
      }
      if (view === 'compact') {
        // One line: time, title.
        const time = ev.allDay ? 'Journée' : ev.start < today ? 'En cours' : hm(ev.start);
        html += `<li><button class="cal-row" ${open(i)} style="--cal: ${ev.color}"><span class="cal-dot"></span><span class="cal-time">${time}</span><span class="cal-row-title">${esc(ev.title)}</span></button></li>`;
      } else {
        const detail = view === 'detail';
        const sub = [whenLabel(ev), ev.location, o.multi && (detail || o.narrow) ? ev.calName : ''].filter(Boolean).map(esc).join(' · ');
        const desc = detail ? cleanDesc(ev.description) : '';
        html += `<li><button class="cal-ev${detail ? ' is-detail' : ''}" ${open(i)} style="--cal: ${ev.color}"><span class="cal-bar" aria-hidden="true"></span>
          <span class="stack grow"><span class="cal-title">${esc(ev.title)}</span><span class="muted small">${sub}</span>${desc ? `<span class="cal-desc small">${esc(desc)}</span>` : ''}</span></button></li>`;
      }
    });
    return html + (last != null ? '</ul>' : '');
  }

  function calendar(m, list, c) {
    const days = Number(m.options && m.options.days) || 7;
    const data = c.calendar(list, days);
    const events = agendaEvents(calEvents(list, data.raw).filter((ev) => ev.end > new Date()), m.options);
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
    // Agenda grouped by day (ongoing events count for today), in the chosen display mode.
    const body = calBody(events, { id: m.id, view: m.options.view, days, multi: list.length > 1, narrow: m.w === 1 });
    return head(title, legend) + `<div class="cal-scroll" data-scroll="${m.id}">${body}</div>`;
  }

  // ---------- Next departures (Île-de-France Mobilités, SIRI Lite via a HA REST sensor) ----------
  // Known lines (referentiel-des-lignes IDFM): badge text and official color.
  const LINES = {
    C01728: { mode: 'RER', name: 'D', color: '#008b5b' },
    C01731: { mode: 'Transilien', name: 'R', color: '#f49fb3', fg: '#1c1c1e' }
  };
  const val = (x) => (Array.isArray(x) ? (x[0] && x[0].value) : x && x.value !== undefined ? x.value : x) || '';

  // SIRI MonitoredStopVisit -> { time, aimed, delay, cancelled, destination, direction, mission, platform, line }
  function departures(st) {
    const visits = (st && st.attributes && st.attributes.MonitoredStopVisit) || [];
    const now = Date.now();
    return visits.map((v) => {
      const j = v.MonitoredVehicleJourney || {};
      const call = j.MonitoredCall || {};
      const exp = Date.parse(call.ExpectedDepartureTime || call.ExpectedArrivalTime || '');
      const aimed = Date.parse(call.AimedDepartureTime || call.AimedArrivalTime || '');
      const time = isFinite(exp) ? exp : aimed;
      const status = String(call.DepartureStatus || call.ArrivalStatus || '').toLowerCase();
      const lineId = (String(val(j.LineRef)).match(/C\d{5}/) || [])[0];
      return {
        time, aimed: isFinite(aimed) ? aimed : null,
        delay: isFinite(exp) && isFinite(aimed) ? Math.round((exp - aimed) / 60000) : 0,
        cancelled: status === 'cancelled',
        destination: val(j.DestinationName) || val(call.DestinationDisplay) || '',
        direction: val(j.DirectionName) || '',
        mission: val(j.JourneyNote) || val(j.VehicleJourneyName) || '',
        platform: val(call.DeparturePlatformName) || val(call.ArrivalPlatformName) || '',
        line: LINES[lineId] || null
      };
    }).filter((d) => isFinite(d.time) && d.time > now - 30000).sort((a, b) => a.time - b.time);
  }

  // Directions seen in the data, for the module's direction filter.
  function transitDirections(st) {
    return [...new Set(departures(st).map((d) => d.direction || d.destination).filter(Boolean))];
  }

  // Disruptions for the module's line: cancellations / delays within the hour (from the departures)
  // and the traffic events of the HA calendars ("RER D : travaux…"). Each event opens its detail.
  function trafficInfo(m, line, deps, c) {
    const out = [];
    const soon = deps.filter((d) => d.time < Date.now() + 3600000);
    const cancelled = soon.filter((d) => d.cancelled).length;
    const maxDelay = Math.max(0, ...soon.filter((d) => !d.cancelled).map((d) => d.delay));
    if (cancelled || maxDelay >= 3) {
      const what = [cancelled ? plural(cancelled, 'train supprimé', 'trains supprimés') : '', maxDelay >= 3 ? 'retards jusqu\'à +' + maxDelay + ' min' : ''].filter(Boolean).join(' · ');
      out.push(`<div class="traffic-item is-live">${icon(WARN_PATH, 16, 2)}<span class="stack"><span class="traffic-title">${esc(what)}</span><span class="muted small">Dans l'heure qui vient</span></span></div>`);
    }
    const cals = c.index ? [...c.index.visible].map((id) => c.states.get(id)).filter((s) => s && M.domainOf(s.entity_id) === 'calendar') : [];
    if (cals.length && c.calendar) {
      const data = c.calendar(cals, 3);
      const mine = new RegExp('^\\s*(RER|Ligne|Transilien)\\s*' + line.name + '\\b', 'i');
      const now = new Date();
      const evs = calEvents(cals, data.raw).filter((ev) => ev.end > now && isTraffic(ev) && mine.test(ev.title));
      c.rememberEvents(m.id + ':traffic', evs);
      const max = m.h <= 2 ? 1 : m.h === 3 ? 2 : 3;
      evs.slice(0, max).forEach((ev, i) => {
        out.push(`<button class="traffic-item" data-act="event-open" data-arg="${esc(m.id)}:traffic|${i}" data-key="${m.id}:tr${i}">${icon(WARN_PATH, 16, 2)}
          <span class="stack"><span class="traffic-title">${esc(ev.title.replace(TRAFFIC_RE, '').trim() || ev.title)}</span><span class="muted small">${esc(whenLabel(ev))}</span></span></button>`);
      });
      if (evs.length > max) out.push(`<span class="muted small traffic-more">+ ${plural(evs.length - max, 'autre info trafic', 'autres infos trafic')}</span>`);
    }
    return out.length ? `<div class="traffic">${out.join('')}</div>` : '';
  }

  function transit(m, list, c) {
    const st = list[0];
    const o = m.options || {};
    let deps = departures(st);
    const dirOf = (d) => d.direction || d.destination;
    if (o.direction) deps = deps.filter((d) => dirOf(d) === o.direction);
    const line = (deps[0] && deps[0].line) || LINES.C01728;
    const badge = `<span class="line-badge" style="background: ${line.color}; color: ${line.fg || '#fff'}" aria-label="${esc(line.mode + ' ' + line.name)}">${esc(line.name)}</span>`;
    const updated = M.relTime(st.last_updated);
    const head2 = `<div class="mod-head"><h2 class="row transit-title">${badge}<span>${esc(m.title || (line.mode + ' ' + line.name + ' · ' + M.shortName(st)))}</span></h2>${updated ? `<span class="muted small">Mis à jour ${esc(updated)}</span>` : ''}</div>`;
    const infos = trafficInfo(m, line, deps, c);
    if (!deps.length) {
      const noData = !(st.attributes && st.attributes.MonitoredStopVisit);
      return head2 + infos + `<div class="mod-empty"><p class="muted small">${noData ? "Aucune donnée reçue : vérifiez la clé API IDFM dans Home Assistant." : 'Aucun départ annoncé pour le moment.'}</p></div>`;
    }
    const max = m.h <= 1 ? 1 : m.h === 2 ? 4 : m.h === 3 ? 6 : 9;
    const row = (d) => {
      const mins = Math.max(0, Math.round((d.time - Date.now()) / 60000));
      const t = new Date(d.time).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const late = !d.cancelled && d.delay >= 1;
      return `<li class="dep${d.cancelled ? ' is-cancelled' : ''}${late ? ' is-late' : ''}">
        <span class="dep-time"><span class="dep-mins">${d.cancelled ? '—' : mins === 0 ? 'À quai' : mins + ' min'}</span><span class="muted small">${esc(t)}</span></span>
        <span class="stack grow"><span class="dep-dest">${esc(d.destination || d.direction)}</span>
          <span class="small dep-info">${d.mission ? `<span class="dep-mission">${esc(d.mission)}</span>` : ''}${d.platform ? `<span>Voie ${esc(d.platform)}</span>` : ''}${d.cancelled ? '<span class="dep-bad">Supprimé</span>' : late ? `<span class="dep-warn">+${d.delay} min</span>` : ''}</span></span>
      </li>`;
    };
    // Wide module without a direction filter: one column per direction.
    const dirs = [...new Set(deps.map(dirOf))];
    if (!o.direction && m.w >= 2 && dirs.length >= 2) {
      return head2 + infos + `<div class="dep-cols" style="grid-template-columns: repeat(${Math.min(dirs.length, m.w)}, minmax(0, 1fr))">${dirs.slice(0, m.w).map((dir) =>
        `<div class="dep-col" data-scroll="${m.id}:${esc(dir)}"><h3 class="cal-day">Vers ${esc(dir)}</h3><ul class="dep-list">${deps.filter((d) => dirOf(d) === dir).slice(0, max).map(row).join('')}</ul></div>`).join('')}</div>`;
    }
    return head2 + infos + `<ul class="dep-list" data-scroll="${m.id}">${deps.slice(0, max).map(row).join('')}</ul>`;
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

  // ---------- Music (Spotify through Home Assistant, or any media player) ----------
  const isSpotify = (s) => /spotify/.test(s.entity_id) || /spotify/i.test(String(s.attributes.app_name || ''));
  const mmss = (sec) => { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
  // Current position in seconds: HA only sends it on changes, so extrapolate while playing.
  function mediaPos(st, now) {
    const a = st.attributes;
    let pos = Number(a.media_position) || 0;
    if (st.state === 'playing' && a.media_position_updated_at) pos += ((now || Date.now()) - Date.parse(a.media_position_updated_at)) / 1000;
    const dur = Number(a.media_duration) || 0;
    return dur ? Math.min(pos, dur) : pos;
  }

  function media(m, list, c) {
    const st = list[0];
    const a = st.attributes;
    const playing = st.state === 'playing';
    const active = playing || st.state === 'paused';
    const off = M.UNAVAILABLE.includes(st.state);
    const spotify = isSpotify(st);
    const art = active && a.entity_picture ? c.mediaUrl(a.entity_picture) : '';
    const dur = Number(a.media_duration) || 0;
    const pos = mediaPos(st);
    const srcs = Array.isArray(a.source_list) ? a.source_list : [];
    const k = (s) => `${m.id}:${s}`;
    const btn = (cmd, ic, label, extra = '') => `<button class="media-btn${extra}" data-act="media-cmd" data-arg="${cmd}" data-key="${k(cmd)}" aria-label="${label}" title="${label}" ${off ? 'disabled' : ''}>${icon(ic, cmd === 'play_pause' ? 26 : 20, 2)}</button>`;
    const repeat = a.repeat || 'off';
    const what = off ? 'Indisponible' : active ? (a.media_title || 'Lecture en cours')
      : srcs.length && !a.source ? 'Choisissez un appareil' : 'Rien en lecture';
    const who = active ? [a.media_artist, a.media_album_name].filter(Boolean).join(' · ') : (spotify ? 'Lancez une playlist ou reprenez la lecture' : M.shortName(st, c.roomName));
    // Two layouts, after the Spotify app: a compact card (cover beside the title) on small sizes,
    // the big cover on top from 2×2 (or 1×3) up.
    const big = (m.w >= 2 && m.h >= 2) || m.h >= 3;
    const tiny = m.w === 1 && m.h === 1;
    const controls = `<div class="media-ctrls">
        ${big ? btn('shuffle', IC.shuffle, a.shuffle ? 'Lecture aléatoire activée' : 'Lecture aléatoire', a.shuffle ? ' is-on' : '') : ''}
        ${tiny ? '' : btn('prev', IC.prev, 'Précédent')}
        ${btn('play_pause', playing ? IC.pause : IC.play, playing ? 'Pause' : 'Lecture', ' is-main')}
        ${btn('next', IC.next, 'Suivant')}
        ${big ? btn('repeat', IC.repeat, repeat === 'one' ? 'Répéter le titre' : repeat === 'all' ? 'Répéter tout' : 'Répéter', repeat !== 'off' ? ' is-on' + (repeat === 'one' ? ' is-one' : '') : '') : ''}
      </div>`;
    const vol = a.volume_level != null ? Math.round(Number(a.volume_level) * 100) : null;
    const img = (cls) => art ? `<img class="${cls}" src="${esc(art)}" alt="" loading="lazy">` : '';
    const text = `<div class="stack media-text"><span class="media-title">${esc(what)}</span>${who ? `<span class="media-who">${esc(who)}</span>` : ''}</div>`;
    const progress = `<div class="media-progress${dur ? '' : ' is-empty'}" data-media-pos data-pos="${pos}" data-at="${Date.now()}" data-dur="${dur || 1}" data-playing="${playing && dur ? 1 : 0}">
      <span class="mp-time" data-cur>${dur ? mmss(pos) : '0:00'}</span>
      <span class="mp-bar"><i style="width: ${dur ? Math.min(100, (pos / dur) * 100).toFixed(2) : 0}%"></i></span>
      <span class="mp-time">${dur ? mmss(dur) : '0:00'}</span></div>`;
    // Speaker picker: an icon, with the (invisible) list of Spotify Connect devices on top of it.
    const deviceIc = srcs.length
      ? `<label class="media-ic" title="${esc(a.source || 'Choisir un appareil')}"><span class="sr-only">Appareil de lecture</span>${icon(IC.tv, 18, 1.8)}
          <select data-act="media-source" data-key="${k('src')}" ${off ? 'disabled' : ''}>
            ${a.source ? '' : '<option value="">Choisir un appareil…</option>'}
            ${srcs.map((s) => `<option value="${esc(s)}"${s === a.source ? ' selected' : ''}>${esc(s)}</option>`).join('')}
          </select></label>`
      : `<span class="media-ic is-static" title="${esc(a.source || '')}">${icon(IC.tv, 18, 1.8)}</span>`;
    const volHtml = vol != null
      ? `<input class="thin-range" type="range" min="0" max="100" value="${vol}" style="--v: ${vol}%" data-act="media-vol" data-key="${k('vol')}" aria-label="Volume" ${off ? 'disabled' : ''}>`
      : '<span class="grow"></span>';
    const browse = `<button class="media-ic" data-act="media-browse" data-arg="${esc(st.entity_id)}" data-key="${k('browse')}" ${off ? 'disabled' : ''} aria-label="${spotify ? 'Playlists' : 'Bibliothèque'}" title="${spotify ? 'Playlists' : 'Bibliothèque'}">${icon(IC.list, 18, 1.8)}</button>`;
    const foot = `<div class="media-foot">${deviceIc}${volHtml}${browse}</div>`;
    const cls = `media-layout${spotify ? ' is-spotify' : ''} ${big ? 'ml-big' : 'ml-card'}${tiny ? ' ml-tiny' : ''}`;
    if (!big) {
      return `<div class="${cls}">
        <div class="media-now"><div class="media-art">${img('fg') || icon(IC.music, 26, 1.8)}</div>${text}${controls}</div>
        ${progress}${foot}</div>`;
    }
    return `<div class="${cls}">
      <div class="media-hero">${img('bg')}${img('fg') || `<span class="media-ph">${icon(IC.music, 40, 1.6)}</span>`}
        ${spotify ? '<span class="spotify-dot" title="Spotify"></span>' : ''}</div>
      ${text}${controls}${progress}${foot}</div>`;
  }

  // ---------- Home Assistant updates (update.* entities: core, OS, add-ons, HACS, devices) ----------
  const UPD_BACKUP = 8, UPD_NOTES = 16;
  function updateInfo(st) {
    const a = st.attributes;
    const pct = a.update_percentage != null ? Number(a.update_percentage) : typeof a.in_progress === 'number' ? a.in_progress : null;
    return {
      id: st.entity_id, name: a.title || M.shortName(st), pending: st.state === 'on', busy: !!a.in_progress, pct,
      installed: a.installed_version || '?', latest: a.latest_version || '', summary: a.release_summary || '', url: a.release_url || '',
      picture: a.entity_picture || '', skipped: a.skipped_version || '',
      backup: !!(Number(a.supported_features) & UPD_BACKUP), notes: !!(Number(a.supported_features) & UPD_NOTES), off: M.UNAVAILABLE.includes(st.state)
    };
  }
  function updates(m, list, c) {
    const items = list.map(updateInfo).sort((x, y) => (y.pending - x.pending) || (y.busy - x.busy) || x.name.localeCompare(y.name, 'fr'));
    const n = items.filter((u) => u.pending).length;
    const pic = (u) => `<span class="upd-ic">${icon(IC.download, 18, 2)}${u.picture ? `<img src="${esc(c.mediaUrl(u.picture))}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>`;
    const row = (u) => `<li class="upd${u.pending ? ' is-pending' : ''}${u.busy ? ' is-busy' : ''}">
      ${pic(u)}
      <button class="upd-main" data-act="update-open" data-arg="${esc(u.id)}" data-key="${m.id}:${esc(u.id)}">
        <span class="upd-name">${esc(u.name)}</span>
        <span class="upd-ver">${u.pending ? `${esc(u.installed)} <span class="upd-arrow">→</span> <b>${esc(u.latest)}</b>` : esc(u.installed)}</span>
        ${u.busy ? `<span class="upd-prog"><i style="width: ${u.pct != null ? Math.max(4, Math.min(100, u.pct)) : 30}%"${u.pct == null ? ' class="indet"' : ''}></i></span>` : u.pending && u.summary && m.w > 1 ? `<span class="upd-sum">${esc(u.summary.replace(/\s+/g, ' ').slice(0, 140))}</span>` : ''}
      </button>
      ${u.busy ? `<span class="upd-state">${u.pct != null ? Math.round(u.pct) + ' %' : 'Installation…'}</span>`
        : u.pending ? `<button class="btn-solid sm" data-act="update-open" data-arg="${esc(u.id)}" data-key="${m.id}:i:${esc(u.id)}" ${u.off ? 'disabled' : ''}>Installer</button>`
        : `<span class="upd-ok">${icon(IC.check, 16, 2.4)}</span>`}
    </li>`;
    const pending = items.filter((u) => u.pending || u.busy), done = items.filter((u) => !u.pending && !u.busy);
    return head(m.title || 'Mises à jour', n ? plural(n, 'disponible', 'disponibles') : 'Tout est à jour') + `
      <ul class="upd-list" data-scroll="${m.id}">
        ${pending.map(row).join('')}
        ${!pending.length ? `<li class="upd-all-ok">${icon(IC.check, 28, 2.2)}<span>Home Assistant et ses modules sont à jour.</span></li>` : ''}
        ${done.length ? `<li class="upd-sep muted small">À jour · ${done.length}</li>${done.map(row).join('')}` : ''}
      </ul>`;
  }

  // ---------- Proxmox VE (integration "Proxmox VE" from HACS, or entities named proxmox) ----------
  const loadColor = (v) => (v == null ? 'rgba(255,255,255,0.3)' : v >= 90 ? '#FF453A' : v >= 75 ? '#FF9F0A' : 'var(--accent)');
  const clampPct = (p) => (p == null || !isFinite(p) ? null : Math.max(0, Math.min(100, p)));
  function ring(pct, label, sub) {
    const v = clampPct(pct);
    const C = 2 * Math.PI * 42;
    return `<span class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" class="ring-bg"></circle>
      <circle cx="50" cy="50" r="42" class="ring-fg" style="stroke: ${loadColor(v)}; stroke-dasharray: ${C.toFixed(1)}; stroke-dashoffset: ${(C * (1 - (v || 0) / 100)).toFixed(1)}"></circle></svg>
      <span class="ring-val">${v == null ? '–' : Math.round(v) + '<small>%</small>'}</span><span class="ring-label">${esc(label)}</span>${sub ? `<span class="ring-sub">${esc(sub)}</span>` : ''}</span>`;
  }
  function pbar(pct, label, sub) {
    const v = clampPct(pct);
    return `<span class="pbar"><span class="pbar-top"><span>${esc(label)}</span><b>${v == null ? '–' : Math.round(v) + ' %'}</b></span>
      <span class="pbar-track"><i style="width: ${v || 0}%; background: ${loadColor(v)}"></i></span>${sub ? `<span class="muted small">${esc(sub)}</span>` : ''}</span>`;
  }
  const pveEmpty = (title) => head(title) + '<div class="mod-empty"><p class="muted small">Aucun serveur Proxmox trouvé. Installez l\'intégration « Proxmox VE » (HACS) dans Home Assistant et ajoutez votre serveur : ses nœuds, VM et conteneurs apparaîtront ici en direct.</p></div>';

  function pveNode(m, list, c) {
    const pve = c.proxmox();
    const nodes = m.options.device ? pve.nodes.filter((x) => x.id === m.options.device) : pve.nodes;
    if (!nodes.length) return pveEmpty(m.title || 'Serveur Proxmox');
    const one = (n) => {
      const mem = n.memUsed != null && n.memTotal ? M.fmtNum(n.memUsed, 1) + ' / ' + M.fmtNum(n.memTotal, 0) + ' ' + n.memUnit : '';
      const gauges = m.w >= 2 && m.h >= 2
        ? `<div class="rings">${ring(n.cpu, 'Processeur')}${ring(n.mem, 'Mémoire', mem)}${ring(n.disk, 'Disque')}</div>`
        : `<div class="pbars">${pbar(n.cpu, 'Processeur')}${pbar(n.mem, 'Mémoire', m.h > 1 ? mem : '')}${m.h > 1 || m.w > 1 ? pbar(n.disk, 'Disque') : ''}</div>`;
      const active = pve.guests.filter((g) => g.running).length;
      const facts = [n.uptime ? 'Allumé ' + n.uptime : '', n.netIn ? '↓ ' + n.netIn : '', n.netOut ? '↑ ' + n.netOut : '',
        pve.guests.length ? active + ' / ' + pve.guests.length + ' VM et conteneurs en marche' : ''].filter(Boolean);
      const stor = m.h >= 3 && pve.storage.length ? `<div class="pbars">${pve.storage.map((x) => pbar(x.pct, x.name, x.sub)).join('')}</div>` : '';
      return `<div class="pve-node">
        <div class="pve-node-head"><span class="pve-dot${n.online === false ? ' is-off' : ''}"></span><b>${esc(n.name)}</b>${n.online === false ? '<span class="muted small">Hors ligne</span>' : ''}</div>
        ${gauges}
        ${facts.length && m.h > 1 ? `<div class="pve-facts">${facts.map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
        ${stor}
      </div>`;
    };
    return head(m.title || 'Serveur Proxmox', nodes.length > 1 ? plural(nodes.length, 'nœud', 'nœuds') : '') +
      `<div class="pve-nodes" data-scroll="${m.id}">${nodes.map(one).join('')}</div>`;
  }

  function pveGuests(m, list, c) {
    const pve = c.proxmox();
    const filter = m.options.kind || '';
    const guests = pve.guests.filter((g) => !filter || g.kind === filter)
      .sort((a, b) => (b.running - a.running) || (Number(a.vmid) || 9999) - (Number(b.vmid) || 9999) || a.name.localeCompare(b.name, 'fr'));
    if (!pve.nodes.length && !guests.length) return pveEmpty(m.title || 'VM et conteneurs');
    const act = (g, cmd, ic, label) => g.buttons[cmd] ? `<button class="pve-act" data-act="pve-press" data-arg="${esc(g.buttons[cmd])}" data-label="${esc(label + ' ' + g.name)}" data-key="${m.id}:${cmd}:${esc(g.id)}" aria-label="${esc(label + ' ' + g.name)}" title="${esc(label)}">${icon(ic, 16, 2)}</button>` : '';
    const acts = (g) => g.running ? act(g, 'reboot', IC.refresh, 'Redémarrer') + (act(g, 'shutdown', IC.power, 'Éteindre') || act(g, 'stop', IC.power, 'Arrêter')) : act(g, 'start', IC.play, 'Démarrer');
    const mini = (g) => m.w > 1 && g.running ? `<span class="pve-mini">
        <span title="Processeur">CPU <b>${g.cpu != null ? Math.round(g.cpu) + ' %' : '–'}</b><i><u style="width: ${clampPct(g.cpu) || 0}%"></u></i></span>
        <span title="Mémoire">RAM <b>${g.mem != null ? Math.round(g.mem) + ' %' : '–'}</b><i><u style="width: ${clampPct(g.mem) || 0}%"></u></i></span></span>` : '';
    const row = (g) => `<li class="pve-guest${g.running ? ' is-on' : ''}">
      <span class="pve-gic">${icon(g.kind === 'lxc' ? IC.box : IC.tv, 18, 1.9)}</span>
      <span class="pve-gmain"><span class="pve-gname">${g.vmid ? `<span class="muted">${esc(g.vmid)}</span> ` : ''}${esc(g.name)}</span>
        <span class="muted small">${g.running ? 'En marche' + (g.uptime ? ' · ' + esc(g.uptime) : '') : 'Arrêtée'}</span></span>
      ${mini(g)}
      <span class="pve-acts">${acts(g)}</span>
    </li>`;
    const running = guests.filter((g) => g.running).length;
    return head(m.title || (filter === 'lxc' ? 'Conteneurs' : filter === 'qemu' ? 'Machines virtuelles' : 'VM et conteneurs'), running + ' / ' + guests.length + ' en marche') +
      `<ul class="pve-guests" data-scroll="${m.id}">${guests.map(row).join('') || '<li class="muted small">Aucune VM ni conteneur.</li>'}</ul>`;
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
    weather: { empty: 'Aucune entité météo dans Home Assistant (ajoutez par exemple l\'intégration Météo-France).', name: 'Météo', desc: 'Conditions actuelles ; agrandi, les prévisions de la semaine. Touchez-le pour le détail.', icon: IC.cloud, w: 2, h: 2, single: true, pick: dom('weather'), render: weather },
    calendar: { name: 'Calendrier', desc: 'Agenda des prochains jours depuis vos calendriers Home Assistant (Google, iCal, local…).', icon: IC.calendar, w: 2, h: 3,
      empty: 'Aucun calendrier dans Home Assistant pour l\'instant. Connectez Google Agenda : Paramètres › Appareils et services › Ajouter une intégration › « Calendrier distant » (adresse iCal secrète) ou « Google Calendar ».',
      pick: dom('calendar'), render: calendar },
    transit: { name: 'Départs train / RER', desc: 'Prochains départs en temps réel (Île-de-France Mobilités) : horaires, retards, quais, missions.', icon: IC.train, w: 2, h: 2, single: true,
      empty: 'Capteur de départs introuvable. Ajoutez le capteur IDFM dans Home Assistant (fichier homeassistant/rer_d_le_mee.yaml), puis redémarrez-le.',
      pick: (s) => M.domainOf(s.entity_id) === 'sensor' && !!s.attributes.MonitoredStopVisit, render: transit },
    notes: { name: 'Notes', desc: 'Un mémo libre : liste de courses, rappels, code wifi invités… Enregistré dans votre compte.', icon: IC.note, w: 1, h: 2, noEntities: true, render: notes },
    automations: { name: 'Automatisations', desc: 'Activer/désactiver les automatisations, lancer les scripts.', icon: IC.robot, w: 2, h: 4,
      pick: (s) => ['automation', 'script'].includes(M.domainOf(s.entity_id)), render: automations },
    media: { name: 'Spotify / musique', desc: 'Pochette, titre, commandes, volume, choix de l\'enceinte et playlists (Spotify via Home Assistant).', icon: IC.music, w: 2, h: 2, single: true,
      empty: 'Aucun lecteur multimédia. Ajoutez Spotify dans Home Assistant : Paramètres › Appareils et services › Ajouter une intégration › Spotify (compte Premium nécessaire pour piloter la lecture).',
      auto: isSpotify, pick: dom('media_player'), render: media },
    rooms: { name: 'Pièces', desc: 'Résumé de chaque pièce ; un clic ouvre la pièce.', icon: IC.home, w: 4, h: 2, noEntities: true, render: rooms },
    updates: { name: 'Mises à jour', desc: 'Home Assistant, système, modules complémentaires, HACS, appareils : versions et installation.', icon: IC.download, w: 2, h: 4, allStates: true,
      empty: 'Aucune entité de mise à jour trouvée dans Home Assistant.', pick: dom('update'), render: updates },
    'pve-node': { name: 'Serveur Proxmox', desc: 'Processeur, mémoire, disque, réseau et durée de fonctionnement du serveur, en direct.', icon: IC.server, w: 2, h: 2, noEntities: true, render: pveNode },
    'pve-guests': { name: 'VM et conteneurs', desc: 'Vos machines virtuelles et conteneurs Proxmox : état, charge, démarrer / éteindre.', icon: IC.box, w: 2, h: 4, noEntities: true, render: pveGuests }
  };

  // Large two-tone weather picture for the home screen (sun in yellow, cloud in white).
  function wxArt(cond, size) {
    const s = size || 56;
    const svg = (body) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${esc(M.WEATHER[cond] || cond)}">${body}</svg>`;
    if (cond === 'sunny') return svg('<g stroke="#F5C542"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"></path></g>');
    if (cond === 'partlycloudy') return svg('<g stroke="#F5C542"><circle cx="8" cy="8" r="3"></circle><path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M12.2 3.8l-1 1"></path></g><path stroke="#FFFFFF" d="M9 20h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 9 20z"></path>');
    return svg(`<path stroke="#FFFFFF" d="${wxIcon(cond)}"></path>`);
  }

  HD.Modules = { types: T, lightState, TONES, ACCENTS, ZONES, tempThresholds, tempZone, tempColorsOn, wxIcon, wxArt, dayLabel, dailyItems, whenLabel, dayTitle, transitDirections, calEvents, calBody, CAL_VIEWS, isTraffic, agendaEvents, departures, LINES, mediaPos, mmss, isSpotify, updateInfo };
})();
