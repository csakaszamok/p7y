#!/usr/bin/env bash
# Unit test for plugins/p9m/scripts/teleport.sh (/p9m:teleport on the user's machine): its prerequisites, waking the
# sandbox, the plan, and the docker calls of a run, with a fake docker and curl that record their arguments.
# Usage: bash tests/teleport.sh
set -euo pipefail
cd "$(dirname "$0")/.."
RED='\033[0;31m'; GREEN='\033[0;32m'; RESET='\033[0m'
pass() { echo -e "${GREEN}PASS${RESET}: $*"; }
fail() { echo -e "${RED}FAIL${RESET}: $*"; exit 1; }
eq() { [ "$2" = "$3" ] && pass "$1" || fail "$1: expected [$3], got [$2]"; }
has() { grep -qF -- "$2" <<<"$1" && pass "$3" || fail "$3: [$2] not in: $1"; }

. plugins/p9m/scripts/teleport-lib.sh
script=$PWD/plugins/p9m/scripts/teleport.sh
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
TOKEN=p9m_secret_token_123

# Fakes: every call appended to $FAKE/log (one line per call, arguments joined by |)
FAKE=$tmp/fake; mkdir -p "$FAKE/bin" "$FAKE/copied"; export FAKE
cat > "$FAKE/bin/docker" <<'SH'
#!/usr/bin/env bash
printf '%s|' docker "$@" >> "$FAKE/log"; echo >> "$FAKE/log"
args=" $* "
case $args in
  *" compose ls "*) [ -f "$FAKE/ctx-fail" ] && exit 1; exit 0 ;;
  *" ps -q --filter name=^claude\$ "*) [ -f "$FAKE/has-claude" ] && echo abc; exit 0 ;;
  *" compose -p claude "*" up -d "*) if [ -f "$FAKE/compose-fail" ]; then echo 'Error: pull access denied' >&2; exit 1; fi; touch "$FAKE/has-claude"; exit 0 ;;
  *" exec claude test -e "*) [ -f "$FAKE/exists" ]; exit ;;
  *" cp "*) for a in "$@"; do case $a in claude:*) ;; *.tgz) cp "$a" "$FAKE/copied/";; esac; done; exit 0 ;;
  *"teleport-in.sh"*) printf 'resume\tabc\t/home/agent/workspace/shop\n'; exit 0 ;;
esac
exit 0
SH
cat > "$FAKE/bin/curl" <<'SH'
#!/usr/bin/env bash
printf '%s|' curl "$@" >> "$FAKE/log"; echo >> "$FAKE/log"
cat > "$FAKE/curl-stdin"
case " $* " in
  *" -X POST "*) touch "$FAKE/started"; echo '{}' ;;
  *) if [ -f "$FAKE/started" ] && [ ! -f "$FAKE/never-wakes" ]; then echo '{"name":"p9m-shop","status":"running"}'
     elif [ -f "$FAKE/asleep" ]; then echo '{"name":"p9m-shop","status":"exited"}'
     else echo '{"name":"p9m-shop","status":"running"}'; fi ;;
