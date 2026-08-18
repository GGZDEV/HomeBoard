/**
 * Backend de démonstration : simule un serveur Home Assistant complet
 * (états, évolution dans le temps, appels de services, scènes).
 * Même interface publique que ha.js -> interchangeable.
 */
import { store, seedHistory } from './store.js';

const now = () => new Date().toISOString();

function e(entity_id, state, attributes = {}) {
  return { entity_id, state: String(state), attributes, last_changed: now() };
}

function buildEntities() {
  return [
    // --- Global ---------------------------------------------------------
    e('weather.maison', 'partlycloudy', {
      friendly_name: 'Météo', temperature: 21.4, humidity: 58,
      wind_speed: 11, forecast_high: 24, forecast_low: 14
    }),
    e('sensor.exterieur_temperature', 19.6, {
      friendly_name: 'Extérieur', unit_of_measurement: '°C', device_class: 'temperature'
    }),
    e('sensor.consommation_electrique', 1240, {
      friendly_name: 'Consommation', unit_of_measurement: 'W', device_class: 'power'
    }),
    e('sensor.production_solaire', 2180, {
      friendly_name: 'Production solaire', unit_of_measurement: 'W', device_class: 'power'
    }),
    e('alarm_control_panel.maison', 'disarmed', { friendly_name: 'Alarme' }),
    e('person.guillaume', 'home', { friendly_name: 'Guillaume' }),
    e('person.marie', 'not_home', { friendly_name: 'Marie' }),

    // --- Salon ----------------------------------------------------------
    e('light.salon', 'on', {
      friendly_name: 'Plafonnier salon', brightness: 190, rgb_color: [255, 190, 120],
      supported_color_modes: ['rgb']
    }),
    e('light.salon_lampadaire', 'on', {
      friendly_name: 'Lampadaire', brightness: 120, rgb_color: [160, 120, 255],
      supported_color_modes: ['rgb']
    }),
    e('climate.salon', 'heat', {
      friendly_name: 'Thermostat salon', current_temperature: 21.5, temperature: 21,
      hvac_modes: ['off', 'heat', 'cool', 'auto'], min_temp: 12, max_temp: 28
    }),
    e('media_player.tv_salon', 'playing', {
      friendly_name: 'TV Salon', media_title: 'Blade Runner 2049',
      media_artist: 'Denis Villeneuve', volume_level: 0.34, source: 'Plex'
    }),
    e('cover.salon_volet', 'open', {
      friendly_name: 'Volet salon', current_position: 100, device_class: 'shutter'
    }),
    e('sensor.salon_temperature', 21.5, {
      friendly_name: 'Température salon', unit_of_measurement: '°C', device_class: 'temperature'
    }),
    e('sensor.salon_humidity', 46, {
      friendly_name: 'Humidité salon', unit_of_measurement: '%', device_class: 'humidity'
    }),

    // --- Cuisine --------------------------------------------------------
    e('light.cuisine', 'off', {
      friendly_name: 'Spots cuisine', brightness: 255, rgb_color: [255, 245, 230],
      supported_color_modes: ['rgb']
    }),
    e('switch.cafetiere', 'off', { friendly_name: 'Cafetière' }),
    e('sensor.cuisine_temperature', 22.1, {
      friendly_name: 'Température cuisine', unit_of_measurement: '°C', device_class: 'temperature'
    }),
    e('binary_sensor.cuisine_mouvement', 'off', {
      friendly_name: 'Mouvement cuisine', device_class: 'motion'
    }),

    // --- Entrée ---------------------------------------------------------
    e('light.entree', 'off', { friendly_name: 'Entrée', brightness: 180 }),
    e('lock.porte_entree', 'locked', { friendly_name: 'Porte d’entrée' }),
    e('binary_sensor.porte_entree', 'off', {
      friendly_name: 'Porte d’entrée', device_class: 'door'
    }),

    // --- Bureau ---------------------------------------------------------
    e('light.bureau', 'on', {
      friendly_name: 'Bureau', brightness: 220, rgb_color: [120, 200, 255],
      supported_color_modes: ['rgb']
    }),
    e('switch.pc_bureau', 'on', { friendly_name: 'Station de travail' }),
    e('media_player.enceinte_bureau', 'playing', {
      friendly_name: 'Enceinte bureau', media_title: 'Ambient Works',
      media_artist: 'Aphex Twin', volume_level: 0.22
    }),
    e('sensor.bureau_temperature', 22.8, {
      friendly_name: 'Température bureau', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    // --- Garage ---------------------------------------------------------
    e('light.garage', 'off', { friendly_name: 'Garage', brightness: 255 }),
    e('cover.porte_garage', 'closed', {
      friendly_name: 'Porte de garage', current_position: 0, device_class: 'garage'
    }),
    e('sensor.voiture_batterie', 72, {
      friendly_name: 'Batterie voiture', unit_of_measurement: '%', device_class: 'battery'
    }),
    e('binary_sensor.garage_porte', 'off', {
      friendly_name: 'Portillon garage', device_class: 'garage_door'
    }),

    // --- Étage ----------------------------------------------------------
    e('light.chambre', 'off', {
      friendly_name: 'Chambre', brightness: 140, rgb_color: [255, 170, 140],
      supported_color_modes: ['rgb']
    }),
    e('climate.chambre', 'heat', {
      friendly_name: 'Thermostat chambre', current_temperature: 19.8, temperature: 19,
      hvac_modes: ['off', 'heat', 'cool', 'auto'], min_temp: 12, max_temp: 28
    }),
    e('cover.chambre_volet', 'closed', {
      friendly_name: 'Volet chambre', current_position: 0, device_class: 'shutter'
    }),
    e('media_player.enceinte_chambre', 'off', { friendly_name: 'Enceinte chambre', volume_level: 0.1 }),
    e('sensor.chambre_temperature', 19.8, {
      friendly_name: 'Température chambre', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.sdb', 'off', { friendly_name: 'Salle de bain', brightness: 200 }),
    e('switch.seche_serviette', 'on', { friendly_name: 'Sèche-serviette' }),
    e('sensor.sdb_humidity', 63, {
      friendly_name: 'Humidité SdB', unit_of_measurement: '%', device_class: 'humidity'
    }),
    e('sensor.sdb_temperature', 22.4, {
      friendly_name: 'Température SdB', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.chambre_lea', 'on', {
      friendly_name: 'Chambre Léa', brightness: 90, rgb_color: [255, 120, 200],
      supported_color_modes: ['rgb']
    }),
    e('cover.chambre_lea_volet', 'open', {
      friendly_name: 'Volet Léa', current_position: 60, device_class: 'shutter'
    }),
    e('sensor.chambre_lea_temperature', 20.4, {
      friendly_name: 'Température Léa', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.chambre_tom', 'off', { friendly_name: 'Chambre Tom', brightness: 160 }),
    e('sensor.chambre_tom_temperature', 20.1, {
      friendly_name: 'Température Tom', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.palier', 'off', { friendly_name: 'Palier', brightness: 120 }),
    e('binary_sensor.palier_mouvement', 'off', {
      friendly_name: 'Mouvement palier', device_class: 'motion'
    }),

    // --- Scènes ---------------------------------------------------------
    e('scene.bonjour', 'scening', { friendly_name: 'Bonjour' }),
    e('scene.cinema', 'scening', { friendly_name: 'Cinéma' }),
    e('scene.diner', 'scening', { friendly_name: 'Dîner' }),
    e('scene.nuit', 'scening', { friendly_name: 'Nuit' }),
    e('script.tout_eteindre', 'off', { friendly_name: 'Tout éteindre' })
  ];
}

const SCENES = {
  'scene.bonjour': [
    ['light.cuisine', { state: 'on', attributes: { brightness: 255, rgb_color: [255, 244, 224] } }],
    ['light.salon', { state: 'on', attributes: { brightness: 220, rgb_color: [255, 236, 210] } }],
    ['cover.salon_volet', { state: 'open', attributes: { current_position: 100 } }],
    ['cover.chambre_volet', { state: 'open', attributes: { current_position: 100 } }],
    ['switch.cafetiere', { state: 'on' }],
    ['climate.salon', { attributes: { temperature: 21 } }]
  ],
  'scene.cinema': [
    ['light.salon', { state: 'on', attributes: { brightness: 40, rgb_color: [120, 90, 255] } }],
    ['light.salon_lampadaire', { state: 'on', attributes: { brightness: 60, rgb_color: [70, 60, 220] } }],
    ['light.cuisine', { state: 'off' }],
    ['cover.salon_volet', { state: 'closed', attributes: { current_position: 0 } }],
    ['media_player.tv_salon', { state: 'playing' }]
  ],
  'scene.diner': [
    ['light.cuisine', { state: 'on', attributes: { brightness: 180, rgb_color: [255, 214, 170] } }],
    ['light.salon', { state: 'on', attributes: { brightness: 120, rgb_color: [255, 190, 140] } }],
    ['media_player.tv_salon', { state: 'paused' }],
    ['light.bureau', { state: 'off' }]
  ],
  'scene.nuit': [
    ['light.salon', { state: 'off' }],
    ['light.salon_lampadaire', { state: 'off' }],
    ['light.cuisine', { state: 'off' }],
    ['light.bureau', { state: 'off' }],
    ['light.entree', { state: 'off' }],
    ['light.palier', { state: 'on', attributes: { brightness: 25 } }],
    ['cover.salon_volet', { state: 'closed', attributes: { current_position: 0 } }],
    ['cover.chambre_volet', { state: 'closed', attributes: { current_position: 0 } }],
    ['media_player.tv_salon', { state: 'off' }],
    ['lock.porte_entree', { state: 'locked' }],
    ['climate.chambre', { attributes: { temperature: 18 } }]
  ]
};

export class DemoBackend {
  constructor() {
    this.timer = null;
    this.entities = new Map();
  }

  async connect() {
    store.setStatus('demo', 'Mode démonstration');
    const list = buildEntities();
    list.forEach((ent) => this.entities.set(ent.entity_id, ent));
    store.setEntities(list);

    // Historique de départ, pour que les courbes ne soient pas vides.
    seedHistory('sensor.consommation_electrique', synth(1240, 45, 260));
    seedHistory('sensor.production_solaire', synth(2180, 45, 420));
    seedHistory('sensor.salon_temperature', synth(21.5, 45, 0.6));
    seedHistory('sensor.exterieur_temperature', synth(19.6, 45, 1.4));

    this.timer = setInterval(() => this.tick(), 3000);
    return true;
  }

  disconnect() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Évolution douce des capteurs + événements aléatoires. */
  tick() {
    const drift = (id, amp, min, max, digits = 1) => {
      const ent = this.entities.get(id);
      if (!ent) return;
      const next = clamp(Number(ent.state) + (Math.random() - 0.5) * amp, min, max);
      this.patch(id, { state: next.toFixed(digits) });
    };

    drift('sensor.salon_temperature', 0.2, 18, 25);
    drift('sensor.cuisine_temperature', 0.2, 18, 26);
    drift('sensor.bureau_temperature', 0.2, 18, 26);
    drift('sensor.chambre_temperature', 0.15, 16, 24);
    drift('sensor.chambre_lea_temperature', 0.15, 16, 24);
    drift('sensor.chambre_tom_temperature', 0.15, 16, 24);
    drift('sensor.sdb_temperature', 0.25, 18, 27);
    drift('sensor.exterieur_temperature', 0.25, 5, 32);
    drift('sensor.salon_humidity', 1.2, 35, 65, 0);
    drift('sensor.sdb_humidity', 2.5, 40, 85, 0);
    drift('sensor.consommation_electrique', 220, 180, 4200, 0);
    drift('sensor.production_solaire', 260, 0, 5200, 0);

    // Reflet du thermostat sur la température mesurée.
    for (const id of ['climate.salon', 'climate.chambre']) {
      const c = this.entities.get(id);
      if (!c || c.state === 'off') continue;
      const cur = Number(c.attributes.current_temperature);
      const target = Number(c.attributes.temperature);
      const next = cur + Math.sign(target - cur) * Math.min(0.1, Math.abs(target - cur));
      this.patch(id, { attributes: { current_temperature: Number(next.toFixed(1)) } });
    }

    // Détecteurs de mouvement : impulsions courtes.
    for (const id of ['binary_sensor.cuisine_mouvement', 'binary_sensor.palier_mouvement']) {
      const s = this.entities.get(id);
      if (!s) continue;
      if (s.state === 'on') {
        if (Math.random() < 0.5) this.patch(id, { state: 'off' });
      } else if (Math.random() < 0.12) {
        this.patch(id, { state: 'on' });
      }
    }

    if (Math.random() < 0.03) {
      const p = this.entities.get('person.marie');
      this.patch('person.marie', { state: p.state === 'home' ? 'not_home' : 'home' });
    }
  }

  patch(entityId, { state, attributes } = {}) {
    const ent = this.entities.get(entityId);
    if (!ent) return;
    const next = {
      entity_id: entityId,
      state: state !== undefined ? String(state) : ent.state,
      attributes: { ...ent.attributes, ...(attributes || {}) },
      last_changed: state !== undefined && String(state) !== ent.state ? now() : ent.last_changed
    };
    this.entities.set(entityId, next);
    store.setEntity(next);
  }

  async callService(domain, service, data = {}) {
    const targets = toArray(data.entity_id);

    if (domain === 'scene' && service === 'turn_on') {
      for (const id of targets) this.applyScene(id);
      return;
    }
    if (domain === 'script') {
      if (service === 'turn_on' || targets.length) {
        for (const id of targets.length ? targets : [`script.${service}`]) this.runScript(id);
      }
      return;
    }
    if (domain === 'alarm_control_panel') {
      const map = {
        alarm_arm_away: 'armed_away', alarm_arm_home: 'armed_home', alarm_disarm: 'disarmed'
      };
      for (const id of targets) this.patch(id, { state: map[service] || 'disarmed' });
      return;
    }

    for (const id of targets) {
      const ent = this.entities.get(id);
      if (!ent) continue;

      switch (`${domain}.${service}`) {
        case 'light.turn_on': {
          const attrs = {};
          if (data.brightness != null) attrs.brightness = Math.round(data.brightness);
          if (data.brightness_pct != null) attrs.brightness = Math.round(data.brightness_pct * 2.55);
          if (data.rgb_color) attrs.rgb_color = data.rgb_color;
          this.patch(id, { state: 'on', attributes: attrs });
          break;
        }
        case 'light.turn_off':
        case 'switch.turn_off':
        case 'fan.turn_off':
        case 'media_player.turn_off':
          this.patch(id, { state: 'off' });
          break;
        case 'switch.turn_on':
        case 'fan.turn_on':
        case 'media_player.turn_on':
          this.patch(id, { state: 'on' });
          break;
        case 'light.toggle':
        case 'switch.toggle':
        case 'fan.toggle':
          this.patch(id, { state: ent.state === 'on' ? 'off' : 'on' });
          break;
        case 'cover.open_cover':
          this.patch(id, { state: 'open', attributes: { current_position: 100 } });
          break;
        case 'cover.close_cover':
          this.patch(id, { state: 'closed', attributes: { current_position: 0 } });
          break;
        case 'cover.stop_cover':
          this.patch(id, { state: Number(ent.attributes.current_position) > 0 ? 'open' : 'closed' });
          break;
        case 'cover.set_cover_position': {
          const pos = clamp(Number(data.position), 0, 100);
          this.patch(id, { state: pos > 0 ? 'open' : 'closed', attributes: { current_position: pos } });
          break;
        }
        case 'climate.set_temperature':
          this.patch(id, { attributes: { temperature: Number(data.temperature) } });
          break;
        case 'climate.set_hvac_mode':
          this.patch(id, { state: data.hvac_mode });
          break;
        case 'media_player.media_play_pause':
          this.patch(id, { state: ent.state === 'playing' ? 'paused' : 'playing' });
          break;
        case 'media_player.media_play':
          this.patch(id, { state: 'playing' });
          break;
        case 'media_player.media_pause':
          this.patch(id, { state: 'paused' });
          break;
        case 'media_player.volume_set':
          this.patch(id, { attributes: { volume_level: clamp(Number(data.volume_level), 0, 1) } });
          break;
        case 'media_player.media_next_track':
        case 'media_player.media_previous_track': {
          const titles = ['Blade Runner 2049', 'Dune', 'Interstellar', 'Arrival', 'Sicario'];
          const i = titles.indexOf(ent.attributes.media_title);
          const d = service === 'media_player.media_next_track' ? 1 : -1;
          const nextIdx = (i + d + titles.length) % titles.length;
          this.patch(id, { state: 'playing', attributes: { media_title: titles[nextIdx] } });
          break;
        }
        case 'lock.lock':
          this.patch(id, { state: 'locked' });
          break;
        case 'lock.unlock':
          this.patch(id, { state: 'unlocked' });
          break;
        default:
          break;
      }
    }
  }

  applyScene(sceneId) {
    const steps = SCENES[sceneId];
    if (!steps) return;
    steps.forEach(([id, patch], i) => {
      setTimeout(() => this.patch(id, patch), i * 90);
    });
  }

  runScript(scriptId) {
    if (scriptId === 'script.tout_eteindre') {
      let i = 0;
      for (const [id, ent] of this.entities) {
        if ((id.startsWith('light.') || id.startsWith('switch.') || id.startsWith('media_player.'))
            && ent.state !== 'off') {
          setTimeout(() => this.patch(id, { state: 'off' }), (i += 1) * 80);
        }
      }
    }
  }
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function toArray(v) { return v == null ? [] : Array.isArray(v) ? v : [v]; }

function synth(base, count, amp) {
  const out = [];
  let v = base;
  for (let i = 0; i < count; i += 1) {
    v = clamp(v + (Math.random() - 0.5) * amp * 0.6, base - amp, base + amp);
    out.push(Number(v.toFixed(1)));
  }
  return out;
}
