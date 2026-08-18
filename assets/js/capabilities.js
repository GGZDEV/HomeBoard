/**
 * Détection des fonctionnalités réellement disponibles.
 *
 * Rien n'est affiché « au cas où » : une carte, une vue ou une puce
 * n'apparaît que si les entités correspondantes existent chez l'utilisateur.
 * La configuration peut forcer un choix ; sinon tout est déduit.
 */

const CONTROL_DOMAINS = ['light', 'switch', 'fan', 'climate', 'cover', 'media_player', 'lock'];
const SENSOR_DOMAINS = ['sensor', 'binary_sensor'];
export const ASSIGNABLE_DOMAINS = [...CONTROL_DOMAINS, ...SENSOR_DOMAINS];

const OPENING_CLASSES = ['door', 'garage_door', 'window', 'opening'];

const SCENE_ICONS = [
  [/nuit|night|dodo|coucher/, 'moon'],
  [/bonjour|matin|morning|reveil|réveil|lever/, 'sun'],
  [/cinema|cinéma|film|movie|serie|série|tv/, 'tv'],
  [/diner|dîner|dinner|repas|cuisine|manger/, 'cooking'],
  [/eteindre|éteindre|off|absent|away|depart|départ|quitter/, 'power'],
  [/lecture|musique|music|ambiance/, 'speaker'],
  [/travail|bureau|work|focus/, 'laptop']
];

export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const list = (entities, prefix) =>
  Object.values(entities).filter((e) => e.entity_id.startsWith(`${prefix}.`));

const byClass = (entities, domain, deviceClass) =>
  Object.values(entities).filter(
    (e) => e.entity_id.startsWith(`${domain}.`) && e.attributes?.device_class === deviceClass
  );

const pick = (candidates, patterns) => {
  for (const pattern of patterns) {
    const hit = candidates.find((e) =>
      pattern.test(e.entity_id) || pattern.test(slugify(e.attributes?.friendly_name)));
    if (hit) return hit;
  }
  return null;
};

/**
 * @returns un descriptif de ce que l'interface peut afficher.
 */
export function detectCapabilities(entities, config = {}) {
  const forced = config.globals || {};
  const has = (id) => Boolean(id && entities[id]);

  const weather = has(forced.weather) ? forced.weather : list(entities, 'weather')[0]?.entity_id || null;

  const temperatures = byClass(entities, 'sensor', 'temperature');
  const outdoorSensor = pick(temperatures, [/exterieur|extérieur|outdoor|exterior|dehors|jardin|terrasse/]);
  const outdoor = has(forced.outdoorTemperature)
    ? forced.outdoorTemperature
    : outdoorSensor?.entity_id || null;

  const powerSensors = [
    ...byClass(entities, 'sensor', 'power'),
    ...byClass(entities, 'sensor', 'energy')
  ];
  const solarSensor = pick(powerSensors, [/solaire|solar|pv|photovolta|production/]);
  const gridSensor = pick(
    powerSensors.filter((e) => e !== solarSensor),
    [/consommation|consumption|grid|reseau|réseau|maison|house|total|puissance|power/]
  ) || powerSensors.find((e) => e !== solarSensor) || null;

  const power = has(forced.power) ? forced.power : gridSensor?.entity_id || null;
  const solar = has(forced.solar) ? forced.solar : solarSensor?.entity_id || null;

  const alarm = has(forced.alarm) ? forced.alarm : list(entities, 'alarm_control_panel')[0]?.entity_id || null;

  const persons = (forced.persons || []).filter(has).length
    ? forced.persons.filter(has)
    : list(entities, 'person').map((e) => e.entity_id);

  const locks = list(entities, 'lock').map((e) => e.entity_id);
  const openings = Object.values(entities)
    .filter((e) => e.entity_id.startsWith('binary_sensor.')
      && OPENING_CLASSES.includes(e.attributes?.device_class))
    .map((e) => e.entity_id);
  const motions = Object.values(entities)
    .filter((e) => ['motion', 'occupancy'].includes(e.attributes?.device_class))
    .map((e) => e.entity_id);

  const scenes = (config.scenes?.length ? config.scenes.filter((s) => has(s.id)) : detectScenes(entities));

  const hasEnergy = Boolean(power || solar);
  const hasSecurity = Boolean(alarm || locks.length || openings.length);

  const views = ['home', 'rooms'];
  if (hasEnergy) views.push('energy');
  if (hasSecurity) views.push('security');

  return {
    weather, outdoor, power, solar, alarm, persons,
    locks, openings, motions, scenes,
    hasEnergy, hasSecurity,
    hasWeather: Boolean(weather || outdoor),
    hasPresence: persons.length > 0,
    views,
    favorites: pickFavorites(entities, config)
  };
}

