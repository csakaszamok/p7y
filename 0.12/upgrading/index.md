# Upgrading

To a new version, in the install directory:

```
curl -fsSLO https://github.com/csakaszamok/p9m/releases/latest/download/docker-compose.yml
docker compose pull && docker compose up -d
```

If `.env` sets `P9M_VERSION`, change or remove it. Each release's notes are in the [changelog](https://github.com/csakaszamok/p9m/blob/main/CHANGELOG.md).

## From Purgatory (p7y)

There is no upgrade from Purgatory (p7y), the project's former name: [install](https://csakaszamok.github.io/p9m/0.12/install/index.md) Purgatorium afresh, in a new directory called `p9m`. Nothing is carried over: sandboxes, archives, users, tokens and settings start empty, and `P7Y_*` settings and `p7y.*` labels are not read.
