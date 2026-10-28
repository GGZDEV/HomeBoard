// Offline demo: a fake Home Assistant with the rooms and devices from the design.
// Same interface as HD.HAConnection, so the rest of the app can't tell the difference.
window.HD = window.HD || {};

// Fake music for the demo player: gradient squares as cover art.
const demoCover = (a, b) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/></svg>`);
const DEMO_TRACKS = [
  { media_title: "Lumière d'automne", media_artist: 'Les Ondes', media_album_name: 'Saisons', media_duration: 243, entity_picture: demoCover('#F5C542', '#C2410C') },
  { media_title: 'Rue des Lilas', media_artist: 'Nina Paradis', media_album_name: 'Faubourgs', media_duration: 198, entity_picture: demoCover('#64D2FF', '#5E5CE6') },
  { media_title: 'Café du matin', media_artist: 'Trio Velours', media_album_name: 'Dimanche', media_duration: 276, entity_picture: demoCover('#30D158', '#0F766E') }
];
const DEMO_PLAYLISTS = [
  ['Dimanche matin', '#F5C542', '#C2410C'], ['Cuisine du soir', '#FF375F', '#7C3AED'], ['Concentration', '#64D2FF', '#1E3A8A'], ['Fête', '#BF5AF2', '#FF9F0A']
].map(([title, a, b], i) => ({ title, media_content_id: 'spotify:playlist:demo' + i, media_content_type: 'playlist', can_play: true, can_expand: true, thumbnail: demoCover(a, b) }));

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
      S('media_player.spotify_maison', 'playing', {
        friendly_name: 'Spotify Maison', app_name: 'Spotify', source: 'Enceinte salon', source_list: ['Enceinte salon', 'Téléviseur', 'PC bureau'],
        ...DEMO_TRACKS[0], media_position: 61, media_position_updated_at: new Date(now).toISOString(),
        volume_level: 0.45, shuffle: false, repeat: 'off', media_playlist: 'Dimanche matin'
      }),
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
      S('sun.sun', 'above_horizon', { friendly_name: 'Soleil', next_rising: (() => { const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(8, 24, 0, 0); return d.toISOString(); })(), next_setting: (() => { const d = new Date(now); d.setHours(17, 58, 0, 0); if (d < now) d.setDate(d.getDate() + 1); return d.toISOString(); })() }),
      S('sensor.rer_d_le_mee', '0', { friendly_name: 'Le Mée', MonitoredStopVisit: [] }),
      S('calendar.famille', 'off', { friendly_name: 'Famille', message: 'Piscine Léa' }),
      S('calendar.travail', 'off', { friendly_name: 'Travail', message: 'Point équipe' }),
      S('calendar.info_trafic', 'on', { friendly_name: 'Info trafic', message: 'RER D : travaux' }),
      S('camera.camoly_vue_en_direct', 'idle', { friendly_name: 'CamOly Vue en direct', access_token: 'demo',
        entity_picture: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6d7a86"/><stop offset="1" stop-color="#2f3540"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><rect x="60" y="210" width="240" height="110" rx="10" fill="#8a6f5a"/><rect x="380" y="60" width="160" height="120" fill="#c9d6e0" opacity=".55"/><circle cx="470" cy="270" r="40" fill="#e9c46a" opacity=".8"/><text x="20" y="345" fill="#fff" font-family="monospace" font-size="16" opacity=".8">2026-10-28 12:16:37</text></svg>') }, 'chambre'),
      Object.assign(S('todo.courses', '3', { friendly_name: 'Courses', supported_features: 15 }), { platform: 'bring' }),
      S('automation.lever_stores', 'on', { friendly_name: 'Ouvrir les stores au lever du soleil', last_triggered: ago(9) }),
      S('automation.extinction', 'on', { friendly_name: 'Tout éteindre à minuit', last_triggered: ago(15) }),
      S('automation.alerte_fuite', 'off', { friendly_name: 'Alerte fuite d\'eau', last_triggered: null }),
      S('script.bonne_nuit', 'off', { friendly_name: 'Bonne nuit' }),
      S('sensor.conso_maison', '1240', { friendly_name: 'Consommation maison', device_class: 'power', unit_of_measurement: 'W' }),
      S('sensor.conso_pc', '182', { friendly_name: 'Prise PC', device_class: 'power', unit_of_measurement: 'W' }, 'bureau'),
      S('sensor.energie_jour', '8.6', { friendly_name: 'Énergie aujourd\'hui', device_class: 'energy', unit_of_measurement: 'kWh' })
    ];
    // Proxmox VE server (as the HACS integration exposes it: one device per node / VM / container).
    this.devices = [
      { id: 'pve_node', name: 'Node pve', model: 'Node', manufacturer: 'Proxmox VE' },
      { id: 'pve_101', name: 'VM homeassistant (101)', model: 'QEMU', manufacturer: 'Proxmox VE' },
      { id: 'pve_102', name: 'LXC adguard (102)', model: 'LXC', manufacturer: 'Proxmox VE' },
      { id: 'pve_103', name: 'LXC jellyfin (103)', model: 'LXC', manufacturer: 'Proxmox VE' },
      { id: 'pve_104', name: 'VM windows11 (104)', model: 'QEMU', manufacturer: 'Proxmox VE' },
      { id: 'pve_st', name: 'Storage local-lvm (pve)', model: 'Storage', manufacturer: 'Proxmox VE' }
    ];
    const P = (entity_id, state, attributes, device, cat) => ({ entity_id, state: String(state), attributes, device, platform: 'proxmoxve', cat });
    const pct = (name) => ({ friendly_name: name, unit_of_measurement: '%', state_class: 'measurement' });
    const boot = (h) => new Date(now - h * 3600e3).toISOString();
    const guest = (id, dev, name, on, cpu, mem, upH) => [
      P(`binary_sensor.${id}_status`, on ? 'on' : 'off', { friendly_name: name + ' Status', device_class: 'running' }, dev),
      P(`sensor.${id}_cpu_used`, on ? cpu : 0, pct(name + ' CPU used'), dev, 'diagnostic'),
      P(`sensor.${id}_memory_used_percentage`, on ? mem : 0, pct(name + ' Memory used percentage'), dev, 'diagnostic'),
      P(`sensor.${id}_uptime`, on ? boot(upH) : 'unknown', { friendly_name: name + ' Uptime', device_class: 'timestamp' }, dev, 'diagnostic'),
      P(`button.${id}_start`, 'unknown', { friendly_name: name + ' Start' }, dev, 'config'),
      P(`button.${id}_shutdown`, 'unknown', { friendly_name: name + ' Shutdown' }, dev, 'config'),
      P(`button.${id}_reboot`, 'unknown', { friendly_name: name + ' Reboot' }, dev, 'config'),
      P(`button.${id}_stop`, 'unknown', { friendly_name: name + ' Stop' }, dev, 'config')
    ];
    list.push(
      P('binary_sensor.pve_status', 'on', { friendly_name: 'pve Status', device_class: 'running' }, 'pve_node'),
      P('sensor.pve_cpu_used', 23, pct('pve CPU used'), 'pve_node', 'diagnostic'),
      P('sensor.pve_memory_used_percentage', 61, pct('pve Memory used percentage'), 'pve_node', 'diagnostic'),
      P('sensor.pve_memory_used', 19.5, { friendly_name: 'pve Memory used', unit_of_measurement: 'GB' }, 'pve_node', 'diagnostic'),
      P('sensor.pve_memory_total', 32, { friendly_name: 'pve Memory total', unit_of_measurement: 'GB' }, 'pve_node', 'diagnostic'),
      P('sensor.pve_disk_used_percentage', 47, pct('pve Disk used percentage'), 'pve_node', 'diagnostic'),
      P('sensor.pve_network_in', 2.4, { friendly_name: 'pve Network in', unit_of_measurement: 'MB/s' }, 'pve_node', 'diagnostic'),
      P('sensor.pve_network_out', 0.8, { friendly_name: 'pve Network out', unit_of_measurement: 'MB/s' }, 'pve_node', 'diagnostic'),
      P('sensor.pve_uptime', boot(24 * 12 + 5), { friendly_name: 'pve Uptime', device_class: 'timestamp' }, 'pve_node', 'diagnostic'),
      ...guest('homeassistant', 'pve_101', 'homeassistant', true, 8, 54, 24 * 3 + 2),
      ...guest('adguard', 'pve_102', 'adguard', true, 2, 18, 24 * 12),
      ...guest('jellyfin', 'pve_103', 'jellyfin', true, 37, 72, 40),
      ...guest('windows11', 'pve_104', 'windows11', false, 0, 0, 0),
      P('sensor.local_lvm_disk_used_percentage', 58, pct('local-lvm Disk used percentage'), 'pve_st', 'diagnostic')
    );
    // Updates (HA marks them "config": hidden from the rest of the dashboard).
    const U = (id, title, installed, latest, extra) => ({ entity_id: 'update.' + id, state: installed === latest ? 'off' : 'on', device: null, cat: 'config', platform: 'hassio',
      attributes: { friendly_name: title + ' Update', title, installed_version: installed, latest_version: latest, in_progress: false, auto_update: false,
        supported_features: 1 | 4 | 8 | 16, release_url: 'https://www.home-assistant.io/blog/', ...extra } });
    list.push(
      U('home_assistant_core_update', 'Home Assistant Core', '2026.10.1', '2026.10.3', { release_summary: 'Corrections de bugs : Zigbee, Matter et tableau de bord énergie.' }),
      U('home_assistant_operating_system_update', 'Home Assistant Operating System', '16.2', '16.2'),
      U('mosquitto_broker_update', 'Mosquitto broker', '6.5.1', '6.5.2', { release_summary: 'Mise à jour de sécurité.' }),
      U('zigbee2mqtt_update', 'Zigbee2MQTT', '2.6.0', '2.6.2'),
      U('hacs_update', 'HACS', '2.0.5', '2.0.5', { supported_features: 1 }),
      U('proxmoxve_update', 'Proxmox VE (intégration)', '3.6.1', '3.6.1', { supported_features: 1 | 16 })
    );
    this.states = new Map();
    this.entities = [];
    for (const s of list) {
      const { area, device, platform, cat, ...st } = s;
      st.last_changed = st.last_updated = new Date(now).toISOString();
      this.states.set(st.entity_id, st);
      this.entities.push({ entity_id: st.entity_id, area_id: area || null, device_id: device || null, platform: platform || 'demo', entity_category: cat || null });
    }
    // Shared Bring! list: 3 items to buy, bought ones in "recently".
    const T = (summary, status) => ({ uid: 'b-' + summary, summary, status });
    this.todo = { 'todo.courses': [T('Lait', 'needs_action'), T('Pain de mie', 'needs_action'), T('Tomates', 'needs_action'),
      T('Beurre', 'completed'), T('Œufs', 'completed'), T('Pâtes', 'completed'), T('Café', 'completed'), T('Yaourts', 'completed')] };
    this.todoSubs = {};
    // RER D at Le Mée, in the SIRI Lite shape PRIM returns; regenerated every 2 min like the HA sensor.
    const rer = () => {
      const t0 = Date.now();
      const v = (min, delay, dest, dir, mission, quai, status) => {
        const aimed = new Date(t0 + min * 60000).toISOString();
        const exp = new Date(t0 + (min + delay) * 60000).toISOString();
        return { MonitoredVehicleJourney: {
          LineRef: { value: 'STIF:Line::C01728:' }, DirectionName: [{ value: dir }], DestinationName: [{ value: dest }],
          JourneyNote: [{ value: mission }],
          MonitoredCall: { AimedDepartureTime: aimed, ExpectedDepartureTime: exp, DepartureStatus: status || (delay ? 'delayed' : 'onTime'), DeparturePlatformName: { value: quai } }
        } };
      };
      return [
        v(4, 0, 'Paris Gare de Lyon', 'Paris', 'ZOVO', '2'), v(9, 0, 'Melun', 'Melun', 'ROVO', '1'),
        v(19, 3, 'Creil', 'Paris', 'ZUPO', '2'), v(26, 0, 'Melun', 'Melun', 'ROVO', '1'),
        v(34, 0, 'Paris Gare de Lyon', 'Paris', 'ZOVO', '2', 'cancelled'), v(41, 0, 'Melun', 'Melun', 'ROVO', '1'),
        v(49, 0, 'Paris Gare de Lyon', 'Paris', 'ZOVO', '2'), v(64, 0, 'Creil', 'Paris', 'ZUPO', '2'), v(71, 0, 'Melun', 'Melun', 'ROVO', '1')
      ];
    };
    const rerState = this.states.get('sensor.rer_d_le_mee');
    rerState.attributes.MonitoredStopVisit = rer();
    rerState.state = String(rerState.attributes.MonitoredStopVisit.length);
    this.rerTimer = setInterval(() => this.set('sensor.rer_d_le_mee', null, { MonitoredStopVisit: rer() }), 120000);

    // Thermometers drift a little so the demo feels alive.
    this.timer = setInterval(() => {
      for (const id of ['sensor.pve_cpu_used', 'sensor.jellyfin_cpu_used', 'sensor.homeassistant_cpu_used']) {
        const st = this.states.get(id);
        if (st && Number(st.state) > 0) this.set(id, String(Math.max(1, Math.min(95, Math.round(Number(st.state) + (Math.random() - 0.5) * 12)))));
      }
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
      areas: this.areas, devices: this.devices, entities: this.entities, config: { location_name: 'Démo' }
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
    // Like HA: entity_id "all" targets every entity of the domain.
    if (ids === 'all') ids = [...this.states.keys()].filter((id) => id.startsWith(domain + '.'));
    for (const id of [].concat(ids)) {
      const st = this.states.get(id);
      if (!st) continue;
      const d = id.split('.')[0];
      if (d === 'update') { this.update(id, st, service); continue; }
      if (d === 'todo') { this.todoService(id, service, data); continue; }
      if (d === 'button') { this.pvePress(id); continue; }
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
      else if (d === 'media_player' && service !== 'toggle') this.media(id, st, service, data);
      else if (service === 'trigger') this.set(id, null, { last_triggered: new Date().toISOString() });
    }
  }

  // Fake install: progress over ~10 s, then the new version is the installed one.
  update(id, st, service) {
    const latest = st.attributes.latest_version;
    if (service === 'skip') { this.set(id, 'off', { skipped_version: latest }); return; }
    if (service !== 'install') return;
    let p = 0;
    this.set(id, 'on', { in_progress: true, update_percentage: 0 });
    const t = setInterval(() => {
      p += 20;
      if (p >= 100) { clearInterval(t); this.set(id, 'off', { in_progress: false, update_percentage: null, installed_version: latest }); }
      else this.set(id, 'on', { update_percentage: p });
    }, 2000);
  }

  // Proxmox buttons: start / shutdown / stop / reboot of a VM or container.
  pvePress(id) {
    const m = id.match(/^button\.(.+)_(start|shutdown|stop|reboot)$/);
    if (!m) return;
    const [, g, cmd] = m;
    const on = cmd === 'start' || cmd === 'reboot';
    const now = new Date().toISOString();
    if (cmd === 'reboot') this.set(`binary_sensor.${g}_status`, 'off');
    setTimeout(() => {
      this.set(`binary_sensor.${g}_status`, on ? 'on' : 'off');
      this.set(`sensor.${g}_cpu_used`, on ? '12' : '0');
      this.set(`sensor.${g}_memory_used_percentage`, on ? '35' : '0');
      this.set(`sensor.${g}_uptime`, on ? now : 'unknown');
    }, cmd === 'reboot' ? 3000 : 1500);
  }

  releaseNotes(id) {
    const st = this.states.get(id);
    const t = st ? st.attributes.title : '';
    return new Promise((resolve) => setTimeout(() => resolve(`## ${t} ${st ? st.attributes.latest_version : ''}\n\n**Nouveautés**\n- Démarrage plus rapide\n- Corrections de bugs\n- Traductions mises à jour\n\n[Voir le détail](https://www.home-assistant.io/blog/)`), 300));
  }

  // Spotify-like player: tracks loop through a small fake playlist.
  media(id, st, service, data) {
    const a = st.attributes;
    const at = new Date().toISOString();
    const pos = st.state === 'playing' ? (a.media_position || 0) + (Date.now() - Date.parse(a.media_position_updated_at)) / 1000 : a.media_position || 0;
    const track = (step) => {
      const i = (DEMO_TRACKS.findIndex((t) => t.media_title === a.media_title) + step + DEMO_TRACKS.length) % DEMO_TRACKS.length;
      this.set(id, 'playing', { ...DEMO_TRACKS[i], media_position: 0, media_position_updated_at: at });
    };
    if (service === 'media_play_pause') this.set(id, st.state === 'playing' ? 'paused' : 'playing', { media_position: pos, media_position_updated_at: at });
    else if (service === 'media_next_track') track(1);
    else if (service === 'media_previous_track') track(-1);
    else if (service === 'volume_set') this.set(id, null, { volume_level: data.volume_level });
    else if (service === 'shuffle_set') this.set(id, null, { shuffle: data.shuffle });
    else if (service === 'repeat_set') this.set(id, null, { repeat: data.repeat });
    else if (service === 'select_source') this.set(id, null, { source: data.source });
    else if (service === 'play_media') {
      const pl = DEMO_PLAYLISTS.find((p) => p.media_content_id === data.media_content_id);
      this.set(id, 'playing', { ...DEMO_TRACKS[0], media_position: 0, media_position_updated_at: at, media_playlist: pl ? pl.title : '' });
    }
  }

  browseMedia(entityId, id) {
    const folder = (title, cid) => ({ title, media_content_id: cid, media_content_type: cid, can_expand: true, can_play: false });
    const node = !id
      ? { title: 'Spotify', children: [folder('Playlists', 'current_user_playlists'), folder('Titres likés', 'current_user_saved_tracks')] }
      : id === 'current_user_playlists' ? { title: 'Playlists', children: DEMO_PLAYLISTS }
      : { title: 'Titres likés', children: DEMO_TRACKS.map((t, i) => ({ title: t.media_title + ' · ' + t.media_artist, media_content_id: 'spotify:track:demo' + i, media_content_type: 'track', can_play: true, can_expand: false, thumbnail: t.entity_picture })) };
    return new Promise((resolve) => setTimeout(() => resolve(JSON.parse(JSON.stringify(node))), 150));
  }

  // To-do lists: like HA, every change pushes the whole list to the subscribers.
  subscribeTodo(id, onItems) {
    (this.todoSubs[id] = this.todoSubs[id] || []).push(onItems);
    setTimeout(() => onItems(JSON.parse(JSON.stringify(this.todo[id] || []))), 150);
    return Promise.resolve();
  }
  listTodo(id) { return Promise.resolve(JSON.parse(JSON.stringify(this.todo[id] || []))); }
  todoService(id, service, data) {
    const list = this.todo[id] || (this.todo[id] = []);
    const find = (k) => list.find((x) => x.uid === k || x.summary === k);
    if (service === 'add_item') list.unshift({ uid: 'b-' + data.item + Date.now(), summary: data.item, status: 'needs_action' });
    else if (service === 'update_item') { const it = find(data.item); if (it && data.status) it.status = data.status; if (it && data.rename) it.summary = data.rename; }
    else if (service === 'remove_item') [].concat(data.item).forEach((k) => { const it = find(k); if (it) list.splice(list.indexOf(it), 1); });
    else if (service === 'remove_completed_items') this.todo[id] = list.filter((x) => x.status !== 'completed');
    this.set(id, String(this.todo[id].filter((x) => x.status !== 'completed').length));
    setTimeout(() => (this.todoSubs[id] || []).forEach((fn) => fn(JSON.parse(JSON.stringify(this.todo[id])))), 300);
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
        E('Vacances de la Toussaint', { date: day(5) }, { date: day(12) }),
        E('Dentiste Léa', { dateTime: at(9, 16, 30) }, { dateTime: at(9, 17, 0) }, { location: 'Cabinet du Dr Roux' }),
        E('Réunion parents-profs', { dateTime: at(16, 18, 30) }, { dateTime: at(16, 20, 0) }, { location: 'École Jules Ferry' }),
        E('Week-end à la mer', { date: day(20) }, { date: day(22) })
      ],
      'calendar.info_trafic': [
        E('RER D : travaux entre Corbeil-Essonnes et Melun, bus de remplacement', { dateTime: at(0, 0, 0) }, { dateTime: at(1, 5, 0) }),
        E('Ligne D : modification des horaires des trains en soirée', { dateTime: at(1, 21, 0) }, { dateTime: at(2, 3, 0) })
      ],
      'calendar.travail': [
        E('Point équipe', { dateTime: at(0, 9, 30) }, { dateTime: at(0, 10, 0) }, { location: 'Visio' }),
        E('Rendez-vous client', { dateTime: at(1, 14, 0) }, { dateTime: at(1, 15, 30) }, { location: 'Lyon', description: 'Présentation du devis.\nPrévoir 30 min de trajet.' }),
        E('Revue trimestrielle', { dateTime: at(4, 10, 0) }, { dateTime: at(4, 12, 0) }),
        E('Séminaire à Bordeaux', { dateTime: at(24, 9, 0) }, { dateTime: at(24, 17, 0) }, { location: 'Bordeaux' })
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

  close() { clearInterval(this.timer); clearInterval(this.rerTimer); }
};
