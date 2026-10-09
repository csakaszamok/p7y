# Purgatory for agents: deploy and update apps in a sandbox

This guide is for a coding agent (for example Claude Code on the user's machine) that deploys or updates apps in the user's Purgatory sandbox. Every call below was run against a live Purgatory.

Every sandbox has its own Docker daemon. The agent works with:

- the **Purgatory API**, with the user's personal access token, to find the sandbox, wake it and get its Docker client certificates;
- the sandbox's **Docker daemon**, with the plain `docker` command line, to deploy, build and update.

An agent with MCP can make the Purgatory API calls as tools instead: see [MCP](https://csakaszamok.github.io/p7y/0.4/mcp/index.md). A sandbox made from the `portainer` template also has a Portainer API: see [With Portainer](#with-portainer) at the end.

## What the user gives the agent

| Value                 | Example                   | Where it comes from                                                                                              |
| --------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Purgatory URL         | `https://p7y.example.com` | The address of the Purgatory UI                                                                                  |
| Personal access token | `p7y_…`                   | UI → **Access tokens** → **+ New token**                                                                         |
| Sandbox name          | `p7y-shop`                | The name in the UI list with the `p7y-` prefix (sandboxes created before the rename to Purgatory use `leander-`) |

The user may instead give these in a `p7y.env` file in the project (UI → the new token → **Download p7y.env**; it may also be renamed `.env` or copied into one): `P7Y_URL`, `P7Y_TOKEN`, `P7Y_SANDBOX` (only for a token limited to one sandbox; otherwise ask which sandbox, or list them with `GET /sandboxes`) and `P7Y_AGENT_GUIDE` (this guide). Read them from there; do not print the token or commit the file.

The token may be limited to one sandbox. Then `GET /sandboxes` lists only that one, `GET /me` returns it as `sandbox`, and creating or deleting sandboxes answers 403. Everything in this guide works with such a token.

Every Purgatory API call sends `Authorization: Bearer p7y_…`. The token acts as the user: it sees and changes only the user's own sandboxes.

## 1. Find the sandbox and wake it

```
GET /sandboxes/p7y-shop
```

The answer includes:

- `status`: `running`, `exited` (asleep) or `deep_sleep`;
- `docker_access`: `host`, the address of the sandbox's Docker daemon (for example `shop-docker.example.com`), and `state`: `ready`, or `needs-certs` for a sandbox created before Docker access existed (the user enables it once: **Access → Enable**, which restarts the sandbox);
- `ca_cert`, `client_cert`, `client_key`: the Docker client certificates (PEM);
- `tunnel_urls`: the app addresses.

If `status` is not `running`, wake the sandbox and poll until it is:

```
POST /sandboxes/p7y-shop/start
GET  /sandboxes/p7y-shop        → repeat until "status": "running"
```

Waking from `exited` takes a few seconds; from `deep_sleep` about 30 seconds. Connecting to the Docker daemon also wakes it.

A request to an app address while the sandbox is not ready returns an HTML **waiting page** ("Sandbox is waking up") with status 200, instead of the real answer: treat it as "not ready yet" and retry after a few seconds.

## 2. Connect the docker command line

Save the three certificates as files exactly as they are (they end their lines with ; write them unchanged), then make a Docker context for the sandbox:

```
mkdir -p ~/.p7y/shop
# ca.pem = ca_cert, cert.pem = client_cert, key.pem = client_key from GET /sandboxes/p7y-shop
docker context create p7y-shop --docker "host=tcp://shop-docker.example.com:443,ca=$HOME/.p7y/shop/ca.pem,cert=$HOME/.p7y/shop/cert.pem,key=$HOME/.p7y/shop/key.pem"
docker --context p7y-shop ps
```

Only TLS with these certificates gets in: Purgatory passes the connection through without opening it. Keep the key as secret as the token.

If the user gave you an export folder instead (`p7y-<sandbox>/` with `p7y.env`, `docker/` and a README), the certificates are in its `docker/` and `p7y.env` has `P7Y_DOCKER_HOST`:

```
docker context create p7y-shop --docker "host=$P7Y_DOCKER_HOST,ca=$PWD/p7y-shop/docker/ca.pem,cert=$PWD/p7y-shop/docker/cert.pem,key=$PWD/p7y-shop/docker/key.pem"
```

## 3. Deploy an app

A compose project in the sandbox, built and run there:

```
docker --context p7y-shop compose -p shop up -d --build
```

```
services:
  web:
    build: .
    ports: ["8080:8080"]
    restart: unless-stopped
    labels:
      frpc.subdomain: shop
```

- **Publish ports on all interfaces** (`8080:8080`): that is what gives the app its public address. A port published on `127.0.0.1` stays private to the sandbox: no address at all. The app itself must listen on `0.0.0.0` inside its container (not `127.0.0.1`), or its address answers with an error; `GET /sandboxes/:name` → `apps[].answers` says whether it answers.
- **Set a restart policy** (`restart: unless-stopped`): when the sandbox wakes from sleep, only containers with one start again.
- Pass secrets when the container runs (`environment:`, `env_file:` read on your machine by `docker compose`), **never in the image**.

### The app's public address

Every published TCP port gets an HTTP address. With the sandbox `p7y-shop` on `example.com`:

- with a `frpc.subdomain: shop` label: `https://shop-shop.example.com`, that is `<sandbox>-<subdomain>.<domain>`;
- without the label: `https://shop-<project>-<container>-port<host port>.example.com`. The container name is `<project>-<service>-1` unless `container_name` is set.

The app is reachable a few seconds after the container starts. `GET /sandboxes/p7y-shop` lists the addresses in `tunnel_urls`.

A database or other TCP service published the same way also gets a TLS address on port 443: see [Isolation and TCP addresses](https://csakaszamok.github.io/p7y/0.4/networking/#tls-tcp-addresses).

## 4. Update the app

Change the code or the image tag and run the same `docker --context p7y-shop compose -p shop up -d --build` again: compose recreates the changed containers and keeps the volumes. Use a fixed tag for every release (`:1.4.2`, `:1.4.3`, …) so you can roll back by deploying the previous one.

### Push to the registry

Every sandbox can push to Purgatory's registry, so an image can be pulled elsewhere too:

```
docker login registry.example.com -u shop             # password: the token
docker --context p7y-shop tag shop-web registry.example.com/shop/web:3
docker --context p7y-shop push registry.example.com/shop/web:3
```

- Every push is scanned for secrets, and an image with a `.env` file or a key in it stays private (`GET /sandboxes/<name>/registry` shows what was found).
- Anyone can pull the image from any machine (`docker pull registry.<domain>/shop/web:3`) once **every** version of it passed the scan: one flagged version keeps the whole image private until it is deleted.

## 5. Other ways in

- **SSH:** `ssh root@<sandbox>-shell-tcp.<domain>` through port 443 ([SSH, terminal and logs](https://csakaszamok.github.io/p7y/0.4/shell-and-logs/index.md)); inside, `docker` talks to the sandbox's Docker.
- **Logs** of every app in the sandbox: `GET /sandboxes/<name>/logs/stream` (Server-Sent Events).

## With Portainer

A sandbox made from the `portainer` template (or one with Portainer in its own compose) also has Portainer, which proxies the sandbox's Docker daemon over HTTPS: an agent can deploy through its API without the `docker` command line. `GET /sandboxes/<name>` then has:

- `extras.portainer_url`, for example `https://shop-portainer.example.com` (if its host is not in `tunnel_urls`, Portainer is published on `127.0.0.1` and private to the sandbox: ask the user to publish it on all interfaces, `9000:9000`, in **Starter stack…**);
- `extras.portainer_password` (user `admin`).

`GET <portainer_url>/api/status` returning JSON means Portainer is ready (an HTML answer is the waiting page). Portainer traffic wakes an asleep sandbox and keeps it awake.

### Sign in to Portainer

If `p7y.env` has `P7Y_PORTAINER_URL` and `P7Y_PORTAINER_TOKEN`, skip the sign-in: use `P7Y_PORTAINER_URL` as `<portainer_url>` and send `X-API-Key: <P7Y_PORTAINER_TOKEN>` instead of `Authorization: Bearer <jwt>` on every Portainer call below. (A line `# Portainer: not included (…)` says why there is none; then sign in as below, or use the Docker command line, [2](#2-connect-the-docker-command-line).)

Otherwise sign in with `extras.portainer_password`:

```
POST <portainer_url>/api/auth
Content-Type: application/json

{"username": "admin", "password": "<extras.portainer_password>"}
```

The answer is `{"jwt": "…"}`. Send `Authorization: Bearer <jwt>` on every Portainer call below.

Then find the environment (endpoint) ID. It is the sandbox's Docker daemon, usually `1`:

```
GET <portainer_url>/api/endpoints      → [{"Id": 1, "Name": "primary", …}]
```

In an older sandbox (created before its Portainer was started with `-H unix:///var/run/docker.sock`), the list can be empty until someone clicks **Get started** in the Portainer UI. Create the environment once:

```
POST <portainer_url>/api/endpoints
Content-Type: multipart/form-data

Name=local
EndpointCreationType=1
```

### Deploy an app as a stack

A Portainer stack is a compose project that Portainer can update later. Deploy it from compose text:

```
POST <portainer_url>/api/stacks/create/standalone/string?endpointId=1
Content-Type: application/json

{
  "name": "shop",
  "stackFileContent": "services:\n  web:\n    image: registry.example.com/shop:1.4.2\n    ports: [\"8080:8080\"]\n    labels:\n      frpc.subdomain: shop\n",
  "env": [{"name": "LOG_LEVEL", "value": "info"}]
}
```

The answer includes the stack `Id`; keep it for updates. `GET <portainer_url>/api/stacks` lists the stacks with their IDs.

The same rules hold as in [3. Deploy an app](#3-deploy-an-app): publish ports on all interfaces, set a restart policy.

### Update a stack

Change the image tag in the compose text and redeploy. `pullImage: true` pulls the image again even if the tag did not change (for `:latest`):

```
PUT <portainer_url>/api/stacks/<stack id>?endpointId=1
Content-Type: application/json

{"stackFileContent": "<the full compose text>", "env": [], "prune": true, "pullImage": true}
```

`prune: true` removes services that are no longer in the compose text. Portainer recreates the changed containers; the volumes are kept.

To build in the sandbox, send the build context as a tar archive to the Docker build endpoint through Portainer's Docker proxy:

```
POST <portainer_url>/api/endpoints/1/docker/build?t=shop:1.4.3
Content-Type: application/x-tar

<tar of the directory with the Dockerfile>
```

The answer streams the build log as JSON lines; the last line is `{"stream":"Successfully tagged shop:1.4.3\n"}` on success, or an `{"error": …}` line on failure. Then redeploy the stack with `image: shop:1.4.3` and `pullImage: false` (the image only exists locally).

### Everything else Docker can do

`<portainer_url>/api/endpoints/1/docker/<Docker Engine API path>` is the sandbox's Docker Engine API. Examples:

| Call                                                             | Docker Engine API       |
| ---------------------------------------------------------------- | ----------------------- |
| `GET …/docker/containers/json`                                   | list running containers |
| `GET …/docker/containers/<name>/logs?stdout=1&stderr=1&tail=200` | container logs          |
| `POST …/docker/containers/<name>/restart`                        | restart a container     |
| `POST …/docker/images/create?fromImage=alpine&tag=3.20`          | pull an image           |
| `DELETE …/docker/images/<image>`                                 | remove an image         |

The stack Purgatory deployed when it created the sandbox (Portainer + `http-echo`) was deployed with `docker compose` outside Portainer: Portainer shows it but cannot edit it as a stack.

## Things to keep in mind

- **Sleep:** the sandbox sleeps after its idle timeout without HTTP traffic, 30 minutes by default. The user can change this or turn it off in the UI (**Sleep settings…**) or with `PATCH /sandboxes/<name>` `{"idle_timeout": "2h"}`, where `0` or `off` means never. An open Docker connection keeps it awake; plain HTTP traffic to its apps (or to Portainer) counts too.
- **Archive** (`DELETE /sandboxes/<name>`, **Archive…** in the UI) archives the sandbox: its configuration and data are kept in the archive, and it is removed from the list.
- **The Purgatory API reference** is at `<Purgatory URL>/swagger`.
