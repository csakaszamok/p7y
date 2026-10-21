#!/bin/sh
# p7y-init: puts this release's files where the other services read them (Sablier themes, error pages,
# registry config, Traefik's error-page middleware). Runs on every `docker compose up`, so they always
# match the image; a file dropped from a release is removed.
set -eu
SRC=${ASSETS_SRC:-/app/assets}
OUT=${ASSETS_OUT:-/out}
DIRS="sablier-themes error-pages registry"
# The 404 page links to Purgatory: its address goes in place of {{P7Y_URL}}, only a plain one (nothing for HTML or sed)
URL=$(printf '%s' "${PUBLIC_URL:-}" | sed 's#/*$##')
printf '%s' "$URL" | grep -Eq '^https?://[A-Za-z0-9.:-]+$' || URL=""

# Everything there first: a failing run must leave what the services read as it is
for d in $DIRS; do
  [ -d "$SRC/$d" ] || { echo "[p7y-init] missing $SRC/$d" >&2; exit 1; }
done
for f in registry/config.yml traefik/errors.yml; do
  [ -f "$SRC/$f" ] || { echo "[p7y-init] missing $SRC/$f" >&2; exit 1; }
done

# Each file under a temporary name, then renamed over the old one: nginx and the others never see a file
# missing or half written. Then whatever this release no longer has goes.
for d in $DIRS; do
  mkdir -p "$OUT/$d"
  for f in "$SRC/$d"/*; do
    [ -f "$f" ] || continue
    name=${f##*/}
    if [ "$d/$name" = error-pages/404.html ] && [ -n "$URL" ]; then
      sed "s#{{P7Y_URL}}#$URL#g" "$f" > "$OUT/$d/.$name.tmp"
    else
      cp "$f" "$OUT/$d/.$name.tmp"
    fi
    mv "$OUT/$d/.$name.tmp" "$OUT/$d/$name"
  done
  for f in "$OUT/$d"/* "$OUT/$d"/.[!.]*; do
    [ -e "$f" ] || continue
    [ -e "$SRC/$d/${f##*/}" ] || rm -rf "$f"
  done
done

# Traefik watches dynamic/: same rename. Only errors.yml: tls.yml and the sandboxes' files there are Purgatory's.
mkdir -p "$OUT/dynamic"
cp "$SRC/traefik/errors.yml" "$OUT/dynamic/.errors.yml.tmp"
mv "$OUT/dynamic/.errors.yml.tmp" "$OUT/dynamic/errors.yml"
echo "[p7y-init] assets installed"
