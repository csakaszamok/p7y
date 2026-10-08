#!/usr/bin/env bash
# Prepares .env for a first start: copies .env.example if there is no .env yet,
# and replaces the example secrets with random ones. Safe to run again: values
# you already set are kept.
set -euo pipefail
cd "$(dirname "$0")"

command -v docker >/dev/null || { echo "docker is not installed" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "the docker compose plugin is not installed" >&2; exit 1; }

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

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
  address=$(hostname -I 2>/dev/null | awk '{print $1}')
  set_value HOST_ADDRESS "${address:-localhost}"
fi

if [ ${#generated[@]} -gt 0 ]; then
  echo "Generated in .env: ${generated[*]}"
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

if ! grep -qs default-address-pools /etc/docker/daemon.json; then
  cat <<'EOF'

Note: /etc/docker/daemon.json has no default-address-pools. Docker's default
pools allow about 30 networks, and every sandbox needs one. See "Give the Docker
daemon a larger address pool" in https://csakaszamok.github.io/p7y/latest/install/
EOF
fi
