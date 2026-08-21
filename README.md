# HomeBoard

Un tableau de bord **Home Assistant** volontairement minimal : le plan de votre
maison en vue isométrique, vos **lumières** et vos **températures**. Rien d'autre.

- **Éditeur de plan visuel** : on pose des pièces sur une grille, on les glisse, on
  tire leurs poignées, on peint des cases pour les formes en L, T ou U. Autant
  d'étages que nécessaire, aucun JSON à écrire.
- **Lumières** : allumer, éteindre, régler la luminosité et la couleur. Les pièces
  s'illuminent sur le plan avec la teinte réelle de vos lampes — sol, murs et
  mobilier prennent la couleur.
- **Plan habité** : murs épais, revêtements de sol selon le type de pièce, ombres
  de contact et mobilier généré (canapé, lit, cuisine, baignoire, escalier…).
  Tout est dessiné à partir du plan, il n'y a aucune image à fournir.
- **Températures** : la mesure de chaque pièce sur le plan, la moyenne intérieure et
  l'extérieur en un coup d'œil.
- **Pensé pour le tactile** : téléphone et tablette d'abord — barre d'onglets au
  pouce, feuilles remontantes, pincer-pour-zoomer. L'écran large reste confortable.

Volets, thermostats, médias, alarme, énergie : **pas encore**. Le produit fait peu de
choses, mais il les fait entièrement.

---

## Démarrage rapide

Les modules ES ont besoin d'être servis en HTTP (ouvrir `index.html` directement ne
fonctionne pas) :

```bash
git clone https://github.com/GGZDEV/HomeBoard.git
cd HomeBoard
python3 -m http.server 8080
```

Puis <http://localhost:8080>. Sans configuration, une maison de démonstration
s'anime : c'est le mode démo, il ne touche à rien chez vous.

Pour une version « un seul fichier », ouvrable sans serveur et facile à partager :

```bash
node tools/build-single-file.js   # -> dist/homeboard.html
```

---

## Brancher son Home Assistant

1. Dans Home Assistant : **Profil → Sécurité → Jetons d'accès longue durée →
   Créer un jeton**. Copiez-le.
2. Dans HomeBoard : bouton **Réglages** (barre du haut), onglet **Connexion**.
3. Choisissez **Home Assistant**, renseignez l'URL et collez le jeton.
4. **Tester la connexion**, puis **Enregistrer**.

L'URL et le jeton restent dans le `localStorage` du navigateur. Si le serveur est
injoignable au démarrage, HomeBoard bascule en mode démo plutôt que d'afficher une
page vide.

**Si ça ne se connecte pas :** page en `https://` et Home Assistant en `http://`, le
navigateur bloque la WebSocket — servez HomeBoard depuis Home Assistant lui-même
(ci-dessous). Derrière un reverse proxy, vérifiez que les WebSockets sont relayées.

### L'installer dans Home Assistant

```bash
cp -r HomeBoard /config/www/homeboard
```

Accessible sur `https://<votre-ha>/local/homeboard/`. Pour une entrée de menu à part
entière, dans `configuration.yaml` :

```yaml
panel_iframe:
  homeboard:
    title: "HomeBoard"
    icon: mdi:floor-plan
    url: /local/homeboard/index.html
    require_admin: false
```

L'URL est alors pré-remplie avec l'origine courante : il ne reste que le jeton.
Pour une tablette murale, ce panneau en plein écran est le mode le plus confortable.

---

## Dessiner sa maison

Onglet **Éditeur**. Le plan occupe tout l'écran ; les commandes viennent à lui.

En haut : le sélecteur d'étage, un bouton **⚙** pour les actions rares, et
**Terminer**. Flottant en bas du plan : **+ Pièce**, **annuler**, **recentrer**.

| Geste | Effet |
|---|---|
| **+ Pièce** | Pose une pièce de 4 × 3 au centre de la vue. |
| Glisser une pièce | La déplace. Elle vire au rouge et le geste est refusé si elle chevauche une voisine. |
| Tirer une poignée | Redimensionne (pièces rectangulaires). |
| **Agrandir** puis glisser | Ajoute des cases : c'est ainsi qu'on obtient un L, un T ou un U. |
| **Rogner** puis glisser | Retire des cases. |
| Pincer / molette | Zoom. Glisser le fond déplace la vue. |
| **↺** | Annule la dernière action (40 niveaux). |

Toucher une pièce ouvre son panneau : nom, outils de forme, icône et appareils.
Sur téléphone c'est une feuille remontante, et **le plan se recale au-dessus
d'elle** pour que la pièce en cours d'édition reste visible ; sur grand écran,
c'est une colonne à droite.

