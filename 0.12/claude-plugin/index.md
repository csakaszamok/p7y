# Claude Code plugin

New to this?

[Put your app online with Claude Code](https://csakaszamok.github.io/p9m/0.12/tutorials/claude-code/index.md) walks through it step by step.

The `p9m` plugin teaches Claude Code to deploy: you say *put my app online*, it deploys the project to your sandbox's own Docker, checks that the app answers and gives you its address. The plugin itself keeps no address and no token: each project says which Purgatorium and which sandbox it belongs to, in its own `.p9m` folder.

## Install

Once on your computer, from a terminal (a sandbox's **Let your agent deploy…** shows these lines ready to copy). Claude Code in an editor (the VS Code extension) has no `/plugin`, so there this is the way:

```
claude plugin marketplace add csakaszamok/p9m
claude plugin install p9m@p9m
```

Or in Claude Code:

```
/plugin marketplace add csakaszamok/p9m
/plugin install p9m@p9m
```

Claude Code asks where to install it: **user** (every folder of yours; usually what you want), **project** (this repository, for everyone who uses it, through its `.claude/settings.json`) or **local** (this folder, only you). It asks for nothing else: no address, no token. Updates come with Purgatorium's releases (`/plugin marketplace update p9m`).

## Connect a project: `/p9m:init`

In Claude Code, in the project's root folder, run the line that **Let your agent deploy…** shows for the sandbox:

```
/p9m:init https://p9m.example.com shop
```

Claude Code prints a link. Open it in your browser (sign in first if Purgatorium asks). The page shows a code and the sandbox; check that the code is the one Claude Code printed and click **Approve** (or **Deny**). Only the sandbox's owner (or the admin) can approve. The code works once and expires in 10 minutes.

Then Claude Code unpacks the project's `.p9m` folder straight to disk: a new token for that sandbox only (in `.p9m/p9m.env`, 90 days) and the sandbox's Docker keys. The token never shows on the screen or in the chat. The folder keeps itself out of git, and the token is listed in Purgatorium under **My area → Access tokens** as `Claude Code init <date>`, where you can revoke it.

Run `/p9m:init` again whenever the token has expired or was revoked. A project can be tied to one sandbox at a time; another project in another folder can be tied to another sandbox, or to another Purgatorium.

## The `.p9m` folder

The `.p9m` folder in the project's root folder says which Purgatorium and which sandbox the project belongs to: `p9m.env` (the address, the sandbox's name and its token) and the sandbox's Docker keys. `/p9m:init` writes it, or you unpack it from an export zip. It holds secrets, and it keeps itself out of git: its own `.gitignore` is a single `*`. Add `.p9m` to `.dockerignore` too, so that a build never copies it into an image; the agent does when it writes one.

## Use

In your project's folder, ask in your own words, e.g. *deploy this app to my sandbox* or *give me a link to show this to someone*, or run `/p9m:deploy`. You need Docker installed on your machine (the build runs in the sandbox, but the `docker` command line talks to it). In a project without a `.p9m` folder, the agent tells you to run `/p9m:init` first.

The plugin has two skills:

- **`/p9m:init`**: ties the project to a sandbox, as above;
- **`/p9m:deploy`**: the steps of the [agent guide](https://csakaszamok.github.io/p9m/0.12/agent-guide/index.md) in short, for an agent that may be talking to someone who is not a developer. It works from `.p9m/p9m.env` with the REST API, and gets fresh Docker keys through a single-use link (unpacked to the disk, so a key never passes through the model: copied by a model a key gets garbled, and it would end up in the transcript).

The plugin does not bring the MCP server. Purgatorium still has one, for other MCP clients: see [MCP](https://csakaszamok.github.io/p9m/0.12/mcp/index.md).

## Where it works

The plugin works fully in Claude Code: in the terminal, and in the Claude desktop app's **Code** tab; also in Claude Code inside a sandbox, deploying to another one (on a local `lvh.me` stack see [An agent inside a sandbox](https://csakaszamok.github.io/p9m/0.12/agents/#an-agent-inside-a-sandbox)). Claude chat and Cowork can install it too (**Customize → Plugins**, add the marketplace `csakaszamok/p9m`), but they cannot run commands on your computer, so there it does not do much. Without the plugin, any agent can deploy with an export (**Let your agent deploy…** on a sandbox) or a token: see [Let your agent deploy](https://csakaszamok.github.io/p9m/0.12/agents/index.md).
