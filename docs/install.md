# Install

First check the machine — without cloning anything; it changes nothing (give it the `HOST_DOMAIN` you plan to use):

```bash
curl -fsSL https://raw.githubusercontent.com/csakaszamok/p7y/main/check-host.sh | bash -s -- dev.example.com
```

Or download it, read it, then run it:

```bash
curl -fsSLO https://raw.githubusercontent.com/csakaszamok/p7y/main/check-host.sh
less check-host.sh
bash check-host.sh dev.example.com
```

Then, on a Linux host with Docker Engine and the compose plugin:

```bash
git clone https://github.com/csakaszamok/p7y.git && cd p7y
./setup.sh            # creates .env with random ADMIN_TOKEN, SESSION_SECRET and ADMIN_PASSWORD
docker compose up -d
```

`check-host.sh` (also in the checkout: `./check-host.sh dev.example.com`) checks Docker, sysbox, the address pools, ports, disk and registry access, and changes nothing (its sysbox check runs one throw-away `alpine` container); with the `HOST_DOMAIN` you plan to use it also checks the DNS records and, if `certs/` has one, the certificate. Lines marked ✘ must be fixed first, ⚠ are worth reading.

`setup.sh` prints the admin password and token. It keeps values you already set, so it is safe to run again. Without it: `cp .env.example .env` and set those three by hand.

`docker compose up -d` pulls the released image `ghcr.io/csakaszamok/p7y` (`P7Y_VERSION` in `.env` picks another version); `docker compose up -d --build` builds it from the checkout instead. To work on the code, see [CONTRIBUTING.md](https://github.com/csakaszamok/p7y/blob/main/CONTRIBUTING.md).

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
