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

## Branches and releases

Each release series has its own branch, `release/<major>.<minor>` (`release/0.3`, `release/0.4`, …); there is no separate development branch.

- **New features** go to the newest series' branch (now `release/0.4`) through a pull request from a feature branch.
- **Fixes for a released series** go to its branch (e.g. `release/0.3`), and that branch is then merged into each newer one, so no fix is lost going forward.
- **A release** is a version bump and a `[x.y.z]` section in `CHANGELOG.md` on the series' branch, then a `vx.y.z` tag on it. The tag builds and publishes the image as `x.y.z` and `x.y`; `latest` only for the highest version, so a fix for an older series does not move it back.
- **`main`** is the newest release: it is updated when a release of the newest series is made.

A server can follow one series with `P7Y_VERSION=0.3` in `.env` (the newest `0.3.x` image) and a checkout of `release/0.3` (its templates and runtimes).

## Pull requests

- One topic per pull request, with a short description of what changes for the user and how you tested it.
- Keep documentation in step: the README describes the behaviour users see.
- Commit messages: a short summary line that says what changes (for example "Deep sleep: take down asleep sandboxes whose network is gone"), then the why in the body if it is not obvious.

## Security issues

Please do not report vulnerabilities in public issues; see [SECURITY.md](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the [Apache-2.0](LICENSE) license.
