---
name: deploy
description: Deploy or update the user's app in their Purgatory (p7y) sandbox and give them its public address. Use when the user asks to put their app online, deploy it, share it, publish it, or update it on Purgatory or p7y, asks for a link to show their app to someone, or asks to set up a p7y zip.
---

# Deploy an app to a Purgatory sandbox

The user may not be technical. Do the work yourself, say what you are doing in plain words, and finish with
the app's address. Never print a token or a Docker key, and never put them in git or in an image.

The `p7y` MCP server (from this plugin) is the Purgatory API; `p7y-local`, its helper on this machine, has one
tool, `setup_project_dir`. The tools are named below.

**Never copy a key or a certificate yourself**: not from a tool's answer, not with Write or an editor, not
character by character. Copied by hand they get garbled (a wrong character in a key still looks like a key), and
in an answer they go into your context and the transcript. Only `setup_project_dir` or an export zip puts them
on disk. Do not ask `get_sandbox` for `include_keys`.

## 1. The project's `.p7y` folder

A project is tied to its sandbox by a `.p7y` folder in the project's root folder:

```
.p7y/.gitignore     a single line: *   (git leaves the whole folder out)
.p7y/p7y.env        P7Y_URL, P7Y_SANDBOX, P7Y_DOCKER_HOST, and P7Y_TOKEN if it came from an export
.p7y/docker/        ca.pem, cert.pem, key.pem: the sandbox's Docker client keys
```

Look for it first:

- **`.p7y/p7y.env` is there:** its `P7Y_SANDBOX` is this project's sandbox. Do not ask which one.
- **Not there, but an export zip is** (`p7y-<name>.zip`, which holds a `.p7y` folder): in the project's
  folder, or the newest one in the user's Downloads folder (`~/Downloads`, on Windows
  `%USERPROFILE%\Downloads`) when the user says so. Unpack its `.p7y` folder into the project's root, check
  that `.p7y/.gitignore` is there, and delete the zip (it holds a token); tell the user you did. An older zip
  holds a `p7y-<name>/` folder instead: put its files in `.p7y/` and write the `.gitignore`.
- **A `.p7y` folder one level down** (unpacked into a subfolder): move it to the project's root.
- **None of these:** go on with step 2; `setup_project_dir` writes the `.p7y` folder in step 3.

If `.p7y` is not in the project's `.gitignore`, it does not have to be: the folder's own `.gitignore` keeps it
out. Never delete or empty that file.

## 2. Pick the sandbox and the token

Two tokens may be at hand: the plugin's (used by the MCP tools) and `P7Y_TOKEN` in `.p7y/p7y.env`.

- `who_am_i` says what the plugin's token can reach. With `sandbox` in the answer, it is limited to that one
  sandbox: use it, and never try to create one (the token may not).
- `.p7y/p7y.env` names a sandbox the plugin's token cannot reach (`get_sandbox` says not found): use the REST
  API with `P7Y_URL` and `P7Y_TOKEN` from the file instead (`curl -H "Authorization: Bearer $P7Y_TOKEN"`,
  `GET /sandboxes/<name>`, `POST /sandboxes/<name>/start`). Do not print the token.
- No `.p7y`, a token for all of the user's sandboxes: `list_sandboxes`. One whose name matches the project, or
  the only one: use it. Several: ask which one, by the names the user sees (without the `p7y-` prefix). None:
  `list_templates`, then `create_sandbox` with a short name from the project (lowercase letters, digits, `-`)
  and the `starter` template; tell the user its name.
- No MCP tools and no `.p7y`: the plugin is not set up. Tell the user: in Purgatory, on the sandbox, **Let your
  agent deploy…** shows the address and makes a token to give the plugin (`/plugin` → p7y → configure); or
  **Download** the zip and say *set up the p7y zip from my Downloads in this project and deploy*.

## 3. Wake it and connect Docker

`get_sandbox` gives `status`. If it is not `running`: `wake_sandbox`, then `get_sandbox` every few seconds until
it is (a few seconds; about 30 s from deep sleep). A Docker connection does not wake it. A refusal that the
running limit is reached: tell the user, and that putting another sandbox to sleep frees a place. Never put a
sandbox to sleep without asking.

