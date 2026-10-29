---
name: init
description: Tie this project folder to a Purgatorium (p9m) sandbox, a new one or one the user already has, with a link the user approves in the browser and a code they paste back; writes the project's .p9m folder (a token for that sandbox, its Docker keys) and the docker context. Use for /p9m:init <address> [sandbox | --template <name>], or when the user asks for a p9m or Purgatorium sandbox for this project.
argument-hint: <purgatorium address> [sandbox | --template <name>]
---

# Tie this project to a Purgatorium sandbox

Arguments: `$ARGUMENTS`: the Purgatorium address (e.g. `https://p9m.example.com`), then optionally either the
name of a sandbox the user already has (e.g. `k3x9q2`), or `--template <name>` for a new one from that template.
With neither, Purgatorium makes a new sandbox from its default template, and gives it a name itself.

The user approves in the browser and pastes back the code Purgatorium shows; the `.p9m` folder then comes by a
single-use link straight to disk. Say what you do in plain words. **Never print** `.p9m/p9m.env` (it holds the
token) or a key: never `cat` it, never `echo $P9M_TOKEN`, never copy a key or a certificate yourself.

## 1. What and where

- The address: the first argument. Without `http://` or `https://`, put `https://` in front; drop a trailing `/`.
  It must match `^https?://[A-Za-z0-9.:-]+$` before it goes into a command; otherwise ask the user for the
  address again.
- The sandbox (optional): a second argument that is not `--template`, as the user sees it (`shop`) or the full
  name (`p9m-shop`): one they already have. It must match `^[a-z0-9][a-z0-9_-]{0,62}$` (lower case letters,
  digits, `-`, `_`) before it goes into a command; otherwise ask the user for the name again.
- The template (optional): `--template <name>`, for a new sandbox. The name must match the same pattern. Not
  together with a sandbox: a template is only for a new one; ask the user which they want.
- No sandbox: a new one. Never make up a name for it, and never ask for one: Purgatorium names it.
- The address missing: ask the user for it (*the address of your Purgatorium, as in your browser*). Do not
  guess.
- The project's root folder: the folder you work in (where Claude Code was started). For the commands below it
  is absolute, with forward slashes: in Git Bash (Claude Code's Bash tool on Windows) `pwd -W` (`C:/Users/…`),
  elsewhere `pwd`. It replaces `<project folder>`, always inside double quotes (`"C:/Users/Ann/My shop"`):
  a folder name with a space must not break the unpack.
- `curl`, `tar` and `docker` (the command line only) must be installed; if one is not, say so and stop. On
  Windows, if curl fails with `CRYPT_E_REVOCATION_OFFLINE`, add `--ssl-no-revoke` (Windows' curl checks
  certificate revocation and fails when it cannot), and from then on add it to **every** curl, `command` in
  step 4 too (its `-sf` hides that error); in PowerShell call `curl.exe`, not `curl`.

**A `.p9m/p9m.env` already there:** read only its address and sandbox, never the whole file:

```sh
grep -E '^P9M_(URL|SANDBOX)=' .p9m/p9m.env
```

Compare by host name (`https://P9M.example.com/` and `p9m.example.com` are the same Purgatorium: ignore the
scheme, the case and a trailing `/`) and by the sandbox's name without its `p9m-` (`p9m-shop` and `shop` are the
same). The same Purgatorium and sandbox: go on (the new folder replaces it, with a new token). Another one, or a
new sandbox asked for: tell the user which one it is tied to now and ask before replacing it (to tie it again to
that one, run `/p9m:init <address> <that sandbox>`).

## 2. Ask for a code

`POST /device/code` (no token needed), with a body of what was asked for: `{"sandbox":"<sandbox>"}` for one the
user has, `{"template":"<template>"}` for a new one from a template, `{}` for a new one:

```sh
curl -sS -X POST -H "Content-Type: application/json" -d '<body>' "<address>/device/code"
```

It answers `device_code` (the secret that gets the token, with the user's code), `user_code`,
`verification_uri_complete` and `expires_in` (600 s). Keep the device code in your commands only: never write it
to a file. An error: 400: the sandbox's name is not a name, or the template is unknown (tell the user; `GET
/templates` needs a token, so do not look it up); 503: too many pending codes, try again in a few minutes; no
answer or not JSON: the address is wrong, ask the user.

Tell the user, with the link and the code as they are, then **stop and wait** for their answer:

> Open **<verification_uri_complete>** and approve the code **<user_code>** (sign in first if Purgatorium asks).
> A new sandbox takes up to a minute. Then paste here the code Purgatorium shows.

## 3. The code the user pastes

The user's next message has the confirmation code (`XXXX-XXXX`, letters; lower case or a space instead of the
dash is fine). It must match `^[A-Za-z]{4}[- ]?[A-Za-z]{4}$` before it goes into a command; otherwise ask for it
again. The user says they clicked Deny, or does not want to go on: stop.

`POST /device/token`, with the device code and the user's code inline:

```sh
curl -sS -X POST -H "Content-Type: application/json" -d '{"device_code":"<device_code>","code":"<code>"}' "<address>/device/token"
```

- `{"status":"wrong","tries_left":N}` (400): not the code. Ask the user to paste it again, as Purgatorium
  shows it; after 5 wrong ones the request ends.
- `{"status":"pending"}` (409): not approved yet. Ask the user to approve in the browser first, then paste the
  code.
- `{"status":"denied"}` (403): the user said no. Say so and stop.
- `{"status":"expired"}` (410): the code expired (10 minutes), was used, or was wrong too often. Say so and
  stop; the user can run `/p9m:init` again.
- `{"error":"…"}` (400): the request was refused. Show the error and stop.
- `{"status":"approved", sandbox, url, expires_in, command, context_commands}`: this answer comes **once**: go
  on at once (the link works once, for 5 minutes). `sandbox` is the sandbox's name: for a new one, tell the user
  that name.

## 4. Unpack and connect

Run them yourself, with the project's root folder, absolute, put inside the quotes of `"<project folder>"`
(and in `context_commands`, where the path is already inside a quoted argument):

1. `command`: `curl -sf "<url>" | tar -x -C "<project folder>"` (with `--ssl-no-revoke` after `curl` if step 2
   needed it). It writes `.p9m/.gitignore`, `.p9m/p9m.env`
   (with a new token for this sandbox only, valid 90 days), `.p9m/README.md` and
   `.p9m/docker/{ca,cert,key}.pem`. An error 410 or an empty download: the link expired or was used; run
   `/p9m:init` again.
2. `context_commands`, in order: the docker context is removed, then created from those files. Its name is
   the one in these commands (`docker context create p9m-shop …`: `p9m-shop`); use that name below, never
   one you built from the argument (`p9m-shop` given would make a wrong `p9m-p9m-shop`).
3. Check it with a compose command (not only `ps`: it can work with a key that compose cannot read), with that
   context name:

```sh
docker --context <context> compose ls
```

A TLS error: never repair or guess at a key; tell the user and stop.

Then:

- Check that `.p9m/.gitignore` is there (a single `*`: git leaves the folder out). Never delete or empty it.
- A `.dockerignore` in the project without `.p9m` in it: add a line `.p9m`, so a build never copies the keys
  into an image.

Tell the user it is ready: this project is tied to the sandbox, and *deploy this app* puts it online.
