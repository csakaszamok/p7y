#!/usr/bin/env bash
# Prepares the current directory for a first start: creates .env (from the release's env.example) if there
# is none, replaces the example secrets with random ones and creates the data directories. Safe to run
# again: values you already set are kept.
#
#   curl -fsSL https://github.com/csakaszamok/p7y/releases/latest/download/setup.sh | bash -s -- dev.example.com
#
# The domain (optional) becomes HOST_DOMAIN: every address is under it (the UI is p7y.<domain>).
set -euo pipefail

# Set in the release asset (e.g. v0.5.0); empty in a checkout, which uses its own .env.example
P7Y_RELEASE=
P7Y_RELEASE_BASE=${P7Y_RELEASE_BASE:-https://github.com/csakaszamok/p7y/releases/download}

command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "the docker compose plugin is not installed" >&2; exit 1; }

if [ ! -f .env ]; then
  if [ -n "$P7Y_RELEASE" ]; then
    curl -fsSL "$P7Y_RELEASE_BASE/$P7Y_RELEASE/env.example" -o .env.tmp       || { rm -f .env.tmp; echo "could not download env.example of $P7Y_RELEASE" >&2; exit 1; }
    mv .env.tmp .env
  else
    cp "$(dirname "$0")/.env.example" .env
  fi
  echo "Created .env"
fi

mkdir -p data opt/sandboxes opt/archive certs dynamic

# random BYTES: that many random bytes as hex
random() { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }

# get KEY: the value of KEY in .env (empty if missing)
get() { sed -n "s/^$1=//p" .env | tail -1; }

# set KEY VALUE: replace KEY's line in .env, or append it
set_value() {
  if grep -q "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

generated=()
fill_secret() { # KEY BYTES placeholder...: set KEY to a random value if it is empty or a placeholder
  local key=$1 bytes=$2; shift 2
  local current
  current=$(get "$key")
  for placeholder in "" "$@"; do
    if [ "$current" = "$placeholder" ]; then
      set_value "$key" "$(random "$bytes")"
      generated+=("$key")
      return
    fi
  done
}

fill_secret ADMIN_TOKEN 32 change-me-to-a-strong-secret abc123
fill_secret SESSION_SECRET 32 change-me-to-a-long-random-string
fill_secret ADMIN_PASSWORD 12 change-me

if [ "$(get HOST_ADDRESS)" = "192.168.1.100" ]; then
  address=$(hostname -I 2>/dev/null | awk '{print $1}' || true)  # no -I (macOS, busybox): localhost
  set_value HOST_ADDRESS "${address:-localhost}"
fi

if [ ${#generated[@]} -gt 0 ]; then
  echo "Generated in .env: ${generated[*]}"
fi

domain=${1:-}
if [ -n "$domain" ]; then
  previous=$(get HOST_DOMAIN)
  set_value HOST_DOMAIN "$domain"
  # PUBLIC_URL follows while it is the example's or the one made from the previous domain; one of your own stays
  case "$(get PUBLIC_URL)" in
    ""|http://p7y.lvh.me|https://p7y.lvh.me|"http://p7y.$previous"|"https://p7y.$previous")
      if [ -f certs/tls.crt ] && [ -f certs/tls.key ]; then scheme=https; else scheme=http; fi
      set_value PUBLIC_URL "$scheme://p7y.$domain" ;;
  esac
fi

public_url=$(get PUBLIC_URL)
cat <<EOF

Next:
  docker compose up -d

Then sign in at ${public_url:-http://p7y.lvh.me}
  user:     $(get ADMIN_USER)
  password: $(get ADMIN_PASSWORD)
API token (Authorization: Bearer ...): $(get ADMIN_TOKEN)
EOF

case "$(get HOST_DOMAIN)" in
  ""|lvh.me) cat <<'EOF'

Note: HOST_DOMAIN is lvh.me, which points to this machine (127.0.0.1): fine for
trying Purgatory here, not for a server. Run setup.sh again with your domain
(e.g. `bash setup.sh dev.example.com`); it needs a wildcard DNS record *.<domain>.
EOF
  ;;
esac

if ! grep -qs default-address-pools /etc/docker/daemon.json; then
  cat <<'EOF'

Note: /etc/docker/daemon.json has no default-address-pools. Docker's default
pools allow about 30 networks, and every sandbox needs one. See "Give the Docker
daemon a larger address pool" in https://csakaszamok.github.io/p7y/latest/install/
EOF
fi
