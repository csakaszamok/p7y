#!/usr/bin/env bash
# Integration test: Sablier idle sleep + wake-on-request.
# Create a sandbox with a short idle_timeout, verify it serves, let it go idle
# until Sablier stops it, then verify the first request shows the waiting page
# and the app comes back on its own.
#
# Usage: bash tests/sablier-wake.sh
#
# Env vars (all optional):
#   P7Y_API    - default http://localhost:8081
#   P7Y_TOKEN  - default abc123
#   HOST_DOMAIN    - default lvh.me
#   TRAEFIK_URL    - default http://localhost  (requests are sent here with a Host header)
#   IDLE_TIMEOUT   - default 1m
#   STOP_DEADLINE  - default 180 (seconds idle before we give up waiting for the stop)
#   WAKE_DEADLINE  - default 90  (seconds after the first request for the app to answer)

set -euo pipefail

P7Y_API="${P7Y_API:-${LEANDER_API:-http://localhost:8081}}"
P7Y_TOKEN="${P7Y_TOKEN:-${LEANDER_TOKEN:-abc123}}"
HOST_DOMAIN="${HOST_DOMAIN:-lvh.me}"
TRAEFIK_URL="${TRAEFIK_URL:-http://localhost}"
IDLE_TIMEOUT="${IDLE_TIMEOUT:-1m}"
STOP_DEADLINE="${STOP_DEADLINE:-180}"
WAKE_DEADLINE="${WAKE_DEADLINE:-90}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
pass() { echo -e "${GREEN}PASS${RESET}: $*"; }
fail() { echo -e "${RED}FAIL${RESET}: $*"; exit 1; }
info() { echo -e "${YELLOW}----${RESET} $*"; }

NAME="sw$(printf '%x' $((RANDOM * RANDOM)) | tail -c 6)"
ECHO_HOST="$NAME-inner-http-echo-port5678.$HOST_DOMAIN"

# GET through Traefik with the sandbox Host header; prints "<code> <body…>"
fetch() {
  local out
  out=$(curl -s -m 10 -w '\n%{http_code}' -H "Host: $ECHO_HOST" "$TRAEFIK_URL/" 2>/dev/null || true)
  echo "$(echo "$out" | tail -1) $(echo "$out" | sed '$d' | head -c 300 | tr '\n' ' ')"
}

status() {
  curl -sf -H "Authorization: Bearer $P7Y_TOKEN" "$P7Y_API/sandboxes/$FULL_NAME" 2>/dev/null \
    | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4
}

echo ""
echo "=== Sablier idle + wake integration test ==="
info "Sandbox name : $NAME"
info "Idle timeout : $IDLE_TIMEOUT"
echo ""

# ── 1. Create sandbox ──────────────────────────────────────────────────────────
info "[1/4] Creating sandbox..."
RESPONSE=$(curl -sf -X POST \
  -H "Content-Type: application/json" -H "Authorization: Bearer $P7Y_TOKEN" \
  -d "{\"name\":\"$NAME\",\"idle_timeout\":\"$IDLE_TIMEOUT\"}" \
  "$P7Y_API/sandboxes") || fail "POST /sandboxes failed"
FULL_NAME=$(echo "$RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$FULL_NAME" ] || fail "Could not parse sandbox name from response"
pass "Created: $FULL_NAME"

cleanup() {
  echo ""
  info "Cleanup: deleting $FULL_NAME"
  curl -sf -X DELETE -H "Authorization: Bearer $P7Y_TOKEN" \
    "$P7Y_API/sandboxes/$FULL_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── 2. Serving ─────────────────────────────────────────────────────────────────
info "[2/4] Waiting for the app to answer..."
for i in $(seq 1 40); do
  R=$(fetch); case "$R" in "200 hello"*) break;; esac; sleep 3
done
case "$R" in "200 hello"*) pass "App answers: $R";; *) fail "App never answered, last: $R";; esac

# ── 3. Idle → stopped ──────────────────────────────────────────────────────────
info "[3/4] Staying idle until Sablier stops the sandbox (deadline ${STOP_DEADLINE}s)..."
T=$(date +%s)
while [ "$(status)" != "exited" ]; do
  [ $(( $(date +%s) - T )) -lt "$STOP_DEADLINE" ] || fail "Still running after ${STOP_DEADLINE}s idle"
  sleep 5
done
pass "Stopped after $(( $(date +%s) - T ))s idle (status: $(status))"

# ── 4. Wake on request ─────────────────────────────────────────────────────────
info "[4/4] First request while asleep..."
T=$(date +%s)
R=$(fetch)
echo "  $R" | head -c 120; echo
echo "$R" | grep -qi "waking up" || fail "Expected the p7y waiting page, got: $(echo "$R" | head -c 200)"
pass "Waiting page served"

while :; do
  R=$(fetch); case "$R" in "200 hello"*) break;; esac
  [ $(( $(date +%s) - T )) -lt "$WAKE_DEADLINE" ] || fail "App not back within ${WAKE_DEADLINE}s, last: $(echo "$R" | head -c 200)"
  sleep 2
done
pass "App back $(( $(date +%s) - T ))s after the first request (status: $(status))"

echo ""
echo "=== All checks passed ==="
