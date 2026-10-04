#!/bin/sh
# ---------------------------------------------------------------------------
#  Boucle du conteneur « updater » (docker-compose.yml).
#
#  Le dashboard ne peut pas piloter Docker lui-même : il dépose ses demandes
#  et ses réglages dans le volume de données partagé ($RPQ_STATUS_DIR) et ce
#  conteneur, qui a accès au socket Docker, exécute scripts/update.sh :
#
#    config.env  (app)      token, dépôt, branche, auto, intervalle
#    request     (app)      « check » ou « update » demandé par le bouton
#    heartbeat   (updater)  preuve de vie toutes les 5 s
#    status / pending / update.log (update.sh) affichés dans le dashboard
# ---------------------------------------------------------------------------
set -u

DIR=${RPQ_STATUS_DIR:-/data/updater}
POLL=5

mkdir -p "$DIR"
# l'app tourne en utilisateur « node » (uid 1000) et doit pouvoir y écrire
chown 1000:1000 "$DIR" 2>/dev/null || true

command -v git >/dev/null 2>&1 || apk add --no-cache git >/dev/null
git config --global --add safe.directory '*'

# valeurs de .env / docker-compose, utilisées si le dashboard n'en fournit pas
BASE_TOKEN=${GITHUB_TOKEN:-}
BASE_REPO=${GITHUB_REPO:-}
BASE_BRANCH=${UPDATE_BRANCH:-}
BASE_INTERVAL=${UPDATE_INTERVAL:-3600}

# une opération interrompue (redémarrage du conteneur) ne doit pas rester « en cours »
if grep -qE '^state=(checking|updating)$' "$DIR/status" 2>/dev/null; then
  sed -i -e 's/^state=.*/state=error/' -e 's/^message=.*/message=Opération interrompue (service redémarré)/' "$DIR/status"
fi

echo "[updater] prêt, dossier d'échange : $DIR"
last=0
while true; do
  date +%s > "$DIR/heartbeat"

  RPQ_GITHUB_TOKEN='' RPQ_GITHUB_REPO='' RPQ_UPDATE_BRANCH='' RPQ_AUTO_UPDATE=1 RPQ_UPDATE_INTERVAL=''
  # shellcheck disable=SC1091
  [ -f "$DIR/config.env" ] && . "$DIR/config.env"

  action=""
  if [ -f "$DIR/request" ]; then
    action=$(tr -d ' \r\n' < "$DIR/request")
    rm -f "$DIR/request"
  fi

  now=$(date +%s)
  interval=${RPQ_UPDATE_INTERVAL:-$BASE_INTERVAL}
  if [ -z "$action" ] && [ "$RPQ_AUTO_UPDATE" = 1 ] && [ $((now - last)) -ge "$interval" ]; then
    action=auto
  fi

  if [ -n "$action" ]; then
    last=$now
    export GITHUB_TOKEN="${RPQ_GITHUB_TOKEN:-$BASE_TOKEN}"
    export GITHUB_REPO="${RPQ_GITHUB_REPO:-$BASE_REPO}"
    export UPDATE_BRANCH="${RPQ_UPDATE_BRANCH:-$BASE_BRANCH}"
    export RPQ_STATUS_DIR="$DIR"

    case "$action" in
      check) flags="--check" ;;
      auto) flags="--auto" ;;
      *) flags="" ;;
    esac

    echo "[updater] $action"
    # heartbeat maintenu pendant la mise à jour (le build peut être long)
    ( while true; do date +%s > "$DIR/heartbeat"; sleep "$POLL"; done ) &
    beat=$!
    if [ "$action" = auto ]; then
      # une vérification automatique sans nouveauté ne remplace pas le journal
      sh scripts/update.sh $flags > "$DIR/run.log" 2>&1
      [ -s "$DIR/run.log" ] && mv "$DIR/run.log" "$DIR/update.log" || rm -f "$DIR/run.log"
    else
      sh scripts/update.sh $flags > "$DIR/update.log" 2>&1
    fi
    kill "$beat" 2>/dev/null
    tail -n 3 "$DIR/update.log" 2>/dev/null | sed 's/^/[updater] /'

    # le code vient peut-être de changer : relancer la dernière version de cette boucle
    if [ "$action" != check ] && ! cmp -s scripts/updater.sh "$0"; then
      cp scripts/updater.sh /tmp/updater.sh
      exec sh /tmp/updater.sh
    fi
  fi

  sleep "$POLL"
done
