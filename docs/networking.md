# Isolation and TCP addresses

## Isolation between sandboxes
An app in one sandbox must not reach another sandbox's apps. Today:

- inner containers' private addresses are only reachable inside their own sandbox;
- Sablier's API is on its own network (`sablier-net`) shared only with Traefik;
- a port an inner container *publishes* on all interfaces (`9000:9000`) gets a link (its tunnel) and a TLS TCP address, and other sandboxes can also reach it directly on its `traefik-net` address; a port published on `127.0.0.1` (`127.0.0.1:9000:9000`) is private to the sandbox: no link, no TCP address, no neighbour. A link whose app does not answer is marked ⚠ in the panel — usually the app listens on 127.0.0.1 inside its container; make it listen on 0.0.0.0.

The Purgatory API itself requires authentication (see [Web UI and sign-in](web-ui.md)). Two endpoints of each sandbox are not published on the host but are reachable from other sandboxes over `traefik-net`: its Docker API (protected by per-sandbox TLS client certs) and its frps API (`:7500`, which lists the sandbox's proxies; it has a per-sandbox password, kept in the sandbox's `frps.toml`, so a neighbour gets 401). Closing published ports to neighbours is on the [roadmap](roadmap.md).

## TLS TCP addresses
A port an inner container publishes on all interfaces (`"5432:5432"`) also gets a TCP address, its HTTP name plus `-tcp`, on port 443, TLS only: `shop-inner-db-port5432-tcp.<domain>:443`. Ports published on `127.0.0.1` stay private: no TCP address and no link.

- Postgres: `psql "host=shop-inner-db-port5432-tcp.<domain> port=443 sslmode=require …"`
- Any client that speaks TLS (Redis `--tls`, MQTTS): connect with that name as SNI.
- SSH through TLS: `ProxyCommand openssl s_client -quiet -connect %h:443 -servername %h`.

Traefik passes these names through to Purgatory's TCP gateway, which terminates TLS (with `certs/tls.crt`, or a self-signed `*.<domain>` kept in `data/`), wakes the sandbox if needed and connects to the sandbox container over `traefik-net`. There is no extra authentication: the service's own login protects it. Only web traffic keeps a sandbox awake: without it the sandbox sleeps after its idle timeout even with an open TCP connection, which then drops; the next connection wakes it. Right after a wake the service itself may still be starting (Postgres answers `the database system is starting up`), so let the client retry. The details panel lists the addresses with ready-made commands (**Connect…**), picked by the container's own port (5432 Postgres, 6379 Redis, 22 or 2222 SSH; anything else gets the generic TLS recipe). A `p7y.connect.user` label on the container puts its login into those commands. The API gives the same as `tcp_addresses` (`address`, `port`, `user`) next to `tcp_urls`.

The `tcp-demo` template (on either runtime) shows it end to end. Its starter stack has a Postgres with a sample `orders` table (`<name>-db-tcp`), a Redis (`<name>-redis-tcp`), an SSH server with the user `demo` (`<name>-ssh-tcp`) and pgweb in the browser (`https://<name>-pgweb.<domain>`, user `demo`), all behind one generated password (**Demo password** in the details panel and in **Connect…**). Insert a row with psql and it shows up in pgweb:

```bash
psql "host=<name>-db-tcp.<domain> port=443 sslmode=require user=postgres dbname=postgres" -c "insert into orders (customer, item, amount) values ('me', 'espresso', 3)"
redis-cli -h <name>-redis-tcp.<domain> -p 443 --tls --sni <name>-redis-tcp.<domain> -a <password> ping   # add --insecure with the self-signed certificate
ssh -o ProxyCommand="openssl s_client -quiet -connect %h:443 -servername %h" demo@<name>-ssh-tcp.<domain>
```

The three TCP containers also get an HTTP link in **Apps** (frpc tunnels every published port); those links do not lead anywhere useful.
