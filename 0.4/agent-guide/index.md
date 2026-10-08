# Purgatory for agents: deploy and update apps in a sandbox

This guide is for a coding agent (for example Claude Code on the user's machine) that deploys or updates apps in the user's Purgatory sandbox. Every call below was run against a live Purgatory.

The agent works through two HTTP APIs:

- the **Purgatory API**, with the user's personal access token, to find the sandbox, wake it and get its Portainer credentials;
- the sandbox's **Portainer API**, which proxies the sandbox's own Docker daemon, to deploy, build and update.

Portainer is reached through the sandbox's public address, so its traffic wakes an asleep sandbox and keeps it awake while the agent works.

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
- `extras.portainer_url`, for example `https://shop-portainer.example.com` (if its host is not in `tunnel_urls`, Portainer is published on `127.0.0.1` and private to the sandbox: ask the user to publish it on all interfaces, `9000:9000`, in **Starter stack…**);
- `extras.portainer_password` (user `admin`);
- `tunnel_urls`: the app addresses.

If `status` is not `running`, wake the sandbox and poll until it is:

```
POST /sandboxes/p7y-shop/start
GET  /sandboxes/p7y-shop        → repeat until "status": "running"
```

Waking from `exited` takes a few seconds; from `deep_sleep` about 30 seconds.

A request to any sandbox address while the sandbox is not ready returns an HTML **waiting page** ("Sandbox is waking up") with status 200, instead of the real answer. Treat an HTML answer from the Portainer API as "not ready yet" and retry after a few seconds. `GET <portainer_url>/api/status` returning JSON means Portainer is ready.

## 2. Sign in to Portainer

If `p7y.env` has `P7Y_PORTAINER_URL` and `P7Y_PORTAINER_TOKEN`, skip the sign-in: use `P7Y_PORTAINER_URL` as `<portainer_url>` and send `X-API-Key: <P7Y_PORTAINER_TOKEN>` instead of `Authorization: Bearer <jwt>` on every Portainer call below. (A line `# Portainer: not included (…)` says why there is none; then sign in as below, or use the Docker command line, 4b.)

Otherwise sign in with the password from step 1:

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

## 3. Deploy an app as a stack

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

**Publish ports on all interfaces** (`8080:8080`): that is what gives the app its public address. A port published on `127.0.0.1` stays private to the sandbox — no address at all. The app itself must listen on `0.0.0.0` inside its container (not `127.0.0.1`), or its address answers with an error; `GET /sandboxes/:name` → `apps[].answers` says whether it answers.

### The app's public address

Every published TCP port gets an HTTP address. With the sandbox `p7y-shop` on `example.com`:

- with a `frpc.subdomain: shop` label: `https://shop-shop.example.com`, that is `<sandbox>-<subdomain>.<domain>`;
- without the label: `https://shop-<stack>-<container>-port<host port>.example.com`. The container name is `<stack>-<service>-1` unless `container_name` is set.

The app is reachable a few seconds after the container starts. `GET /sandboxes/p7y-shop` lists the addresses in `tunnel_urls`.

Only HTTP is carried. A database or other TCP service is reachable only inside the sandbox.

## 4. Update the app

### New image version

Change the image tag in the compose text and redeploy. `pullImage: true` pulls the image again even if the tag did not change (for `:latest`):

```
PUT <portainer_url>/api/stacks/<stack id>?endpointId=1
Content-Type: application/json

{"stackFileContent": "<the full compose text>", "env": [], "prune": true, "pullImage": true}
```

`prune: true` removes services that are no longer in the compose text. Portainer recreates the changed containers; the volumes are kept.

### Build in the sandbox

The sandbox can build the image itself, so no registry is needed. Send the build context as a tar archive to the Docker build endpoint through Portainer's Docker proxy:

```
POST <portainer_url>/api/endpoints/1/docker/build?t=shop:1.4.3
Content-Type: application/x-tar

<tar of the directory with the Dockerfile>
```

The answer streams the build log as JSON lines; the last line is `{"stream":"Successfully tagged shop:1.4.3\n"}` on success, or an `{"error": …}` line on failure. Then redeploy the stack with `image: shop:1.4.3` and `pullImage: false` (the image only exists locally).

### Roll back

Redeploy the stack with the previous image tag. Use a fixed tag for every release (`:1.4.2`, `:1.4.3`, …) so the previous version stays available.

## 4b. Or use the sandbox's Docker directly

If the user gave you an export folder (`p7y-<sandbox>/` with `p7y.env`, `docker/` and a README), you can skip Portainer and use the `docker` command line:

```
docker context create p7y-shop --docker "host=$P7Y_DOCKER_HOST,ca=$PWD/p7y-shop/docker/ca.pem,cert=$PWD/p7y-shop/docker/cert.pem,key=$PWD/p7y-shop/docker/key.pem"
docker --context p7y-shop compose up -d --build      # builds and runs in the sandbox
docker login "$P7Y_REGISTRY" -u shop                 # password: $P7Y_TOKEN
docker --context p7y-shop tag shop-web "$P7Y_REGISTRY/shop/web:3"
docker --context p7y-shop push "$P7Y_REGISTRY/shop/web:3"
```

- Connecting wakes the sandbox. `GET /sandboxes/<name>` → `apps[].answers` tells whether the app answers on its address.
- Pass secrets when the container runs (`environment:`, `env_file:` read on the sandbox), **never in the image**: every push is scanned, and an image with a `.env` file or a key in it stays private (`GET /sandboxes/<name>/registry` shows what was found).
- Anyone can pull the image from any machine (`docker pull registry.<domain>/shop/web:3`) once **every** version of it passed the scan: one flagged version keeps the whole image private until it is deleted.

## 5. Everything else Docker can do

`<portainer_url>/api/endpoints/1/docker/<Docker Engine API path>` is the sandbox's Docker Engine API. Examples:

| Call                                                             | Docker Engine API       |
| ---------------------------------------------------------------- | ----------------------- |
| `GET …/docker/containers/json`                                   | list running containers |
| `GET …/docker/containers/<name>/logs?stdout=1&stderr=1&tail=200` | container logs          |
| `POST …/docker/containers/<name>/restart`                        | restart a container     |
| `POST …/docker/images/create?fromImage=alpine&tag=3.20`          | pull an image           |
| `DELETE …/docker/images/<image>`                                 | remove an image         |

## Things to keep in mind

- **Sleep:** the sandbox sleeps after its idle timeout without HTTP traffic, 30 minutes by default. The user can change this or turn it off in the UI (**Sleep settings…**) or with `PATCH /sandboxes/<name>` `{"idle_timeout": "2h"}`, where `0` or `off` means never. Portainer calls count as traffic.
- **Stacks deployed by Purgatory:** the starter stack (Portainer + `http-echo`) was deployed with `docker compose` outside Portainer. Portainer shows it but cannot edit it as a stack. Deploy your own apps as Portainer stacks as above.
- **Archive** (`DELETE /sandboxes/<name>`, **Archive…** in the UI) archives the sandbox: its configuration and data are kept in the archive, and it is removed from the list.
- **The Purgatory API reference** is at `<Purgatory URL>/swagger`.
