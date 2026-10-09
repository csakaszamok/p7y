# Security

Purgatory is built for a team that trusts each other's intentions but not each other's mistakes: it keeps one person's broken compose file, runaway container or exposed port from affecting everyone else. It is **not** a boundary against hostile code.

What it does:

- each user gets their own Docker daemon, so their containers, images, volumes and networks are separate from everyone else's and from the host's Docker;
- an app's private addresses are reachable only inside its own sandbox, and ports published on `127.0.0.1` only through its tunnel (see [Isolation between sandboxes](networking.md#isolation-between-sandboxes));
- users see and change only their own sandboxes, through the UI, the API or a personal access token; the admin sees all;
- with an `https://` `PUBLIC_URL`, Purgatory refuses to start with default secrets.

What it does not do:

- **Without sysbox, sandboxes run `privileged` (the `dind` runtime).** Code with root inside such a sandbox can escape to the host. By default (`DEFAULT_RUNTIME=auto`) new sandboxes use the `sysbox` runtime wherever [sysbox](https://github.com/nestybox/sysbox) is installed on the (Linux) host, which runs Docker in an unprivileged container; Docker Desktop cannot run sysbox, so there they fall back to `dind`, and Purgatory says so at startup. Only let people and agents you would give a shell on the host run code in `dind` sandboxes.
- The `sysbox` runtime has not been run in production yet (only its generated configuration is tested).
- There is no network policy between a sandbox and the internet, and no hard disk quota per sandbox: only a warning above its disk limit (see [Disk](resources.md#disk)); CPU and memory limits exist (see [CPU and memory](resources.md#cpu-and-memory)).
- The Purgatory container mounts the host's Docker socket, so whoever controls Purgatory controls the host.

For untrusted code (public sign-up, code from strangers), use sysbox or a microVM-based sandbox instead; a Kata Containers runtime (a VM per sandbox) is on the [roadmap](roadmap.md).

Found a vulnerability? See [SECURITY.md](https://github.com/csakaszamok/p7y/blob/main/SECURITY.md).
