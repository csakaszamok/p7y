#!/usr/bin/env bash
# Integration test: the Hub. Run the stack with HUB_ENABLED=true (and ADMIN_USER/ADMIN_PASSWORD set).
# Creates a sandbox with one published and one unpublished container, signs in to the Hub as the admin,
# checks the list, a vote and taking it back, the feed with and without the key, and that the sandbox
# API is not reachable on the Hub host.
# Usage: P9M_TOKEN=<ADMIN_TOKEN> ADMIN_USER=admin ADMIN_PASSWORD=… bash tests/hub.sh
set -euo pipefail
P9M_API="${P9M_API:-http://localhost:8081}"
P9M_TOKEN="${P9M_TOKEN:?set P9M_TOKEN}"
TRAEFIK_URL="${TRAEFIK_URL:-http://localhost}"
HUB="${HUB_HOST:-hub.lvh.me}"
NAME="hub$RANDOM"
JAR="$(mktemp)"
PY="${PYTHON:-python3}"   # PYTHON=python where python3 is not the interpreter (Windows)
pass() { printf '\033[0;32mPASS\033[0m: %s\n' "$1"; }
fail() { printf '\033[0;31mFAIL\033[0m: %s\n' "$1"; exit 1; }
api() { curl -sf -H "Authorization: Bearer $P9M_TOKEN" "$@"; }
hub() { curl -s -H "Host: $HUB" -b "$JAR" -c "$JAR" "$@"; }
cleanup() { api -X DELETE "$P9M_API/sandboxes/p9m-$NAME" >/dev/null 2>&1 || true; rm -f "$JAR"; }
trap cleanup EXIT

compose=$'services:\n  web:\n    image: hashicorp/http-echo:latest\n    command: ["-text=hub test"]\n    ports: ["5678:5678"]\n    labels:\n      p9m.publish: "true"\n      p9m.title: "Hub test"\n    restart: unless-stopped\n  other:\n    image: hashicorp/http-echo:latest\n    command: ["-text=other", "-listen=:5679"]\n    ports: ["5679:5679"]\n    restart: unless-stopped\n'
body=$("$PY" -c 'import json,sys;print(json.dumps({"name":sys.argv[1],"template":"empty","compose":sys.argv[2],"idle_timeout":"off"}))' "$NAME" "$compose")
api -X POST -H 'Content-Type: application/json' -d "$body" "$P9M_API/sandboxes" >/dev/null || fail "create p9m-$NAME"
pass "created p9m-$NAME"

hub -o /dev/null -H "Origin: http://$HUB" -d "username=${ADMIN_USER:?}&password=${ADMIN_PASSWORD:?}" "$TRAEFIK_URL/login"
for i in $(seq 1 30); do
  apps=$(hub "$TRAEFIK_URL/api/hub")
  echo "$apps" | grep -q '"title":"Hub test"' && break; sleep 2
done
echo "$apps" | grep -q '"title":"Hub test"' || fail "the published app is not on the Hub: $apps"
echo "$apps" | grep -q "other" && fail "the unpublished container is on the Hub"
pass "only the published app is listed"

id=$(echo "$apps" | "$PY" -c 'import json,sys;print([a["id"] for a in json.load(sys.stdin)["apps"] if a["title"]=="Hub test"][0])')
hub -X PUT -H "Origin: http://$HUB" "$TRAEFIK_URL/api/hub/apps/$id/vote" | grep -q '"votes":1' || fail "vote"
hub -X DELETE -H "Origin: http://$HUB" "$TRAEFIK_URL/api/hub/apps/$id/vote" | grep -q '"votes":0' || fail "take the vote back"
pass "vote and take it back"

key=$(api -X POST "$P9M_API/hub/feed-key" | "$PY" -c 'import json,sys;from urllib.parse import urlparse,parse_qs;print(parse_qs(urlparse(json.load(sys.stdin)["url"]).query)["key"][0])')
[ "$(hub -o /dev/null -w '%{http_code}' "$TRAEFIK_URL/feed.xml?key=$key")" = 200 ] || fail "feed with the key"
[ "$(hub -o /dev/null -w '%{http_code}' "$TRAEFIK_URL/feed.xml")" = 404 ] || fail "feed without the key"
pass "feed: 200 with the key, 404 without"

[ "$(hub -o /dev/null -w '%{http_code}' "$TRAEFIK_URL/sandboxes")" = 404 ] && pass "the sandbox API is not on the Hub host" || fail "/sandboxes reachable on the Hub host"
