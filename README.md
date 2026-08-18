# HomeBoard

Un tableau de bord **Home Assistant** avec une vue « 2.5D » isométrique de la maison…
sans avoir à modéliser quoi que ce soit en 3D.

Chaque pièce est simplement un **rectangle sur une grille** (`x`, `y`, largeur, profondeur)
décrit dans un fichier JSON. HomeBoard se charge de l'extrusion isométrique, des murs,
des ombres et des halos de lumière. Modéliser sa maison prend une dizaine de minutes,
avec un éditeur de plan intégré à l'application.

> Prototype fonctionnel : il tourne en **mode démo** (maison fictive animée, aucune
> installation requise) ou en **mode direct**, branché sur l'API WebSocket de votre
> serveur Home Assistant.

---

## Ce que ça fait

| | |
|---|---|
| **Plan isométrique vivant** | Les pièces s'allument avec la couleur réelle de vos lampes, l'intensité du halo suit la luminosité, les appareils actifs apparaissent sur l'étiquette de la pièce. |
| **Pilotage complet** | Lampes (on/off, luminosité, couleur), thermostats, volets, serrures, lecteurs multimédia, interrupteurs. |
| **Multi-étages** | Un onglet par niveau, avec un point orange quand des lumières y sont allumées. |
| **Scènes** | Barre de scènes en bas du plan (`scene.*` et `script.*`). |
| **Vues dédiées** | Pièces, Énergie (consommation / production solaire / appareils actifs), Sécurité (alarme, ouvertures, serrures, détecteurs). |
| **Thème clair / sombre** | Bascule instantanée, mémorisée. |
| **Zéro dépendance** | Pas de build, pas de framework, pas de `node_modules`. Du HTML, du CSS et des modules ES. |

---

## Démarrage rapide (mode démo)

Les modules ES ont besoin d'être servis en HTTP (l'ouverture directe du fichier
`index.html` ne fonctionne pas) :

```bash
git clone https://github.com/GGZDEV/HomeBoard.git
cd HomeBoard
python3 -m http.server 8080
```

Puis ouvrez <http://localhost:8080>. Une maison fictive s'anime immédiatement :
températures qui dérivent, détecteurs qui se déclenchent, scènes fonctionnelles.

---

## Brancher son vrai Home Assistant

1. Dans Home Assistant : **Profil → Sécurité → Jetons d'accès longue durée →
   Créer un jeton**. Copiez-le.
2. Dans HomeBoard : bouton **Réglages** (en bas du rail), onglet **Connexion**.
3. Choisissez **Home Assistant**, renseignez l'URL (`http://homeassistant.local:8123`)
   et collez le jeton.
4. **Tester la connexion**, puis **Enregistrer**.

L'URL et le jeton restent dans le `localStorage` du navigateur : rien n'est envoyé
ailleurs. Si le serveur est injoignable au démarrage, HomeBoard bascule
automatiquement en mode démo plutôt que d'afficher une page vide.

**Si ça ne se connecte pas :**

- Page en `https://` et Home Assistant en `http://` → le navigateur bloque la
  WebSocket. Servez HomeBoard depuis Home Assistant lui-même (voir ci-dessous).
- Home Assistant derrière un reverse proxy : vérifiez que les WebSockets sont bien
  relayées (`proxy_set_header Upgrade`/`Connection` côté nginx).

---

## L'installer dans Home Assistant

Le plus simple : servir HomeBoard depuis Home Assistant, ce qui règle d'un coup les
questions de HTTPS et d'origine.

```bash
# depuis la machine qui héberge Home Assistant
cp -r HomeBoard /config/www/homeboard
```

Il est alors accessible sur `https://<votre-ha>/local/homeboard/`.
Pour en faire une entrée de menu à part entière, dans `configuration.yaml` :

```yaml
panel_iframe:
  homeboard:
    title: "HomeBoard"
    icon: mdi:floor-plan
    url: /local/homeboard/index.html
    require_admin: false
```

Redémarrez Home Assistant. Dans les réglages de HomeBoard, l'URL est
pré-remplie avec l'origine courante — il ne reste que le jeton à coller.

