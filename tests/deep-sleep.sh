#!/usr/bin/env bash
# Integration test: idle → asleep → deep sleep → wake on first request.
# Run the stack with a short check interval first:
#   DEEP_SLEEP_CHECK_INTERVAL=15s docker compose up -d p7y
#
# Usage: bash tests/deep-sleep.sh   (from the repo root)
#
# Env vars (all optional):
#   P7Y_API    - default http://localhost:8081
#   P7Y_TOKEN  - default abc123
#   HOST_DOMAIN    - default lvh.me
#   TRAEFIK_URL    - default http://localhost

set -euo pipefail
export MSYS_NO_PATHCONV=1

P7Y_API="${P7Y_API:-${LEANDER_API:-http://localhost:8081}}"
P7Y_TOKEN="${P7Y_TOKEN:-${LEANDER_TOKEN:-abc123}}"
HOST_DOMAIN="${HOST_DOMAIN:-lvh.me}"
TRAEFIK_URL="${TRAEFIK_URL:-http://localhost}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
pass() { echo -e "${GREEN}PASS${RESET}: $*"; }
fail() { echo -e "${RED}FAIL${RESET}: $*"; exit 1; }
info() { echo -e "${YELLOW}----${RESET} $*"; }

NAME="dz$(printf '%x' $((RANDOM * RANDOM)) | tail -c 6)"
FULL="p7y-$NAME"
ECHO_HOST="$NAME-inner-http-echo-port5678.$HOST_DOMAIN"

status() {
  curl -s -H "Authorization: Bearer $P7Y_TOKEN" "$P7Y_API/sandboxes/$FULL" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4
}
body() { curl -s -m 10 -H "Host: $ECHO_HOST" "$TRAEFIK_URL/" | head -c 4000; }
wait_status() { # $1 wanted status, $2 deadline seconds
  local t; t=$(date +%s)
  until [ "$(status)" = "$1" ]; do
    [ $(( $(date +%s) - t )) -lt "$2" ] || fail "status never became $1 (now: $(status))"
    sleep 5
  done
}

cleanup() {
  echo ""
  info "Cleanup: archiving $FULL"
  curl -s -m 600 -X DELETE -H "Authorization: Bearer $P7Y_TOKEN" "$P7Y_API/sandboxes/$FULL" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo ""
echo "=== Deep sleep integration test ==="
info "[1/6] Creating $FULL (idle_timeout 1m, deep_sleep_after 2m)..."
curl -sf -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $P7Y_TOKEN" \
  -d "{\"name\":\"$NAME\",\"idle_timeout\":\"1m\",\"deep_sleep_after\":\"2m\"}" \
  "$P7Y_API/sandboxes" >/dev/null || fail "POST /sandboxes failed"
for i in $(seq 1 40); do [ "$(body | head -c 5)" = "hello" ] && break; sleep 3; done
[ "$(body | head -c 5)" = "hello" ] || fail "app never answered"
pass "Created and serving"

info "[2/6] Waiting for Sablier to stop it (idle)..."
wait_status exited 180
pass "Asleep (exited)"

info "[3/6] Waiting for deep sleep (2m after the stop + check interval)..."
wait_status deep_sleep 300
[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$FULL")" ] || fail "containers still exist"
docker network inspect "${FULL}_default" >/dev/null 2>&1 && fail "network ${FULL}_default still exists"
docker volume inspect "${FULL}_docker_data" >/dev/null 2>&1 || fail "docker_data volume is gone"
ls -d opt/sandboxes/*/"$FULL" >/dev/null 2>&1 || fail "opt/sandboxes/*/$FULL is gone"
pass "Deep sleep: containers and network gone, volume and config kept"

info "[4/6] One request while in deep sleep (and then no more traffic)..."
# Traefik drops the removed sandbox's router ~1s after compose down; until then
# the request 404s. Retry briefly instead of racing the provider.
T=$(date +%s)
# "rebuilding after a long sleep" only appears on p7y's deep-sleep page (the Sablier
# waiting page shares the "Sandbox is waking up" heading).
until B=$(body); echo "$B" | grep -q "rebuilding after a long sleep"; do
  [ $(( $(date +%s) - T )) -lt 30 ] || fail "expected the deep-sleep waiting page, got: $(echo "$B" | head -c 200)"
  sleep 1
done
pass "Waiting page served after $(( $(date +%s) - T ))s"

info "[5/6] Waiting (API only, no requests to the sandbox) until it is running again..."
wait_status running 180
pass "Rebuilt and running $(( $(date +%s) - T ))s after the single request"

# A sandbox woken by a single request must still go back to sleep: p7y opens
# the Sablier session itself, since nobody else sends traffic through the router.
info "[6/6] Staying idle: it must fall asleep again after idle_timeout..."
wait_status exited 180
pass "Asleep again after the idle timeout (Sablier session was opened)"

T=$(date +%s)
until [ "$(body | head -c 5)" = "hello" ]; do
  [ $(( $(date +%s) - T )) -lt 120 ] || fail "app not back within 120s, last: $(body | head -c 200)"
  sleep 3
done
pass "App back $(( $(date +%s) - T ))s after the next request (normal Sablier wake)"

echo ""
echo "=== All checks passed ==="
