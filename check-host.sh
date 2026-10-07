#!/usr/bin/env bash
# Checks whether this machine is ready for Purgatory, before the first `docker compose up`.
# Changes nothing on the host; the sysbox check runs one `docker run --rm alpine` (pulls alpine).
#
#   ./check-host.sh [domain]     # domain: the HOST_DOMAIN you plan to use, e.g. dev.example.com (UI: p7y.dev.example.com)
#
# Exit code 1 if any check failed (✘), 0 otherwise (warnings ⚠ allowed).
set -uo pipefail
cd "$(dirname "$0")" || exit 1

DOMAIN=${1:-}
fails=0 warns=0
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      → %s\n' "$2"; warns=$((warns + 1)); }
fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '      → %s\n' "$2"; fails=$((fails + 1)); }
section() { printf '\n\033[1m%s\033[0m\n' "$1"; }
has() { command -v "$1" >/dev/null 2>&1; }
# version_ge A B: A >= B (dotted versions)
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -1)" = "$2" ]; }

section "System"
if [ "$(uname -s)" != Linux ]; then
  fail "Not Linux ($(uname -s))" "Purgatory runs on a Linux host (Docker Desktop works for trying it, not for a server)"
else
  # shellcheck disable=SC1091
  os=$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || echo Linux)
  kernel=$(uname -r | cut -d- -f1)
  if version_ge "$kernel" 5.5; then ok "$os, kernel $kernel"
  else warn "$os, kernel $kernel" "sysbox needs kernel 5.5 or newer; without it sandboxes run privileged (dind)"; fi
fi
cpus=$(nproc 2>/dev/null || echo 0)
mem_gb=$(awk '/MemTotal/ {printf "%d", $2/1024/1024}' /proc/meminfo 2>/dev/null || echo 0)
# A sandbox is limited to 2 CPUs / 4 GB by default (SANDBOX_CPUS, SANDBOX_MEMORY); these are limits, not reservations
if [ "$cpus" -lt 4 ] || [ "$mem_gb" -lt 8 ]; then
  warn "$cpus CPUs, $mem_gb GB RAM" "little for more than a sandbox or two at the default limits (2 CPUs, 4 GB each)"
else
  ok "$cpus CPUs, $mem_gb GB RAM (about $((mem_gb / 4)) sandboxes using their full default 4 GB at once)"
fi

section "Docker"
docker_ok=false
if ! has docker; then
  fail "docker is not installed" "install Docker Engine: https://docs.docker.com/engine/install/"
elif ! docker info >/dev/null 2>&1; then
  fail "the Docker daemon is not reachable" "is it running? Run this as root or as a member of the docker group"
