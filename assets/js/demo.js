/**
 * Backend de démonstration : simule un serveur Home Assistant réduit aux
 * lumières et aux capteurs de température. Même interface publique que
 * ha.js, les deux sont donc interchangeables.
 */
import { store, seedHistory } from './store.js';

const now = () => new Date().toISOString();

function e(entity_id, state, attributes = {}) {
  return { entity_id, state: String(state), attributes, last_changed: now() };
}

function buildEntities() {
  return [
    e('sensor.exterieur_temperature', 12.4, {
      friendly_name: 'Extérieur', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    // Rez-de-chaussée
    e('light.salon', 'on', {
      friendly_name: 'Plafonnier salon', brightness: 190, rgb_color: [255, 190, 120],
      supported_color_modes: ['rgb']
    }),
    e('light.salon_lampadaire', 'on', {
      friendly_name: 'Lampadaire', brightness: 120, rgb_color: [160, 120, 255],
      supported_color_modes: ['rgb']
    }),
    e('sensor.salon_temperature', 21.5, {
      friendly_name: 'Température salon', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.cuisine', 'off', {
      friendly_name: 'Spots cuisine', brightness: 255, rgb_color: [255, 245, 230],
      supported_color_modes: ['rgb']
    }),
    e('sensor.cuisine_temperature', 22.1, {
      friendly_name: 'Température cuisine', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.entree', 'off', {
      friendly_name: 'Entrée', brightness: 180, supported_color_modes: ['brightness']
    }),

    e('light.bureau', 'on', {
      friendly_name: 'Bureau', brightness: 220, rgb_color: [120, 200, 255],
      supported_color_modes: ['rgb']
    }),
    e('sensor.bureau_temperature', 22.8, {
      friendly_name: 'Température bureau', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.garage', 'off', { friendly_name: 'Garage', supported_color_modes: ['onoff'] }),

    // Étage
    e('light.chambre', 'off', {
      friendly_name: 'Chambre', brightness: 140, rgb_color: [255, 170, 140],
      supported_color_modes: ['rgb']
    }),
    e('sensor.chambre_temperature', 19.8, {
      friendly_name: 'Température chambre', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.sdb', 'off', {
      friendly_name: 'Salle de bain', brightness: 200, supported_color_modes: ['brightness']
    }),
    e('sensor.sdb_temperature', 22.4, {
      friendly_name: 'Température salle de bain', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.chambre_lea', 'on', {
      friendly_name: 'Chambre Léa', brightness: 90, rgb_color: [255, 120, 200],
      supported_color_modes: ['rgb']
    }),
    e('sensor.chambre_lea_temperature', 20.4, {
      friendly_name: 'Température Léa', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.chambre_tom', 'off', {
      friendly_name: 'Chambre Tom', brightness: 160, supported_color_modes: ['brightness']
    }),
    e('sensor.chambre_tom_temperature', 20.1, {
      friendly_name: 'Température Tom', unit_of_measurement: '°C', device_class: 'temperature'
    }),

    e('light.palier', 'off', {
      friendly_name: 'Palier', brightness: 120, supported_color_modes: ['brightness']
    })
  ];
}

export class DemoBackend {
  constructor() {
    this.timer = null;
    this.entities = new Map();
  }

  async connect() {
    store.setStatus('demo', 'Mode démonstration');
    const list = buildEntities();
    list.forEach((entity) => this.entities.set(entity.entity_id, entity));
    store.setEntities(list);

    // Un peu d'historique de départ, pour que les courbes ne soient pas vides.
    for (const entity of list) {
      if (entity.attributes.device_class === 'temperature') {
        seedHistory(entity.entity_id, synth(Number(entity.state), 40, 0.8));
      }
    }

    this.timer = setInterval(() => this.tick(), 3000);
    return true;
  }

  disconnect() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Dérive douce des températures. */
  tick() {
    for (const [id, entity] of this.entities) {
      if (entity.attributes.device_class !== 'temperature') continue;
      const outdoor = id.includes('exterieur');
      const amplitude = outdoor ? 0.3 : 0.2;
      const [min, max] = outdoor ? [-5, 35] : [16, 27];
      const next = clamp(Number(entity.state) + (Math.random() - 0.5) * amplitude, min, max);
      this.patch(id, { state: next.toFixed(1) });
    }
  }

  patch(entityId, { state, attributes } = {}) {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    const next = {
      entity_id: entityId,
      state: state !== undefined ? String(state) : entity.state,
      attributes: { ...entity.attributes, ...(attributes || {}) },
      last_changed: state !== undefined && String(state) !== entity.state ? now() : entity.last_changed
    };
    this.entities.set(entityId, next);
    store.setEntity(next);
  }

  async callService(domain, service, data = {}) {
    if (domain !== 'light') return;
    const targets = data.entity_id == null
      ? []
      : [].concat(data.entity_id);

    for (const id of targets) {
      const entity = this.entities.get(id);
      if (!entity) continue;

      if (service === 'turn_off') {
        this.patch(id, { state: 'off' });
      } else if (service === 'toggle') {
        this.patch(id, { state: entity.state === 'on' ? 'off' : 'on' });
      } else if (service === 'turn_on') {
        const attributes = {};
        if (data.brightness != null) attributes.brightness = Math.round(data.brightness);
        if (data.rgb_color) attributes.rgb_color = data.rgb_color;
        this.patch(id, { state: 'on', attributes });
      }
    }
  }
}

function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function synth(base, count, amplitude) {
  const out = [];
  let v = base;
  for (let i = 0; i < count; i += 1) {
    v = clamp(v + (Math.random() - 0.5) * amplitude, base - amplitude * 3, base + amplitude * 3);
    out.push(Number(v.toFixed(1)));
  }
  return out;
}
