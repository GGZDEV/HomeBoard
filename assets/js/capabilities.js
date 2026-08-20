/**
 * Lecture de l'installation.
 *
 * Le produit ne s'intéresse qu'aux lumières et aux capteurs de température :
 * tout le reste des entités Home Assistant est ignoré.
 */

const OUTDOOR = /exterieur|extérieur|outdoor|exterior|dehors|jardin|terrasse|balcon/;

export function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const isLightEntity = (entity) => entity?.entity_id.startsWith('light.');

const isTemperatureEntity = (entity) =>
  entity?.entity_id.startsWith('sensor.')
  && entity.attributes?.device_class === 'temperature'
  && Number.isFinite(Number(entity.state));

/** Entité utilisable par HomeBoard (lumière ou température). */
const isSupported = (entity) => isLightEntity(entity) || isTemperatureEntity(entity);

/**
 * Résumé de ce que l'installation permet d'afficher.
 * `config.globals.outdoorTemperature` et `config.globals.favorites` ont la
 * priorité sur la détection automatique.
 */
export function detectCapabilities(entities, config = {}) {
  const forced = config.globals || {};
  const all = Object.values(entities);

  const lights = all.filter(isLightEntity);
  const temperatures = all.filter(isTemperatureEntity);

  const outdoor = entities[forced.outdoorTemperature]
    ? forced.outdoorTemperature
    : temperatures.find((e) => OUTDOOR.test(e.entity_id)
        || OUTDOOR.test(slugify(e.attributes?.friendly_name)))?.entity_id || null;

  const indoor = temperatures.filter((e) => e.entity_id !== outdoor);
  const indoorAverage = indoor.length
    ? indoor.reduce((sum, e) => sum + Number(e.state), 0) / indoor.length
    : null;

  const configured = (forced.favorites || []).filter((id) => entities[id]);

  return {
    lights: lights.map((e) => e.entity_id),
    lightsOn: lights.filter((e) => e.state === 'on').map((e) => e.entity_id),
    temperatures: temperatures.map((e) => e.entity_id),
    outdoor,
    indoorAverage,
    hasLights: lights.length > 0,
    hasTemperature: temperatures.length > 0,
    favorites: configured.length ? configured : lights.slice(0, 4).map((e) => e.entity_id)
  };
}

/**
 * Rattache les entités aux pièces d'après leur nom
 * (`light.cuisine_plan_de_travail` -> pièce « Cuisine »).
 * Les entités déjà placées ne sont jamais touchées.
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
      rooms.push({ room, tokens: [slugify(room.name), slugify(room.id)].filter(Boolean) });
    }
  }
  // Les noms les plus longs d'abord : « chambre_lea » avant « chambre ».
  rooms.sort((a, b) => Math.max(...b.tokens.map((t) => t.length)) - Math.max(...a.tokens.map((t) => t.length)));

  let assigned = 0;
  for (const entity of Object.values(entities)) {
    if (!isSupported(entity) || already.has(entity.entity_id)) continue;

    const object = entity.entity_id.split('.')[1];
    const haystack = `${slugify(object)}_${slugify(entity.attributes?.friendly_name)}`;
    const match = rooms.find(({ tokens }) => tokens.some((t) => t && haystack.includes(t)));
    if (!match) continue;

    match.room.entities = [...(match.room.entities || []), entity.entity_id];
    already.add(entity.entity_id);
    assigned += 1;
  }

  return { assigned };
}

/** Lumières et capteurs de température non encore rattachés à une pièce. */
export function unassignedEntities(config, entities) {
  const used = new Set();
  for (const floor of config.floors || []) {
    for (const room of floor.rooms || []) {
      for (const id of room.entities || []) used.add(id);
    }
  }
  return Object.values(entities)
    .filter((e) => isSupported(e) && !used.has(e.entity_id))
    .sort((a, b) => a.entity_id.localeCompare(b.entity_id));
}
