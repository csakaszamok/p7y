---
hide:
  - navigation
---

# Purgatorium (p9m)

!!! note "Early, before 1.0"
    It works and is tested (CI on every change, releases with a changelog), but expect rough edges, and breaking changes between minor versions.

**Self-hosted sandboxes for your team and their AI agents: everyone gets their own Docker, every app gets a URL, idle sandboxes sleep.**

**About 10 seconds** from *New sandbox* to your own Docker and a public URL for your app; a sleeping sandbox is back in under 10. (Measured with the images already pulled: the first sandbox on a new server also downloads them.)

<video controls preload="none" playsinline poster="media/demo-poster.webp" src="media/demo.mp4" aria-label="Creating a sandbox and opening its app, in real time: about 10 seconds" style="width:100%;max-width:960px;border-radius:8px"></video>

The same from a script or an agent, all real runs:

| With curl, through the [API](api.md) | By an agent, over the [MCP server](mcp.md) | The MCP server by hand (JSON-RPC) |
|---|---|---|
| <video controls preload="none" playsinline poster="media/api-curl-poster.webp" src="media/api-curl.mp4" aria-label="Creating a sandbox with curl and calling its app, in real time: about 7 seconds" style="width:100%;max-width:960px;border-radius:8px"></video> | <video controls preload="none" playsinline poster="media/mcp-agent-poster.webp" src="media/mcp-agent.mp4" aria-label="Claude Code creates a sandbox through the MCP server and checks its app, in real time" style="width:100%;max-width:960px;border-radius:8px"></video> | <video controls preload="none" playsinline poster="media/mcp-rpc-poster.webp" src="media/mcp-rpc.mp4" aria-label="The MCP server called with curl: tools/list, then create_sandbox, in real time" style="width:100%;max-width:960px;border-radius:8px"></video> |

*Where your team's code waits before it goes to heaven (production). Nothing is lost here: idle sandboxes sleep, deleted ones are archived.* `p9m` is the short name, as in k8s: **p**urgator**y**, 7 letters in between. It names the sandboxes (`p9m-<name>`), labels, tokens and the UI address.

**Purgatorium gives each user their own Docker daemon on demand** — not a shared platform where you deploy apps, but a full Docker engine they own, with a public URL for every app (and a Portainer UI if they want one), provisioned in seconds from the web UI or a REST API.

!!! tip "Just want your app online?"
    [Tutorials](tutorials/index.md): with Claude Code, install the p9m plugin once and say *deploy this app*; you get a link that works for anyone.

## Who is this for

Teams where people need to spin up arbitrary Docker workloads without touching shared infrastructure. Designed for vibe-coded apps: your colleague runs an AI agent, gets a `docker-compose.yml`, and the agent deploys it into their sandbox (or they paste it into Portainer), done.

## What each sandbox gets

- **Its own Docker daemon** (Docker-in-Docker; see [Security](security.md) for what that does and does not isolate)
- **Access for agents and people** — the `docker` command line straight to the sandbox's daemon, SSH, a browser terminal, an [MCP server](mcp.md); a token limited to the sandbox is enough for an agent to deploy, build and update ([agent guide](agent-guide.md))
- **Portainer UI** if you want one — the `portainer` template adds it, with generated credentials
- **FRP tunnel** — public URLs for services running inside the sandbox
- **Sleeps when idle** — after `idle_timeout` without HTTP traffic the sandbox is stopped; the next request wakes it ([Sablier](https://github.com/sablierapp/sablier))
- **Nothing is ever destroyed automatically** — an explicit delete archives the sandbox (config + data) instead of discarding it
- **Template-based** — define what goes into a sandbox via YAML

## Why Purgatorium

A self-hosted Vercel or Railway for the whole team: everyone gets their own Docker, every app a URL, and idle apps cost nothing.

| | Purgatorium | Cloud PaaS (Vercel, Railway, Render, Fly.io) | Shared VPS / Coolify / Dokploy |
|---|---|---|---|
| Runs on | your own server, one `docker compose` | their cloud | your own server |
| You pay for | the server | every project and its usage | the server |
| Each person gets | their own Docker daemon, any compose stack | projects on a team account | projects on a shared daemon |
| Public URL for every app | automatic | automatic | Coolify / Dokploy: automatic |
| Idle | sleeps, wakes on the next request | runs and is billed, or scales to zero on some | keeps running |
| On delete | archives | deletes | deletes |

In short: pick Purgatorium for the many apps a team builds before production (experiments, demos, internal tools, vibe-coded apps), on your own hardware. For production that must scale, pick a cloud PaaS or Coolify / Dokploy; for untrusted code, a microVM. Coder or Codespaces are for writing code, E2B or Daytona for an agent's short runs: different jobs. The full comparison: [docs/comparison.md](comparison.md).

Next: [install it](install.md), then [create your first sandbox](first-sandbox.md).
