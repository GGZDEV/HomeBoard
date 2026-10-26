#!/usr/bin/env bash
# Publie le site dans Home Assistant (VM 101) : /config/www/maison -> http://192.168.1.251:8123/local/maison/index.html
# Passe par l'hôte Proxmox (alias SSH "proxmox") et l'agent invité de la VM : rien à installer dans HA.
# Usage : deploy/deploy.sh            publier
#         deploy/deploy.sh --rollback remettre la sauvegarde précédente
set -euo pipefail

VMID=101
HA_URL=http://192.168.1.251:8123
CONFIG=/mnt/data/supervisor/homeassistant   # = /config vu depuis Home Assistant
DEST=$CONFIG/www/maison
BACKUPS=/mnt/data/maison-backups            # hors de /config/www, donc jamais servi
KEEP=5
FILES=(index.html styles.css js)

cd "$(dirname "$0")/.."

guest() { # guest <script shell> [stdin] : lance un script sur l'OS de la VM, sort en erreur si échec
  local out
  out=$(ssh proxmox "qm guest exec $VMID --timeout 60 --pass-stdin 1 -- sh -c $(printf %q "$1")" < "${2:-/dev/null}")
  python3 -c 'import json,sys
d=json.loads(sys.argv[1]); sys.stdout.write(d.get("out-data","")); sys.stderr.write(d.get("err-data",""))
sys.exit(d.get("exitcode",1))' "$out"
}

if [[ "${1:-}" == "--rollback" ]]; then
  guest "set -e; last=\$(ls -1 $BACKUPS/*.tar 2>/dev/null | tail -1); [ -n \"\$last\" ] || { echo 'aucune sauvegarde' >&2; exit 1; }
    rm -rf $DEST.new && mkdir -p $DEST.new && tar -xf \"\$last\" -C $DEST.new
    rm -rf $DEST.old; [ -d $DEST ] && mv $DEST $DEST.old; mv $DEST.new $DEST; rm -rf $DEST.old; rm -f \"\$last\"
    echo \"restaure : \$last\""
  exit 0
fi

# Version = empreinte du contenu : elle ne change que si un fichier change.
VER=$(cat index.html styles.css js/*.js | sha256sum | cut -c1-10)
REV=$(git rev-parse --short HEAD 2>/dev/null || echo none)
git diff --quiet -- . 2>/dev/null || REV="$REV+modifs"

STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
cp -r "${FILES[@]}" "$STAGE/"
sed -i -e "s/?v=dev\"/?v=$VER\"/g" -e "s/var v = 'dev';/var v = '$VER';/" "$STAGE/index.html"
grep -q "var v = '$VER';" "$STAGE/index.html" || { echo "index.html : marqueur de version introuvable" >&2; exit 1; }
printf '{"v":"%s","rev":"%s","date":"%s"}\n' "$VER" "$REV" "$(date -u +%FT%TZ)" > "$STAGE/version.json"
tar -C "$STAGE" -cf "$STAGE.tar" --owner=0 --group=0 --mode='u=rwX,go=rX' .
base64 -w0 "$STAGE.tar" > "$STAGE.b64"; rm -f "$STAGE.tar"

echo "Publication $VER ($REV)…"
guest "set -e; mkdir -p $BACKUPS $CONFIG/www
  if [ -d $DEST ]; then tar -C $DEST -cf $BACKUPS/\$(date -u +%Y%m%dT%H%M%SZ).tar .; fi
  ls -1r $BACKUPS/*.tar 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
  rm -rf $DEST.new && mkdir -p $DEST.new && base64 -d | tar -xf - -C $DEST.new
  rm -rf $DEST.old; [ -d $DEST ] && mv $DEST $DEST.old; mv $DEST.new $DEST; rm -rf $DEST.old" "$STAGE.b64"
rm -f "$STAGE.b64"

# Vérification : chaque fichier servi par HA doit être identique à la version préparée.
fail=0
for f in $(cd "$STAGE" && find . -type f | sed 's|^\./||' | sort); do
  remote=$(curl -fsS "$HA_URL/local/maison/$f?v=$VER" | sha256sum | cut -c1-64) || remote=absent
  local_=$(sha256sum < "$STAGE/$f" | cut -c1-64)
  if [[ "$remote" == "$local_" ]]; then echo "  ok   $f"; else echo "  ÉCHEC $f" >&2; fail=1; fi
done
[[ $fail == 0 ]] || { echo "Vérification échouée (si tout est absent : redémarrer HA une fois après création de /config/www)." >&2; exit 1; }
echo "En ligne : $HA_URL/local/maison/index.html  (version $VER)"
