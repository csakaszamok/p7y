# 0.3.x: mcp-core.ts (the API routes as MCP tools at /mcp)
FROM ghcr.io/p7y-dev/rododentron:0.3.1
RUN apk add --no-cache python3 make g++ docker-cli docker-cli-compose
WORKDIR /app
# Node resolves names (and reads files) on this many threads, 4 by default: a few slow lookups held up the rest
ENV UV_THREADPOOL_SIZE=16
RUN npm install --no-save dockerode@^5.0.1 node-forge@^1.3.1 js-yaml@^4.3.2 bcryptjs@^3.0.3 openid-client@^6 ws@^8
COPY ecosystem.config.cjs ./
COPY server.ts ./
COPY routes ./routes
COPY services ./services
COPY templates ./templates
COPY runtimes ./runtimes
# The 404 page Traefik's error-page middleware asks Purgatory for
COPY error-pages ./error-pages
# Files other services read: p7y-init (assets/install-assets.sh) copies them into their volumes on every up
COPY sablier-themes ./assets/sablier-themes
COPY registry ./assets/registry
COPY traefik ./assets/traefik
COPY scripts/install-assets.sh ./assets/install-assets.sh
COPY ui ./ui
# Purgatory's own package.json (its version for the topbar); /app/package.json is the base image's
COPY package.json ./p7y/package.json
# The licence and the notice travel with the image (AGPL-3.0, sections 4 and 5)
COPY LICENSE NOTICE ./p7y/

LABEL org.opencontainers.image.source="https://github.com/csakaszamok/p7y" \
      org.opencontainers.image.description="Purgatory: self-hosted sandboxes, each with its own Docker daemon" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
