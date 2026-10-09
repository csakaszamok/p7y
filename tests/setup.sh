#!/usr/bin/env bash
# Test for setup.sh: works in the current directory, from a checkout or piped from a release, and again.
# Usage: bash tests/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'
pass() { echo -e "${GREEN}PASS${RESET}: $*"; }
fail() { echo -e "${RED}FAIL${RESET}: $*"; exit 1; }
repo=$PWD
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# From a checkout: the script's own .env.example, into the current directory
repo_env=$(md5sum "$repo/.env" 2>/dev/null || true)
mkdir "$tmp/a" && cd "$tmp/a"
bash "$repo/setup.sh" >/dev/null
[ "$(md5sum "$repo/.env" 2>/dev/null || true)" = "$repo_env" ] || fail "touched the checkout's .env"
[ -f .env ] && pass "checkout: .env in the current directory" || fail "no .env"
for d in data opt/sandboxes opt/archive certs dynamic; do [ -d "$d" ] || fail "no $d/"; done; pass "directories created"
token=$(sed -n 's/^ADMIN_TOKEN=//p' .env)
[ ${#token} -eq 64 ] && pass "random ADMIN_TOKEN" || fail "ADMIN_TOKEN=$token"
echo HOST_DOMAIN=dev.example.com >> .env   # a value of the user's own
before=$(md5sum .env)
bash "$repo/setup.sh" >/dev/null
[ "$(md5sum .env)" = "$before" ] && pass "second run changes nothing" || fail "second run changed .env"

# Piped from a release: no script directory; env.example from the release (a file:// stand-in here)
mkdir -p "$tmp/rel/v9.9.9" && cp "$repo/.env.example" "$tmp/rel/v9.9.9/env.example"
# curl on Windows (Git Bash) needs a Windows path in a file:// URL
rel="file://$tmp/rel"; command -v cygpath >/dev/null && rel="file:///$(cygpath -m "$tmp/rel")"
mkdir "$tmp/b" && cd "$tmp/b"
sed 's/^P7Y_RELEASE=.*/P7Y_RELEASE=v9.9.9/' "$repo/setup.sh" | P7Y_RELEASE_BASE="$rel" bash >/dev/null
[ -f .env ] && grep -q '^SESSION_SECRET=' .env && pass "piped: .env from the release's env.example" || fail "piped setup"

# A release whose env.example cannot be fetched: a clear failure, no half .env
mkdir "$tmp/c" && cd "$tmp/c"
if sed 's/^P7Y_RELEASE=.*/P7Y_RELEASE=v0.0.0/' "$repo/setup.sh" | P7Y_RELEASE_BASE="$rel" bash >/dev/null 2>&1; then fail "missing env.example must fail"; fi
[ ! -f .env ] && pass "missing env.example: fails, no .env" || fail ".env left behind"

# The domain as an argument (as check-host.sh takes it): HOST_DOMAIN, and PUBLIC_URL while it is the example's
mkdir "$tmp/d" && cd "$tmp/d"
out=$(bash "$repo/setup.sh" dev.example.com)
grep -qx 'HOST_DOMAIN=dev.example.com' .env && pass "domain: HOST_DOMAIN set" || fail "HOST_DOMAIN: $(grep HOST_DOMAIN .env)"
grep -qx 'PUBLIC_URL=http://p7y.dev.example.com' .env && pass "domain: PUBLIC_URL from it (no certificate: http)" || fail "PUBLIC_URL: $(grep PUBLIC_URL .env)"
echo "$out" | grep -q 'HOST_DOMAIN is lvh.me' && fail "warned about lvh.me with a domain given" || pass "no lvh.me warning with a domain"
mkdir "$tmp/e" && cd "$tmp/e" && mkdir certs && touch certs/tls.crt certs/tls.key
bash "$repo/setup.sh" dev.example.com >/dev/null
grep -qx 'PUBLIC_URL=https://p7y.dev.example.com' .env && pass "domain + certificate: https" || fail "PUBLIC_URL: $(grep PUBLIC_URL .env)"
sed -i 's|^PUBLIC_URL=.*|PUBLIC_URL=https://purgatory.example.org|' .env
bash "$repo/setup.sh" other.example.com >/dev/null
grep -qx 'PUBLIC_URL=https://purgatory.example.org' .env && grep -qx 'HOST_DOMAIN=other.example.com' .env \
  && pass "a PUBLIC_URL of the user's own is kept" || fail "PUBLIC_URL: $(grep PUBLIC_URL .env)"
# Without a domain on a fresh directory: it says lvh.me only works on this machine
mkdir "$tmp/f" && cd "$tmp/f"
out=$(bash "$repo/setup.sh")
echo "$out" | grep -q 'HOST_DOMAIN is lvh.me' && pass "no domain: lvh.me warning" || fail "no lvh.me warning"

# .env holds the secrets: only its owner may read it (Linux; Git Bash on Windows has no Unix permissions)
if [ "$(uname -s)" = Linux ]; then
  mkdir "$tmp/g" && cd "$tmp/g" && bash "$repo/setup.sh" >/dev/null
  [ "$(stat -c %a .env)" = 600 ] && pass ".env readable by its owner only" || fail ".env mode $(stat -c %a .env)"
  chmod 644 .env && bash "$repo/setup.sh" >/dev/null
  [ "$(stat -c %a .env)" = 600 ] && pass "an existing .env is made private too" || fail ".env mode $(stat -c %a .env)"
fi
