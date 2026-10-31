#!/usr/bin/env bash
# Unit test for plugins/p9m/scripts/teleport-lib.sh (/p9m:teleport, the user's machine side): project names, Claude's
# projects folder names, the file list, the secret candidates and the current conversation.
# Usage: bash tests/teleport-lib.sh
set -euo pipefail
cd "$(dirname "$0")/.."
RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'
pass() { echo -e "${GREEN}PASS${RESET}: $*"; }
fail() { echo -e "${RED}FAIL${RESET}: $*"; exit 1; }
eq() { [ "$2" = "$3" ] && pass "$1" || fail "$1: expected [$3], got [$2]"; }

. plugins/p9m/scripts/teleport-lib.sh

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

eq "project name: lowercase, odd characters to -" "$(tp_project_name "/tmp/x/My Shop!")" "my-shop-"
eq "project name: dots and digits kept" "$(tp_project_name /tmp/x/api.v2)" "api.v2"
eq "claude key: a Linux path" "$(tp_claude_key /home/agent/workspace/shop)" "-home-agent-workspace-shop"
eq "claude key: a Windows path" "$(tp_claude_key 'C:\Users\Ann\My Shop')" "C--Users-Ann-My-Shop"

# A project with everything that matters
make_tree() {
  local d=$1
  mkdir -p "$d/b c" "$d/config" "$d/node_modules" "$d/.p9m"
  echo a > "$d/a.txt"; echo u > "$d/b c/ü.txt"; echo d > "$d/-dash.txt"
  echo s > "$d/.env"; echo s > "$d/.env.local"; echo e > "$d/.env.example"; echo s > "$d/config/.env"
  echo k > "$d/key.pem"; echo p > "$d/id_ed25519.pub"; echo n > "$d/node_modules/x.js"; echo t > "$d/.p9m/p9m.env"
  ln -s "b c" "$d/cur"
}
list() { tp_file_list "$1" | tr '\0' '\n'; }

g=$tmp/git; make_tree "$g"
printf 'node_modules/\n.env\n.env.local\n*.pem\n' > "$g/.gitignore"
( cd "$g" && git init -q && git add a.txt "b c" .gitignore cur && git add -f config/.env \
  && git -c user.email=t@t -c user.name=t commit -qm init && echo new > new.txt )

eq "secret candidates (tracked config/.env too; not .env.example, not .pub, not .p9m)" \
  "$(tp_secret_candidates "$g" | tr '\n' ' ')" ".env .env.local config/.env key.pem "
eq "git: the file list (uncommitted in, ignored and secrets and .p9m out, symlink as itself)" \
  "$(list "$g" | grep -v '^\.git/' | tr '\n' '|')" "-dash.txt|.env.example|.gitignore|a.txt|b c/ü.txt|cur|id_ed25519.pub|new.txt|"
eq "git: the repository itself (.git) goes along, for the way back" "$(list "$g" | grep -c '^\.git/HEAD$' || true)" "1"
rm "$g/a.txt"
eq "git: a file deleted in the working folder is not listed" "$(list "$g" | grep -c '^a.txt$' || true)" "0"

n=$tmp/plain; make_tree "$n"; mkdir -p "$n/.git" "$n/dist"; echo x > "$n/dist/app.js"
eq "no git: the built-in excludes" \
  "$(list "$n" | tr '\n' '|')" "-dash.txt|.env.example|a.txt|b c/ü.txt|cur|id_ed25519.pub|"

# The current conversation
ch=$tmp/claude; cwd=/home/ann/shop; pd=$ch/projects/$(tp_claude_key "$cwd"); mkdir -p "$pd"
echo '{}' > "$pd/older.jsonl"; touch -d '2026-10-30 10:00' "$pd/older.jsonl"
echo '{}' > "$pd/newer.jsonl"; touch -d '2026-10-31 10:00' "$pd/newer.jsonl"
eq "session: the newest" "$(CLAUDE_SESSION_ID= tp_current_session "$ch" "$cwd")" "newer"
eq "session: the one Claude Code names" "$(CLAUDE_SESSION_ID=older tp_current_session "$ch" "$cwd")" "older"
eq "session: a named one that is not there falls back to the newest" "$(CLAUDE_SESSION_ID=gone tp_current_session "$ch" "$cwd")" "newer"
if CLAUDE_SESSION_ID= tp_current_session "$ch" /home/ann/other >/dev/null 2>&1; then fail "no conversation must fail"; else pass "no conversation: exit non-zero"; fi
