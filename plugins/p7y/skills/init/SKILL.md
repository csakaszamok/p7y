---
name: init
description: Tie this project folder to a Purgatory (p7y) sandbox with a link the user approves in the browser; writes the project's .p7y folder (a token for that sandbox, its Docker keys) and the docker context. Use for /p7y:init <address> <sandbox>, or when the user asks to connect this project to their p7y or Purgatory sandbox.
argument-hint: <purgatory address> <sandbox>
---

# Tie this project to a Purgatory sandbox

Arguments: `$ARGUMENTS`: the Purgatory address (e.g. `https://p7y.example.com`) and the sandbox's name (e.g.
`shop`). Purgatory shows this line ready to copy under the sandbox → **Let your agent deploy…**.

The user approves in the browser; the `.p7y` folder then comes by a single-use link straight to disk. Say what
you do in plain words. **Never print** `.p7y/p7y.env` (it holds the token) or a key: never `cat` it, never
`echo $P7Y_TOKEN`, never copy a key or a certificate yourself.

## 1. What and where

- The address: the first argument. Without `http://` or `https://`, put `https://` in front; drop a trailing `/`.
- The sandbox: the second argument, as the user sees it (`shop`) or the full name (`p7y-shop`). It must match
  `^[a-z0-9][a-z0-9_-]{0,62}$` (lower case letters, digits, `-`, `_`) before it goes into a command; otherwise
  ask the user for the name again.
- Either missing: ask the user for it (*the address of your Purgatory, as in your browser*, *the sandbox's
  name*). Do not guess.
- The project's root folder: the folder you work in (where Claude Code was started). For the commands below it
  is absolute, with forward slashes: in Git Bash (Claude Code's Bash tool on Windows) `pwd -W` (`C:/Users/…`),
  elsewhere `pwd`. It replaces `<project folder>`, always inside double quotes (`"C:/Users/Ann/My shop"`):
  a folder name with a space must not break the unpack.
- `curl`, `tar` and `docker` (the command line only) must be installed; if one is not, say so and stop. On
  Windows, if curl fails with `CRYPT_E_REVOCATION_OFFLINE`, add `--ssl-no-revoke` (Windows' curl checks
  certificate revocation and fails when it cannot), and from then on add it to **every** curl, `command` in
  step 4 too (its `-sf` hides that error); in PowerShell call `curl.exe`, not `curl`.

**A `.p7y/p7y.env` already there:** read only its address and sandbox, never the whole file:

```sh
grep -E '^P7Y_(URL|SANDBOX)=' .p7y/p7y.env
```

Compare by host name (`https://P7Y.example.com/` and `p7y.example.com` are the same Purgatory: ignore the
scheme, the case and a trailing `/`) and by the sandbox's name without its `p7y-` (`p7y-shop` and `shop` are the
same). The same Purgatory and sandbox: go on (the new folder replaces it, with a new token). Another one: tell
the user which one it is tied to now and ask before replacing it.

## 2. Ask for a code

`POST /device/code` (no token needed):

```sh
curl -sS -X POST -H "Content-Type: application/json" -d '{"sandbox":"<sandbox>"}' "<address>/device/code"
```

It answers `device_code` (the secret this agent polls with), `user_code`, `verification_uri_complete`,
`expires_in` (600 s) and `interval` (3 s). Keep the device code in your commands only: never write it to a
file. An error: 400: the sandbox's name is not a name (lower case letters, digits, `-`, `_`); 503: too many
pending codes, try again in a few minutes; no answer or not JSON: the address is wrong, ask the user.

Tell the user, with the link and the code as they are:

> Open **<verification_uri_complete>** and approve the code **<user_code>** (sign in first if Purgatory asks).

## 3. Wait for the approval

`POST /device/poll` every `interval` seconds, in one bash command that stops after about 90 seconds (a Bash
tool command is cut off at 2 minutes, and an approved answer cut off with it is lost), with the device code
inline:

```sh
DC='<device_code>'; out=still-pending; end=$((SECONDS + 90))
for i in $(seq 1 30); do
  r=$(curl -sS --max-time 10 -X POST -H "Content-Type: application/json" -d "{\"device_code\":\"$DC\"}" "<address>/device/poll")
  case "$r" in *'"pending"'*|'') [ "$SECONDS" -ge "$end" ] && break; sleep 3 ;; *) out=$r; break ;; esac
done
echo "$out"
```

`still-pending` (or curl errors only): run the same command again, **up to 7 times in all** (the code expires
after 10 minutes); still pending after the 7th: tell the user the code ran out and stop. Then:

- `{"status":"denied"}`: the user said no. Say so and stop.
- `{"status":"expired"}`: the code expired (10 minutes) or was already used. Say so and stop; the user can run
  `/p7y:init` again.
- `{"status":"approved", sandbox, url, expires_in, command, context_commands}`: this answer comes **once**:
  go on at once (the link works once, for 5 minutes).

## 4. Unpack and connect

Run them yourself, with the project's root folder, absolute, put inside the quotes of `"<project folder>"`
(and in `context_commands`, where the path is already inside a quoted argument):

1. `command`: `curl -sf "<url>" | tar -x -C "<project folder>"` (with `--ssl-no-revoke` after `curl` if step 2
   needed it). It writes `.p7y/.gitignore`, `.p7y/p7y.env`
   (with a new token for this sandbox only, valid 90 days), `.p7y/README.md` and
   `.p7y/docker/{ca,cert,key}.pem`. An error 410 or an empty download: the link expired or was used; run
   `/p7y:init` again.
2. `context_commands`, in order: the docker context is removed, then created from those files. Its name is
   the one in these commands (`docker context create p7y-shop …`: `p7y-shop`); use that name below, never
   one you built from the argument (`p7y-shop` given would make a wrong `p7y-p7y-shop`).
3. Check it with a compose command (not only `ps`: it can work with a key that compose cannot read), with that
   context name:

```sh
docker --context <context> compose ls
```

A TLS error: never repair or guess at a key; tell the user and stop. Docker access not on (the answer says so):
the user turns it on in Purgatory (the sandbox → Access), then runs `/p7y:init` again.

Then:

- Check that `.p7y/.gitignore` is there (a single `*`: git leaves the folder out). Never delete or empty it.
- A `.dockerignore` in the project without `.p7y` in it: add a line `.p7y`, so a build never copies the keys
  into an image.

Tell the user it is ready: this project is tied to the sandbox, and *deploy this app* puts it online.
