// Turns raw Home Assistant data (states + registries) into rooms and readable device info.
window.HD = window.HD || {};

(function () {
  const IC = HD.IC;
  const GRID_DOMAINS = ['light', 'switch', 'fan', 'cover', 'lock', 'media_player', 'climate',
    'input_boolean', 'humidifier', 'vacuum', 'valve', 'water_heater', 'siren'];
  const SAFETY_CLASSES = ['moisture', 'smoke', 'gas', 'carbon_monoxide', 'door', 'window', 'garage_door'];
  const HVAC = { off: 'Arrêt', auto: 'Auto', heat_cool: 'Mixte', cool: 'Froid', heat: 'Chaud', dry: 'Déshum.', fan_only: 'Ventil.' };
  const WEATHER = {
    'clear-night': 'Nuit claire', cloudy: 'Nuageux', exceptional: 'Exceptionnel', fog: 'Brouillard', hail: 'Grêle',
    lightning: 'Orage', 'lightning-rainy': 'Orage pluvieux', partlycloudy: 'Éclaircies', pouring: 'Averses',
    rainy: 'Pluie', snowy: 'Neige', 'snowy-rainy': 'Neige fondue', sunny: 'Ensoleillé', windy: 'Venteux', 'windy-variant': 'Venteux'
  };
  const UNAVAILABLE = ['unavailable', 'unknown'];

  const domainOf = (id) => id.split('.')[0];

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Custom labels set by the user (entity_id -> label), shared by every module.
  let names = {};
  function setNames(map) { names = map || {}; }

  // Home Assistant names sensors "<Device> Température"; the suffix is noise next to the value.
  const SUFFIX = { temperature: /\s+(temp[ée]rature)$/i, humidity: /\s+(humidit[ée]|humidity)$/i };

  function baseName(st) {
    let full = (st.attributes && st.attributes.friendly_name) || st.entity_id.split('.')[1].replace(/_/g, ' ');
    const re = st.attributes && SUFFIX[st.attributes.device_class];
    if (re && domainOf(st.entity_id) === 'sensor' && re.test(full) && full.replace(re, '').trim()) full = full.replace(re, '').trim();
    return full;
  }

  // "Salon Plafonnier" in room "Salon" -> "Plafonnier"; a custom label always wins.
  function shortName(st, roomName) {
    if (names[st.entity_id]) return names[st.entity_id];
    const full = baseName(st);
    if (!roomName) return full;
    if (normalize(full).startsWith(normalize(roomName) + ' ') && full.length > roomName.length + 1) {
      const rest = full.slice(roomName.length + 1).trim();
      return rest.charAt(0).toUpperCase() + rest.slice(1);
    }
    return full;
  }

  // Built once per fetch: visible entities, their area and device.
  function buildIndex(data) {
    const devArea = new Map(data.devices.map((d) => [d.id, d.area_id]));
    const reg = new Map(data.entities.map((e) => [e.entity_id, e]));
    const areaOf = new Map();
    const deviceOf = new Map();
    const visible = new Set();
    for (const st of data.states) {
      const e = reg.get(st.entity_id);
      if (e && (e.hidden_by || e.disabled_by || e.entity_category)) continue;
      visible.add(st.entity_id);
      if (e && e.device_id) deviceOf.set(st.entity_id, e.device_id);
      areaOf.set(st.entity_id, e ? (e.area_id || (e.device_id && devArea.get(e.device_id)) || null) : null);
    }
    const known = new Set(data.areas.map((a) => a.area_id));
    const rooms = data.areas.map((a) => ({ id: a.area_id, name: a.name, ids: [] }));
    const other = { id: '__autres', name: data.areas.length ? 'Autres' : 'Maison', ids: [] };
    const byId = new Map(rooms.map((r) => [r.id, r]));
    for (const id of visible) {
      const a = areaOf.get(id);
      (a && known.has(a) ? byId.get(a) : other).ids.push(id);
      if (!(a && known.has(a))) areaOf.set(id, null);
    }
    rooms.push(other);
    byId.set(other.id, other);
    return { rooms, byId, areaOf, deviceOf, visible };
  }

  function addEntity(index, id) {
    if (index.areaOf.has(id)) return;
    index.visible.add(id);
    index.areaOf.set(id, null);
    index.byId.get('__autres').ids.push(id);
  }

  function roomOf(index, id) {
    const a = index.areaOf.get(id);
    return index.byId.get(a || '__autres');
  }

  const isAvail = (st) => st && !UNAVAILABLE.includes(st.state);
  const isGridEntity = (st) => GRID_DOMAINS.includes(domainOf(st.entity_id)) ||
    (domainOf(st.entity_id) === 'binary_sensor' && SAFETY_CLASSES.includes(st.attributes.device_class));
  const isSensorClass = (st, dc) => domainOf(st.entity_id) === 'sensor' && st.attributes.device_class === dc;
  const isTemp = (st) => isSensorClass(st, 'temperature');
  const isHumidity = (st) => isSensorClass(st, 'humidity');

  function lightCaps(st) {
    const modes = st.attributes.supported_color_modes || [];
    return {
      dimmable: modes.some((m) => m !== 'onoff'),
      ct: modes.includes('color_temp'),
      color: modes.some((m) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m))
    };
  }

  // Humidity sensor from the same physical device as a thermometer (most thermometers report both).
  function humidityFor(tempSt, states, index) {
    const dev = index.deviceOf.get(tempSt.entity_id);
    if (!dev) return null;
    for (const [id, d] of index.deviceOf) {
      if (d !== dev || id === tempSt.entity_id) continue;
      const st = states.get(id);
      if (st && isHumidity(st) && isAvail(st)) return Number(st.state);
    }
    return null;
  }

  function iconFor(st) {
    const d = domainOf(st.entity_id);
    const a = st.attributes;
    const n = normalize(a.friendly_name);
    switch (d) {
      case 'light': return IC.bulb;
      case 'switch':
      case 'input_boolean': return /ecran|tv|tele/.test(n) ? IC.tv : IC.plug;
      case 'fan': return IC.fan;
      case 'humidifier': return IC.drop;
      case 'cover': return ['door', 'garage', 'gate'].includes(a.device_class) ? IC.door : IC.blinds;
      case 'lock': return IC.lock;
      case 'media_player': return a.device_class === 'tv' || /tv|tele/.test(n) ? IC.tv : IC.speaker;
      case 'climate': return IC.snow;
      case 'water_heater': return IC.thermo;
      case 'vacuum': return IC.vacuum;
      case 'valve': return IC.drop;
      case 'siren': return IC.speaker;
      case 'weather': return IC.cloud;
      case 'scene': return IC.spark;
      case 'automation': return IC.robot;
      case 'script': return IC.play;
      case 'binary_sensor':
        if (a.device_class === 'moisture') return IC.drop;
        if (['door', 'garage_door'].includes(a.device_class)) return IC.door;
        if (a.device_class === 'window') return IC.window;
        return IC.smoke;
      case 'sensor':
        if (a.device_class === 'temperature') return IC.thermo;
        if (a.device_class === 'humidity') return IC.drop;
        if (['power', 'energy'].includes(a.device_class)) return IC.bolt;
        return IC.dot;
      default: return IC.dot;
    }
  }

  // Status text, "on" highlight and the service to call when the tile is pressed.
  function describe(st, roomName) {
    const d = domainOf(st.entity_id);
    const a = st.attributes;
    const s = st.state;
    const out = { id: st.entity_id, name: shortName(st, roomName), icon: iconFor(st), on: false, status: '', action: null };
    if (UNAVAILABLE.includes(s) && d !== 'scene') {
      out.status = 'Indisponible';
      out.unavailable = true;
      return out;
    }
    const pct = (v) => Math.round(v) + ' %';
    switch (d) {
      case 'light':
        out.on = s === 'on';
        out.status = out.on ? (a.brightness != null ? 'Allumé · ' + pct(a.brightness / 2.55) : 'Allumé') : 'Éteint';
        out.action = ['light', 'toggle'];
        break;
      case 'switch': case 'input_boolean': case 'siren': case 'humidifier':
        out.on = s === 'on';
        out.status = out.on ? 'Allumé' : 'Éteint';
        out.action = [d, 'toggle'];
        break;
      case 'fan':
        out.on = s === 'on';
        out.status = out.on ? (a.percentage ? 'Allumé · ' + pct(a.percentage) : 'Allumé') : 'Éteint';
        out.action = ['fan', 'toggle'];
        break;
      case 'cover':
        out.on = s !== 'closed';
        out.status = { open: 'Ouvert', closed: 'Fermé', opening: 'Ouverture…', closing: 'Fermeture…' }[s] || s;
        if (s === 'open' && a.current_position != null && a.current_position < 100) out.status += ' ' + pct(a.current_position);
        out.action = ['cover', 'toggle'];
        break;
      case 'valve':
        out.on = s !== 'closed';
        out.status = s === 'closed' ? 'Fermée' : 'Ouverte';
        out.action = ['valve', 'toggle'];
        break;
      case 'lock':
        out.on = s === 'locked';
        out.status = { locked: 'Verrouillée', unlocked: 'Déverrouillée', jammed: 'Bloquée', locking: 'Verrouillage…', unlocking: 'Déverrouillage…', open: 'Ouverte' }[s] || s;
        out.action = ['lock', out.on ? 'unlock' : 'lock'];
        break;
      case 'media_player':
        out.on = !['off', 'standby'].includes(s);
        out.status = s === 'playing' ? (a.media_title || 'Lecture') : s === 'paused' ? 'En pause' : out.on ? (a.source || 'Allumé') : 'Éteint';
        out.action = ['media_player', 'toggle'];
        break;
      case 'climate':
        out.on = s !== 'off';
        out.status = out.on ? (HVAC[s] || s) + (a.temperature != null ? ' · ' + fmtNum(a.temperature) + '°' : '') : 'Éteint';
        out.action = ['climate', out.on ? 'turn_off' : 'turn_on'];
        break;
      case 'water_heater':
        out.on = s !== 'off';
        out.status = out.on ? (a.temperature != null ? fmtNum(a.temperature) + '°' : 'Allumé') : 'Éteint';
        out.action = ['water_heater', out.on ? 'turn_off' : 'turn_on'];
        break;
      case 'vacuum':
        out.on = ['cleaning', 'returning'].includes(s);
        out.status = { cleaning: 'Nettoyage', docked: 'À la base', returning: 'Retour…', idle: 'En attente', paused: 'En pause', error: 'Erreur' }[s] || s;
        out.action = ['vacuum', out.on ? 'return_to_base' : 'start'];
        break;
      case 'binary_sensor': {
        out.on = s === 'on';
        const dc = a.device_class;
        if (['door', 'window', 'garage_door'].includes(dc)) out.status = out.on ? 'Ouverte' : 'Fermée';
        else if (dc === 'moisture') out.status = out.on ? 'Fuite détectée' : 'RAS';
        else if (SAFETY_CLASSES.includes(dc)) out.status = out.on ? 'Alerte' : 'RAS';
        else out.status = out.on ? 'Actif' : 'Inactif';
        break;
      }
      case 'sensor':
        out.status = fmtNum(s) + (a.unit_of_measurement ? ' ' + a.unit_of_measurement : '');
        break;
      default:
        out.status = s;
    }
    return out;
  }

  function fmtNum(v, digits = 1) {
    const n = Number(v);
    if (v === '' || v == null || !isFinite(n)) return String(v);
    return n.toLocaleString('fr-FR', { maximumFractionDigits: digits });
  }

  function relTime(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return null;
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return "à l'instant";
    if (m < 60) return 'il y a ' + m + ' min';
    const h = Math.round(m / 60);
    if (h < 24) return 'il y a ' + h + ' h';
    return 'il y a ' + Math.round(h / 24) + ' j';
  }

  function sceneIcon(name) {
    const n = normalize(name);
    if (/matin|reveil|lever|jour/.test(n)) return IC.sun;
    if (/cine|film|tv|tele/.test(n)) return IC.film;
    if (/nuit|dodo|coucher|soir/.test(n)) return IC.moon;
    if (/absent|depart|vacance|sortie/.test(n)) return IC.away;
    return IC.spark;
  }

  HD.Model = {
    buildIndex, addEntity, roomOf, describe, lightCaps, isGridEntity, isTemp, isHumidity, isSensorClass, isAvail,
    humidityFor, shortName, baseName, setNames, sceneIcon, relTime, fmtNum, domainOf, normalize, iconFor, HVAC, WEATHER, UNAVAILABLE
  };
})();