*(Une carte `webpage` dans un dashboard Lovelace fonctionne aussi, mais le mode
plein écran d'un panneau rend mieux.)*

---

## Modéliser sa maison (10 minutes, sans modeleur 3D)

Tout tient dans [`config/home.json`](config/home.json). L'éditeur intégré
(**Réglages → Plan de la maison**) valide le JSON et applique le plan à chaud ;
l'onglet **Entités** liste toutes vos entités Home Assistant, cliquables pour copier
leur identifiant.

### Une pièce

```json
{
  "id": "salon",
  "name": "Salon",
  "icon": "sofa",
  "x": 0, "y": 0, "w": 6, "h": 5,
  "entities": ["light.salon", "climate.salon", "sensor.salon_temperature"]
}
```

| Champ | Rôle |
|---|---|
| `x`, `y` | Coin haut-gauche de la pièce sur la grille (vue de dessus, avant projection). |
| `w`, `h` | Largeur et profondeur, en cases de grille. |
| `icon` | Icône affichée sur l'étiquette (voir la liste ci-dessous). |
| `entities` | Entités Home Assistant rattachées à la pièce, dans l'ordre d'affichage. |

**La méthode :** dessinez le plan de votre étage sur une feuille quadrillée, une case
= environ 50 cm. Notez pour chaque pièce le coin haut-gauche et ses dimensions.
Recopiez. Les pièces qui se touchent partagent naturellement leurs murs — inutile de
dessiner ces derniers, ils sont générés.

Icônes disponibles pour les pièces : `sofa`, `cooking`, `bed`, `shower`, `door`,
`laptop`, `car`, `stairs`, `tv`, `speaker`, `grid`.

### Le reste du fichier

```json
"grid":    { "tileWidth": 66, "tileHeight": 33, "wallHeight": 34 },
"globals": { "weather": "...", "power": "...", "solar": "...",
             "alarm": "...", "persons": [...], "favorites": [...] },
"scenes":  [ { "id": "scene.cinema", "name": "Cinéma", "icon": "tv" } ],
"floors":  [ { "id": "rdc", "name": "Rez-de-chaussée", "rooms": [ ... ] } ]
```

`tileWidth`/`tileHeight` gardent un rapport 2:1 pour une isométrie classique ;
`wallHeight` règle la hauteur des murs en pixels (34 laisse bien voir les sols).

Le plan modifié depuis l'application est stocké dans le navigateur. Pour le rendre
définitif, recopiez-le dans `config/home.json` (« Revenir au plan d'origine » efface
la version locale).

---

## Organisation du code

```
index.html                 Squelette de la page
config/home.json           Le plan de la maison + les entités
assets/css/base.css        Jetons de couleur, thèmes clair/sombre
assets/css/layout.css      Rail, barre haute, scène, panneau, responsive
assets/css/components.css  Plan isométrique, cartes, contrôles, modale
assets/js/app.js           Démarrage, vues, mises à jour temps réel
assets/js/iso.js           Projection isométrique et rendu SVG du plan
assets/js/cards.js         Une carte de contrôle par domaine Home Assistant
assets/js/views.js         Panneau latéral et vues Pièces / Énergie / Sécurité
assets/js/ha.js            Client WebSocket Home Assistant
assets/js/demo.js          Serveur simulé (même interface que ha.js)
assets/js/settings.js      Réglages, éditeur de plan, explorateur d'entités
assets/js/store.js         État partagé et bus d'événements
assets/js/icons.js         Jeu d'icônes SVG
```

`ha.js` et `demo.js` exposent la même interface (`connect`, `callService`) : tout le
reste de l'application ignore lequel des deux tourne.

---

## Limites connues

- Les murs sont générés sur les deux côtés arrière de chaque pièce (vue « en coupe »
  isométrique classique) : pas de portes ni de fenêtres dessinées.
- Les pièces ne peuvent pas se chevaucher ; une forme en L se décrit avec deux
  rectangles adjacents.
- L'historique des courbes est construit pendant la session : à l'ouverture, les
  graphiques se remplissent au fil des mesures (l'API `history` de Home Assistant
  n'est pas encore interrogée).
- Prototype : testé sur Chromium et Firefox récents.
