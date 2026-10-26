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

## Écran d'accueil (tablette)

Le premier écran de l'Accueil reprend le design « Dashboard Maison – tablette » (1280×800) et
remplit exactement l'écran :
- **Météo** : actuelle, 5 prochaines heures, 4 jours, lever/coucher du soleil (`sun.sun`) ; un toucher ouvre le détail
- **Pièces** : température (point vert = confort, ⚠ = valeur à vérifier), humidité, lampes allumées ;
  boutons des lampes à toucher, bouton pour éteindre la pièce, « Voir les N » ouvre la pièce
- **Scènes** : « Tout éteindre » (toutes les lampes) + 3 scènes Home Assistant
- **Agenda** : 7 jours des calendriers HA, avec une alerte si des RER sont supprimés ou en retard dans l'heure
- **Notes** : liste à cocher (ajout au clavier, « Effacer les cochées »), enregistrée dans le compte HA

Chacun de ces blocs est un module comme les autres : avec le crayon, on peut le déplacer,
l'étirer, le supprimer ou le remettre (« + Module »). Vos propres modules se placent dessous, en
faisant défiler. « Revenir à l'écran d'accueil d'origine » remet la disposition du design.
Réglages › Disposition › « Écran d'accueil tablette » permet de revenir à l'ancien Accueil automatique.

## Pages et modules

Chaque page (Accueil, chaque pièce, Automatisations, Énergie) est une grille de **modules**
sur 4 colonnes. Tant qu'une page n'a pas été personnalisée, sa disposition est générée
automatiquement à partir des appareils trouvés (les nouveaux appareils apparaissent seuls).

**Personnaliser** : touchez le crayon en haut à droite de la page.
- `+ Module` / « Ajouter un module » : choisir un type (le nombre d'appareils compatibles trouvés est indiqué)
- **déplacer / échanger** : attrapez un module (au doigt : maintenez-le ~0,3 s, ou prenez la
  poignée ⠿ en haut à gauche) et lâchez-le sur un autre module : les deux échangent leur place
- **redimensionner** : étirez le bord droit (largeur), le bord bas (hauteur) ou le coin
  (les deux) ; la taille s'aligne sur la grille de 4 × 4 en direct et les autres modules se
  replacent autour
- au clavier : flèches sur la poignée (déplacer) ou sur une poignée de bord (taille)
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
| **Calendrier** | `calendar.*` (Google Calendar, Calendrier distant iCal, calendrier local…) : une couleur par calendrier, détail au toucher ; période réglable (aujourd'hui à 30 jours) ; 4 affichages (⚙ › Affichage) : **Compact** (une ligne : heure + titre), **Liste** (horaires, lieu), **Détaillé** (en plus calendrier et début de description), **Semaine** (une colonne par jour, largeur 2 ou plus). Les mêmes réglages existent pour l'Agenda de l'accueil |
| **Départs train / RER** | prochains départs temps réel IDFM (capteur REST, voir `homeassistant/rer_d_le_mee.yaml`) : minutes restantes, heure, destination, mission, voie, retards et suppressions ; une colonne par direction quand il est large, ou filtré sur une direction |
| **Spotify / musique** | lecteur `media_player` (Spotify en priorité) : pochette, titre, progression, précédent / lecture / suivant, aléatoire, répétition, volume, choix de l'enceinte (Spotify Connect) et **Playlists** (bibliothèque du lecteur). Sur une ligne : version compacte. Voir *Spotify* plus bas |
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

## Spotify

Le module passe par l'intégration Spotify de Home Assistant (le tableau de bord ne se connecte
pas directement à Spotify : Spotify exige une adresse HTTPS pour se connecter).
1. developer.spotify.com › Dashboard › *Create app* ; Redirect URI :
   `https://my.home-assistant.io/redirect/oauth` ; API : *Web API*.
2. Home Assistant › Paramètres › Appareils et services › Ajouter une intégration › **Spotify** :
   collez le *Client ID* et le *Client secret*, puis connectez votre compte (Premium requis pour
   piloter la lecture).
3. Une entité `media_player.spotify_…` apparaît : crayon › « + Module » › **Spotify / musique**.

Les enceintes proposées sont vos appareils Spotify Connect ; si aucune n'est active, ouvrez
Spotify une fois sur l'appareil voulu.

## Fichiers
- `js/ha.js` — client WebSocket (auth, registres, `state_changed`, `call_service`, reconnexion)
- `js/model.js` — pièces, appareils, libellés d'état en français
- `js/modules.js` — catalogue des modules (ce qu'ils acceptent et comment ils s'affichent)
- `js/layout.js` — disposition : sauvegarde, dispositions automatiques, choix des entités
- `js/app.js` — pages, mode édition, fenêtres de paramétrage, actions
- `js/demo.js` — faux serveur pour la démo
- `styles.css` — styles « verre » de la maquette
