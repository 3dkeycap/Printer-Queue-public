#!/bin/sh
# ---------------------------------------------------------------------------
#  Publie le commit courant sur `main` des DEUX dépôts (privé = origin, public),
#  après avoir lancé les tests. Le serveur de l'atelier se met à jour depuis le
#  dépôt public : les deux doivent toujours pointer sur le même commit.
#
#    sh scripts/publish.sh            tests, puis push sur les deux
#    sh scripts/publish.sh --dry-run  montre ce qui serait poussé, sans rien envoyer
#
#  PUBLIC_REPO : adresse du dépôt public (défaut ci-dessous).
# ---------------------------------------------------------------------------
set -eu

PUBLIC_REPO=${PUBLIC_REPO:-https://github.com/3dkeycap/printer-queue-public}
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Des modifications ne sont pas commitées : commit d'abord (rien n'est poussé)." >&2
  exit 1
fi

HEAD_SHA=$(git rev-parse HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo "Commit $(git rev-parse --short HEAD) (branche $BRANCH)"

echo "→ npm test"
if ! OUT=$(npm test 2>&1); then
  echo "$OUT" | grep -E "^not ok|^# (pass|fail)" >&2 || true
  echo "Les tests échouent : rien n'est poussé." >&2
  exit 1
fi
echo "$OUT" | grep -E "^# (pass|fail)"

if [ "$DRY" = 1 ]; then
  echo "[dry-run] pousserait $HEAD_SHA sur origin/main et sur $PUBLIC_REPO main"
  exit 0
fi

# la branche de travail aussi (sauf si on est déjà sur main), puis main des deux dépôts
[ "$BRANCH" != main ] && git push -q origin "HEAD:$BRANCH"
git push -q origin HEAD:main
git push -q "$PUBLIC_REPO" HEAD:main

PRIVATE_MAIN=$(git ls-remote origin refs/heads/main | cut -f1)
PUBLIC_MAIN=$(git ls-remote "$PUBLIC_REPO" refs/heads/main | cut -f1)
if [ "$PRIVATE_MAIN" = "$HEAD_SHA" ] && [ "$PUBLIC_MAIN" = "$HEAD_SHA" ]; then
  echo "✓ main identique sur les deux dépôts : $(git rev-parse --short HEAD)"
else
  echo "✗ main diffère (privé ${PRIVATE_MAIN:-?}, public ${PUBLIC_MAIN:-?}, local $HEAD_SHA)" >&2
  exit 1
fi
