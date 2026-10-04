#!/bin/sh
# ---------------------------------------------------------------------------
#  Mise à jour depuis GitHub, sans perte de données.
#
#    sh scripts/update.sh             mettre à jour si une version plus récente existe
#    sh scripts/update.sh --check     seulement dire s'il y a une mise à jour
#    sh scripts/update.sh --force     reconstruire et redémarrer même si à jour
#    sh scripts/update.sh --no-backup ne pas sauvegarder la base avant (déconseillé)
#
#  Dépôt privé : mettre un token GitHub en lecture seule dans .env
#  (GITHUB_TOKEN=...). Il n'est envoyé qu'à github.com et n'est jamais écrit
#  dans .git/config ni dans l'image Docker.
#
#  Étapes : récupère la branche -> sauvegarde la base (dans le volume ET dans
#  ./backups sur l'hôte) -> avance le code -> reconstruit l'image ->
#  redémarre app + worker -> attend que l'app soit saine. Si elle ne l'est
#  pas, revient automatiquement à la version précédente.
#
#  Les données vivent dans le volume Docker « rpq-data » : ce script ne le
#  supprime jamais (pas de « down -v »).
# ---------------------------------------------------------------------------
set -eu

# La mise à jour peut remplacer ce fichier pendant qu'il tourne : on s'exécute
# depuis une copie temporaire.
if [ -z "${RPQ_UPDATE_COPY:-}" ]; then
  RPQ_ROOT=$(cd "$(dirname "$0")/.." && pwd)
  RPQ_UPDATE_COPY=$(mktemp)
  cp "$0" "$RPQ_UPDATE_COPY"
  export RPQ_ROOT RPQ_UPDATE_COPY
  exec sh "$RPQ_UPDATE_COPY" "$@"
fi

trap 'rm -f "$RPQ_UPDATE_COPY"' EXIT
cd "$RPQ_ROOT"
ROOT=$(pwd)
APP_CONTAINER=rpq-app

say() { printf '[update %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { say "ERREUR : $*" >&2; exit 1; }

CHECK=0
FORCE=0
AUTO=0
BACKUP=1
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    --force) FORCE=1 ;;
    --auto) AUTO=1 ;;
    --no-backup) BACKUP=0 ;;
    -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "option inconnue : $arg (voir --help)" ;;
  esac
done

# --- réglages : variables d'environnement, sinon .env (lu, jamais « sourcé »)
env_value() {
  [ -f .env ] || return 0
  sed -n "s/^$1=//p" .env | tail -n 1 | tr -d '\r' | sed -e "s/^[\"']//" -e "s/[\"']\$//"
}
GITHUB_TOKEN=${GITHUB_TOKEN:-$(env_value GITHUB_TOKEN)}
GITHUB_REPO=${GITHUB_REPO:-$(env_value GITHUB_REPO)}
UPDATE_BRANCH=${UPDATE_BRANCH:-$(env_value UPDATE_BRANCH)}
BACKUP_KEEP=${BACKUP_KEEP:-$(env_value BACKUP_KEEP)}
BACKUP_KEEP=${BACKUP_KEEP:-10}

command -v git >/dev/null 2>&1 || die "git n'est pas installé"
command -v docker >/dev/null 2>&1 || die "docker n'est pas installé"
[ -d .git ] || die "$ROOT n'est pas un clone Git (installer avec « git clone »)"

# --- un seul update à la fois (manuel + service updater)
LOCK="$ROOT/.git/rpq-update.lock"
mkdir "$LOCK" 2>/dev/null || die "une mise à jour est déjà en cours (sinon supprimer $LOCK)"

cleanup() {
  rmdir "$LOCK" 2>/dev/null || true
  rm -f "$RPQ_UPDATE_COPY"
  # lancé en root (service updater) : rendre les fichiers à leur propriétaire
  if [ "$(id -u)" = 0 ]; then
    owner=$(stat -c '%u:%g' "$ROOT" 2>/dev/null || true)
    if [ -n "$owner" ] && [ "$owner" != "0:0" ]; then
      chown -R "$owner" "$ROOT/.git" 2>/dev/null || true
      git ls-files -z | xargs -0 chown "$owner" 2>/dev/null || true
      [ -d "$ROOT/backups" ] && chown -R "$owner" "$ROOT/backups" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT INT TERM

# --- docker compose (plugin v2 ou ancien binaire), même projet que l'existant
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  die "docker compose est introuvable"
fi
PROJECT=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$APP_CONTAINER" 2>/dev/null || true)
[ -n "$PROJECT" ] && DC="$DC -p $PROJECT"

# --- d'où récupérer le code
if [ -n "$GITHUB_REPO" ]; then
  SOURCE="https://github.com/$GITHUB_REPO.git"
else
  ORIGIN=$(git remote get-url origin 2>/dev/null || true)
  [ -n "$ORIGIN" ] || die "pas de remote « origin » : définir GITHUB_REPO=owner/depot dans .env"
  case "$ORIGIN" in
    *github.com[:/]*)
      REPO=$(printf '%s' "$ORIGIN" | sed -E -e 's#^.*github\.com[:/]##' -e 's#/$##' -e 's#\.git$##')
      SOURCE="https://github.com/$REPO.git" ;;
    *) SOURCE="$ORIGIN" ;;   # pas GitHub : on utilise origin tel quel
  esac
