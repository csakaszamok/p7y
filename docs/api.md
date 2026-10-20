# API

<video controls preload="none" playsinline poster="../media/api-curl-poster.webp" src="../media/api-curl.mp4" aria-label="Creating a sandbox with curl and calling its app, in real time: about 7 seconds" style="width:100%;max-width:960px;border-radius:8px"></video>

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sandboxes` | Create a sandbox (`name`; optional `runtime` like `dind`, `template` like `starter`, `compose` (your own compose text instead of the template's; its `before_script` and defaults still apply), `idle_timeout` like `30m`, `deep_sleep_after` like `7d` or `off`, `ssh_keys` (extra SSH public keys for this sandbox only), `cpus` like `2`, `memory` like `4g`, `create_inner_stack: false` for no template stack) |
| `GET` | `/sandboxes` | List all sandboxes |
| `GET` | `/sandboxes/summary` | How many sandboxes: `quota`, `total`, `free`, `running`, `asleep`, `deep_sleep`, `archived`; your own (and `server_full`), or for the admin the whole server, `by_owner`, `server_limit` / `server_used` and `resources` (not with a token limited to one sandbox) |
| `GET` | `/sandboxes/:name` | Get sandbox details; the Docker client certificates and key (`ca_cert`, `client_cert`, `client_key`) only with `?include_keys=true` |
| `GET` | `/sandboxes/:name/compose` | The starter stack deployed into the sandbox (compose YAML), secrets masked (**Starter stack…** in the UI) |
| `PATCH` | `/sandboxes/:name` | Change `idle_timeout` and/or `deep_sleep_after` (see [Sleep and wake](sleep-wake.md)), `cpus` and/or `memory` (see [CPU and memory](resources.md#cpu-and-memory)) |
| `POST` | `/sandboxes/:name/start` | Wake a sandbox, also from deep sleep (**Wake** in the UI); 409 at the owner's limit with `reason` and `running`; `{"sleep": "<name>"}` puts that running one to sleep first |
| `POST` | `/sandboxes/:name/stop` | Put a sandbox to sleep now (**Sleep** in the UI) |
| `POST` | `/sandboxes/:name/deep-sleep` | Put a sandbox into deep sleep now, also a running one (**Deep sleep now** on the panel's **Details** tab) |
| `POST` | `/sandboxes/:name/keep-awake` | Start a running sandbox's sleep countdown over (**Reset** next to *Sleeps in*); 409 if it is not running |
| `POST` | `/sandboxes/:name/export` | A zip for coding agents: a new token for the sandbox, its Docker client keys, a README (owner/admin; not with a token limited to one sandbox); `docker: false` without the keys, `format: "env"` the p7y.env text |
| `POST` | `/sandboxes/:name/project-link` | A single-use link (5 minutes) to the project's `.p7y` folder with the Docker client keys, checked first; answers `url`, `command` (`curl … \| tar -x`) and `context_commands`, never the keys |
| `GET` | `/project-dir/:token` | The `.p7y` folder as a tar, once (no token: the link is the authorization); `410` when used or expired |
| `POST` | `/device/code` | Start a device approval for `/p7y:init` (no token; `sandbox` optional): answers `device_code` (the agent's secret), `user_code`, `verification_uri_complete`, `expires_in` (600) and `interval` (3); both codes live 10 minutes |
| `POST` | `/device/poll` | Ask whether it was approved (no token; `device_code` in the body): `{"status": "pending"}` or `"denied"`, `410` `"expired"` (also for a used code), or `approved` with the same answer as `project-link`, once |
| `GET` | `/activate` | The page where a signed-in owner approves or denies a code (`?code=`); `POST` sends the decision |
| `POST` | `/sandboxes/:name/docker-keys` | New Docker access certificates (**Enable** / **Rotate Docker keys…**); restarts the sandbox |
| `GET` | `/sandboxes/:name/registry` | The sandbox's images in the registry, with secret-scan results |
| `DELETE` | `/sandboxes/:name/registry/:app/:digest` | Delete one version of an image |
| `POST` | `/sandboxes/:name/restart` | Restart a sandbox |
| `GET` | `/sandboxes/:name/files` | List a folder of the sandbox's files (`path`, default `/root`): `/root`, `/home`, `/srv` and `/opt`, the folders kept over a deep sleep, and the apps' volumes; the sandbox must be running (409 `not_running` otherwise). See [Files](files.md) |
| `GET` | `/sandboxes/:name/files/content` | Download a file (`path`), or a folder as a tar |
| `PUT` | `/sandboxes/:name/files/content` | Upload a file to `path` (the body is the file; its folder must exist), up to `FILES_MAX_UPLOAD` |
| `GET` | `/sandboxes/:name/files/text` | A text file's content as JSON (UTF-8, up to 1 MB): for agents |
| `POST` | `/sandboxes/:name/files/mkdir` | Create a folder (`{"path": "/srv/data"}`) |
| `DELETE` | `/sandboxes/:name/files` | Delete a file or a folder (`path`), not the four folders themselves (nor a volume's folder) |
| `GET` | `/sandboxes/:name/volumes` | The volumes of the apps in the sandbox's own Docker: `name`, `path` (for the routes above), `project`, `containers` that use it |
| `DELETE` | `/sandboxes/:name` | Archive the sandbox, then remove it (**Archive…** in the UI; see [Delete = archive](archive.md)) |
| `GET` | `/runtimes` | List the runtimes new sandboxes may use (`name`, `description`, `default`; only those in `ALLOWED_RUNTIMES` when it is set) |
| `GET` | `/templates` | List the templates (`name`, `description`, `default`) |
| `GET` | `/ssh-keys` | Your SSH public keys (`id`, `name`, `type`, `fingerprint`, `created_at`) |
| `POST` | `/ssh-keys` | Add a public key (`key`, optional `name`); it lets you into all your sandboxes with SSH |
| `GET` | `/sandboxes/:name/ssh-key` | The sandbox's generated SSH private key (download) |
| `POST` | `/sandboxes/:name/ssh-key` | Generate it for an SSH sandbox that has none yet |
| `GET` | `/sandboxes/:name/terminal` | The browser terminal (page; the same path as a websocket: the shell) |
| `GET` | `/sandboxes/:name/logs` | The logs page (signed-in browsers) |
| `GET` | `/sandboxes/:name/logs/stream` | The sandbox's app logs as Server-Sent Events: the last 100 lines of every container, then live (token too) |
| `DELETE` | `/ssh-keys/:id` | Delete one of your keys (it stops working at once) |
| `GET` | `/templates/:name` | A template's `compose.yaml` as written (`compose`), to show or edit before a create |
| `GET` | `/me` | Who you are signed in as, Purgatory's own address (`url`), your running sandboxes and limit, and `server_places`: the sandbox places on the server, `used` and `limit` (`null` without a server limit) |
| `PUT` | `/me/view` | The web UI's view for this account: `{"view": "simple"}` or `"advanced"` (`GET /me` returns it as `view`) |
| `GET` | `/tokens` | List your personal access tokens (`hint`: the token's start and end, e.g. `p7y_aB3x…9fQz`; null for tokens made before hints) |
| `POST` | `/tokens` | Mint a personal access token (`name`, optional `expires_in` like `30d`/`90d`/`never`) |
| `DELETE` | `/tokens/:id` | Revoke a personal access token |

All endpoints require `Authorization: Bearer <ADMIN_TOKEN | personal token>` or a signed-in browser session. Users only see their own sandboxes.

## OpenAPI and clients

The whole API is described as OpenAPI 3.0 at `/swagger.json` (no token needed to read it), and you can try it in Swagger UI at `/swagger`. There is no official SDK yet; generate a client in your language from that document instead, for example typed TypeScript:

```bash
curl -s https://p7y.example.com/swagger.json -o p7y.json
npx openapi-typescript p7y.json -o p7y.d.ts   # use it with openapi-fetch
```

or any language [openapi-generator](https://openapi-generator.tech/) supports (`openapi-generator-cli generate -i p7y.json -g python -o p7y-client`). The document's version is Purgatory's own, so regenerate after an upgrade.

More reading: [architecture diagrams](architecture.html), [how agents deploy](agent-guide.md), [comparison with other sandbox platforms](comparison.md), [roadmap](roadmap.md).
