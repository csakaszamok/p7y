# SSH, terminal and logs

## SSH into a sandbox

Every sandbox created since foxglove 0.6.0 runs an sshd: root, keys only, at `<name>-shell-tcp.<domain>:443` (the same TLS gateway as the TCP addresses). Add your public keys under **SSH keys** (`/settings/ssh-keys`, API `GET/POST/DELETE /ssh-keys`): they let you into all your sandboxes, and a change takes effect at once. A create request can add keys for that sandbox only (`ssh_keys`, or **Advanced → Extra SSH public keys**). Inside, `docker` talks to the sandbox's own Docker.

```
ssh -o ProxyCommand="openssl s_client -quiet -connect %h:443 -servername %h" root@<name>-shell-tcp.<domain>
```

Each new sandbox also has a key of its own: **Download key** in its panel (API `GET /sandboxes/:name/ssh-key`; `POST` makes one for an SSH sandbox that has none yet), so nobody has to make or upload a key first. The **Connect…** recipe then reads `ssh -i ~/Downloads/<name>.key …`.

The name `shell` is reserved: an inner service with `frpc.subdomain: shell` gets no TCP address. Sandboxes created before have no SSH.

## Terminal in the browser

**Terminal** in a sandbox's panel opens a root shell in the sandbox in a new tab: nothing to install, no key. It wakes the sandbox if it is asleep, and keeps it awake while the tab is open. Inside, `docker` talks to the sandbox's own Docker. Only the sandbox's owner (and the admin) can open it, from the Purgatory pages themselves (signed in; not with a token); at most 5 at once per user.

## App logs

**Logs** in a sandbox's panel opens, in a new tab, what the apps in the sandbox write: the last 100 lines of every container (time, service name; errors in red), then new lines as they come. A filter shows one service; Pause holds new lines, Clear empties the view. It does not wake the sandbox or keep it awake: a sleeping one says *asleep* with a **Start** button. With a token: `curl -N -H "Authorization: Bearer $TOKEN" https://p7y.example.com/sandboxes/p7y-shop/logs/stream`. At most 5 viewers per sandbox at once.
