# HomeBoard

Un tableau de bord **Home Assistant** avec une vue « 2.5D » isométrique de la maison,
dessinée au doigt — sans modélisation 3D et sans écrire une ligne de JSON.

- **Éditeur de plan visuel** : on pose des pièces sur une grille, on les glisse, on
  tire leurs poignées, on peint des cases pour les formes en L, T ou U. Autant
  d'étages que nécessaire.
- **Interface qui s'adapte à votre installation** : chaque carte, chaque onglet
  n'apparaît que si les entités correspondantes existent chez vous. Pas d'alarme ?
  Pas d'onglet Sécurité.
- **Pensé pour le tactile** : téléphone et tablette d'abord, avec barre d'onglets
  au pouce, feuilles remontantes, pincer-pour-zoomer. L'écran large reste confortable.

> Prototype fonctionnel : il tourne en **mode démo** (maison fictive animée, aucune
> installation requise) ou en **mode direct**, branché sur l'API WebSocket de votre
> serveur Home Assistant.

---

## Démarrage rapide (mode démo)

Les modules ES ont besoin d'être servis en HTTP (l'ouverture directe du fichier
`index.html` ne fonctionne pas) :

```bash
git clone https://github.com/GGZDEV/HomeBoard.git
cd HomeBoard
python3 -m http.server 8080
```

Puis ouvrez <http://localhost:8080>.

Pour une version « un seul fichier », ouvrable sans serveur et facile à partager :

```bash
node tools/build-single-file.js   # -> dist/homeboard.html
```

---

## Dessiner sa maison

Onglet **Éditeur**. Aucune connaissance technique requise.

| Geste | Effet |
|---|---|
| **+ Pièce** | Pose une pièce de 4 × 3 là où vous regardez. |
| Glisser une pièce | La déplace. Elle devient rouge si elle chevauche une voisine — le déplacement est alors refusé. |
| Tirer une poignée | Redimensionne (pièces rectangulaires). |
| **Agrandir** puis glisser | Ajoute des cases : c'est ainsi qu'on obtient un L, un T ou un U. |
| **Rogner** puis glisser | Retire des cases. |
| Pincer / molette | Zoom. Glisser le fond : déplacement de la vue. |
| **↺** | Annule la dernière action (40 niveaux). |

À droite (en bas sur téléphone) : le nom de la pièce, son icône, et la liste de ses
appareils. **Ajouter** ouvre la liste des entités Home Assistant non encore placées.
Le bouton **Rattacher les appareils automatiquement** fait le gros du travail : il
associe `light.cuisine_plan_de_travail` à la pièce « Cuisine », etc.

Les étages se gèrent dans la barre du haut : ajouter, renommer, **dupliquer** (très
pratique, l'étage a souvent la même empreinte que le rez-de-chaussée), supprimer.

Tout est enregistré au fur et à mesure dans le navigateur. **Réglages → Sauvegarde**
permet de copier le plan pour le transférer sur un autre appareil.

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

Pour une tablette murale, ce panneau en plein écran est le mode d'emploi le plus
confortable — la mise en page est prévue pour le tactile et ne demande jamais de survol.

---

## Ce qui s'affiche, et quand

Rien n'est affiché « au cas où ». À chaque changement d'état, HomeBoard relit la liste
des entités et en déduit ce qu'il peut proposer :

| Fonctionnalité | Condition |
|---|---|
| Onglet **Énergie** | un capteur `device_class: power` ou `energy` |
| Onglet **Sécurité** | une alarme, une serrure, ou un capteur d'ouverture |
| Carte **Météo** | une entité `weather.*` ou un capteur de température extérieure |
| Carte **Présence** | au moins une entité `person.*` |
| Barre de **scènes** | des entités `scene.*` ou `script.*` |
| Puces de la barre haute | idem, une par mesure réellement disponible |

Les identifiants sont devinés par nom (`sensor.production_solaire` → production
solaire). Pour forcer un choix, un bloc `globals` optionnel dans le plan a la
priorité :

```json
"globals": {
  "power": "sensor.mon_compteur",
  "solar": "sensor.mes_panneaux",
  "favorites": ["light.salon", "climate.salon"]
}
```

---

## Format du plan

L'éditeur produit ce fichier ; le lire n'est utile que pour comprendre ou pour
bidouiller à la main.

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
          "entities": ["light.salon", "climate.salon"]
        }
      ]
    }
  ]
}
```

Une pièce est un **ensemble de cases de grille**, sérialisé en une liste de
rectangles `[x, y, largeur, profondeur]`. Une pièce en L, c'est deux rectangles ;
l'éditeur les recalcule automatiquement après chaque coup de pinceau. L'ancien
format `x`/`y`/`w`/`h` reste accepté.

Icônes de pièces : `sofa`, `bed`, `cooking`, `shower`, `door`, `laptop`, `car`,
`stairs`, `tv`, `speaker`, `coffee`, `grid`.

---

## Organisation du code

```
index.html                 Squelette de la page
config/home.json           Plan de démonstration
assets/css/base.css        Jetons de couleur, thèmes clair/sombre
assets/css/layout.css      Structure, mobile d'abord
assets/css/components.css  Plan isométrique, cartes, contrôles, éditeur
assets/js/app.js           Démarrage, vues, mises à jour temps réel
assets/js/geometry.js      Cases de grille, rectangles, murs, contours
assets/js/iso.js           Projection isométrique et rendu SVG
assets/js/editor.js        Éditeur de plan visuel
assets/js/capabilities.js  Détection des fonctionnalités disponibles
assets/js/cards.js         Une carte de contrôle par domaine Home Assistant
assets/js/views.js         Panneau latéral et vues Pièces / Énergie / Sécurité
assets/js/ha.js            Client WebSocket Home Assistant
assets/js/demo.js          Serveur simulé (même interface que ha.js)
assets/js/settings.js      Connexion et sauvegarde du plan
assets/js/store.js         État partagé et bus d'événements
assets/js/icons.js         Jeu d'icônes SVG
tools/build-single-file.js Fabrique dist/homeboard.html (version autonome)
```

`ha.js` et `demo.js` exposent la même interface (`connect`, `callService`) : tout le
reste de l'application ignore lequel des deux tourne.

---

## Limites connues

- Les murs sont générés sur les deux côtés arrière de chaque pièce (vue « en coupe »
  isométrique) : pas de portes ni de fenêtres dessinées.
- Les pièces ne peuvent pas se chevaucher ; l'éditeur refuse un déplacement qui
  créerait un conflit.
- Le tri de profondeur se fait par pièce : une pièce concave qui en entoure une autre
  peut s'afficher devant elle.
- L'historique des courbes est construit pendant la session : à l'ouverture, les
  graphiques se remplissent au fil des mesures (l'API `history` n'est pas interrogée).
- Prototype : testé sur Chromium et Firefox récents.
