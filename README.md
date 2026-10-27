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

Le premier écran de l'Accueil reprend le design « Dashboard Maison » (4 colonnes, 2 rangées de cartes)
et remplit exactement l'écran :
- **Météo** : actuelle, prochaines heures, jours suivants (barre min → max) ; un toucher ouvre le détail
- **Pièces** : température (orange = chaude), lumières allumées, une ampoule par pièce pour tout
  allumer / éteindre, « Tout éteindre » ; ⚙ › *Pièces affichées* pour n'en garder que certaines
- **Courses** : liste à cocher (ajout au clavier, « Effacer les cochées »), enregistrée dans le compte HA ;
  à partir de 3 rangées, les articles effacés reviennent en « Souvent achetés »
- **Notes** : un mémo libre
- **Agenda** (2 colonnes) : les 7 prochains jours des calendriers HA (autres affichages dans ⚙)
- **Lecture en cours** : Spotify / lecteur multimédia (pochette, commandes, appareil, volume)
- **Départs RER** : prochains trains, retards et infos trafic

Chaque module a une mise en page dédiée à chaque taille (de 1×1 à 4×4) : par exemple la météo en
bandeau sur une rangée, en colonne sur une largeur, complète à partir de 2×2.

Chacun de ces blocs est un module comme les autres : avec le crayon, on peut le déplacer,
l'étirer, le supprimer ou le remettre (« + Module »). Vos propres modules se placent dessous, en
faisant défiler. « Revenir à l'écran d'accueil d'origine » remet la disposition du design.
Réglages › Disposition › « Écran d'accueil tablette » permet de revenir à l'ancien Accueil automatique.

**En-tête de l'accueil** : trois zones (gauche, centre, droite) d'éléments : date, heure, lampes
allumées, températures, plein écran… Avec le crayon, on les déplace d'une zone à l'autre, et ⚙
règle la couleur, la taille, la police (11 styles : Moderne, Affirmée, Design, Élégante, Magazine,
Raffinée, Douce, Futuriste, Rétro, Manuscrite…) et le format (date, heure avec ou sans secondes).
N'importe quel module glissé dans l'en-tête passe en version compacte (météo, prochain événement,
prochain train, musique…) ; glissé sur la page, il redevient un module complet. ✕ retire un élément,
« + Module » › « Dans l'en-tête » le remet.

**Fond d'écran** : crayon › Fond (ou Réglages › Fond d'écran) : fonds prêts, couleur au choix ou
photo (réduite puis enregistrée avec la disposition), avec un réglage d'assombrissement.

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
| **Départs train / RER** | perturbations de la ligne en tête (suppressions et retards de l'heure, et événements « RER D : … » / « Ligne D : … » de vos calendriers, masqués des agendas) ; prochains départs temps réel IDFM (capteur REST, voir `homeassistant/rer_d_le_mee.yaml`) : minutes restantes, heure, destination, mission, voie, retards et suppressions ; une colonne par direction quand il est large, ou filtré sur une direction |
| **Spotify / musique** | lecteur `media_player` (Spotify en priorité) : pochette, titre, progression, précédent / lecture / suivant, aléatoire, répétition, volume, choix de l'enceinte (Spotify Connect) et **Playlists** (bibliothèque du lecteur). Deux dispositions inspirées de l'appli Spotify : en petit (1×1, 1×2, une ligne) pochette + titre + boutons, barre de progression, enceinte · volume · playlists ; à partir de 2×2 (ou 1×3) grande pochette en haut. Voir *Spotify* plus bas |
| **Notes** | mémo libre, enregistré automatiquement dans votre compte Home Assistant |
| **Automatisations** | activer/désactiver `automation.*`, lancer `script.*` |
| **Pièces** | résumé de chaque pièce, un clic ouvre la pièce |
| **Mises à jour** | entités `update.*` (Home Assistant Core, OS, modules complémentaires, HACS, appareils) : version installée → disponible, notes de version, installation avec ou sans sauvegarde, « Ignorer cette version », progression en direct |
| **Serveur Proxmox** | nœud Proxmox : processeur, mémoire, disque (anneaux en grand, barres en petit), réseau, durée de fonctionnement, stockages |
| **VM et conteneurs** | VM et LXC Proxmox : en marche / arrêtée, CPU et RAM, démarrer, éteindre, redémarrer (avec confirmation) |

Les entités masquées, désactivées ou de catégorie *config/diagnostic* sont ignorées.

## Pages Serveur et Mises à jour

- **Mises à jour** (icône ⬇ de la barre, avec une pastille rouge du nombre disponible) : tout ce que
  Home Assistant propose de mettre à jour ; touchez une ligne pour les notes de version et l'installation.
  **Tout mettre à jour** les installe une par une (modules et HACS d'abord, puis Supervisor, Core et
  le système en dernier), avec une sauvegarde avant Home Assistant ; gardez la page ouverte jusqu'à la fin.
- **Serveur** : votre Proxmox, en direct. Il faut l'intégration **Proxmox VE** (HACS : *Proxmox VE*,
  puis Paramètres › Appareils et services › Ajouter › Proxmox VE, avec un utilisateur API Proxmox).
  Chaque nœud, VM, conteneur et stockage devient un appareil ; les valeurs se mettent à jour à
  l'intervalle de l'intégration. Les boutons Démarrer / Éteindre / Redémarrer utilisent les boutons
  de l'intégration.

Les deux pages sont des pages de modules comme les autres (crayon pour les modifier) et ces modules
peuvent aussi être ajoutés à l'accueil.

**Connexion perdue** : la page se floute et une fenêtre au centre indique la reconnexion automatique
(avec le délai avant le prochain essai) et un bouton « Réessayer maintenant ». La reconnexion repart
aussi dès que le réseau revient ou que l'écran se rallume.

**Fluidité** : l'écran n'est plus redessiné en entier à chaque changement ; seuls les éléments modifiés
sont mis à jour (`js/morph.js`), avec des transitions (changement de page, fenêtres, boutons, jauges).

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
- `js/app.js` — pages, mode édition, fenêtres de paramétrage, actions, Proxmox, mises à jour
- `js/morph.js` — mise à jour de la page sur place (sans tout redessiner)
- `js/demo.js` — faux serveur pour la démo
- `styles.css` — styles « verre » de la maquette
