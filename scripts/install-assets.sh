#!/bin/sh
# p7y-init: puts this release's files where the other services read them (Sablier themes, error pages,
# registry config, Traefik's error-page middleware). Runs on every `docker compose up`, so they always
# match the image; a file dropped from a release is removed.
set -eu
SRC=${ASSETS_SRC:-/app/assets}
OUT=${ASSETS_OUT:-/out}

for d in sablier-themes error-pages registry; do
  [ -d "$SRC/$d" ] || { echo "[p7y-init] missing $SRC/$d" >&2; exit 1; }
  mkdir -p "$OUT/$d"
  find "$OUT/$d" -mindepth 1 -delete
  cp -R "$SRC/$d/." "$OUT/$d/"
done
[ -f "$SRC/registry/config.yml" ] || { echo "[p7y-init] missing $SRC/registry/config.yml" >&2; exit 1; }

# Traefik watches dynamic/: write under a name it ignores, then rename, so it never reads half a file.
# Only errors.yml: tls.yml and the sandboxes' files there are Purgatory's.
mkdir -p "$OUT/dynamic"
cp "$SRC/traefik/errors.yml" "$OUT/dynamic/.errors.yml.tmp"
mv "$OUT/dynamic/.errors.yml.tmp" "$OUT/dynamic/errors.yml"
echo "[p7y-init] assets installed"
