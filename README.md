
# <img src="ui/logo.svg" alt="" width="40" align="top"> Purgatory (p7y)

[![CI](https://github.com/csakaszamok/p7y/actions/workflows/ci.yml/badge.svg)](https://github.com/csakaszamok/p7y/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Self-hosted sandboxes for your team and their AI agents: everyone gets their own Docker, every app gets a URL, idle sandboxes sleep.**

![Creating a sandbox, opening its app, and waking it after it fell asleep](docs/media/demo.gif)

*Where your team's code waits before it goes to heaven (production). Nothing is lost here: idle sandboxes sleep, deleted ones are archived.* `p7y` is the short name, as in k8s: **p**urgator**y**, 7 letters in between. It names the sandboxes (`p7y-<name>`), labels, tokens and the UI address.

**Purgatory gives each user their own Docker daemon on demand** — not a shared platform where you deploy apps, but a full Docker engine they own, with a Portainer UI and a public URL for every app, provisioned in seconds from the web UI or a REST API.

**Documentation: [csakaszamok.github.io/p7y](https://csakaszamok.github.io/p7y/latest/)**

## What each sandbox gets

- **Its own Docker daemon**, with a Portainer UI and generated credentials
- **A public URL for every app** (FRP tunnel), and TLS TCP addresses for Postgres, Redis, SSH
- **Sleep when idle, wake on the next request** ([Sablier](https://github.com/sablierapp/sablier)); nothing is ever destroyed automatically: a delete archives
- **Made for agents:** a token limited to one sandbox, an [agent guide](docs/agent-guide.md), and an **MCP server** at `/mcp`

## Install

On a Linux host with Docker Engine and the compose plugin (check it first, without cloning: `curl -fsSL https://raw.githubusercontent.com/csakaszamok/p7y/main/check-host.sh | bash -s -- dev.example.com`):

```bash
git clone https://github.com/csakaszamok/p7y.git && cd p7y
./setup.sh            # creates .env with random ADMIN_TOKEN, SESSION_SECRET and ADMIN_PASSWORD
docker compose up -d
```

Then sign in at `http://p7y.<HOST_DOMAIN>` (by default `http://p7y.lvh.me`). Details: [Install](https://csakaszamok.github.io/p7y/latest/install/), [Configuration](https://csakaszamok.github.io/p7y/latest/configuration/), [HTTPS](https://csakaszamok.github.io/p7y/latest/https/).

## Read more

| | |
|---|---|
| Getting started | [Install](https://csakaszamok.github.io/p7y/latest/install/) · [First sandbox](https://csakaszamok.github.io/p7y/latest/first-sandbox/) · [Configuration](https://csakaszamok.github.io/p7y/latest/configuration/) · [HTTPS](https://csakaszamok.github.io/p7y/latest/https/) |
| Using Purgatory | [Web UI and sign-in](https://csakaszamok.github.io/p7y/latest/web-ui/) · [Runtimes and templates](https://csakaszamok.github.io/p7y/latest/runtimes-templates/) · [Sleep and wake](https://csakaszamok.github.io/p7y/latest/sleep-wake/) · [CPU, memory and disk](https://csakaszamok.github.io/p7y/latest/resources/) · [Deep sleep](https://csakaszamok.github.io/p7y/latest/deep-sleep/) · [Delete = archive](https://csakaszamok.github.io/p7y/latest/archive/) · [Isolation and TCP addresses](https://csakaszamok.github.io/p7y/latest/networking/) · [SSH, terminal and logs](https://csakaszamok.github.io/p7y/latest/shell-and-logs/) |
| Agents | [Let your agent deploy](https://csakaszamok.github.io/p7y/latest/agents/) · [MCP](https://csakaszamok.github.io/p7y/latest/mcp/) · [Agent guide](docs/agent-guide.md) |
| Reference | [API](https://csakaszamok.github.io/p7y/latest/api/) · [Security](https://csakaszamok.github.io/p7y/latest/security/) · [Upgrading from Leander](https://csakaszamok.github.io/p7y/latest/upgrading/) · [Comparison](docs/comparison.md) · [Roadmap](docs/roadmap.md) |
| For agents | [`llms.txt`](https://csakaszamok.github.io/p7y/latest/llms.txt) · [`llms-full.txt`](https://csakaszamok.github.io/p7y/latest/llms-full.txt): the whole documentation in one file |

**Security in one line:** the default `dind` runtime is privileged, so it is for a team that trusts each other's intentions, not for hostile code; use the `sysbox` runtime on a shared server ([Security](https://csakaszamok.github.io/p7y/latest/security/)).

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · Vulnerabilities: [SECURITY.md](SECURITY.md)

## License

[Apache-2.0](LICENSE)
