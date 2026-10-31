#!/usr/bin/env bash
# /p9m:teleport on the user's machine: moves this project (run in its root, where .p9m is) into a claude container in
# its own sandbox, through the sandbox's Docker. Purgatorium's API is used only to wake the sandbox.
#
#   teleport.sh --plan [--ecc]                                    what would move, as tab-separated lines:
#       project NAME | files COUNT BYTES | secret PATH | session ID ISO-TIME | setting WHAT | exists yes|no | large yes|no
#   teleport.sh --run [--ecc] [--replace] [--secret PATH]...      moves it; the last line: resume ID FOLDER
#
# Exit 2 with `error<TAB>message` when it cannot; 3 when the project is in the sandbox already and --replace is not
# given. Never prints the token or a secret: secrets go only when named with --secret.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
. "$here/teleport-lib.sh"

err() { printf 'error\t%s\n' "$1"; exit 2; }

mode= image=ghcr.io/csakaszamok/p9m-claude-code-minimal:latest replace= secrets=()
while [ $# -gt 0 ]; do
  case $1 in
    --plan|--run) mode=${1#--} ;;
    --ecc) image=ghcr.io/csakaszamok/p9m-claude-code-ecc:latest ;;
    --replace) replace=--replace ;;
    --secret) secrets+=("$2"); shift ;;
    *) err "unknown argument: $1" ;;
  esac
  shift
done
[ -n "$mode" ] || err "usage: teleport.sh --plan|--run [--ecc] [--replace] [--secret PATH]..."

[ -f .p9m/p9m.env ] || err "run /p9m:init first"
P9M_URL= P9M_TOKEN= P9M_SANDBOX=
. ./.p9m/p9m.env
[ -n "$P9M_URL" ] && [ -n "$P9M_TOKEN" ] && [ -n "$P9M_SANDBOX" ] || err "run /p9m:init first"
ctx=$P9M_SANDBOX

# The API, the token on stdin (never in the arguments, which other processes can see)
api() { printf 'Authorization: Bearer %s\n' "$P9M_TOKEN" | curl -sf "$@" -H @- 2>/dev/null; }
status() { api "$P9M_URL/sandboxes/$ctx" | grep -o '"status":"[a-z_]*"' | head -n 1 | cut -d'"' -f4; }

# Connecting to its Docker does not wake a sleeping sandbox: wake it first
if [ "$(status || true)" != running ]; then
  api -X POST "$P9M_URL/sandboxes/$ctx/start" >/dev/null || true
  deadline=$((SECONDS + ${TELEPORT_WAKE_TIMEOUT:-60}))
  until [ "$(status || true)" = running ]; do
    [ $SECONDS -lt $deadline ] || err "the sandbox did not wake up in time: try again"
    sleep 2
  done
fi
docker --context "$ctx" compose ls >/dev/null 2>&1 || err "turn Docker access on: Access → Enable in the sandbox panel"

project=$(tp_project_name "$PWD")
claude_home=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
has_claude=$(docker --context "$ctx" ps -q --filter 'name=^claude$' 2>/dev/null || true)
exists=no
if [ -n "$has_claude" ] && docker --context "$ctx" exec claude test -e "/home/agent/workspace/$project" >/dev/null 2>&1; then exists=yes; fi
session=$(tp_current_session "$claude_home" "$PWD" || true)
session_file=$claude_home/projects/$(tp_claude_key "$PWD")/$session.jsonl

if [ "$mode" = plan ]; then
  count=0 bytes=0
  while IFS= read -r -d '' f; do
    count=$((count + 1))
    [ -L "$f" ] || bytes=$((bytes + $(wc -c < "$f")))
  done < <(tp_file_list .)
  printf 'project\t%s\n' "$project"
  printf 'files\t%s\t%s\n' "$count" "$bytes"
  tp_secret_candidates . | while IFS= read -r s; do printf 'secret\t%s\n' "$s"; done
  if [ -n "$session" ]; then
    printf 'session\t%s\t%s\n' "$session" "$(date -u -r "$session_file" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || true)"
  fi
  [ -f "$claude_home/CLAUDE.md" ] && printf 'setting\tCLAUDE.md\n'
  [ -n "$(ls -A "$claude_home/skills" 2>/dev/null)" ] && printf 'setting\tskills\n'
  if [ -f "$claude_home/settings.json" ]; then
    grep -q '"permissions"' "$claude_home/settings.json" && printf 'setting\tpermissions\n'
    n=$(grep -o '"[^"]*@[^"]*" *: *true' "$claude_home/settings.json" | wc -l | tr -d ' ')
    [ "$n" -gt 0 ] && printf 'setting\tplugins:%s\n' "$n"
  fi
  printf 'exists\t%s\n' "$exists"
  [ "$bytes" -gt 524288000 ] && printf 'large\tyes\n' || printf 'large\tno\n'
  exit 0
fi

# --run: only confirmed secrets, and only real candidates
candidates=$(tp_secret_candidates .)
for s in ${secrets[@]+"${secrets[@]}"}; do
  grep -qxF -- "$s" <<<"$candidates" || err "not a secret file of this project: $s"
done
if [ "$exists" = yes ] && [ -z "$replace" ]; then printf 'exists\t/home/agent/workspace/%s\n' "$project"; exit 3; fi

if [ -z "$has_claude" ]; then
  out=$(TELEPORT_IMAGE=$image docker --context "$ctx" compose -p claude -f "$here/teleport-compose.yaml" up -d 2>&1) \
    || err "the claude container did not start: $(printf '%s\n' "$out" | tail -n 1)"
fi

# Stage everything locally, then one archive into the container
st=$(mktemp -d)
remote=/tmp/teleport-$RANDOM$RANDOM
cleanup() { rm -rf "$st"; docker --context "$ctx" exec claude rm -rf "$remote" >/dev/null 2>&1 || true; }
trap cleanup EXIT
stage=$st/stage
mkdir -p "$stage/files" "$stage/user"
tp_file_list . | tar -c --null -T - -f - | tar -x -C "$stage/files" -f -
for s in ${secrets[@]+"${secrets[@]}"}; do
  mkdir -p "$stage/secrets/$(dirname "$s")"
  cp -p "$s" "$stage/secrets/$s"
done
if [ -n "$session" ] && [ -f "$session_file" ]; then
  cp "$session_file" "$stage/session.jsonl"
  printf '%s\n' "$session" > "$stage/session.id"
  : > "$stage/subdir"
fi
[ -f "$claude_home/CLAUDE.md" ] && cp "$claude_home/CLAUDE.md" "$stage/user/"
[ -d "$claude_home/skills" ] && cp -R "$claude_home/skills" "$stage/user/"
[ -f "$claude_home/settings.json" ] && cp "$claude_home/settings.json" "$stage/user/"
[ -f "$claude_home/plugins/known_marketplaces.json" ] && cp "$claude_home/plugins/known_marketplaces.json" "$stage/user/"
tar -C "$st" -czf "$st/stage.tgz" stage

docker --context "$ctx" exec claude mkdir -p "$remote"
docker --context "$ctx" cp "$st/stage.tgz" "claude:$remote/stage.tgz"
docker --context "$ctx" cp "$here/teleport-in.sh" "claude:$remote/teleport-in.sh"
docker --context "$ctx" cp "$here/teleport-lib.sh" "claude:$remote/teleport-lib.sh"
docker --context "$ctx" exec claude tar -xzf "$remote/stage.tgz" -C "$remote"
docker --context "$ctx" exec -u agent claude bash "$remote/teleport-in.sh" "$remote/stage" "$project" $replace
