# Runtimes and templates

A sandbox is a **runtime** (how it runs) plus a **template** (what runs inside), picked separately on create (`runtime`, `template`; the **New sandbox** form has a select for each):

| Runtime  | Isolation                                  | Use                                                                               |
| -------- | ------------------------------------------ | --------------------------------------------------------------------------------- |
| `dind`   | `privileged: true`                         | development, any Docker host (incl. Docker Desktop / WSL)                         |
| `sysbox` | `runtime: sysbox-runc`, no privileged mode | production; requires [sysbox](https://github.com/nestybox/sysbox) on a Linux host |

| Template            | What runs inside                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `starter` (default) | a hello app; deploy yours with `docker`, SSH or an agent                                                                                                                                                |
| `portainer`         | the same with Portainer, a web UI for the sandbox's Docker (its address and password in the API and the panel; it runs with `-H unix:///var/run/docker.sock`, so its environment exists from the start) |
| `tcp-demo`          | a demo of [TLS TCP addresses](https://csakaszamok.github.io/p7y/0.4/networking/#tls-tcp-addresses): Postgres, Redis, SSH and pgweb                                                                      |
| `empty`             | nothing: paste your own compose file in the dialog                                                                                                                                                      |

Both runtimes have the same wiring (FRP tunnel, Traefik route, Sablier sleep/wake, `docker_data` volume, archive on delete). The sysbox image runs plain `dockerd`, so its TLS listener is configured through the runtime's `daemon_json` field, which Purgatory merges into the generated `daemon.json`. Both run in production. On a shared server use `sysbox` only: install it on the host and set `ALLOWED_RUNTIMES=sysbox` (see [Security](https://csakaszamok.github.io/p7y/0.4/security/index.md)).

**Runtimes** are `runtimes/<name>.yaml`: a `description`, the sandbox's own `docker_compose` (the DinD container, frps, socat, and their Traefik and Sablier labels) and an optional `daemon_json`. **Templates** are directories, `templates/<name>/`:

- `compose.yaml` (required): the stack deployed into the sandbox's own Docker on creation, a plain compose file.
- `template.yaml` (optional, every field optional): `description` (default: the directory name), `before_script` (JavaScript run on create; what it returns becomes `${variables}` for both compose files and the sandbox's `extras`, e.g. a generated password), `idle_timeout` (Go duration, default `30m`: how long a sandbox may go without HTTP traffic before it sleeps; a create request can override it), `deep_sleep_after` (default `7d`), `inner_project_name` (default `inner`).

A new template is a new directory; it shows up in `GET /templates` and the form without a restart. In both files Purgatory fills in `${name}`, `${raw_name}`, `${host_domain}`, `${template_name}`, `${runtime_name}` and whatever `before_script` returned; any other `${…}` is left for docker compose (write `$$` for a literal `$`). Publish a port on all interfaces (`"5432:5432"`) to give it a link and a [TLS TCP address](https://csakaszamok.github.io/p7y/0.4/networking/#tls-tcp-addresses); a port on `127.0.0.1` stays private to the sandbox; a `p7y.connect.user` label puts its login into the **Connect…** commands. Pass passwords through variables whose name contains `PASSWORD` (or `TOKEN`, `SECRET`, `KEY`): **Starter stack…** masks those.

The **New sandbox** dialog shows the chosen template's `compose.yaml`; edit it there, or pick `empty` and paste your own (`empty` without a compose text is refused). The sandbox then gets that text (comments kept, the same variables filled in, the template's `before_script` still run) and shows "(edited)" in the list and its panel. The text is checked first: it must be YAML with at least one service, at most 256 KB, that docker compose accepts. Keys that would make the compose CLI (which runs in the Purgatory container) read the server's files are refused: `build`, `env_file`, `label_file`, `extends.file`, `include`, and `secrets`/`configs` from a `file` or `environment` — build images through `DOCKER_HOST` or Portainer instead. The CLI gets no Purgatory settings in its environment, so an unknown `${VAR}` is empty.

Sandboxes created before runtimes existed keep working from their own files; their panel shows the old template name (`dind-standard`) and no runtime.
