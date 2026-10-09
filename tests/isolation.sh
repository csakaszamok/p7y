#!/usr/bin/env bash
# Integration test: one sandbox's apps cannot reach another sandbox's apps.
# Creates sandbox A (no inner stack) and B (starter stack), then from a throwaway
# container inside A tries to reach a port B publishes on 127.0.0.1 only, B's
# inner containers, Sablier and B's frps API without its password — all must fail,
# while B's tunnel keeps working. A port B publishes on all interfaces (the
# starter's 5678) is reachable from A by design: that is what publishing means.
#
# Usage: bash tests/isolation.sh   (stack running)
#
# Env vars (all optional):
#   P7Y_API    - default http://localhost:8081
#   P7Y_TOKEN  - default abc123
#   HOST_DOMAIN    - default lvh.me
#   TRAEFIK_URL    - default http://localhost (https://localhost with HTTPS on; its certificate is not checked)

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

A="isa$(printf '%x' $((RANDOM * RANDOM)) | tail -c 6)"
B="isb$(printf '%x' $((RANDOM * RANDOM)) | tail -c 6)"
FA="p7y-$A"; FB="p7y-$B"

cleanup() {
  echo ""
  info "Cleanup: archiving $FA and $FB"
  for n in "$FA" "$FB"; do
    curl -sf -m 600 -X DELETE -H "Authorization: Bearer $P7Y_TOKEN" "$P7Y_API/sandboxes/$n" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

echo ""
echo "=== Sandbox isolation integration test ==="
info "[1/3] Creating $FA (no inner stack) and $FB (with inner stack)..."
curl -sf -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $P7Y_TOKEN" -d "{\"name\":\"$A\",\"create_inner_stack\":false}" \
  "$P7Y_API/sandboxes" >/dev/null || fail "create $FA failed"
curl -sf -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $P7Y_TOKEN" -d "{\"name\":\"$B\"}" \
  "$P7Y_API/sandboxes" >/dev/null || fail "create $FB failed"
ECHO_HOST="$B-inner-http-echo-port5678.$HOST_DOMAIN"
for i in $(seq 1 40); do
  [ "$(curl -sk -m 5 -H "Host: $ECHO_HOST" "$TRAEFIK_URL/" | head -c 5)" = "hello" ] && break; sleep 3
done
[ "$(curl -sk -m 5 -H "Host: $ECHO_HOST" "$TRAEFIK_URL/" | head -c 5)" = "hello" ] || fail "B's tunnel never served"
pass "Both created; B's app serves through its tunnel"

info "[2/3] Collecting B's addresses..."
B_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "traefik-net").IPAddress}}' "$FB")
B_ECHO_IP=$(docker exec "$FB" docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' http-echo)
SABLIER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker compose ps -q sablier))
echo "  B DinD (traefik-net): $B_IP   B http-echo (inside B): $B_ECHO_IP   Sablier: $SABLIER_IP"

info "[3/3] Probing B and Sablier from an app inside $FA..."
# A port published on 127.0.0.1 only is the sandbox's own
docker exec "$FB" docker run -d --name iso-private -p 127.0.0.1:5681:5678 hashicorp/http-echo -text=private >/dev/null
OUT=$(docker exec "$FA" docker run --rm alpine sh -c "
  sleep 2
  nc -z -w3 $B_IP 5681       && echo LEAK:private-5681
  nc -z -w3 $B_ECHO_IP 5678  && echo LEAK:inner-private-ip
  nc -z -w3 $SABLIER_IP 10000 && echo LEAK:sablier
  nc -z -w3 sablier 10000    && echo LEAK:sablier-by-name
  echo probed
" 2>&1)
echo "$OUT" | grep -q probed || fail "probe container did not run: $OUT"
LEAKS=$(echo "$OUT" | grep LEAK || true)
[ -z "$LEAKS" ] || fail "reachable from $FA: $(echo "$LEAKS" | tr '\n' ' ')"
pass "B's 127.0.0.1-published ports, inner containers (private IPs) and Sablier are unreachable from $FA"

OPEN=$(docker exec "$FA" docker run --rm alpine sh -c "wget -qO- -T 5 http://$B_IP:5678/ || echo closed" 2>&1 | tail -1)
[ "$OPEN" = "hello $FB" ] || fail "the port B's starter publishes on all interfaces is not reachable from $FA (got: $OPEN)"
pass "A port B publishes on all interfaces is reachable from $FA (by design)"

B_SOCAT_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "traefik-net").IPAddress}}' "$FB-socat")
FRPS=$(docker exec "$FA" docker run --rm alpine sh -c "wget -qO- -T 5 http://$B_SOCAT_IP:7500/api/proxy/http 2>&1 || true" 2>&1 | tail -1)
echo "$FRPS" | grep -q '401' || fail "B's frps API from $FA without its password: $FRPS"
pass "B's frps API answers 401 to $FA without its password"

[ "$(curl -sk -m 5 -H "Host: $ECHO_HOST" "$TRAEFIK_URL/" | head -c 5)" = "hello" ] || fail "B's tunnel stopped working"
pass "B's tunnel still serves"

echo ""
echo "=== All checks passed ==="
