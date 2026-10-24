#!/bin/sh
# Runs the soak test (soak.mjs) in a throwaway Node container, so the server needs only Docker. Run it in the
# directory with Purgatory's .env: SESSION_SECRET comes from there, P7Y_URL from its PUBLIC_URL, USER_DOMAIN
# from its OIDC_ALLOWED_DOMAINS. A certificate from an internal CA needs INSECURE=1 (the container does not trust it).
#
#   sh soak.sh [USERS] [SANDBOXES] [MINUTES]        e.g. sh soak.sh 10 3 30
#
# The other settings as environment variables (see soak.mjs): RATE, SLEEP_EVERY, CPUS, MEMORY, USER_DOMAIN,
# MAX_ERRORS, KEEP, INSECURE, P7Y_URL. soak.mjs is taken from next to this script, else downloaded (SOAK_REF:
# the branch or tag, release/0.11).
set -eu
USERS=${1:-${USERS:-10}}
SANDBOXES=${2:-${SANDBOXES:-2}}
MINUTES=${3:-${MINUTES:-15}}
export USERS SANDBOXES MINUTES

env_value() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -1 | tr -d '\r"' || true; }
SESSION_SECRET=${SESSION_SECRET:-$(env_value SESSION_SECRET)}
P7Y_URL=${P7Y_URL:-$(env_value PUBLIC_URL)}
[ -n "$SESSION_SECRET" ] || { echo "no SESSION_SECRET: run it next to Purgatory's .env, or set it" >&2; exit 2; }
[ -n "$P7Y_URL" ] || { echo "no PUBLIC_URL in .env: set P7Y_URL=https://p7y.<domain>" >&2; exit 2; }
export SESSION_SECRET P7Y_URL
# The test users' e-mails must pass OIDC_ALLOWED_DOMAINS: its first domain, unless USER_DOMAIN is set
USER_DOMAIN=${USER_DOMAIN:-$(env_value OIDC_ALLOWED_DOMAINS | cut -d, -f1 | tr -d ' ')}
[ -n "$USER_DOMAIN" ] && export USER_DOMAIN || unset USER_DOMAIN

script=$(dirname "$0")/soak.mjs
if [ ! -f "$script" ]; then
  script=$(mktemp)
  trap 'rm -f "$script"' EXIT
  curl -fsSL "https://raw.githubusercontent.com/p7y-dev/p7y/${SOAK_REF:-release/0.11}/tests/load/soak.mjs" -o "$script"
fi

# -t only with a terminal (Ctrl+C reaches the test, which then archives its sandboxes); not from cron or a pipe
tty=""; [ -t 0 ] && tty="-t"
docker run --rm -i $tty --network host --init -v "$(cd "$(dirname "$script")" && pwd)/$(basename "$script"):/soak.mjs:ro" \
  -e SESSION_SECRET -e P7Y_URL -e USERS -e SANDBOXES -e MINUTES \
  -e RATE -e SLEEP_EVERY -e CPUS -e MEMORY -e USER_DOMAIN -e MAX_ERRORS -e KEEP -e INSECURE \
  node:22.23.4-alpine node /soak.mjs
