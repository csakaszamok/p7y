#!/usr/bin/env bash
# Integration test: changing a sandbox's sleep settings after creation (PATCH /sandboxes/<name>).
# Create a sandbox with a long idle_timeout, shorten it to 1m while it runs, and
# verify it then falls asleep within the new time. Set deep_sleep_after and check
# the countdown uses it. Change the sleep time again while it is asleep: it must
# stay asleep and still wake on the next request.
#
# Usage: bash tests/sleep-settings.sh
#
# Env vars (all optional):
#   P7Y_API    - default http://localhost:8081
#   P7Y_TOKEN  - default abc123
#   HOST_DOMAIN    - default lvh.me
#   TRAEFIK_URL    - default http://localhost  (requests are sent here with a Host header)
#   STOP_DEADLINE  - default 180 (seconds idle before we give up waiting for the stop)
#   WAKE_DEADLINE  - default 90  (seconds after the first request for the app to answer)

set -euo pipefail

P7Y_API="${P7Y_API:-${LEANDER_API:-http://localhost:8081}}"
P7Y_TOKEN="${P7Y_TOKEN:-${LEANDER_TOKEN:-abc123}}"
HOST_DOMAIN="${HOST_DOMAIN:-lvh.me}"
TRAEFIK_URL="${TRAEFIK_URL:-http://localhost}"
STOP_DEADLINE="${STOP_DEADLINE:-180}"
WAKE_DEADLINE="${WAKE_DEADLINE:-90}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
pass() { echo -e "${GREEN}PASS${RESET}: $*"; }
fail() { echo -e "${RED}FAIL${RESET}: $*"; exit 1; }
info() { echo -e "${YELLOW}----${RESET} $*"; }

NAME="ss$(printf '%x' $((RANDOM * RANDOM)) | tail -c 6)"
ECHO_HOST="$NAME-inner-http-echo-port5678.$HOST_DOMAIN"

fetch() {
  local out
  out=$(curl -s -m 10 -w '\n%{http_code}' -H "Host: $ECHO_HOST" "$TRAEFIK_URL/" 2>/dev/null || true)
  echo "$(echo "$out" | tail -1) $(echo "$out" | sed '$d' | head -c 300 | tr '\n' ' ')"
}
details() { curl -sf -H "Authorization: Bearer $P7Y_TOKEN" "$P7Y_API/sandboxes/$FULL_NAME"; }
field() { details | grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }
patch() {
  curl -s -o /dev/stderr -w '%{http_code}' -X PATCH -H "Content-Type: application/json" -H "Authorization: Bearer $P7Y_TOKEN" \
    -d "$1" "$P7Y_API/sandboxes/$FULL_NAME" 2>/dev/null
}
wait_app() {
  local deadline=$1 T R
  T=$(date +%s)
  while :; do
    R=$(fetch); case "$R" in "200 hello"*) echo "$R"; return 0;; esac
    [ $(( $(date +%s) - T )) -lt "$deadline" ] || { echo "$R"; return 1; }
    sleep 2
  done
}

echo ""
echo "=== Sleep settings integration test ==="
info "Sandbox name : $NAME"
echo ""

# ── 1. Create with a long idle timeout ─────────────────────────────────────────
info "[1/5] Creating sandbox (idle_timeout 10m)..."
RESPONSE=$(curl -sf -X POST \
  -H "Content-Type: application/json" -H "Authorization: Bearer $P7Y_TOKEN" \
  -d "{\"name\":\"$NAME\",\"idle_timeout\":\"10m\"}" \
  "$P7Y_API/sandboxes") || fail "POST /sandboxes failed"
FULL_NAME=$(echo "$RESPONSE" | grep -o '"name":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$FULL_NAME" ] || fail "Could not parse sandbox name from response"
cleanup() {
  echo ""
  info "Cleanup: deleting $FULL_NAME"
  curl -sf -X DELETE -H "Authorization: Bearer $P7Y_TOKEN" "$P7Y_API/sandboxes/$FULL_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
R=$(wait_app 120) || fail "App never answered, last: $R"
pass "Created $FULL_NAME, app answers"

# ── 2. Change both settings while running ──────────────────────────────────────
info "[2/5] PATCH idle_timeout=1m, deep_sleep_after=14d while running..."
CODE=$(patch '{"idle_timeout":"1m","deep_sleep_after":"14d"}') || true
[ "$CODE" = 200 ] || fail "PATCH answered $CODE"
[ "$(field idle_timeout)" = 1m ] && [ "$(field deep_sleep_after)" = 14d ] || fail "details do not show the new settings: $(details)"
[ "$(field status)" = running ] || fail "sandbox not running after the change"
R=$(wait_app 30) || fail "App not reachable after the change, last: $R"
pass "Settings changed; app still answers"

BAD=$(patch '{"idle_timeout":"0m"}') || true
[ "$BAD" = 400 ] || fail "invalid idle_timeout answered $BAD, expected 400"
pass "Invalid value rejected (400)"

# ── 3. Falls asleep within the new idle time ───────────────────────────────────
info "[3/5] Staying idle; the new 1m must apply (deadline ${STOP_DEADLINE}s, old value was 10m)..."
T=$(date +%s)
while [ "$(field status)" != exited ]; do
  [ $(( $(date +%s) - T )) -lt "$STOP_DEADLINE" ] || fail "Still running after ${STOP_DEADLINE}s idle"
  sleep 5
done
pass "Asleep after $(( $(date +%s) - T ))s idle"

# ── 4. Deep sleep countdown uses the new value ─────────────────────────────────
info "[4/5] deep_sleep_at ≈ stop time + 14d..."
AT=$(field deep_sleep_at)
[ -n "$AT" ] || fail "no deep_sleep_at: $(details)"
DAYS=$(( ( $(date -d "$AT" +%s) - $(date +%s) ) / 86400 ))
[ "$DAYS" -ge 13 ] || fail "deep_sleep_at $AT is only $DAYS days away"
pass "Deep sleep at $AT (~$DAYS days)"

# ── 5. Change while asleep: stays asleep, wakes on request ─────────────────────
info "[5/5] PATCH idle_timeout=2m while asleep..."
CODE=$(patch '{"idle_timeout":"2m"}') || true
[ "$CODE" = 200 ] || fail "PATCH answered $CODE"
sleep 3
[ "$(field status)" = exited ] || fail "sandbox woke up from the change (status $(field status))"
pass "Still asleep after the change"
fetch >/dev/null
R=$(wait_app "$WAKE_DEADLINE") || fail "App not back within ${WAKE_DEADLINE}s, last: $R"
pass "Woke on request; idle_timeout now $(field idle_timeout)"

echo ""
echo "=== All checks passed ==="
