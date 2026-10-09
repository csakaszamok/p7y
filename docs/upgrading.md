# Upgrading

To a new version, in the install directory:

```bash
curl -fsSLO https://github.com/csakaszamok/p7y/releases/latest/download/docker-compose.yml
docker compose pull && docker compose up -d
```

If `.env` sets `P7Y_VERSION`, change or remove it. Each release's notes are in the [changelog](https://github.com/csakaszamok/p7y/blob/main/CHANGELOG.md).

## From 0.4 (an install from a git clone)

From 0.5 Purgatory no longer needs the checkout: the sandbox templates and runtimes, the Sablier themes, the error pages and the registry config come from the image.

**First** check that Docker Compose is 2.17 or newer (`docker compose version`, or run `check-host.sh`): an older one refuses the new compose file, and the site stays down until it is updated.

Then, in the checkout directory, `git pull` and **right away** `docker compose up -d --remove-orphans`. The pull removes `dynamic/errors.yml`, which `up` writes again; this first `up` also recreates Traefik once, so it reads the new `dynamic/`. `.env`, `data/`, `opt/`, `certs/` and `dynamic/` are used as they are.

**A template or runtime you edited in the checkout no longer applies**: the image's are used.

## From Leander

The project used to be called Leander. After pulling this version:

- **Run** `docker compose up -d --remove-orphans`: the service is now called `p7y`, so the old `leander` container is replaced. The compose project name still comes from the directory, so an existing checkout keeps its volumes (registry, registry cache, Sablier sessions).
- **If you renamed or moved the checkout** (for example `leander/` → `p7y/`): the compose project name changes with the directory, so stop the old stack first (`docker compose -p leander stop`), or it keeps ports 80/443. Sandbox compose files hold absolute paths to their files; at startup Purgatory points them at the new directory and recreates their containers (running ones and ones that failed to start are started, asleep ones stay asleep).
- **UI address:** `p7y.<HOST_DOMAIN>`; the old `leander.<HOST_DOMAIN>` redirects to it. If you set `PUBLIC_URL`, change it, and register the new `$PUBLIC_URL/auth/callback` with your OIDC provider. Everyone signs in once more (the session cookie is now `p7y_session`).
- **Existing sandboxes** (`leander-<name>`, `leander.*` labels) keep working as they are; new ones are `p7y-<name>`. A name is taken under either prefix, since both would get the same URLs.
- **Personal access tokens:** existing `ldr_…` tokens keep working; new ones are `p7y_…`.
- **Settings:** `LEANDER_API_BIND` still works; the new name is `P7Y_API_BIND`. The e2e scripts read `P7Y_API` / `P7Y_TOKEN` and fall back to `LEANDER_API` / `LEANDER_TOKEN`.
