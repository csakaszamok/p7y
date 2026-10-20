# Let your agent deploy

Give a coding agent (Claude Code, Codex, Cursor…) a personal access token and a sandbox, and it can ship your app there on its own: wake the sandbox, deploy a compose project to the sandbox's own Docker daemon, build images inside it, read the logs and roll out new versions. The app gets its public URL from the tunnel.

1. In the UI: create a sandbox (say `shop`), then in its panel's **Access** tab **Token for this sandbox…** — a token that works only for that sandbox.
2. **Download p7y.env** in the token's dialog and save it in your project folder (keep it out of git), then tell the agent: *Deploy this app to my Purgatory sandbox — settings in p7y.env.* The file holds `P7Y_URL`, `P7Y_TOKEN`, `P7Y_SANDBOX` and `P7Y_AGENT_GUIDE`. Or tell the agent everything yourself, for example:

   > Deploy this repo to my Purgatory sandbox `p7y-shop` at `https://p7y.example.com` with the token `p7y_…`. Follow https://p7y-dev.github.io/p7y/latest/agent-guide/index.md.

[docs/agent-guide.md](agent-guide.md) is written for the agent: every call it needs, tried against a live Purgatory. A token limited to one sandbox keeps the agent away from your other sandboxes; a token for all your sandboxes (Access tokens → + New token) acts as you.

An agent with MCP can also use Purgatory as an MCP server with the same token: see [MCP](mcp.md). In Claude Code, the [p7y plugin](claude-plugin.md) needs no token typed in: install it once (`/plugin marketplace add p7y-dev/p7y`, `/plugin install p7y@p7y`), then run `/p7y:init <address> <sandbox>` in the project and approve in the browser.

## Docker, registry, export
A coding agent (Claude Code, Codex…) can work on a sandbox with plain `docker` commands:

- **Docker from outside:** `<raw>-docker.<domain>:443` reaches the sandbox's own Docker daemon. Purgatory does not open that TLS: it only reads the name and passes the connection through, so the Docker command line and the sandbox talk to each other with the sandbox's own certificates (only whoever holds its client key gets in). It does not wake a sleeping sandbox (wake it first: **Wake**, `POST /sandboxes/:name/start`, or the MCP tool `wake_sandbox`); traffic on the connection keeps a running one awake, a connection that is only open (e.g. Docker Desktop keeping a context connected) does not. Sandboxes created before this need new certificates once: **Access → Enable** (restarts the sandbox).
- **Let your agent deploy…**, on a sandbox's **Apps** tab (and in the Advanced view also at the top of its **Access** tab), is the same window in both views. For the [Claude Code plugin](claude-plugin.md): the two lines that install it (once), and the `/p7y:init <address> <sandbox>` line to paste into Claude Code in the project; you approve in the browser, and the project gets its `.p7y` folder with a token for the sandbox. For other agents: **Download** gives `p7y-<raw>.zip`, with a `.p7y` folder to unpack in the project's root folder (its own `.gitignore` of `*` keeps it out of git; add `.p7y` to `.dockerignore` too, so that a build never copies it into an image), and what to tell the agent (*set up the p7y zip from my Downloads in this project and deploy*). Before a sandbox has Docker access it offers to enable it, or to export without the Docker keys. In the Advanced view the window has **Options**: the token's name and expiry (for the zip), a zip without the Docker keys, and **Copy as .env**, which puts `p7y.env` (a new token for the sandbox) on the clipboard. When the sandbox's Portainer is public, both also carry `P7Y_PORTAINER_URL` and a Portainer API token (`P7Y_PORTAINER_TOKEN`, sent as `X-API-Key`), made for the export, so the agent never gets the Portainer admin password; making it wakes the sandbox. That token does not expire and revoking the Purgatory token does not revoke it: delete it in the sandbox's Portainer (My account → Access tokens). The `.p7y` folder holds `p7y.env` (with a new token limited to the sandbox, `P7Y_DOCKER_HOST`, `P7Y_REGISTRY`), the Docker client keys and a README with the `docker context create` command for Windows and macOS/Linux. It is a secret; **Rotate Docker keys…** makes the keys of earlier exports useless.
- **Registry:** `docker login registry.<domain>` with a Purgatory token as the password (a token limited to a sandbox pushes to `<raw>/…`, a personal one to its owner's sandboxes); the password returned at create still works.
- **Anonymous pull after a secret scan:** every push is scanned (files such as `.env`, private keys, and well-known key formats, in every layer and in the image config, where Dockerfile `ENV` lines end up). Anonymous pull is decided per repository: one whose versions are all clean — and that has nothing in the registry Purgatory has not scanned — can be pulled by anyone without logging in; one flagged, unscanned or failed version keeps the whole repository private until it is deleted. The registry tells Purgatory about pushes with a secret Purgatory generates (`data/registry-notify.secret`). Garbage collection runs weekly; a push at that very moment may fail and needs a retry. The **Registry** tab shows the images, the scan results (masked) and a Delete button. `REGISTRY_PUBLIC_PULL=false` keeps everything private.

## An agent inside a sandbox

A coding agent can also run inside one sandbox (say, in a VS Code or code-server container there) and deploy to another: give it that other sandbox's access as usual (the [Claude Code plugin](claude-plugin.md) with `/p7y:init` for that sandbox, or its zip). It needs two names to reach from inside the sandbox: Purgatory's (`p7y.<domain>`, the API and MCP) and the other sandbox's Docker address (`<sandbox>-docker.<domain>`), plus its apps' addresses if it opens them.

**With a real domain** (a wildcard DNS record for `*.<domain>`), these names point at the server from inside a sandbox too: nothing to set. The server must reach its own public address from inside, which it usually does ("hairpin NAT"; most clouds and Docker do it).

**On a local development stack on `lvh.me`** they do not: `lvh.me` names point at `127.0.0.1`, which inside a sandbox's container is that container itself, not Purgatory. With Docker Desktop (Windows, macOS), point them at the host, `192.168.65.254` (what `host.docker.internal` resolves to; a fixed address), with `extra_hosts` on the agent's service in that sandbox's compose file:

```yaml
    extra_hosts:
      - "p7y.lvh.me:192.168.65.254"
      - "shop-docker.lvh.me:192.168.65.254"   # the other sandbox's Docker address
      - "shop-web.lvh.me:192.168.65.254"      # its app, if the agent opens it
```

It has to be an address: `extra_hosts` takes no names, and `host-gateway` inside a sandbox is the sandbox's own container, not the host. The names stay as they are, because the TLS certificates and Traefik's routing go by them. On a Linux host without Docker Desktop there is no such address: use a real domain there.
