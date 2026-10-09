#!/usr/bin/env bash
# Release guard: the files of tag vX.Y.Z name version X.Y.Z, so the attached docker-compose.yml runs the image
# just built (both image defaults: p7y and p7y-init) and the topbar shows it.
#   scripts/check-release-version.sh v0.5.0
set -euo pipefail
cd "$(dirname "$0")/.."
v=${1#v}
n=$(grep -cF "ghcr.io/csakaszamok/p7y:\${P7Y_VERSION:-$v}" docker-compose.yml || true)
[ "$n" = 2 ] || { echo "docker-compose.yml: $n of its 2 image defaults name $v" >&2; exit 1; }
grep -q "^  \"version\": \"$v\"," package.json || { echo "package.json is not version $v" >&2; exit 1; }
echo "version $v: docker-compose.yml and package.json agree"