esac
SH
chmod +x "$FAKE/bin/"*
export PATH="$FAKE/bin:$PATH"
reset() { rm -f "$FAKE"/log "$FAKE"/{ctx-fail,has-claude,compose-fail,exists,started,asleep,never-wakes}; rm -rf "$FAKE/copied"/*; }

# The project (as in tests/teleport-lib.sh), tied to p9m-shop, with a conversation
proj=$tmp/shop; mkdir -p "$proj/b c" "$proj/config" "$proj/node_modules"
echo a > "$proj/a.txt"; echo u > "$proj/b c/ü.txt"; echo s > "$proj/.env"; echo s > "$proj/.env.local"
echo s > "$proj/config/.env"; echo k > "$proj/key.pem"; echo e > "$proj/.env.example"; echo n > "$proj/node_modules/x.js"
export HOME=$tmp/home; mkdir -p "$HOME/.claude/projects/$(tp_claude_key "$proj")"
echo '{"m":1}' > "$HOME/.claude/projects/$(tp_claude_key "$proj")/sess1.jsonl"
echo '# me' > "$HOME/.claude/CLAUDE.md"
tp() { (cd "$proj" && bash "$script" "$@"); }

reset
set +e; out=$(tp --plan); code=$?; set -e
eq "no .p9m: exit 2" "$code" 2
eq "no .p9m: says what to do" "$out" $'error\trun /p9m:init first'

mkdir -p "$proj/.p9m"; printf 'P9M_URL=http://p9m.test\nP9M_TOKEN=%s\nP9M_SANDBOX=p9m-shop\n' "$TOKEN" > "$proj/.p9m/p9m.env"

reset; touch "$FAKE/ctx-fail"
set +e; out=$(tp --plan); code=$?; set -e
eq "Docker access off: exit 2" "$code" 2
eq "Docker access off: says what to do" "$out" $'error\tturn Docker access on: Access → Enable in the sandbox panel'

reset; touch "$FAKE/asleep"
tp --plan >/dev/null
start=$(grep '/sandboxes/p9m-shop/start|' "$FAKE/log" || true)
has "$start" "|-X|POST|" "asleep: woken through the API (POST …/start)"
has "$start" "|-H|@-|" "asleep: the token's header read from stdin"
has "$(cat "$FAKE/curl-stdin")" "Authorization: Bearer $TOKEN" "the token goes to curl on stdin"

reset; touch "$FAKE/asleep" "$FAKE/never-wakes"
set +e; out=$(TELEPORT_WAKE_TIMEOUT=2 tp --plan); code=$?; set -e
eq "never wakes: exit 2" "$code" 2
has "$out" $'error\tthe sandbox did not wake up' "never wakes: says so"

reset
out=$(tp --plan)
has "$out" $'project\tshop' "plan: the project's name"
has "$out" $'files\t3\t' "plan: the number of files (a.txt, b c/ü.txt, .env.example; no git: node_modules left out)"
eq "plan: the secret candidates" "$(grep $'^secret\t' <<<"$out" | cut -f2 | tr '\n' ' ')" ".env .env.local config/.env key.pem "
has "$out" $'session\tsess1\t' "plan: the conversation"
has "$out" $'setting\tCLAUDE.md' "plan: the global CLAUDE.md"
has "$out" $'exists\tno' "plan: not in the sandbox yet"
has "$out" $'large\tno' "plan: not large"

reset
out=$(tp --run --secret .env)
log=$(cat "$FAKE/log")
up=$(grep -n 'compose|-p|claude|' <<<"$log" | head -1 | cut -d: -f1)
cpl=$(grep -n '|cp|' <<<"$log" | grep 'stage.tgz' | head -1 | cut -d: -f1)
ex=$(grep -n 'exec|-u|agent|claude|bash|/tmp/teleport-' <<<"$log" | head -1 | cut -d: -f1)
[ -n "$up" ] && [ -n "$cpl" ] && [ -n "$ex" ] && [ "$up" -lt "$cpl" ] && [ "$cpl" -lt "$ex" ] && pass "run: compose up, then cp, then teleport-in.sh" || fail "run order: $log"
has "$(sed -n "${ex}p" <<<"$log")" "/stage|shop|" "run: teleport-in.sh gets the stage and the project"
listing=$(tar -tzf "$FAKE"/copied/stage.tgz)
has "$listing" "stage/secrets/.env" "run: the confirmed secret is staged"
grep -q 'stage/secrets/.env.local\|stage/secrets/key.pem\|stage/files/.env$\|stage/files/key.pem' <<<"$listing" && fail "an unconfirmed secret was staged" || pass "run: unconfirmed secrets stay home"
mkdir -p "$tmp/unpacked" && tar -xzf "$FAKE"/copied/stage.tgz -C "$tmp/unpacked"
[ "$(cat "$tmp/unpacked/stage/files/b c/ü.txt")" = u ] && pass "run: a path with a space and an accent" || fail "space/accent path"
has "$listing" "stage/session.jsonl" "run: the conversation"
eq "run: the resume line comes last" "$(tail -n 1 <<<"$out")" $'resume\tabc\t/home/agent/workspace/shop'

reset; touch "$FAKE/has-claude"
tp --run >/dev/null
grep -q 'compose|-p|claude|' "$FAKE/log" && fail "a claude container there already must not be deployed again" || pass "run: an existing claude container is reused"

reset; touch "$FAKE/has-claude" "$FAKE/exists"
set +e; out=$(tp --run); code=$?; set -e
eq "run: the project there already, no --replace: exit 3" "$code" 3
grep -q '|cp|' "$FAKE/log" && fail "nothing may be copied before --replace" || pass "run: nothing copied without --replace"

reset; touch "$FAKE/compose-fail"
set +e; out=$(tp --run); code=$?; set -e
eq "the claude container does not start: exit 2" "$code" 2
eq "the claude container does not start: why" "$out" $'error\tthe claude container did not start: Error: pull access denied'
grep -q '|cp|' "$FAKE/log" && fail "nothing may be copied when the container did not start" || pass "nothing copied when the container did not start"

set +e; out=$(tp --run --secret a.txt); code=$?; set -e
eq "a --secret that is not a candidate is refused" "$code" 2

reset; tp --plan >/dev/null; tp --run --secret .env >/dev/null
grep -qF "$TOKEN" "$FAKE/log" && fail "the token appeared in an argument" || pass "the token is in no argument"
