# <img src="ui/logo.svg" alt="" width="40" align="top"> Purgatory (p7y)

[![Docs](https://img.shields.io/badge/docs-csakaszamok.github.io%2Fp7y-ea580c)](https://csakaszamok.github.io/p7y/latest/) [![CI](https://github.com/csakaszamok/p7y/actions/workflows/ci.yml/badge.svg)](https://github.com/csakaszamok/p7y/actions/workflows/ci.yml) [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

> [!NOTE]
> **Purgatory is a proof of concept.** It works, but it is an experiment: expect rough edges and breaking changes before 1.0.

**Self-hosted sandboxes for your team and their AI agents: everyone gets their own Docker, every app gets a URL, idle sandboxes sleep.**

**About 10 seconds** from *New sandbox* to your own Docker and a public URL for your app; a sleeping sandbox is back in under 10. (Measured with the images already pulled: the first sandbox on a new server also downloads them.)

![Creating a sandbox, opening its app, and waking it after it fell asleep](docs/media/demo.gif)

- **Its own Docker daemon** for every sandbox (with a Portainer UI if you want one)
- **A public URL for every app**, and TLS addresses for Postgres, Redis and SSH
- **Sleeps when idle, wakes on the next request**; a delete archives, nothing is lost
- **Made for agents:** tokens limited to one sandbox, an [agent guide](docs/agent-guide.md) and an MCP server

## Install

On a Linux host with Docker Engine and the compose plugin, no clone needed ([check the host first](https://csakaszamok.github.io/p7y/latest/install/)):

```bash
mkdir p7y && cd p7y
curl -fsSLO https://github.com/csakaszamok/p7y/releases/latest/download/docker-compose.yml
curl -fsSL https://github.com/csakaszamok/p7y/releases/latest/download/setup.sh | bash     # creates .env with random secrets
docker compose up -d
```

Then sign in at `http://p7y.<HOST_DOMAIN>` (by default `http://p7y.lvh.me`).

## Documentation

**[csakaszamok.github.io/p7y](https://csakaszamok.github.io/p7y/latest/)**: [install](https://csakaszamok.github.io/p7y/latest/install/), [configuration](https://csakaszamok.github.io/p7y/latest/configuration/), [let your agent deploy](https://csakaszamok.github.io/p7y/latest/agents/), [MCP](https://csakaszamok.github.io/p7y/latest/mcp/), [API](https://csakaszamok.github.io/p7y/latest/api/), and [`llms-full.txt`](https://csakaszamok.github.io/p7y/latest/llms-full.txt) for agents.

> **Security:** where [sysbox](https://github.com/nestybox/sysbox) is installed, sandboxes run without a privileged container; without it they fall back to the privileged `dind`, which suits a team that trusts each other, not hostile code. On a shared server install sysbox and set `ALLOWED_RUNTIMES=sysbox` ([details](https://csakaszamok.github.io/p7y/latest/security/)).

[Contributing](CONTRIBUTING.md) · [Security issues](SECURITY.md) · [Apache-2.0](LICENSE)
