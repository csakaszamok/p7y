# Contributing

Thanks for helping. Bug reports, fixes and documentation improvements are all welcome. For a larger feature, please open an issue first so we can agree on the approach before you write the code.

## Development setup

You need Docker with the compose plugin, and Node.js 22 for the unit tests.

```bash
git clone https://github.com/csakaszamok/p7y.git && cd p7y
./setup.sh
echo 'COMPOSE_PATH_SEPARATOR=:' >> .env
echo 'COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml' >> .env
docker compose up -d --build
npm ci
```

`docker-compose.dev.yml` mounts `server.ts`, `routes/`, `services/` and `ui/` into the container, so a code change applies on the next request, without a rebuild. Changes to the `Dockerfile` or the dependencies need `docker compose up -d --build`.

## Code layout

- `server.ts`: the HTTP server; each file under `routes/` is one endpoint (`routes/sandboxes/[name]/GET.ts` → `GET /sandboxes/:name`).
- `services/`: everything else: creating and archiving sandboxes, sleep and deep sleep, sign-in, tokens, the UI pages.
- `templates/`: what goes into a sandbox (YAML).
- `docs/architecture.html`: diagrams of how a request reaches a sandbox and how a sandbox sleeps and wakes.

## Tests

- **Unit tests:** `npm test` (vitest). **Types:** `npm run typecheck` (tsc, the app code only; tsx runs the code without checking types). Both run in CI on every push and pull request.
- **End-to-end tests:** the scripts in `tests/*.sh` run against a live stack; the README lists which settings each one needs (under "Isolation between sandboxes"). Run the ones your change touches.

A pull request should add or update tests for what it changes.

## Pull requests

- One topic per pull request, with a short description of what changes for the user and how you tested it.
- Keep documentation in step: the README describes the behaviour users see.
- Commit messages: a short summary line that says what changes (for example "Deep sleep: take down asleep sandboxes whose network is gone"), then the why in the body if it is not obvious.

## Security issues

Please do not report vulnerabilities in public issues; see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the [Apache-2.0](LICENSE) license.
