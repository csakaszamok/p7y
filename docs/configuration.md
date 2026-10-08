# Configuration

Main settings in `.env`:

| Variable | Default | Description |
|---|---|---|
| `ADMIN_TOKEN` | `abc123` (dev only) | Bearer token with admin rights on the API |
| `ADMIN_USER`, `ADMIN_PASSWORD` | `admin`, — | The local admin account of the UI |
| `SESSION_SECRET` | — | Signs the session cookie; a long random string |
| `HOST_DOMAIN` | `lvh.me` | Every address is under it: the UI, the registry, the sandbox apps (needs a wildcard DNS record) |
| `HOST_ADDRESS` | `localhost` | The host's address, put into the sandbox TLS certificates and used for the registry token URL when `PUBLIC_URL` is not set |
| `PUBLIC_URL` | `http://p7y.<HOST_DOMAIN>` | The address of the UI as users see it; `https://…` turns on the HTTPS checks (see [HTTPS](https.md)) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_PROVIDER_NAME` | — | Sign-in for everyone but the admin (see [Web UI and sign-in](web-ui.md)) |
| `SANDBOX_QUOTA` | `3` | Sandboxes a user may have running at once; asleep and deep-sleeping ones are not counted; `0` = unlimited |
| `SANDBOX_MAX_TOTAL` | `200` | Users' running and asleep sandboxes on the whole server (each holds a Docker network and its subnet); the admin's are not counted and the admin is not limited; `0` = no limit |
| `DEFAULT_RUNTIME` | `auto` | Runtime for new sandboxes when a request names none: `auto` picks `sysbox` where the host has sysbox installed (no privileged container) and `dind` otherwise; or name one (see [Runtimes and templates](runtimes-templates.md)) |
| `ALLOWED_RUNTIMES` | — (all) | Runtimes new sandboxes may use, as a comma list: `sysbox` forbids the privileged `dind` on a shared server. Others are left out of `GET /runtimes` and the **New sandbox** form, and a create asking for one is a 400 (so is one without a runtime when the default is not allowed). Existing sandboxes keep running, sleeping and waking |
| `SANDBOX_CPUS`, `SANDBOX_MEMORY` | `2`, `4g` | CPU and memory limit of every new sandbox (see [CPU and memory](resources.md#cpu-and-memory)) |
| `SANDBOX_MAX_CPUS`, `SANDBOX_MAX_MEMORY` | `4`, `8g` | How far a user can raise their sandbox's limits; the admin can go up to the host |
| `SANDBOX_DISK` | `20g` | Disk use above which a sandbox is flagged; a warning only, see [Disk](resources.md#disk) |
| `GITHUB_STATS` | `on` | The topbar links to the GitHub repo and shows Purgatory's version, stars and forks. The server fetches the counts at most once an hour (users' browsers never contact GitHub); `off` never asks GitHub, and the link and the version stay |
| `DEFAULT_TEMPLATE` | `starter` | Template for new sandboxes when a request names none. An old value such as `dind-standard` makes every create without a template fail with `Unknown template` |
| `DEEP_SLEEP_CHECK_INTERVAL` | `1m` | How often Purgatory looks for sandboxes to take into deep sleep |
| `HOST_SANDBOXES_DIR` | auto-detected | Host path of `opt/sandboxes` (every sandbox's compose file mounts from it). Set it only if auto-detection fails; an old `HOST_USERS_DIR` (the former `opt/users`) still works, its sibling `sandboxes` is used |
| `P7Y_API_BIND` | `0.0.0.0` | Interface of the direct API port `8081`; `127.0.0.1` for a public deployment |
| `REGISTRY_PUBLIC_PULL` | `true` | Images whose versions all passed the secret scan can be pulled without a login; `false`: tokens only |
