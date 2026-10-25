#!/usr/bin/env bash
# Release guard: the files of tag vX.Y.Z name version X.Y.Z, so the attached docker-compose.yml runs the image
# just built (both image defaults: p9m and p9m-init) and the topbar shows it.
#   scripts/check-release-version.sh v0.5.0
set -euo pipefail
cd "$(dirname "$0")/.."
v=${1#v}
n=$(grep -cF "ghcr.io/csakaszamok/p9m:\${P9M_VERSION:-$v}" docker-compose.yml || true)
[ "$n" = 2 ] || { echo "docker-compose.yml: $n of its 2 image defaults name $v" >&2; exit 1; }
grep -q "^  \"version\": \"$v\"," package.json || { echo "package.json is not version $v" >&2; exit 1; }
grep -q "^  \"version\": \"$v\"," server.json || { echo "server.json (MCP Registry) is not version $v" >&2; exit 1; }
grep -q "^  \"version\": \"$v\"," plugins/p9m/.claude-plugin/plugin.json || { echo "plugins/p9m/.claude-plugin/plugin.json (Claude Code plugin) is not version $v" >&2; exit 1; }
echo "version $v: docker-compose.yml, package.json, server.json and the Claude Code plugin agree"