function detectScenes(entities) {
  return [...list(entities, 'scene'), ...list(entities, 'script')]
    .slice(0, 8)
    .map((e) => {
      const label = e.attributes?.friendly_name || e.entity_id.split('.')[1].replace(/_/g, ' ');
      const slug = slugify(label);
      const match = SCENE_ICONS.find(([re]) => re.test(slug));
      return { id: e.entity_id, name: capitalize(label), icon: match ? match[1] : 'zap' };
    });
}

/**
 * Favoris : ceux de la configuration s'ils existent, sinon les quelques
 * appareils les plus utiles trouvés dans l'installation.
 */
function pickFavorites(entities, config) {
  const configured = (config.globals?.favorites || []).filter((id) => entities[id]);
  if (configured.length) return configured;

  const out = [];
  for (const domain of ['light', 'climate', 'media_player', 'cover']) {
    const first = list(entities, domain)[0];
    if (first) out.push(first.entity_id);
  }
  return out.slice(0, 4);
}

/**
 * Rattache automatiquement les entités aux pièces d'après leur nom
 * (`light.salon` -> pièce « Salon »). Ne touche pas aux entités déjà placées.
 *
 * @returns { assigned: number, perRoom: Map<roomId, string[]> }
 */
export function autoAssignEntities(config, entities) {
  const already = new Set();
  for (const floor of config.floors || []) {
    for (const room of floor.rooms || []) {
      for (const id of room.entities || []) already.add(id);
    }
  }

  const rooms = [];
  for (const floor of config.floors || []) {
    for (const room of floor.rooms || []) {
      const slug = slugify(room.name);
      rooms.push({ room, tokens: [slug, slugify(room.id)].filter(Boolean) });
    }
  }
  // Les noms les plus longs d'abord : « chambre_lea » avant « chambre ».
  rooms.sort((a, b) => Math.max(...b.tokens.map((t) => t.length)) - Math.max(...a.tokens.map((t) => t.length)));

  const perRoom = new Map();
  let assigned = 0;

  for (const entity of Object.values(entities)) {
    const [domain, object] = entity.entity_id.split('.');
    if (!ASSIGNABLE_DOMAINS.includes(domain)) continue;
    if (already.has(entity.entity_id)) continue;

    const haystack = `${slugify(object)}_${slugify(entity.attributes?.friendly_name)}`;
    const match = rooms.find(({ tokens }) => tokens.some((t) => t && haystack.includes(t)));
    if (!match) continue;

    match.room.entities = match.room.entities || [];
    match.room.entities.push(entity.entity_id);
    already.add(entity.entity_id);
    assigned += 1;
    perRoom.set(match.room.id, [...(perRoom.get(match.room.id) || []), entity.entity_id]);
  }

  return { assigned, perRoom };
}

/** Entités pilotables non encore rattachées à une pièce. */
export function unassignedEntities(config, entities) {
  const used = new Set();
  for (const floor of config.floors || []) {
    for (const room of floor.rooms || []) {
      for (const id of room.entities || []) used.add(id);
    }
  }
  return Object.values(entities)
    .filter((e) => ASSIGNABLE_DOMAINS.includes(e.entity_id.split('.')[0]) && !used.has(e.entity_id))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}

function capitalize(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
