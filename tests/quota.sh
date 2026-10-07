#!/usr/bin/env bash
# Integration test: per-user sandbox quota. Run the stack like tests/self-service.sh
# (mock OIDC env) plus SANDBOX_QUOTA=1:
#   SANDBOX_QUOTA=1 OIDC_ISSUER=http://host.docker.internal:8090/default OIDC_CLIENT_ID=p7y #   OIDC_CLIENT_SECRET=secret ADMIN_PASSWORD=pw SESSION_SECRET=e2e PUBLIC_URL=http://localhost:8081 #   docker compose up -d p7y
# Usage: bash tests/quota.sh   (from the repo root)
set -euo pipefail

API="${P7Y_API:-http://localhost:8081}"
ADMIN_TOKEN="${P7Y_TOKEN:-abc123}"
MOCK_PORT="${MOCK_OIDC_PORT:-8090}"
TMP="$(mktemp -d)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
pass() { echo -e "${GREEN}PASS${RESET}: $*"; }
fail() { echo -e "${RED}FAIL${RESET}: $*"; exit 1; }
info() { echo -e "${YELLOW}----${RESET} $*"; }

# shared helpers: sign_in <email> → cookie jar path; as_user <jar> <curl args…>
eval "$(sed -n '/^sign_in() {/,/^}/p' tests/self-service.sh)"
eval "$(sed -n '/^as_user() {/p' tests/self-service.sh)"

A="qa$(printf '%x' $RANDOM)"; B="qb$(printf '%x' $RANDOM)"; C="qc$(printf '%x' $RANDOM)"
cleanup() {
  for n in "$A" "$B" "$C"; do curl -s -m 600 -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" "$API/sandboxes/p7y-$n" >/dev/null 2>&1 || true; done
  docker rm -f p7y-mock-oidc >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap cleanup EXIT

info "[1/4] Mock OIDC provider + a regular user"
docker rm -f p7y-mock-oidc >/dev/null 2>&1 || true
docker run -d --name p7y-mock-oidc -p "$MOCK_PORT:8080" -e JSON_CONFIG='{"interactiveLogin":true}' ghcr.io/navikt/mock-oauth2-server:2.1.10 >/dev/null
for i in $(seq 1 30); do curl -sf "http://localhost:$MOCK_PORT/default/.well-known/openid-configuration" >/dev/null && break; sleep 1; done
U=$(sign_in quota-user@example.com)
pass "signed in"

create() { as_user "$U" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"name\":\"$1\",\"create_inner_stack\":false}" "$API/sandboxes"; }

info "[2/4] First sandbox fits the quota of 1"
[ "$(create "$A")" = 201 ] || fail "first create was not 201"
as_user "$U" "$API/me" | grep -q '"quota":1,"sandbox_count":1' || fail "/me: $(as_user "$U" "$API/me")"
pass "created $A; /me shows 1 of 1"

info "[3/4] Second sandbox is refused"
BODY=$(as_user "$U" -w ' %{http_code}' -X POST -H 'Content-Type: application/json' -d "{\"name\":\"$B\",\"create_inner_stack\":false}" "$API/sandboxes")
case "$BODY" in *"Sandbox limit reached (1). Delete one to create a new one."*" 409") pass "409 limit reached";; *) fail "expected 409 limit, got: $BODY";; esac

info "[4/4] After deleting one, creating works again"
as_user "$U" -X DELETE "$API/sandboxes/p7y-$A" >/dev/null
[ "$(create "$C")" = 201 ] || fail "create after delete was not 201"
pass "created $C after archiving $A"

echo ""; echo "=== All checks passed ==="
