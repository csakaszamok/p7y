#!/usr/bin/env bash
# Integration test: a fresh install from the release files only (no checkout), then an old checkout
# upgraded in place. Builds the image and needs ports 80, 443 and 8081.
#
# Only on a machine without Purgatory (CI, or a throw-away Docker): its networks have fixed names, so a test
# stack next to a real one would join the real sandboxes' networks. On a development machine run it in a
# docker:dind container:
#
#   docker run --rm --privileged -e DOCKER_TLS_CERTDIR= -e DOCKER_HOST=unix:///var/run/docker.sock \
#     -v "$PWD:/src:ro" docker:dind sh -c \
#     'dockerd-entrypoint.sh >/dev/null 2>&1 & until docker info >/dev/null 2>&1; do sleep 1; done; \
#      apk add -q bash curl && cp -r /src /p7y && bash /p7y/tests/install.sh'
#
# Usage: bash tests/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
pass() { echo -e "${GREEN}PASS${RESET}: $*"; }
fail() { echo -e "${RED}FAIL${RESET}: $*"; exit 1; }
info() { echo -e "${YELLOW}----${RESET} $*"; }

if docker network inspect traefik-net sablier-net >/dev/null 2>&1 \
  || [ -n "$(docker ps -aq --filter label=p7y.managed=true)$(docker ps -aq --filter label=leander.managed=true)" ]; then
  fail "this Docker already runs Purgatory (or its sandboxes): run the test in docker:dind, see the top of this file"
fi

repo=$PWD
TAG=p7y-install-test
info "building the image"
docker build -q -t "ghcr.io/csakaszamok/p7y:$TAG" . >/dev/null

# Its own compose project, so `down -v` removes only the test's volumes
export COMPOSE_PROJECT_NAME=p7y-install-test
base=$(mktemp -d); dir=$base/p7y; mkdir "$dir"
cleanup() { (cd "$dir" && docker compose down -v --remove-orphans >/dev/null 2>&1) || true; rm -rf "$base"; }
trap cleanup EXIT

api() { curl -fsS -m 10 -H "Authorization: Bearer $(sed -n 's/^ADMIN_TOKEN=//p' "$dir/.env")" "http://localhost:8081$1"; }
wait_api() {
  for _ in $(seq 1 90); do api /templates >/dev/null 2>&1 && return 0; sleep 2; done
  docker compose ps -a; docker compose logs --tail 40 p7y; api /templates || true
  fail "API not up"
}
# The old starter ran Portainer; the description of today's starter names the portainer template, so look at the image
has_portainer() { api /templates/starter | grep -q 'portainer/portainer'; }

info "fresh install: release files only"
cp "$repo/docker-compose.yml" "$repo/setup.sh" "$dir/"
cp "$repo/.env.example" "$dir/.env.example"   # what setup.sh copies when P7Y_RELEASE is empty
cd "$dir"
bash setup.sh >/dev/null && rm .env.example
printf 'P7Y_VERSION=%s\n' "$TAG" >> .env
docker compose up -d --quiet-pull >/dev/null 2>&1 || { docker compose ps -a; docker compose logs p7y-init; fail "up failed"; }
[ "$(docker compose ps -a --format '{{.ExitCode}}' p7y-init)" = 0 ] && pass "p7y-init exited 0" || fail "p7y-init"
wait_api
has_portainer && fail "starter has Portainer" || pass "starter from the image (no Portainer)"
[ -f dynamic/errors.yml ] && pass "dynamic/errors.yml written" || fail "no dynamic/errors.yml"
for _ in $(seq 1 15); do curl -s -m 5 -H 'Host: nothing-here.lvh.me' http://localhost/ | grep -q 'VIEW IN FULL SCREEN' && break; sleep 2; done
curl -s -m 5 -H 'Host: nothing-here.lvh.me' http://localhost/ | grep -q 'VIEW IN FULL SCREEN' && pass "our 404 page" || fail "404 page"
docker run --rm -q -v "${COMPOSE_PROJECT_NAME}_sablier_themes:/t" alpine ls /t | grep -qx p7y.html && pass "Sablier has the p7y theme" || fail "theme"

info "old checkout upgraded in place: an edited template no longer applies"
docker compose down >/dev/null 2>&1
mkdir -p templates/starter && printf 'services:\n  portainer:\n    image: portainer/portainer-ce\n' > templates/starter/compose.yaml
rm dynamic/errors.yml   # what git pull does to an old checkout
cp .env env.before; find data opt -type f | sort > files.before
docker compose up -d >/dev/null 2>&1 || fail "up after upgrade"
wait_api
has_portainer && fail "the checkout's starter applies" || pass "the image's starter applies"
[ -f dynamic/errors.yml ] && pass "dynamic/errors.yml back after up" || fail "errors.yml missing"
cmp -s .env env.before && pass ".env untouched" || fail ".env changed"
missing=$(while read -r f; do [ -e "$f" ] || echo "$f"; done < files.before)
[ -z "$missing" ] && pass "data/ and opt/ kept" || fail "gone after the upgrade: $missing"
