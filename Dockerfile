FROM docker.io/csakaszamok/rododentron:2
RUN apk add --no-cache python3 make g++ docker-cli docker-cli-compose
WORKDIR /app
RUN npm install --no-save dockerode@^4.0.2 better-sqlite3@^9.4.3 node-forge@^1.3.1 js-yaml@^4.1.0 bcryptjs@^3.0.3 openid-client@^6 ws@^8
COPY ecosystem.config.cjs ./
COPY server.ts ./
COPY routes ./routes
COPY services ./services
COPY templates ./templates
COPY runtimes ./runtimes
COPY ui ./ui
# Purgatory's own package.json (its version for the topbar); /app/package.json is the base image's
COPY package.json ./p7y/package.json

LABEL org.opencontainers.image.source="https://github.com/csakaszamok/p7y" \
      org.opencontainers.image.description="Purgatory: self-hosted sandboxes, each with its own Docker daemon" \
      org.opencontainers.image.licenses="Apache-2.0"
