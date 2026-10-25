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

