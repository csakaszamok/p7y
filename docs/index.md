# Purgatory (p7y)

!!! note "Proof of concept"
    Purgatory works, but it is an experiment: expect rough edges and breaking changes before 1.0.

**Self-hosted sandboxes for your team and their AI agents: everyone gets their own Docker, every app gets a URL, idle sandboxes sleep.**

**About 15 seconds** from *New sandbox* to your own Docker with Portainer and a public URL; a sleeping sandbox is back in under 10. (Measured with the images already pulled: the first sandbox on a new server also downloads them.)

![Creating a sandbox, opening its app, and waking it after it fell asleep](media/demo.gif)

*Where your team's code waits before it goes to heaven (production). Nothing is lost here: idle sandboxes sleep, deleted ones are archived.* `p7y` is the short name, as in k8s: **p**urgator**y**, 7 letters in between. It names the sandboxes (`p7y-<name>`), labels, tokens and the UI address.

**Purgatory gives each user their own Docker daemon on demand** — not a shared platform where you deploy apps, but a full Docker engine they own, with a Portainer UI and a public URL for every app, provisioned in seconds from the web UI or a REST API.

## Who is this for

Teams where people need to spin up arbitrary Docker workloads without touching shared infrastructure. Designed for vibe-coded apps: your colleague runs an AI agent, gets a `docker-compose.yml`, pastes it into Portainer, done.

## What each sandbox gets

- **Its own Docker daemon** (Docker-in-Docker; see [Security](security.md) for what that does and does not isolate)
- **Portainer UI** with generated credentials — deploy stacks from a browser
- **Agent access through the Portainer API** — a personal access token is enough for an agent to deploy, build and update ([docs/agent-guide.md](agent-guide.md))
- **FRP tunnel** — public URLs for services running inside the sandbox
- **Sleeps when idle** — after `idle_timeout` without HTTP traffic the sandbox is stopped; the next request wakes it ([Sablier](https://github.com/sablierapp/sablier))
- **Nothing is ever destroyed automatically** — an explicit delete archives the sandbox (config + data) instead of discarding it
- **Template-based** — define what goes into a sandbox via YAML

## Why Purgatory

A self-hosted Vercel or Railway for the whole team: everyone gets their own Docker, every app a URL, and idle apps cost nothing.

| | Purgatory | Cloud PaaS (Vercel, Railway, Render, Fly.io) | Shared VPS / Coolify / Dokploy |
|---|---|---|---|
| Runs on | your own server, one `docker compose` | their cloud | your own server |
| You pay for | the server | every project and its usage | the server |
| Each person gets | their own Docker daemon, any compose stack | projects on a team account | projects on a shared daemon |
| Public URL for every app | automatic | automatic | Coolify / Dokploy: automatic |
| Idle | sleeps, wakes on the next request | runs and is billed, or scales to zero on some | keeps running |
| On delete | archives | deletes | deletes |

In short: pick Purgatory for the many apps a team builds before production (experiments, demos, internal tools, vibe-coded apps), on your own hardware. For production that must scale, pick a cloud PaaS or Coolify / Dokploy; for untrusted code, a microVM. Coder or Codespaces are for writing code, E2B or Daytona for an agent's short runs: different jobs. The full comparison: [docs/comparison.md](comparison.md).

Next: [install it](install.md), then [create your first sandbox](first-sandbox.md).
