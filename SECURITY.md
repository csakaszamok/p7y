# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Report it privately through GitHub: **Security** tab → **Report a vulnerability** ([direct link](https://github.com/csakaszamok/p7y/security/advisories/new)).

Include what you found, how to reproduce it, and which version or commit you ran. You will get an answer within a few days; once a fix is out, the advisory is published with credit to you, unless you prefer otherwise.

## Supported versions

Purgatory has no releases yet. Fixes go to the `main` branch.

## Scope

Purgatory's default sandbox template runs Docker-in-Docker `privileged`, so code with root inside such a sandbox can reach the host. That is a documented limitation, not a vulnerability (see [Security in the README](README.md#security)). Reports about escaping a `sysbox-sandbox` sandbox, bypassing sign-in or tokens, reaching another user's sandbox, or anything else the README says Purgatory prevents are in scope.