`docker_access.state` must be `ready`. If it is `needs-certs`, ask the user first: `rotate_docker_keys` turns
Docker access on but restarts the sandbox, and its apps are unreachable for about 30 seconds. A token limited
to one sandbox may not do it: then the user turns it on in Purgatory (the sandbox → Access → Enable).

Then **`setup_project_dir`** with `sandbox` (its full name) and `project_dir` (the project's root, absolute). It
fetches the keys and writes `.p7y` itself (`.gitignore`, `p7y.env` with `P7Y_URL`, `P7Y_SANDBOX`,
`P7Y_DOCKER_HOST`, and `docker/*.pem`), checks that the key matches the certificate and the CA signed it, adds
`.p7y` to `.dockerignore`, and creates the docker context (`p7y-<sandbox>`, removed first). Its answer has the
files, the certificate's fingerprint and the context name, never the key. Then check the connection with a
compose command, not only `ps` (`ps` can work with a key that compose cannot read):

```sh
docker --context p7y-<sandbox> compose ls
```

- **`.p7y` came from an export zip:** run `setup_project_dir` anyway when `p7y-local` is there (it checks the
  keys and makes the context); without it, create the context from the zip's files (`.p7y/README.md` has the
  command), never by copying keys.
- **No `setup_project_dir` tool** (the helper needs Node.js 18+ on this machine): ask the user for the export zip
  (Purgatory, the sandbox → **Let your agent deploy…** → **Download**) and set it up from that, as in step 1.
- **New keys** (`rotate_docker_keys`), a moved project folder, or **any TLS error** (`tls: failed to parse
  private key`, a bad certificate): run `setup_project_dir` again. It writes the files and creates the context
  again: a docker context keeps its own copies of the files, so fixing a file alone changes nothing. Never repair
  or guess at a key.
- `docker` must be installed on this machine; if `setup_project_dir` says it is not, say so and stop.

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
- Who may open it: `p7y.access: owner` (*only for me*), `domain` (*for my colleagues*: anyone who can sign in to
  their Purgatory) or `public` (anyone; the server's default unless set otherwise). Set it before the first deploy
  when the user says so. Your own `curl` to a non-public app gets a sign-in redirect: rely on `answers`.
- Secrets go in `environment:` / `env_file:` at run time, never into the image. Add `.p7y` to a
  `.dockerignore` so the keys never reach a build.

```sh
docker --context p7y-<sandbox> compose -p <project> up -d --build
```

The build runs in the sandbox; it is the same command for an update.

## 5. Check and hand over

`get_sandbox` again: `apps` lists each app with its `url` and `answers`. A new app shows there a few seconds
after `compose up` (first only in `tcp_urls`): ask every 3 s for up to about 30 s, until it is listed with
`answers: true`. Rely on `answers`, not on your own `curl` (on Windows the built-in curl fails with
`CRYPT_E_REVOCATION_OFFLINE` unless given `--ssl-no-revoke`).

- `answers: true`: give the user the `https://` address. It works for anyone with the link; when nobody
  uses it for a while (30 minutes by default) the sandbox sleeps, and the next visit wakes it in a few seconds.
- `answers: false`: the app does not answer. Usually it listens on `127.0.0.1`: make it listen on `0.0.0.0`,
  deploy again. `docker --context p7y-<sandbox> compose -p <project> logs --tail 50` shows why.
- No app at all: a port is not published on all interfaces.

A page that says the sandbox is waking up is Purgatory's waiting page, not the app: wait and look again.

To change how long it stays awake: `set_sleep_settings` (`idle_timeout`, e.g. `2h`, or `off`), only if the
user asks.

## Publish on the Hub (when the user asks)

The Hub (`https://hub.<domain>`, if the admin turned it on) lists apps for the user's colleagues. Labels on the
app's service, then deploy again:

```yaml
    labels:
      p7y.publish: "true"            # "true" or "1"
      p7y.title: "Stock room"        # optional, up to 80 characters
      p7y.description: "Who took what from the stock room"   # optional, up to 280
      p7y.image: "/screenshot.png"   # optional: a path the app itself serves (PNG, JPEG, WebP, GIF; up to 2 MB)
```

It appears within about 90 seconds; `get_sandbox` → `hub.published` lists it. Taking it off: remove
`p7y.publish` and deploy again.
