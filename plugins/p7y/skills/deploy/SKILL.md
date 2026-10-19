---
name: deploy
description: Deploy or update the user's app in their Purgatory (p7y) sandbox and give them its public address. Use when the user asks to put their app online, deploy it, share it, publish it, or update it on Purgatory or p7y, or asks for a link to show their app to someone.
---

# Deploy an app to a Purgatory sandbox

The user may not be technical. Do the work yourself, say what you are doing in plain words, and finish with
the app's address. Never print the token or the Docker keys, and never put them in git or in an image.

The `p7y` MCP server (from this plugin) is the Purgatory API. Its tools are named below. If its tools are not
available, the plugin is not set up: tell the user to run `/plugin` → p7y → configure, with their Purgatory
address and a token (Purgatory → **Access tokens** → **+ New token**). If the project has a `p7y.env` or a
`p7y-<sandbox>/` export folder instead, read its `README.md` and follow that.

## 1. Pick the sandbox

- `list_sandboxes`: the user's sandboxes. One whose name matches the project, or the only one: use it. Several:
  ask which one, by the names the user sees (without the `p7y-` prefix).
- None: `list_templates`, then `create_sandbox` with a short name from the project (lowercase letters,
  digits, `-`) and the `starter` template. Tell the user its name.

## 2. Wake it

`get_sandbox` gives `status`. If it is not `running`: `wake_sandbox`, then `get_sandbox` every few seconds until
it is (a few seconds; about 30 s from deep sleep). A refusal that the running limit is reached: tell the user,
and that putting another sandbox to sleep frees a place. Never put a sandbox to sleep without asking.

`docker_access.state` must be `ready`. If it is `needs-certs`, ask the user first: `rotate_docker_keys` turns
Docker access on but restarts the sandbox, and its apps are unreachable for about 30 seconds.

## 3. Connect Docker

From `get_sandbox`: `ca_cert`, `client_cert`, `client_key` and `docker_access.host`. Save the three as files,
unchanged, in a folder outside the project (`~/.p7y/<sandbox>/` as `ca.pem`, `cert.pem`, `key.pem`), then:

```sh
docker context create p7y-<sandbox> --docker "host=tcp://<docker_access.host>:443,ca=<dir>/ca.pem,cert=<dir>/cert.pem,key=<dir>/key.pem"
docker --context p7y-<sandbox> ps
```

On Windows use the full path with backslashes. If the context exists already, use it (or remove and create it
again after a key rotation). `docker` must be installed on this machine; if it is not, say so and stop.

## 4. Deploy

Use the project's `compose.yaml` / `docker-compose.yml`, or write a small one (and a `Dockerfile` if needed):

```yaml
services:
  web:
    build: .
    ports: ["8080:8080"]
    restart: unless-stopped
```

- Publish ports **on all interfaces** (`8080:8080`, not `127.0.0.1:8080:8080`): that is what gives the app an
  address. The app must listen on `0.0.0.0` inside its container.
- `restart: unless-stopped` on every service, or it does not start again when the sandbox wakes.
- Secrets go in `environment:` / `env_file:` at run time, never into the image.

```sh
docker --context p7y-<sandbox> compose -p <project> up -d --build
```

The build runs in the sandbox; it is the same command for an update.

## 5. Check and hand over

`get_sandbox` again: `apps` lists each app with its `url` and `answers`. Wait a few seconds after the start.

- `answers: true`: give the user the `https://` address. It works for anyone with the link; when nobody
  uses it for a while (30 minutes by default) the sandbox sleeps, and the next visit wakes it in a few seconds.
- `answers: false`: the app does not answer. Usually it listens on `127.0.0.1`: make it listen on `0.0.0.0`,
  deploy again. `docker --context p7y-<sandbox> compose -p <project> logs --tail 50` shows why.
- No app at all: a port is not published on all interfaces.

A page that says the sandbox is waking up is Purgatory's waiting page, not the app: wait and look again.

To change how long it stays awake: `set_sleep_settings` (`idle_timeout`, e.g. `2h`, or `off`), only if the
user asks.
