# Changelog

All notable changes are listed here. Versions follow [semantic versioning](https://semver.org/); before 1.0, a minor version may change behaviour.

## [Unreleased]

## [0.4.0] - 2026-10-09

Upgrading from 0.3: `git pull` (or a checkout of `release/0.4`), then `docker compose pull && docker compose up -d`. The new settings are optional. Read **Changed** first if a client of yours creates sandboxes and uses their Portainer.

### Added

- `ALLOWED_RUNTIMES`: the runtimes new sandboxes may use (comma list, empty = all), e.g. `sysbox` so nobody creates a privileged `dind` sandbox on a shared server. The others are left out of `GET /runtimes` and the create form; asking for one is a 400. Existing sandboxes are not affected.
- The topbar links to the GitHub repo and shows Purgatory's version and its star and fork counts. The server fetches the counts at most once an hour, so users' browsers never contact GitHub; `GITHUB_STATS=off` turns the fetching off.
- **MCP server** at `/mcp` (Streamable HTTP): every API endpoint is a tool (`list_sandboxes`, `create_sandbox`, `wake_sandbox`, `sleep_sandbox`, …), run with the caller's token, so it can do what that token can do on the REST API; a token limited to one sandbox is offered only the tools it may call. Only tokens are accepted, not a browser session. Built on the base image `csakaszamok/rododentron:0.3.1`.
- **Documentation site** (MkDocs Material, GitHub Pages): the README's sections are now pages in `docs/`, one version per release series, with search and `llms.txt` / `llms-full.txt` for agents. The README is a short introduction.

### Changed

- **The `starter` template no longer has Portainer**, only the hello app: an agent deploys with the `docker` command line (the sandbox's own Docker daemon, with the client certificates `GET /sandboxes/:name` gives), SSH or MCP, and a sandbox no longer exposes a Portainer admin login on the internet unless asked for. The new **`portainer`** template is the former starter. A client that creates sandboxes without a template and reads `extras.portainer_url` / `portainer_password` must now ask for `"template": "portainer"`. Existing sandboxes keep their Portainer.
- **Creating a sandbox is faster** (about 10 s instead of 15 on a dev machine): Purgatory waits until the tunnel serves every app the inner compose publishes, instead of polling every 3 s until two answers match.
- The agent guide puts the `docker` command line first; Portainer is a section for sandboxes that have it. `P7Y_AGENT_GUIDE` in `p7y.env` points to its Markdown on the documentation site.
- Release images: `latest` is the highest version only, so a fix for an older series does not move it back; every release is also tagged `x.y` (e.g. `0.4`), the newest of its series.

### Fixed

- A sleeping sandbox's TCP addresses (Postgres, Redis, SSH… on port 443) were missing from its panel and from `GET /sandboxes/:name`, although a connection wakes it. They are now the ones it had when it last ran (kept in `tcp.json` in its directory, like the apps in `apps.json`).

## [0.3.1] - 2026-10-08

### Fixed

- A sleeping sandbox's **Apps** tab showed only the apps of its template's stack (e.g. Portainer and http-echo), not those deployed later through Portainer or SSH. It now shows the apps the sandbox had when it last ran (kept in `apps.json` in its directory); a sandbox not seen running since this version still shows its template's.

## [0.3.0] - 2026-10-07

The first release from the public repository. The images of 0.1.0 and 0.2.0 are no longer published: use 0.3.0 or later.

### Added

- `check-host.sh [domain]`: checks a machine before the first install — Linux and kernel, Docker and Compose, whether sysbox is there and works, how many sandbox networks the address pools allow, free ports 80/443/8081, disk, access to Docker Hub and ghcr.io, and with a domain its DNS records (the wildcard too) and the certificate in `certs/`. Changes nothing.

### Fixed

- **A sandbox's own files survive a deep sleep:** `/opt`, `/root`, `/home` and `/srv` of the sandbox container live in named volumes (`sandbox_opt`, …), like its inner Docker. Before, a deep sleep or a removed container lost what was written there. Existing sandboxes are moved over at startup: their current files are copied into the volumes (a running one restarts once).
- A sandbox put to sleep right after a wake no longer wakes again by itself (Purgatory's own session probe reached `/wake`).
- Disk use counts all of a sandbox's volumes.

### Changed

- **Sandbox files per owner:** `opt/sandboxes/<owner>/<name>/` instead of `opt/users/<name>/`, archives under `opt/archive/<owner>/` (the manifest names the owner). Existing sandboxes and archives are moved at startup; a running sandbox restarts once, asleep ones stay asleep, a failed move is retried at the next start. The `./opt/users` mount stays in `docker-compose.yml` for the move and goes in a later version. `HOST_SANDBOXES_DIR` replaces `HOST_USERS_DIR` (still read: its sibling `sandboxes` is used). Runtime files can use `${sandbox_dir}`; `${host_users_dir}/${name}` still names the sandbox's directory.
- `DEFAULT_RUNTIME` defaults to `auto`: new sandboxes use `sysbox` (no privileged container) where the host has sysbox installed, `dind` otherwise (with a warning at startup). Asking for `sysbox` on a host without it is a 400 that says so.
- Exact image versions instead of moving tags, so an updater such as Watchtower does not swap them on its own: `registry:2.8.3`, `traefik:v3.6.25`, `nginx:1.31.6-alpine`, and `alpine/socat:1.8.1.3` for new sandboxes (the same images the old tags point to today). Existing sandboxes keep `alpine/socat:latest`.

## 0.2.0 - 2026-10-06

### Changed (breaking)

- `SANDBOX_QUOTA` now counts **running** sandboxes per user (asleep and deep-sleeping ones are free); at the limit a create or a wake is refused. `SANDBOX_MAX_TOTAL` now defaults to `200` (users' running and asleep sandboxes on the server); set `0` for no server limit. A sleeping sandbox no longer has a Traefik router: every wake goes through Purgatory, so while it is down nothing wakes (running sandboxes keep serving).
- The registry's default domain is now `lvh.me`, like everything else (it was `my.local`, which made `registry.lvh.me` answer 404 when `HOST_DOMAIN` was not set): set `HOST_DOMAIN` if you relied on `registry.my.local`.
- A port an inner container publishes on `127.0.0.1` (or any one address) now gets no link, as it gets no TCP address: it is private to the sandbox. The starter and tcp-demo stacks publish on all interfaces now (they also get TCP addresses and other sandboxes can reach them). Existing sandboxes whose stack publishes on `127.0.0.1` (the old starter: Portainer, `http-echo`) lose those links until the compose file says `"9000:9000"` / `"5678:5678"` (Starter stack…); with the current foxglove image such an address still works for whoever knows it.
- A sandbox is now a **runtime** plus a **template**, picked separately: `runtimes/dind.yaml`, `runtimes/sysbox.yaml` (how it runs) and `templates/<name>/compose.yaml` with an optional `template.yaml` (what runs inside: `starter`, `tcp-demo`). `POST /sandboxes` takes `runtime` and `template`; the old names `dind-standard` and `sysbox-sandbox` now answer 400 `Unknown template` (use `runtime: "dind"` / `"sysbox"` with `template: "starter"`).
- New `DEFAULT_RUNTIME` (default `dind`); `DEFAULT_TEMPLATE` now defaults to `starter`. An `.env` still saying `DEFAULT_TEMPLATE=dind-standard` makes creates without a template fail with 400 `Unknown template`.
- `GET /templates` returns `name`, `description`, `default` (no more `runtime`, `port_ranges`); new `GET /runtimes` in the same shape. Sandboxes carry a `runtime` field (`""` for ones created before).
- With `create_inner_stack: false` the template's `before_script` no longer runs, so such a sandbox has no starter extras (Portainer password and URL).
- Existing sandboxes keep working from their own files; they show their old template name and no runtime.

### Fixed

- **Internal Server Error right after a wake:** Traefik reaches a sandbox's tunnel by name (`http://<name>-socat:8080`), not by the container's address, which it learned ~1.5 s after Sablier let the first request through. Existing sandboxes are switched over when Purgatory starts.

### Added

- **The quota counts running sandboxes:** `SANDBOX_QUOTA` (default 3) sandboxes run at once per user; asleep and deep-sleeping ones are not counted, so letting one sleep frees its place. At the limit a create or wake is refused (the address says *Running limit reached*) and **Wake** lets the owner choose one to put to sleep. Running sandboxes' web addresses no longer go through Purgatory: they keep working while it is down (TLS TCP addresses and Docker access still need it).
- **Overview page:** cards for running of how many allowed, asleep, deep sleep, archived (and a disk warning); for the admin also host CPU and memory, disk use and a table per owner, each linking to the filtered list. API: `GET /sandboxes/summary`.
- **`SANDBOX_MAX_TOTAL`** (default 200): the users' running and asleep sandboxes on the whole server, each with a Docker network (the admin is not limited and not counted).
- **Disk use per sandbox:** measured every 15 minutes while running, shown in the Resources tab against `SANDBOX_DISK` (20 GB; the admin can set it per sandbox); above it the panel and the list show ⚠. A warning only.
- **Copy as .env** and the export carry a Portainer API token (`P7Y_PORTAINER_URL`, `P7Y_PORTAINER_TOKEN`) instead of needing the Portainer admin password; without a public Portainer they say why it is missing.
- The token list shows each token's start and end (`p7y_aB3x…9fQz`) to tell them apart; tokens made before this show —.
- **Copy as .env** and **Export for coding agents…** at the top of the Access tab for every sandbox: before Docker access is enabled, export without the Docker keys or enable it in the same step.
- Coding agents: **Export for coding agents…** (a zip with a scoped token, Docker client keys and a README), the sandbox's Docker API at `<raw>-docker.<domain>:443` (TLS passed through, Enable / Rotate Docker keys), registry login with Purgatory tokens, anonymous pull of images that passed a secret scan, a **Registry** tab.
- The details panel has a header (status, main buttons, sleep countdown with Reset) and four tabs — **Apps** (a table: link, whether it answers, TCP address with copy, Connect…), **Access** (SSH, Portainer, token), **Resources**, **Settings** (with a danger zone: Deep sleep now, Archive…); the open tab is remembered. `GET /sandboxes/:name` `apps[]` carry `service`.
- **Reset** next to *Sleeps in*: starts a running sandbox's sleep countdown over (`POST /sandboxes/:name/keep-awake`, a token for that sandbox too).
- The panel marks a link whose app does not answer (⚠, with a tip); `GET /sandboxes/:name` has `apps[].answers`.
- **Download p7y.env** for a new access token: `P7Y_URL`, `P7Y_TOKEN`, `P7Y_SANDBOX`, `P7Y_AGENT_GUIDE` for a coding agent (made in the browser; the server keeps no copy).
- **Logs** in a sandbox's panel: the sandbox's app logs (every inner container, last 100 lines, then live) on their own page; `GET /sandboxes/:name/logs/stream` (Server-Sent Events, token too). Never wakes the sandbox.
- CPU and memory limits per sandbox (`SANDBOX_CPUS`, `SANDBOX_MEMORY`; users up to `SANDBOX_MAX_*`, the admin up to the host), changed live (**Resources…**, `PATCH` `cpus`/`memory`); current usage in the panel and the list. Older sandboxes get the default at startup.
- **Terminal** in a sandbox's panel: a root shell in the browser (nothing to install, no key); it wakes the sandbox and keeps it awake while open. Every SSH sandbox also gets a generated key (**Download key**, `GET /sandboxes/:name/ssh-key`).
- SSH into every new sandbox: root, keys only, at `<name>-shell-tcp.<domain>:443`; keys under **SSH keys** (`/ssh-keys`) and per sandbox (`ssh_keys`). Needs foxglove 0.6.0.
- New sandbox shows the chosen template's compose file and lets you edit it, or paste your own (`empty` template). API: `GET /templates/:name`, and `compose` on `POST /sandboxes`.
- The `tcp-demo` template: Postgres with sample data, Redis and SSH on TLS TCP addresses, pgweb in the browser, one generated password (in the panel and in **Connect…**, which shows the recipe for the service behind each address).

- TLS TCP addresses: every port an inner container publishes on all interfaces is reachable as `<http-name>-tcp.<domain>:443` (TLS only; Postgres with `sslmode=require`), waking the sandbox on connect.
- The details panel speaks the lifecycle: **Sleep**, **Deep sleep**, **Wake** and **Archive…** instead of Stop / Start / Delete, with visible progress while an action runs (archiving can take minutes). New `POST /sandboxes/:name/deep-sleep`.
- **Starter stack…** in the details panel shows the compose file of the starter stack Purgatory deployed into the sandbox, with secrets (password hashes, *token/password/secret/key* values) masked. New `GET /sandboxes/:name/compose`.
- The log says which address and client woke a deep-sleeping sandbox.
- An ember look: status dots that flicker (running), breathe (asleep) or turn to ash (deep sleep); a logo; drifting embers on the sign-in and waiting pages. The waiting pages update in place instead of reloading every few seconds. Still with reduced motion.
- Access tokens limited to one sandbox: they see and act on only that sandbox and cannot create or delete sandboxes or manage tokens.

### Fixed

- Archiving a sandbox in deep sleep now records its template and creation time in `manifest.json` (they were empty: there were no containers to read them from).
- Sandboxes of a checkout that was moved or renamed (e.g. `leander/` → `p7y/`) failed to start ("not a directory"), because their compose files point at the old directory. Purgatory now rewrites those paths at startup and recreates the sandboxes' containers.
- A sandbox whose last start failed is shown as "failed to start", with Docker's error, instead of "asleep".
- The waiting page no longer shows a sandbox woken from sleep in red ("container exited with code 2 / 137"): those containers are starting.
- A sandbox stops in under a second when it falls asleep; its socat container used to be killed after Docker's 10 s grace period (new sandboxes).
- The sandbox list no longer shows "-1 min" in Created when the browser's clock is behind the server's.

## 0.1.0 - 2026-09-28

The first release.

### Sandboxes

- Every sandbox gets its own Docker daemon (Docker-in-Docker, or sysbox with the `sysbox-sandbox` template), with Portainer and a starter stack.
- Every app published inside a sandbox gets a public address, `<name>-<app>.<domain>`, through an FRP tunnel. Ports published on `127.0.0.1` are reachable only through their tunnel.
- Sandboxes are defined by YAML templates.
- A per-sandbox image registry login, and a pull-through cache.

### Sleep, deep sleep, archive

- A sandbox sleeps after `idle_timeout` without HTTP traffic and wakes on the next request, with a waiting page meanwhile ([Sablier](https://github.com/sablierapp/sablier)).
- After `deep_sleep_after` asleep, its containers and network are removed and its data kept; the next request rebuilds it.
- Both times can be changed after creation, and `0` / `off` means never.
- Delete archives the sandbox's volumes and configuration; nothing is ever deleted automatically.

### Self-service

- Web UI: My sandboxes, All sandboxes (admin), Access tokens.
- Sign-in with OIDC (e.g. Google) for everyone, a local account for the admin.
- Users see and change only their own sandboxes; a per-user quota (`SANDBOX_QUOTA`).
- Personal access tokens for agents. An agent can deploy, build and update apps through the sandbox's Portainer API ([docs/agent-guide.md](docs/agent-guide.md)).

### Running it

- One `docker compose up -d`; `setup.sh` writes a `.env` with random secrets.
- A ready-made image: `ghcr.io/csakaszamok/p7y`.
- HTTPS with a copied-in wildcard certificate; with an `https://` `PUBLIC_URL`, Purgatory refuses to start with default secrets.

### Security

- The p7y container runs only the API. The base image's MCP Inspector, which ran without authentication and was reachable from sandboxes, is no longer started.
- The sandbox image (foxglove 0.5.10) recovers its tunnels after an abrupt kill.

### Renamed from Leander

- The project used to be called Leander. Existing `leander-` sandboxes and `ldr_` tokens keep working; see "Upgrading from Leander" in the README.

[Unreleased]: https://github.com/csakaszamok/p7y/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/csakaszamok/p7y/releases/tag/v0.4.0
[0.3.1]: https://github.com/csakaszamok/p7y/releases/tag/v0.3.1
[0.3.0]: https://github.com/csakaszamok/p7y/releases/tag/v0.3.0
