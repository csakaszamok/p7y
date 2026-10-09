# Sleep and wake

A sandbox is **running**, **asleep** (containers stopped, data intact), in **deep sleep** (containers and network removed, data intact) or **archived** (after an explicit delete). There is no fixed-time expiry: a sandbox only sleeps when nobody uses it, and only a person deleting it removes it.

Handled entirely by [Sablier](https://github.com/sablierapp/sablier). The sandbox's outer containers (DinD, frps, socat) form one Sablier group and its Traefik router carries the Sablier middleware. After `idle_timeout` without HTTP traffic the group is stopped — which stops everything inside the sandbox too. The sandbox's router exists only while it runs, so the next request reaches Purgatory's catch-all `/wake`, which wakes it within the owner's limits (see [Web UI and sign-in](web-ui.md)) and shows a waiting page until the router is back; the socat healthcheck only passes once the FRP tunnel is online. Sablier still measures the idle time and puts the sandbox to sleep. **Reset** next to *Sleeps in* in the panel (`POST /sandboxes/:name/keep-awake`) starts the countdown over, as a visit would; it does not wake a sleeping sandbox.

> **Apps must set a restart policy to come back after sleep.** When the sandbox wakes, its inner Docker daemon only restarts containers with `restart: unless-stopped` or `restart: always`. Without one, the app stays stopped and has to be started by hand (`docker start`, or from Portainer):
>
> ```yaml
> services:
>   web:
>     image: my-app
>     restart: unless-stopped
>   db:
>     image: postgres:16
>     restart: unless-stopped
> ```

Only HTTP traffic through Traefik counts as activity: working through `DOCKER_HOST` directly does not keep a sandbox awake. Sablier persists its sessions (`--storage.file`), so restarting Sablier does not put running sandboxes to sleep. After a host reboot, sandboxes that were asleep stay asleep.

The sandbox list (`GET /sandboxes` adds `stops_at`, `deep_sleep_at` and `deep_sleep_after` to each row) and the details panel show **Sleeps in** (time until Sablier stops a running sandbox; every request resets it — read from Sablier's `/metrics`, which Purgatory reaches on `sablier-net`) and **Deep sleep in** (time until an asleep sandbox is taken down).

Both times can be changed after creation — **Change…** next to *Sleep* on the details panel's **Settings** tab, or `PATCH /sandboxes/<name>` with `{"idle_timeout": "45m", "deep_sleep_after": "14d"}` (either field; same formats as at creation; owner or admin). The values are written into the sandbox's `docker-compose.yml`. A new `idle_timeout` recreates only the socat container, which carries the Sablier middleware labels: a running sandbox's apps are unreachable for a few seconds, an asleep one stays asleep, and the DinD container and its inner stack are not touched; it applies from the next request's Sablier session. A new `deep_sleep_after` applies immediately — Purgatory reads it from the compose file.

`0` or `off` means never, for both — at creation and when changing them. `deep_sleep_after: off` never takes the sandbox down. Sablier has no "never", so `idle_timeout: off` is written as a 10-year session (`87600h`): the sandbox keeps running, and if it is stopped by hand the next request still wakes it. The panel and the list show "never" for either.
