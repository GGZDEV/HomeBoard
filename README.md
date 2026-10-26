# Maison — tableau de bord Home Assistant (style visionOS)

Appli web sans compilation (HTML/CSS/JS) qui se connecte directement à Home Assistant
via son API WebSocket et construit l'interface à partir de ce qu'elle trouve.

## Utilisation

### Option A — servie par Home Assistant (recommandé)
1. Copiez le dossier dans `/config/www/maison/` de Home Assistant.
2. Ouvrez `http://<votre-ha>:8123/local/maison/index.html`.
3. (Optionnel) Ajoutez-la à la barre latérale dans `configuration.yaml` :
   ```yaml
   panel_iframe:
     maison:
       title: Maison
       icon: mdi:home-variant
       url: /local/maison/index.html
   ```
   (Sur les versions récentes : Paramètres › Tableaux de bord › Ajouter › Page web.)

### Option B — en local
Double-cliquez sur `index.html`, ou servez le dossier :
```bash
python -m http.server 8080
```

### Connexion
- **Adresse** : par ex. `http://homeassistant.local:8123`
- **Jeton** : Home Assistant › votre profil › Sécurité › *Jetons d'accès longue durée* › Créer.
  Utilisez un compte **administrateur** pour que les pièces (zones) soient lues.
- Le jeton est stocké dans le `localStorage` de ce navigateur uniquement.
- Une page en HTTPS ne peut pas joindre un Home Assistant en HTTP (blocage navigateur).

Le bouton **Essayer la démo** lance des données fictives (celles de la maquette) sans serveur.

## Pages et modules

Chaque page (Accueil, chaque pièce, Automatisations, Énergie) est une grille de **modules**
sur 4 colonnes. Tant qu'une page n'a pas été personnalisée, sa disposition est générée
automatiquement à partir des appareils trouvés (les nouveaux appareils apparaissent seuls).

**Personnaliser** : touchez le crayon en haut à droite de la page.
- `+ Module` / « Ajouter un module » : choisir un type (le nombre d'appareils compatibles trouvés est indiqué)
- glisser-déposer un module, ou ‹ › pour le déplacer
- ↔ / ↕ : largeur et hauteur (1 à 4)
- ⚙ : titre, portée (*cette pièce* / *toute la maison*), taille, choix des appareils
  (automatique, ou liste à cocher avec recherche)
- ⚙ › **Couleur** : couleur d'accent propre au module (ou celle par défaut des Réglages)
- ⚙ › liste des appareils : touchez un nom pour le **renommer** ; le libellé s'applique dans
  tous les modules (vide = nom Home Assistant)
- Températures › **Couleur selon la température** : Froid / Confort / Chaud / Très chaud,
  seuils réglables (18 / 24 / 27 °C par défaut), appliqués à la valeur et à la barre
- « Revenir à la disposition automatique » pour repartir de zéro sur la page

| Module | Contenu |
|---|---|
| **Températures** | thermomètres (`sensor`, `device_class: temperature`) avec l'humidité du même appareil ; *par capteur* ou *moyenne par pièce* (idéal en global sur l'Accueil) ; une seule valeur = grand chiffre |
| **Thermostat** | `climate.*` : consigne, modes, humidité ; cadran si hauteur ≥ 3, sinon compact |
| **Éclairage** | groupe de `light.*` : intensité, teintes selon `supported_color_modes` |
| **Appareils** | tuiles : prises, volets, serrures, médias, ventilateurs, aspirateurs, capteurs de sécurité… |
| **Capteurs** | n'importe quelle valeur (CO₂, luminosité, batterie…), à choisir |
| **Scènes** | `scene.*` (celles de la pièce, sinon celles sans zone) |
| **Énergie** | capteurs `power` / `energy` |
| **Météo** | `weather.*` ; en largeur ≥ 2 ou hauteur ≥ 3, les prévisions des jours suivants ; un toucher ouvre le détail (ressenti, vent, pression, 24 h, 7 jours) |
| **Calendrier** | `calendar.*` (Google Calendar, Calendrier distant iCal, calendrier local…) : agenda groupé par jour, une couleur par calendrier, détail au toucher ; période réglable (aujourd'hui à 30 jours) |
| **Notes** | mémo libre, enregistré automatiquement dans votre compte Home Assistant |
| **Automatisations** | activer/désactiver `automation.*`, lancer `script.*` |
| **Pièces** | résumé de chaque pièce, un clic ouvre la pièce |

Les entités masquées, désactivées ou de catégorie *config/diagnostic* sont ignorées.

## Réglages
- **Pièces** : ordre des onglets, masquer une pièce, réinitialiser sa disposition
- **Température extérieure** de l'en-tête : automatique (capteur nommé « extérieur », sinon météo), un capteur précis, ou rien
- **Disposition** : enregistrée dans votre compte Home Assistant (elle suit sur tous vos écrans),
  avec copie dans le navigateur ; **Exporter / Importer** en JSON ; tout réinitialiser
- Couleur d'accent, récapitulatif des appareils trouvés, connexion

## Déploiement (Home Assistant VM 101)

Dépôt de travail : `C:\Users\guill\Desktop\HomeDashboard` sur PCGUIGZ.
Dépôt distant : `openclaw@100.76.111.11:/home/openclaw/git/homedashboard.git`.

- Double-cliquez sur `publier.cmd` : il ajoute les modifications, demande une courte description,
  crée le commit et pousse `main`.
- Le `git push` lance automatiquement les contrôles JavaScript puis `deploy/deploy.sh` sur le serveur.
- `deploy/deploy.sh` publie dans `/config/www/maison` via Proxmox, sauvegarde la version en ligne
  dans `/mnt/data/maison-backups` (5 dernières), puis vérifie chaque fichier servi.
- `deploy/deploy.sh --rollback` remet la sauvegarde précédente.
- La clé SSH du PC est limitée à ce seul dépôt Git : elle ne donne pas de terminal sur le serveur.

URL : http://192.168.1.251:8123/local/maison/index.html (`/local/maison/` seul renvoie 403 :
HA ne sert pas d'index de dossier).

**Cache** : HA sert `/local` avec `Cache-Control: max-age=31 jours`. Ne touchez pas au `?v=` à la
main : laissez `?v=dev` dans les sources, `deploy.sh` le remplace par l'empreinte du contenu et
publie `version.json`. Au chargement, `index.html` lit `version.json` sans cache et, si une version
plus récente existe, se recharge en `index.html?v=<version>`.

## Fichiers
- `js/ha.js` — client WebSocket (auth, registres, `state_changed`, `call_service`, reconnexion)
- `js/model.js` — pièces, appareils, libellés d'état en français
- `js/modules.js` — catalogue des modules (ce qu'ils acceptent et comment ils s'affichent)
- `js/layout.js` — disposition : sauvegarde, dispositions automatiques, choix des entités
- `js/app.js` — pages, mode édition, fenêtres de paramétrage, actions
- `js/demo.js` — faux serveur pour la démo
- `styles.css` — styles « verre » de la maquette
