// Offline demo: a fake Home Assistant with the rooms and devices from the design.
// Same interface as HD.HAConnection, so the rest of the app can't tell the difference.
window.HD = window.HD || {};

HD.DemoConnection = class DemoConnection {
  constructor() {
    this.listeners = { state: [], status: [], ready: [] };
    this.haVersion = 'démo';
    this.baseUrl = 'demo';
    const now = Date.now();
    const ago = (h) => new Date(now - h * 3600e3).toISOString();
    const S = (entity_id, state, attributes = {}, area, device) => ({ entity_id, state, attributes, area, device });
    // A thermometer = one device exposing a temperature and a humidity sensor.
    const thermo = (id, name, t, h, area = id) => [
      S(`sensor.${id}_temperature`, String(t), { friendly_name: name, device_class: 'temperature', unit_of_measurement: '°C', state_class: 'measurement' }, area, 'th_' + id),
      S(`sensor.${id}_humidite`, String(h), { friendly_name: name + ' humidité', device_class: 'humidity', unit_of_measurement: '%', state_class: 'measurement' }, area, 'th_' + id)
    ];
    const ct = { supported_color_modes: ['color_temp', 'hs'], color_mode: 'color_temp', min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500 };
    const clim = (t, cur, hum, mode) => ({
      hvac_modes: ['off', 'auto', 'cool', 'heat'], temperature: t, current_temperature: cur, current_humidity: hum,
      min_temp: 16, max_temp: 30, target_temp_step: 1
    });
    this.areas = [
      { area_id: 'salon', name: 'Salon' },
      { area_id: 'cuisine', name: 'Cuisine' },
      { area_id: 'chambre', name: 'Chambre' },
      { area_id: 'bureau', name: 'Bureau' },
      { area_id: 'sdb', name: 'Salle de bain' }
    ];
    const list = [
      S('weather.maison', 'partlycloudy', { friendly_name: 'Maison', temperature: 14, temperature_unit: '°C', humidity: 78,
        pressure: 1016, pressure_unit: 'hPa', wind_speed: 12, wind_speed_unit: 'km/h', wind_bearing: 240, apparent_temperature: 12,
        dew_point: 10, uv_index: 2, supported_features: 3 }),
      S('light.salon_plafonnier', 'on', { friendly_name: 'Salon Plafonnier', brightness: 204, color_temp_kelvin: 2700, ...ct }, 'salon'),
      S('media_player.salon_tv', 'on', { friendly_name: 'Téléviseur', source: 'HDMI 1' }, 'salon'),
      S('media_player.salon_enceinte', 'playing', { friendly_name: 'Enceinte', media_title: 'Lecture' }, 'salon'),
      S('climate.salon', 'auto', { friendly_name: 'Climatisation', ...clim(22, 21.4, 46) }, 'salon'),
      S('cover.salon_stores', 'open', { friendly_name: 'Stores', current_position: 60 }, 'salon'),
      S('fan.salon_purificateur', 'off', { friendly_name: 'Purificateur', percentage: 0 }, 'salon'),
      S('light.cuisine_spots', 'on', { friendly_name: 'Spots', brightness: 255, color_temp_kelvin: 4000, ...ct }, 'cuisine'),
      S('light.cuisine_ilot', 'off', { friendly_name: 'Suspension îlot', ...ct }, 'cuisine'),
      S('fan.cuisine_hotte', 'off', { friendly_name: 'Hotte' }, 'cuisine'),
      S('switch.cuisine_cafe', 'on', { friendly_name: 'Machine à café' }, 'cuisine'),
      S('binary_sensor.cuisine_fuite', 'off', { friendly_name: 'Détecteur fuite', device_class: 'moisture' }, 'cuisine'),
      S('light.chambre_chevet', 'off', { friendly_name: 'Lampe chevet', ...ct }, 'chambre'),
      S('light.chambre_plafonnier', 'off', { friendly_name: 'Plafonnier', supported_color_modes: ['onoff'] }, 'chambre'),
      S('cover.chambre_volets', 'closed', { friendly_name: 'Volets', current_position: 0 }, 'chambre'),
      S('climate.chambre', 'heat', { friendly_name: 'Climatisation', ...clim(19, 19.6, 51) }, 'chambre'),
      S('fan.chambre_purificateur', 'on', { friendly_name: 'Purificateur', percentage: 40 }, 'chambre'),
      S('light.bureau_lampe', 'on', { friendly_name: 'Lampe bureau', brightness: 230, color_temp_kelvin: 6500, ...ct }, 'bureau'),
      S('switch.bureau_ecrans', 'on', { friendly_name: 'Écrans' }, 'bureau'),
      S('switch.bureau_pc', 'on', { friendly_name: 'Prise PC' }, 'bureau'),
      S('cover.bureau_store', 'open', { friendly_name: 'Store', current_position: 50 }, 'bureau'),
      S('lock.bureau_porte', 'locked', { friendly_name: 'Porte' }, 'bureau'),
      S('light.sdb_miroir', 'off', { friendly_name: 'Miroir', supported_color_modes: ['onoff'] }, 'sdb'),
      S('light.sdb_spots', 'off', { friendly_name: 'Spots', ...ct }, 'sdb'),
      S('fan.sdb_vmc', 'on', { friendly_name: 'VMC', percentage: 100 }, 'sdb'),
      S('switch.sdb_seche_serviettes', 'off', { friendly_name: 'Sèche-serviettes' }, 'sdb'),
      ...thermo('salon', 'Thermomètre salon', 21.4, 46),
      ...thermo('cuisine', 'Thermomètre cuisine', 22.1, 52),
      ...thermo('chambre', 'Thermomètre chambre', 19.6, 51),
      ...thermo('chambre_bebe', 'Thermomètre bébé', 20.3, 48, 'chambre'),
      ...thermo('bureau', 'Thermomètre bureau', 20.8, 44),
      ...thermo('sdb', 'Thermomètre salle de bain', 23.2, 64),
      ...thermo('exterieur', 'Extérieur', 14.0, 78, null),
      S('sensor.bureau_co2', '620', { friendly_name: 'CO₂ bureau', device_class: 'carbon_dioxide', unit_of_measurement: 'ppm' }, 'bureau'),
      S('scene.matin', ago(10), { friendly_name: 'Matin', entity_id: ['cover.salon_stores', 'switch.cuisine_cafe', 'climate.salon'] }),
      S('scene.cinema', ago(1), { friendly_name: 'Cinéma', entity_id: ['light.salon_plafonnier', 'media_player.salon_tv'] }),
      S('scene.nuit', ago(20), { friendly_name: 'Nuit', entity_id: ['light.salon_plafonnier', 'climate.chambre'] }),
      S('scene.absent', 'unknown', { friendly_name: 'Absent', entity_id: [] }),
      S('calendar.famille', 'off', { friendly_name: 'Famille', message: 'Piscine Léa' }),
      S('calendar.travail', 'off', { friendly_name: 'Travail', message: 'Point équipe' }),
      S('automation.lever_stores', 'on', { friendly_name: 'Ouvrir les stores au lever du soleil', last_triggered: ago(9) }),
      S('automation.extinction', 'on', { friendly_name: 'Tout éteindre à minuit', last_triggered: ago(15) }),
      S('automation.alerte_fuite', 'off', { friendly_name: 'Alerte fuite d\'eau', last_triggered: null }),
      S('script.bonne_nuit', 'off', { friendly_name: 'Bonne nuit' }),
      S('sensor.conso_maison', '1240', { friendly_name: 'Consommation maison', device_class: 'power', unit_of_measurement: 'W' }),
      S('sensor.conso_pc', '182', { friendly_name: 'Prise PC', device_class: 'power', unit_of_measurement: 'W' }, 'bureau'),
      S('sensor.energie_jour', '8.6', { friendly_name: 'Énergie aujourd\'hui', device_class: 'energy', unit_of_measurement: 'kWh' })
    ];
    this.states = new Map();
    this.entities = [];
    for (const s of list) {
      const { area, device, ...st } = s;
      st.last_changed = st.last_updated = new Date(now).toISOString();
      this.states.set(st.entity_id, st);
      this.entities.push({ entity_id: st.entity_id, area_id: area || null, device_id: device || null });
    }
    // Thermometers drift a little so the demo feels alive.
    this.timer = setInterval(() => {
      for (const st of this.states.values()) {
        if (st.attributes.device_class !== 'temperature') continue;
        const v = Math.round((Number(st.state) + (Math.random() - 0.5) * 0.2) * 10) / 10;
        this.set(st.entity_id, String(v));
      }
    }, 15000);
  }

  on(evt, fn) { this.listeners[evt].push(fn); }
  emit(evt, data) { for (const fn of this.listeners[evt]) fn(data); }

  connect() {
    setTimeout(() => { this.emit('status', 'connected'); this.emit('ready'); }, 0);
    return Promise.resolve();
  }

  async fetchAll() {
    return {
      states: [...this.states.values()].map((s) => JSON.parse(JSON.stringify(s))),
      areas: this.areas, devices: [], entities: this.entities, config: { location_name: 'Démo' }
    };
  }

  set(id, state, attrs = {}) {
    const old = this.states.get(id);
    if (!old) return;
    const neu = { ...old, state: state != null ? state : old.state, attributes: { ...old.attributes, ...attrs }, last_changed: new Date().toISOString() };
    this.states.set(id, neu);
    setTimeout(() => this.emit('state', { entity_id: id, new_state: JSON.parse(JSON.stringify(neu)) }), 120);
  }

  async callService(domain, service, ids, data = {}) {
    for (const id of [].concat(ids)) {
      const st = this.states.get(id);
      if (!st) continue;
      const d = id.split('.')[0];
      const isOn = !['off', 'closed', 'unlocked', 'standby'].includes(st.state);
      if (service === 'toggle') {
        if (d === 'cover') this.set(id, isOn ? 'closed' : 'open', { current_position: isOn ? 0 : 100 });
        else if (d === 'media_player') this.set(id, isOn ? 'off' : 'on');
        else this.set(id, isOn ? 'off' : 'on', d === 'light' && !isOn ? { brightness: st.attributes.brightness || 200 } : {});
      } else if (service === 'turn_on') {
        if (d === 'scene') { this.set(id, new Date().toISOString()); continue; }
        if (d === 'climate') { this.set(id, 'auto'); continue; }
        if (d === 'script') { this.set(id, 'on'); setTimeout(() => this.set(id, 'off'), 1500); continue; }
        const a = {};
        if (data.brightness_pct != null) a.brightness = Math.round(data.brightness_pct * 2.55);
        else if (!st.attributes.brightness) a.brightness = 200;
        if (data.color_temp_kelvin) { a.color_temp_kelvin = data.color_temp_kelvin; a.color_mode = 'color_temp'; }
        if (data.rgb_color) { a.rgb_color = data.rgb_color; a.color_mode = 'hs'; }
        this.set(id, 'on', a);
      } else if (service === 'turn_off') this.set(id, 'off');
      else if (service === 'lock') this.set(id, 'locked');
      else if (service === 'unlock') this.set(id, 'unlocked');
      else if (service === 'set_temperature') this.set(id, null, { temperature: data.temperature });
      else if (service === 'set_hvac_mode') this.set(id, data.hvac_mode);
      else if (service === 'trigger') this.set(id, null, { last_triggered: new Date().toISOString() });
    }
  }

  // A family calendar and a work calendar over the next days.
  fetchCalendarEvents(entityId, start, end) {
    const at = (dayOffset, h, m) => { const d = new Date(); d.setHours(h, m || 0, 0, 0); d.setDate(d.getDate() + dayOffset); return d.toISOString(); };
    const day = (dayOffset) => { const d = new Date(); d.setDate(d.getDate() + dayOffset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const E = (summary, s, e, extra) => Object.assign({ summary, start: s, end: e, uid: entityId + summary + JSON.stringify(s) }, extra || {});
    const all = {
      'calendar.famille': [
        E('Piscine Léa', { dateTime: at(0, 17, 30) }, { dateTime: at(0, 18, 30) }, { location: 'Centre aquatique' }),
        E('Anniversaire de Mamie', { date: day(2) }, { date: day(3) }, { description: 'Apporter le gâteau au chocolat.' }),
        E('Dîner chez les Martin', { dateTime: at(3, 20, 0) }, { dateTime: at(3, 23, 0) }, { location: '12 rue des Lilas' }),
        E('Vacances de la Toussaint', { date: day(5) }, { date: day(12) })
      ],
      'calendar.travail': [
        E('Point équipe', { dateTime: at(0, 9, 30) }, { dateTime: at(0, 10, 0) }, { location: 'Visio' }),
        E('Rendez-vous client', { dateTime: at(1, 14, 0) }, { dateTime: at(1, 15, 30) }, { location: 'Lyon', description: 'Présentation du devis.\nPrévoir 30 min de trajet.' }),
        E('Revue trimestrielle', { dateTime: at(4, 10, 0) }, { dateTime: at(4, 12, 0) })
      ]
    };
    const items = (all[entityId] || []).filter((ev) => {
      const s = new Date(ev.start.dateTime || ev.start.date + 'T00:00:00');
      return s < end && s >= new Date(start.getTime() - 86400000 * 7);
    });
    return new Promise((resolve) => setTimeout(() => resolve(items), 120));
  }

  // Plausible autumn week + next 24 hours.
  subscribeForecast(entityId, type, onEvent) {
    const conds = ['partlycloudy', 'rainy', 'cloudy', 'sunny', 'sunny', 'pouring', 'partlycloudy'];
    const now = new Date();
    let forecast;
    if (type === 'hourly') {
      forecast = Array.from({ length: 24 }, (_, i) => {
        const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + i + 1);
        const h = d.getHours();
        return { datetime: d.toISOString(), condition: h > 19 || h < 7 ? 'clear-night' : i > 14 ? 'rainy' : 'partlycloudy',
          temperature: Math.round(14 + 4 * Math.sin((h - 9) / 24 * 2 * Math.PI)), precipitation_probability: i > 14 ? 60 : 10 };
      });
    } else {
      forecast = conds.map((c, i) => {
        const d = new Date(now); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + i);
        return { datetime: d.toISOString(), condition: c, temperature: [16, 13, 14, 18, 19, 12, 15][i], templow: [9, 8, 7, 9, 11, 8, 6][i],
          precipitation_probability: [10, 80, 30, 0, 5, 90, 20][i], wind_speed: [12, 25, 15, 8, 6, 30, 14][i] };
      });
    }
    setTimeout(() => onEvent({ type, forecast }), 150);
    return Promise.resolve();
  }

  close() { clearInterval(this.timer); }
};