else
  docker_ok=true
  engine=$(docker version --format '{{.Server.Version}}' 2>/dev/null)
  if version_ge "$engine" 24; then ok "Docker Engine $engine"
  else warn "Docker Engine $engine" "Purgatory is tested on Docker 24 or newer"; fi
  if compose=$(docker compose version --short 2>/dev/null); then
    compose=${compose#v}
    if version_ge "$compose" 2.20; then ok "Docker Compose $compose"
    else warn "Docker Compose $compose" "Purgatory is tested on Compose 2.20 or newer"; fi
  else
    fail "the docker compose plugin is not installed" "install docker-compose-plugin (Compose v2)"
  fi
fi

if $docker_ok; then
  section "Sandbox runtime"
  runtimes=$(docker info --format '{{range $k, $v := .Runtimes}}{{$k}} {{end}}' 2>/dev/null)
  if [[ " $runtimes " != *" sysbox-runc "* ]]; then
    warn "sysbox is not installed: new sandboxes will use dind, which runs privileged (code with root in a sandbox can reach the host)" \
         "for a server shared by several people install sysbox: https://github.com/nestybox/sysbox"
  else
    inactive=""
    if has systemctl; then
      for s in sysbox-mgr sysbox-fs; do systemctl is-active --quiet "$s" || inactive="$inactive $s"; done
    fi
    if [ -n "$inactive" ]; then
      fail "sysbox is registered with Docker, but not running:$inactive" "systemctl start sysbox (and check: systemctl status sysbox)"
    elif out=$(timeout 120 docker run --rm --runtime=sysbox-runc alpine true 2>&1); then
      ok "sysbox works (new sandboxes use it: no privileged containers)"
    else
      fail "sysbox is installed, but a test container did not start" "$(echo "$out" | tail -1)"
    fi
  fi

  section "Networks"
  # Every sandbox (asleep ones too) keeps its own Docker network
  pools=$(docker info 2>/dev/null | awk '/Default Address Pools:/ {on=1; next} on && /Base:/ {print $2, $4; next} on {exit}' | tr -d ',')
  if [ -z "$pools" ]; then
    warn "Docker's default address pools: about 30 networks, so about 30 sandboxes" \
         'set "default-address-pools": [{"base": "10.10.0.0/16", "size": 28}] in /etc/docker/daemon.json and restart Docker (see the README)'
  else
    total=0
    while read -r base size; do
      prefix=${base#*/}
      [ "$size" -ge "$prefix" ] && total=$((total + (1 << (size - prefix))))
    done <<< "$pools"
    used=$(docker network ls -q | wc -l)
    if [ "$total" -lt 200 ]; then
      warn "address pools allow $total networks ($used in use)" "SANDBOX_MAX_TOTAL defaults to 200 sandboxes: use smaller subnets (e.g. size 28, see the README)"
    else
      ok "address pools allow $total networks ($used in use)"
    fi
  fi

  section "Disk"
  root=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null)
  free_gb=$(df -BG --output=avail "$root" 2>/dev/null | tail -1 | tr -dc 0-9)
  if [ -z "$free_gb" ]; then warn "could not read the free space of $root"
  elif [ "$free_gb" -lt 10 ]; then fail "$free_gb GB free for Docker ($root)" "sandbox images and volumes need at least 10 GB, more with every sandbox"
  elif [ "$free_gb" -lt 50 ]; then warn "$free_gb GB free for Docker ($root)" "enough to start; sandboxes are flagged above 20 GB each (SANDBOX_DISK)"
  else ok "$free_gb GB free for Docker ($root)"; fi
fi

section "Ports"
for port in 80 443 8081; do
  if has ss; then busy=$(ss -ltnH "sport = :$port" 2>/dev/null | head -1); else busy=""; fi
  if [ -z "$busy" ]; then ok "port $port is free"; continue; fi
  # Already used by Purgatory's own stack (a re-run after `docker compose up`) is fine
  owner=""
  if $docker_ok; then
    owner=$(docker ps --filter "publish=$port" --format '{{.Label "com.docker.compose.project"}}' | head -1)
  fi
  if [ -n "$owner" ] && [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$owner" --filter label=com.docker.compose.service=p7y)" ]; then
    ok "port $port is used by Purgatory (compose project $owner)"
  else
    fail "port $port is in use" "Purgatory's Traefik needs 80 and 443, its API 8081: $(echo "$busy" | grep -o 'users:.*' || echo 'see: ss -ltnp')"
  fi
done

section "Internet"
if ! has curl; then
  warn "curl is not installed: registry access not checked"
else
  # A registry answers 401 to an anonymous /v2/: reachable
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://registry-1.docker.io/v2/)
  if [ "$code" = 401 ] || [ "$code" = 200 ]; then ok "Docker Hub is reachable (sandbox, Traefik and Sablier images)"
  else fail "Docker Hub is not reachable (HTTP $code)" "the sandbox images come from there; check the proxy / firewall, or set a registry mirror"; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://ghcr.io/v2/)
  if [ "$code" = 401 ] || [ "$code" = 200 ]; then ok "ghcr.io is reachable (the Purgatory image)"
  else warn "ghcr.io is not reachable (HTTP $code)" "build the image here instead: docker compose up -d --build"; fi
fi

if [ -n "$DOMAIN" ]; then
  section "Domain: $DOMAIN"
  my_ips=" $(hostname -I 2>/dev/null) "
  resolve() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1; exit}'; }
  check_name() { # NAME WHAT FAIL|WARN
    local ip
    ip=$(resolve "$1")
    if [ -z "$ip" ]; then
      "$3" "$1 does not resolve" "add a DNS record: *.$DOMAIN (and $DOMAIN) → this machine's address${my_ips:+ (one of:$my_ips)}"
    elif [[ "$my_ips" != *" $ip "* ]] && [[ "$ip" != 127.* ]]; then
      "$3" "$1 → $ip, not this machine (its addresses:$my_ips)" "fine if a proxy or NAT in front forwards to it; otherwise fix the DNS record"
    else
      ok "$1 → $ip ($2)"
    fi
  }
  check_name "p7y.$DOMAIN" "the UI" fail
  # A made-up name: only a wildcard record resolves it (every sandbox app has its own name)
  check_name "check-$RANDOM-web.$DOMAIN" "wildcard record for sandbox apps" warn

  if [ -f certs/tls.crt ] || [ -f certs/tls.key ]; then
    section "Certificate (certs/)"
    if ! has openssl; then
      warn "openssl is not installed: certificate not checked"
    elif [ ! -f certs/tls.crt ] || [ ! -f certs/tls.key ]; then
      fail "only one of certs/tls.crt and certs/tls.key is there" "both are needed (PEM)"
    elif ! openssl x509 -in certs/tls.crt -noout 2>/dev/null; then
      fail "certs/tls.crt is not a PEM certificate"
    else
      if [ "$(openssl x509 -in certs/tls.crt -noout -pubkey 2>/dev/null)" != "$(openssl pkey -in certs/tls.key -pubout 2>/dev/null)" ]; then
        fail "certs/tls.key does not belong to certs/tls.crt" "or the key is encrypted: it must be unencrypted PEM"
      else
        ok "the key matches the certificate"
      fi
      end=$(openssl x509 -in certs/tls.crt -noout -enddate | cut -d= -f2)
      if ! openssl x509 -in certs/tls.crt -noout -checkend 0 >/dev/null; then fail "the certificate expired ($end)"
      elif ! openssl x509 -in certs/tls.crt -noout -checkend $((30 * 86400)) >/dev/null; then warn "the certificate expires within 30 days ($end)"
      else ok "valid until $end"; fi
      if openssl x509 -in certs/tls.crt -noout -ext subjectAltName 2>/dev/null | grep -qF "DNS:*.$DOMAIN"; then
        ok "covers *.$DOMAIN"
      else
        warn "does not cover *.$DOMAIN" "sandbox addresses (and p7y.$DOMAIN) would get a certificate warning"
      fi
    fi
  fi
else
  section "Domain"
  warn "no domain given: DNS not checked" "run again with the domain you plan to use: ./check-host.sh dev.example.com"
fi

echo
if [ "$fails" -gt 0 ]; then
  printf '\033[31m%d problem(s)\033[0m and %d warning(s): fix the ✘ lines before installing.\n' "$fails" "$warns"
  exit 1
fi
if [ "$warns" -gt 0 ]; then printf 'Ready, with %d warning(s). Next: ./setup.sh\n' "$warns"
else echo "Ready. Next: ./setup.sh"; fi