fi

BRANCH=${UPDATE_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}
[ "$BRANCH" != "HEAD" ] || die "aucune branche extraite : définir UPDATE_BRANCH dans .env"

# --- fetch (token passé par l'environnement : absent de .git/config et de « ps »)
export GIT_TERMINAL_PROMPT=0
if [ -n "$GITHUB_TOKEN" ]; then
  AUTH=$(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')
  export GIT_CONFIG_COUNT=2
  export GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"
  export GIT_CONFIG_VALUE_0="Authorization: Basic $AUTH"
  export GIT_CONFIG_KEY_1="credential.helper"
  export GIT_CONFIG_VALUE_1=""
fi

[ "$AUTO" = 1 ] || say "Vérification de $BRANCH sur ${GITHUB_REPO:-origin}…"
if ! git fetch --quiet "$SOURCE" "$BRANCH" 2>"$ROOT/.git/rpq-fetch.err"; then
  cat "$ROOT/.git/rpq-fetch.err" >&2
  if [ -z "$GITHUB_TOKEN" ]; then
    die "impossible de lire le dépôt. Dépôt privé ? Ajouter GITHUB_TOKEN=... dans .env"
  fi
  die "impossible de lire le dépôt (token expiré, sans accès « Contents: Read » à ce dépôt, ou branche « $BRANCH » inexistante)"
fi
rm -f "$ROOT/.git/rpq-fetch.err"

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse FETCH_HEAD)
short() { git rev-parse --short "$1"; }

if [ "$LOCAL" = "$REMOTE" ]; then
  UPDATE=0
elif git merge-base --is-ancestor "$LOCAL" "$REMOTE"; then
  UPDATE=1
elif git merge-base --is-ancestor "$REMOTE" "$LOCAL"; then
  [ "$AUTO" = 1 ] || say "Le code local ($(short "$LOCAL")) est en avance sur GitHub : rien à faire."
  UPDATE=0
else
  die "le code local et GitHub ont divergé (commits locaux ?). Résoudre à la main avec git."
fi

if [ "$UPDATE" = 1 ]; then
  say "Mise à jour disponible : $(short "$LOCAL") -> $(short "$REMOTE")"
  git --no-pager log --oneline --no-decorate "$LOCAL..$REMOTE" | head -n 20 | sed 's/^/    /'
elif [ "$FORCE" = 0 ]; then
  [ "$AUTO" = 1 ] || say "Déjà à jour ($(short "$LOCAL"))."
  exit 0
fi
[ "$CHECK" = 0 ] || exit 0

# --- modifications locales : elles bloqueraient le fast-forward
if [ "$UPDATE" = 1 ] && ! git diff --quiet HEAD --; then
  git status --short --untracked-files=no >&2
  die "des fichiers suivis ont été modifiés localement. Mettre les réglages dans .env ou docker-compose.override.yml, puis « git checkout -- . »"
fi

# --- 1. sauvegarde de la base
# Copie cohérente (VACUUM INTO) + rotation. Code inline : fonctionne quelle
# que soit la version installée, même ancienne.
BACKUP_JS='
const Database = require("better-sqlite3"); const fs = require("fs"); const path = require("path");
const [reason, keep] = process.argv.slice(1);
const dir = process.env.BACKUP_DIR || path.join(path.dirname(process.env.DATABASE_PATH), "backups");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const file = path.join(dir, "printer-queue-" + stamp + "-" + reason + ".db");
const db = new Database(process.env.DATABASE_PATH, { fileMustExist: true });
db.pragma("busy_timeout = 10000");
db.prepare("VACUUM INTO ?").run(file);
db.close();
fs.readdirSync(dir).filter((n) => /^printer-queue-.*\.db$/.test(n))
  .map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t)
  .slice(Math.max(Number(keep) || 10, 1)).forEach(({ n }) => fs.rmSync(path.join(dir, n)));