**Ajouter** liste les lumières et capteurs de température pas encore placés.
Le menu **⚙** contient la gestion des étages — renommer, **dupliquer** (utile,
l'étage a souvent la même empreinte que le rez-de-chaussée), ajouter, supprimer —
et **Rattacher les appareils**, qui associe d'un coup `light.cuisine_plan_de_travail`
à la pièce « Cuisine ».

Tout est enregistré au fur et à mesure dans le navigateur. **Réglages → Sauvegarde**
permet de copier le plan pour le transférer sur un autre appareil.

---

## Ce que HomeBoard lit chez vous

Seules deux familles d'entités sont prises en compte :

| Entités | Usage |
|---|---|
| `light.*` | Pilotage : marche/arrêt, luminosité et couleur si la lampe les gère |
| `sensor.*` avec `device_class: temperature` | Lecture seule |

Le capteur extérieur est reconnu à son nom (`exterieur`, `outdoor`, `jardin`,
`terrasse`…). Pour forcer un choix, un bloc `globals` optionnel dans le plan a la
priorité :

```json
"globals": {
  "outdoorTemperature": "sensor.mon_capteur_dehors",
  "favorites": ["light.salon"]
}
```

Tout le reste de votre installation est ignoré : rien n'est affiché « au cas où ».

---

## Format du plan

L'éditeur produit ce fichier ; le lire n'est utile que pour comprendre ou bidouiller.

```json
{
  "name": "Maison",
  "grid": { "tileWidth": 66, "tileHeight": 33, "wallHeight": 34 },
  "floors": [
    {
      "id": "rdc",
      "name": "Rez-de-chaussée",
      "rooms": [
        {
          "id": "salon",
          "name": "Salon",
          "icon": "sofa",
          "rects": [[0, 0, 6, 5], [6, 0, 2, 3]],
          "entities": ["light.salon", "sensor.salon_temperature"]
        }
      ]
    }
  ]
}
```

Une pièce est un **ensemble de cases de grille**, sérialisé en une liste de
rectangles `[x, y, largeur, profondeur]`. Une pièce en L, c'est deux rectangles ;
l'éditeur les recalcule après chaque coup de pinceau. L'ancien format `x`/`y`/`w`/`h`
reste accepté.

Icônes de pièces : `sofa`, `bed`, `cooking`, `shower`, `door`, `laptop`, `car`,
`stairs`, `tv`, `speaker`, `coffee`, `grid`.

---

## Organisation du code

Pas de framework, pas d'étape de build, pas de `node_modules` : du HTML, du CSS et
des modules ES.

```
index.html                 Squelette de la page
config/home.json           Plan de démonstration
assets/css/base.css        Jetons de couleur, thèmes clair/sombre
assets/css/layout.css      Structure, mobile d'abord
assets/css/components.css  Plan isométrique, cartes, contrôles, éditeur
assets/js/app.js           Démarrage, vues, mises à jour temps réel
assets/js/geometry.js      Cases de grille, rectangles, murs, contours
assets/js/iso.js           Projection isométrique et rendu SVG
assets/js/furniture.js     Mobilier isométrique généré
assets/js/editor.js        Éditeur de plan visuel
assets/js/capabilities.js  Lecture des lumières et températures disponibles
assets/js/cards.js         Carte lumière et carte température
assets/js/views.js         Panneau latéral et vue « Pièces »
assets/js/ha.js            Client WebSocket Home Assistant
assets/js/demo.js          Serveur simulé (même interface que ha.js)
assets/js/settings.js      Connexion et sauvegarde du plan
assets/js/store.js         État partagé et bus d'événements
assets/js/icons.js         Jeu d'icônes SVG
tools/build-single-file.js Fabrique dist/homeboard.html (version autonome)
```

`ha.js` et `demo.js` exposent la même interface (`connect`, `callService`) : le reste
de l'application ignore lequel des deux tourne. Ajouter un domaine plus tard revient
donc à écrire une carte dans `cards.js` et à l'autoriser dans `capabilities.js`.

---

## Limites connues

- Les murs sont générés sur les deux côtés arrière de chaque pièce (vue « en coupe »
  isométrique) : pas de portes ni de fenêtres dessinées.
- Le mobilier est déduit de l'icône de la pièce et posé dans son plus grand
  rectangle plein : il illustre l'usage, il ne reproduit pas votre agencement.
- Les pièces ne peuvent pas se chevaucher ; l'éditeur refuse un déplacement qui
  créerait un conflit.
- Le tri de profondeur se fait par pièce : une pièce concave qui en entoure une autre
  peut s'afficher devant elle.
- Les courbes de température se remplissent pendant la session : l'API `history` de
  Home Assistant n'est pas interrogée.
- Testé sur Chromium et Firefox récents.
