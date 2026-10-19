#!/usr/bin/env bash
# Integration test: app access (p7y.access). Run the stack with ADMIN_USER/ADMIN_PASSWORD set, on lvh.me (or set
# DOMAIN to a domain whose names reach this machine). Creates a sandbox with three whoami apps — public, domain,
# owner —, then checks what an anonymous visitor and the signed-in admin get, that the app never sees Purgatory's
# app cookie, and that a client-sent X-P7y-User is removed. Archives the sandbox at the end.
# Usage: P7Y_TOKEN=<ADMIN_TOKEN> ADMIN_USER=admin ADMIN_PASSWORD=… bash tests/access.sh
set -euo pipefail
P7Y_API="${P7Y_API:-http://localhost:8081}"
P7Y_TOKEN="${P7Y_TOKEN:?set P7Y_TOKEN}"
DOMAIN="${DOMAIN:-lvh.me}"
UI="https://p7y.$DOMAIN"
NAME="acc$RANDOM"
JAR="$(mktemp)"
PY="${PYTHON:-python3}"   # PYTHON=python where python3 is not the interpreter (Windows)
pass() { printf '\033[0;32mPASS\033[0m: %s\n' "$1"; }
fail() { printf '\033[0;31mFAIL\033[0m: %s\n' "$1"; exit 1; }
api() { curl -sf -H "Authorization: Bearer $P7Y_TOKEN" "$@"; }
web() { curl -sk -b "$JAR" -c "$JAR" "$@"; }
cleanup() { api -X DELETE "$P7Y_API/sandboxes/p7y-$NAME" >/dev/null 2>&1 || true; rm -f "$JAR"; }
trap cleanup EXIT

svc() { printf '  %s:\n    image: traefik/whoami:latest\n    ports: ["%s:80"]\n    labels:\n      frpc.subdomain: %s\n      p7y.access: %s\n    restart: unless-stopped\n' "$1" "$2" "$1" "$3"; }
compose="services:
$(svc pub 8081 public)
$(svc dom 8082 domain)
$(svc own 8083 owner)"
body=$("$PY" -c 'import json,sys;print(json.dumps({"name":sys.argv[1],"template":"empty","compose":sys.argv[2],"idle_timeout":"off"}))' "$NAME" "$compose")
api -X POST -H 'Content-Type: application/json' -d "$body" "$P7Y_API/sandboxes" >/dev/null || fail "create p7y-$NAME"
pass "created p7y-$NAME"
PUB="https://$NAME-pub.$DOMAIN"; DOM="https://$NAME-dom.$DOMAIN"; OWN="https://$NAME-own.$DOMAIN"

# Purgatory learns the levels from the labels (every 10 s), Traefik reads the middlewares (every 2 s)
for i in $(seq 1 40); do
  levels=$(api "$P7Y_API/sandboxes/p7y-$NAME" | "$PY" -c 'import json,sys;print(" ".join(sorted(a.get("access","?") for a in json.load(sys.stdin)["apps"])))' 2>/dev/null || true)
  [ "$levels" = "domain owner public" ] && break; sleep 2
done
[ "$levels" = "domain owner public" ] || fail "the apps' access levels: '$levels'"
pass "the API lists the three levels"
for i in $(seq 1 30); do
  [ "$(curl -sk -o /dev/null -w '%{http_code}' "$OWN/")" = 302 ] && break; sleep 2
done

code() { curl -sk -o /dev/null -w '%{http_code}' "$@"; }
[ "$(code "$PUB/")" = 200 ] || fail "anonymous: the public app does not open"
for app in "$DOM" "$OWN"; do
  loc=$(curl -sk -o /dev/null -w '%{redirect_url}' "$app/x?y=1")
  case "$loc" in "$UI/auth/app/start?rd="*) ;; *) fail "anonymous $app: not sent to Purgatory's sign-in ($loc)";; esac
done
pass "anonymous: public opens, domain and owner go to Purgatory's sign-in"

web -o /dev/null -H "Origin: $UI" -d "username=${ADMIN_USER:?}&password=${ADMIN_PASSWORD:?}" "$UI/login"
start=$(curl -sk -o /dev/null -w '%{redirect_url}' "$OWN/x?y=1")
landing=$(web -o /dev/null -w '%{redirect_url}' "$start")
case "$landing" in "$OWN/__p7y/auth?ticket="*) ;; *) fail "signed in: no ticket for the app ($landing)";; esac
back=$(web -o /dev/null -w '%{redirect_url}' "$landing")
[ "$back" = "$OWN/x?y=1" ] || fail "the ticket does not lead back to the page ($back)"
grep -q "__p7y_app" "$JAR" || fail "no app cookie"
pass "the admin signs in once and gets the owner app's cookie"

seen=$(web -H "Cookie: theirs=1" "$OWN/")
echo "$seen" | grep -qi "^X-P7y-User: admin" || fail "the app does not see who is viewing: $seen"
echo "$seen" | grep -i "^Cookie:" | grep -q "__p7y_app" && fail "the app sees Purgatory's app cookie"
pass "the app sees X-P7y-User and not the app cookie"

[ "$(web -o /dev/null -w '%{http_code}' "$DOM/")" = 302 ] || fail "the owner app's cookie opens another app"
pass "the cookie is for its own app only"

spoof=$(curl -sk -H "X-P7y-User: someone@evil.example" "$PUB/")
echo "$spoof" | grep -qi "someone@evil.example" && fail "a client-sent X-P7y-User reaches the app"
pass "a client-sent X-P7y-User is removed"