console.log(file);'

BACKUP_FILE=""
if [ "$BACKUP" = 1 ]; then
  if docker inspect "$APP_CONTAINER" >/dev/null 2>&1; then
    say "Sauvegarde de la base…"
    REASON="pre-update-$(short "$REMOTE")"
    if [ "$(docker inspect -f '{{.State.Status}}' "$APP_CONTAINER")" = "running" ]; then
      BACKUP_FILE=$(docker exec "$APP_CONTAINER" node -e "$BACKUP_JS" "$REASON" "$BACKUP_KEEP" | tail -n 1) || BACKUP_FILE=""
    fi
    if [ -z "$BACKUP_FILE" ]; then
      # app arrêtée ou en boucle de redémarrage : conteneur jetable sur le même volume
      IMAGE=$(docker inspect -f '{{.Config.Image}}' "$APP_CONTAINER")
      VOLUME=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$APP_CONTAINER")
      DB_PATH=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP_CONTAINER" | sed -n 's/^DATABASE_PATH=//p' | head -n 1)
      [ -n "$VOLUME" ] || die "volume de données introuvable : mise à jour annulée (--no-backup pour forcer)"
      BACKUP_FILE=$(docker run --rm -v "$VOLUME:/data" -e "DATABASE_PATH=${DB_PATH:-/data/printer-queue.db}" \
        --entrypoint node "$IMAGE" -e "$BACKUP_JS" "$REASON" "$BACKUP_KEEP" | tail -n 1) || BACKUP_FILE=""
    fi
    case "$BACKUP_FILE" in
      /*.db) ;;
      *) die "sauvegarde impossible : mise à jour annulée (--no-backup pour forcer)" ;;
    esac

    # copie hors du volume Docker, au cas où le volume serait perdu
    mkdir -p backups
    VOLUME=${VOLUME:-$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$APP_CONTAINER")}
    if docker cp "$APP_CONTAINER:$BACKUP_FILE" "backups/" >/dev/null 2>&1; then
      say "Sauvegarde : $BACKUP_FILE (copie : backups/$(basename "$BACKUP_FILE"))"
      ls -1t backups/printer-queue-*.db 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do rm -f "$old"; done
    else
      say "Sauvegarde : $BACKUP_FILE (dans le volume ${VOLUME:-rpq-data})"
    fi
  else
    say "Aucune installation en cours d'exécution : rien à sauvegarder."
  fi
fi

# --- 2. code + image + redémarrage
wait_healthy() {
  i=0
  crashes=0
  while [ "$i" -lt 60 ]; do
    state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$APP_CONTAINER" 2>/dev/null || echo missing)
    case "$state" in
      "running healthy") return 0 ;;
      *unhealthy|exited*|dead*) return 1 ;;
      restarting*)
        # plante au démarrage et Docker le relance en boucle
        crashes=$((crashes + 1))
        [ "$crashes" -lt 3 ] || return 1 ;;
    esac
    sleep 3
    i=$((i + 1))
  done
  return 1
}

deploy() {
  GIT_SHA=$(git rev-parse --short HEAD)
  export GIT_SHA
  say "Construction de l'image ($GIT_SHA)…"
  if ! $DC build app; then
    say "La construction de l'image a échoué."
    return 1
  fi
  say "Redémarrage de app + worker (les données du volume rpq-data sont conservées)…"
  # « up » échoue aussi quand l'app ne devient pas saine (le worker l'attend) :
  # c'est wait_healthy qui tranche
  $DC up -d app worker || true
  say "Attente du démarrage…"
  wait_healthy
}

[ "$UPDATE" = 0 ] || git merge --ff-only --quiet "$REMOTE"

if deploy; then
  docker image prune -f >/dev/null 2>&1 || true
  say "Mise à jour terminée : version $(short HEAD) en ligne."
  exit 0
fi

# --- 3. échec : retour à la version précédente
say "La nouvelle version ne démarre pas. Derniers logs :"
docker logs --tail 20 "$APP_CONTAINER" 2>&1 | sed 's/^/    /' || true
if [ "$UPDATE" = 1 ]; then
  say "Retour à la version précédente ($(short "$LOCAL"))…"
  git reset --hard --quiet "$LOCAL"
  deploy || die "la version précédente ne redémarre pas non plus. Sauvegarde : ${BACKUP_FILE:-aucune}"
  die "mise à jour annulée, version $(short "$LOCAL") restaurée et en ligne. Sauvegarde : ${BACKUP_FILE:-aucune}"
fi
die "l'app ne démarre pas (voir les logs ci-dessus)"
