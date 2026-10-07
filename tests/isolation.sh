#!/usr/bin/env bash
# Integration test: one sandbox's apps cannot reach another sandbox's apps.
# Creates sandbox A (no inner stack) and B (starter stack: ports 9000/5678
# published on 127.0.0.1 only), then from a throwaway container inside A tries
# to reach B's starter ports, B's inner containers and Sablier — all must fail,
# while B's tunnel keeps working. A port B publishes on all interfaces
# (-p 5680:5678) is reachable from A by design: that is what publishing means.
#
# Usage: bash tests/isolation.sh   (stack running)
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
  [ "$(curl -s -m 5 -H "Host: $ECHO_HOST" "$TRAEFIK_URL/" | head -c 5)" = "hello" ] && break; sleep 3
done
[ "$(curl -s -m 5 -H "Host: $ECHO_HOST" "$TRAEFIK_URL/" | head -c 5)" = "hello" ] || fail "B's tunnel never served"
pass "Both created; B's app serves through its tunnel"

info "[2/3] Collecting B's addresses..."
B_IP=$(docker inspect -f '{{(index .NetworkSettings.Networks "traefik-net").IPAddress}}' "$FB")
B_ECHO_IP=$(docker exec "$FB" docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' http-echo)
SABLIER_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $(docker compose ps -q sablier))
echo "  B DinD (traefik-net): $B_IP   B http-echo (inside B): $B_ECHO_IP   Sablier: $SABLIER_IP"

info "[3/3] Probing B and Sablier from an app inside $FA..."
OUT=$(docker exec "$FA" docker run --rm alpine sh -c "
  nc -z -w3 $B_IP 5678       && echo LEAK:starter-5678
  nc -z -w3 $B_IP 9000       && echo LEAK:starter-9000
  nc -z -w3 $B_ECHO_IP 5678  && echo LEAK:inner-private-ip
  nc -z -w3 $SABLIER_IP 10000 && echo LEAK:sablier
  nc -z -w3 sablier 10000    && echo LEAK:sablier-by-name
  echo probed
" 2>&1)
echo "$OUT" | grep -q probed || fail "probe container did not run: $OUT"
LEAKS=$(echo "$OUT" | grep LEAK || true)
[ -z "$LEAKS" ] || fail "reachable from $FA: $(echo "$LEAKS" | tr '\n' ' ')"
pass "B's 127.0.0.1-published ports, inner containers (private IPs) and Sablier are unreachable from $FA"

docker exec "$FB" docker run -d --name iso-open -p 5680:5678 hashicorp/http-echo -text=open >/dev/null
OPEN=$(docker exec "$FA" docker run --rm alpine sh -c "sleep 2; wget -qO- -T 5 http://$B_IP:5680/ || echo closed" 2>&1 | tail -1)
[ "$OPEN" = "open" ] || fail "a port B published on all interfaces is not reachable from $FA (got: $OPEN)"
pass "A port B publishes on all interfaces is reachable from $FA (by design)"

[ "$(curl -s -m 5 -H "Host: $ECHO_HOST" "$TRAEFIK_URL/" | head -c 5)" = "hello" ] || fail "B's tunnel stopped working"
pass "B's tunnel still serves"

echo ""
echo "=== All checks passed ==="
