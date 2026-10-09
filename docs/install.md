# Install

No git clone is needed: every file comes from a GitHub release, and the image carries the rest.

First check the machine; it changes nothing (give it the `HOST_DOMAIN` you plan to use):

```bash
curl -fsSL https://github.com/csakaszamok/p7y/releases/latest/download/check-host.sh | bash -s -- dev.example.com
```

Or download it, read it, then run it:

```bash
curl -fsSLO https://github.com/csakaszamok/p7y/releases/latest/download/check-host.sh
less check-host.sh
bash check-host.sh dev.example.com
```

Then, on a Linux host with Docker Engine and the compose plugin (Compose 2.17 or newer):

```bash
mkdir p7y && cd p7y
curl -fsSLO https://github.com/csakaszamok/p7y/releases/latest/download/docker-compose.yml
curl -fsSL https://github.com/csakaszamok/p7y/releases/latest/download/setup.sh | bash -s -- dev.example.com   # .env with your domain and random secrets
docker compose up -d
```

The directory must be called `p7y`: the compose project name comes from it. For a given version, use `releases/download/v0.5.0/…` instead of `releases/latest/download/…`.

`check-host.sh` checks Docker and Docker Compose, sysbox, the address pools, ports, disk and registry access, and changes nothing (its sysbox check runs one throw-away `alpine` container); with the `HOST_DOMAIN` you plan to use it also checks the DNS records and, if `certs/` has one, the certificate. Lines marked ✘ must be fixed first, ⚠ are worth reading.

`setup.sh` works in the current directory: it creates `.env` from its release's `env.example`, sets `HOST_DOMAIN` to the domain you give it and `PUBLIC_URL` to `p7y.<domain>` (`https://` if `certs/` already holds a certificate, else `http://`: run it again with the domain after adding one; a `PUBLIC_URL` you set yourself is kept), fills in random secrets, creates `data/`, `opt/`, `certs/` and `dynamic/`, and prints the admin password and token. It keeps values you already set, so it is safe to run again. Without it: download `env.example` of the release as `.env` and set `HOST_DOMAIN`, `PUBLIC_URL` and the three secrets by hand.

`docker compose up -d` pulls the released image `ghcr.io/csakaszamok/p7y`. It carries the sandbox templates and runtimes, and the files the other services read: on every `up` the one-shot `p7y-init` service copies the Sablier themes, the error pages, the registry config and `dynamic/errors.yml` from it, so they always match the running version. To work on the code, see [CONTRIBUTING.md](https://github.com/csakaszamok/p7y/blob/main/CONTRIBUTING.md).

The stack runs Traefik v3.6 with the Sablier plugin, Sablier, a registry and the Purgatory API. The UI is at `http://p7y.<HOST_DOMAIN>` (by default `http://p7y.lvh.me`, which resolves to `127.0.0.1`), the API also on port `8081` of the host.

Each sandbox's files (compose file, certificates, tunnel config) live in `opt/sandboxes/<owner>/<name>/`, its archives in `opt/archive/<owner>/`; `<owner>` is `admin` or the user's sign-in e-mail. Sandboxes from older versions (`opt/users/<name>/`) are moved there at startup; a running one restarts once.

> **Give the Docker daemon a larger address pool.** Every sandbox — sleeping ones included — keeps its own compose network until it is archived. Docker's default pools only allow about 30 networks; beyond that sandbox creation fails with `fully subnetted`. Set smaller subnets in the daemon config (`/etc/docker/daemon.json`, or Docker Desktop → Settings → Docker Engine) and restart Docker:
>
> ```json
> { "default-address-pools": [ { "base": "10.10.0.0/16", "size": 28 } ] }
> ```
>
> A sandbox network needs only a handful of addresses, so `/28` subnets are enough: this allows 4096 networks (`/24` would allow 256).

> **Before exposing Purgatory publicly**, set `ADMIN_TOKEN`, `SESSION_SECRET` and `ADMIN_PASSWORD` to real secrets. The compose defaults (`ADMIN_TOKEN=abc123`, and the `.env.example` placeholders) are only meant for local dev and the e2e scripts; Purgatory logs a startup warning if any of them is still in effect.

All settings: [Configuration](configuration.md). For HTTPS: [HTTPS](https.md).
