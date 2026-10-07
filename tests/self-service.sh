#!/usr/bin/env bash
# Integration test: OIDC sign-in, ownership, personal tokens, admin view.
# Starts a local mock OIDC provider; p7y must be configured to use it:
#   OIDC_ISSUER=http://host.docker.internal:8090/default OIDC_CLIENT_ID=p7y \
#   OIDC_CLIENT_SECRET=secret ADMIN_PASSWORD=pw SESSION_SECRET=e2e \
#   PUBLIC_URL=http://localhost:8081 docker compose up -d p7y
#
# Usage: bash tests/self-service.sh   (from the repo root)

set -euo pipefail

API="${P7Y_API:-http://localhost:8081}"
ADMIN_TOKEN="${P7Y_TOKEN:-abc123}"
MOCK_PORT="${MOCK_OIDC_PORT:-8090}"
TMP="$(mktemp -d)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
pass() { echo -e "${GREEN}PASS${RESET}: $*"; }
fail() { echo -e "${RED}FAIL${RESET}: $*"; exit 1; }
info() { echo -e "${YELLOW}----${RESET} $*"; }

cleanup() {
  echo ""
  info "Cleanup"
  for n in "${CREATED[@]:-}"; do
    [ -n "$n" ] && curl -s -m 600 -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API/sandboxes/$n" >/dev/null 2>&1 || true
  done
  docker rm -f p7y-mock-oidc >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
CREATED=()
trap cleanup EXIT

info "[1/6] Starting mock OIDC provider on :$MOCK_PORT..."
docker rm -f p7y-mock-oidc >/dev/null 2>&1 || true
docker run -d --name p7y-mock-oidc -p "$MOCK_PORT:8080" \
  -e JSON_CONFIG='{"interactiveLogin":true}' ghcr.io/navikt/mock-oauth2-server:2.1.10 >/dev/null
for i in $(seq 1 30); do curl -sf "http://localhost:$MOCK_PORT/default/.well-known/openid-configuration" >/dev/null && break; sleep 1; done
pass "Mock OIDC up"

# Sign in as <email>: p7y /auth/oidc → provider login form (username + claims) → p7y callback.
sign_in() {
  local email="$1" jar="$TMP/$1.jar"
  local authorize
  authorize=$(curl -s -c "$jar" -b "$jar" -o /dev/null -w '%{redirect_url}' "$API/auth/oidc")
  authorize="${authorize//host.docker.internal/localhost}"
  local callback
  callback=$(curl -s -c "$jar" -b "$jar" -o /dev/null -w '%{redirect_url}' \
    --data-urlencode "username=$email" \
    --data-urlencode "claims={\"email\":\"$email\",\"email_verified\":true}" \
    "$authorize")
  [ -n "$callback" ] || fail "provider did not redirect back for $email"
  curl -s -c "$jar" -b "$jar" -o /dev/null "$callback"
  grep -q p7y_session "$jar" || fail "no session cookie for $email"
  echo "$jar"
}
as_user() { local jar="$1"; shift; curl -s -b "$jar" -H "Origin: $API" "$@"; }

info "[2/6] Two users sign in with OIDC..."
ALICE=$(sign_in alice@example.com)
BOB=$(sign_in bob@example.com)
[ "$(as_user "$ALICE" "$API/me" | grep -o '"sub":"[^"]*"')" = '"sub":"alice@example.com"' ] || fail "/me for alice"
pass "alice and bob have sessions"

info "[3/6] Each creates a sandbox; neither sees the other's..."
A="ssa$(printf '%x' $RANDOM)"; B="ssb$(printf '%x' $RANDOM)"
as_user "$ALICE" -X POST -H 'Content-Type: application/json' -d "{\"name\":\"$A\",\"create_inner_stack\":false}" "$API/sandboxes" >/dev/null; CREATED+=("p7y-$A")
as_user "$BOB"   -X POST -H 'Content-Type: application/json' -d "{\"name\":\"$B\",\"create_inner_stack\":false}" "$API/sandboxes" >/dev/null; CREATED+=("p7y-$B")
as_user "$ALICE" "$API/sandboxes" | grep -q "p7y-$A" || fail "alice does not see her sandbox"
as_user "$ALICE" "$API/sandboxes" | grep -q "p7y-$B" && fail "alice sees bob's sandbox"
[ "$(as_user "$ALICE" -o /dev/null -w '%{http_code}' "$API/sandboxes/p7y-$B")" = 404 ] || fail "alice can open bob's sandbox"
pass "ownership enforced"

info "[4/6] Alice mints a personal token; her agent creates a sandbox with it..."
TOKEN=$(as_user "$ALICE" -X POST -H 'Content-Type: application/json' -d '{"name":"e2e agent","expires_in":"30d"}' "$API/tokens" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
[ -n "$TOKEN" ] || fail "no token returned"
C="ssc$(printf '%x' $RANDOM)"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"$C\",\"create_inner_stack\":false}" "$API/sandboxes" >/dev/null; CREATED+=("p7y-$C")
as_user "$ALICE" "$API/sandboxes" | grep -q "p7y-$C" || fail "token-created sandbox is not alice's"
pass "agent acts as alice"

info "[5/6] Revoked token stops working..."
ID=$(as_user "$ALICE" "$API/tokens" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
as_user "$ALICE" -X DELETE "$API/tokens/$ID" >/dev/null
[ "$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$API/sandboxes")" = 401 ] || fail "revoked token still works"
pass "revoked token → 401"

info "[6/6] Admin signs in with the local account and sees everything..."
ADMIN_JAR="$TMP/admin.jar"
curl -s -c "$ADMIN_JAR" -o /dev/null -H "Origin: $API" --data-urlencode username=admin --data-urlencode "password=${ADMIN_PASSWORD:-pw}" "$API/login"
LIST=$(curl -s -b "$ADMIN_JAR" "$API/sandboxes")
echo "$LIST" | grep -q "p7y-$A" && echo "$LIST" | grep -q "p7y-$B" || fail "admin does not see all sandboxes"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"name":"anon"}' "$API/sandboxes")" = 401 ] || fail "anonymous create allowed"
pass "admin sees all; anonymous create → 401"

echo ""
echo "=== All checks passed ==="
