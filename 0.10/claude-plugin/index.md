# Claude Code plugin

New to this?

[Put your app online with Claude Code](https://p7y-dev.github.io/p7y/0.10/tutorials/claude-code/index.md) walks through it step by step.

The `p7y` plugin teaches Claude Code to deploy: you say *put my app online*, it deploys the project to your sandbox's own Docker, checks that the app answers and gives you its address. The plugin itself keeps no address and no token: each project says which Purgatory and which sandbox it belongs to, in its own `.p7y` folder.

## Install

Once on your computer, from a terminal (a sandbox's **Let your agent deploy…** shows these lines ready to copy). Claude Code in an editor (the VS Code extension) has no `/plugin`, so there this is the way:

```
claude plugin marketplace add p7y-dev/p7y
claude plugin install p7y@p7y
```

Or in Claude Code:

```
/plugin marketplace add p7y-dev/p7y
/plugin install p7y@p7y
```

Claude Code asks where to install it: **user** (every folder of yours; usually what you want), **project** (this repository, for everyone who uses it, through its `.claude/settings.json`) or **local** (this folder, only you). It asks for nothing else: no address, no token. Updates come with Purgatory's releases (`/plugin marketplace update p7y`).

## Connect a project: `/p7y:init`

In Claude Code, in the project's root folder, run the line that **Let your agent deploy…** shows for the sandbox:

```
/p7y:init https://p7y.example.com shop
```

Claude Code prints a link. Open it in your browser (sign in first if Purgatory asks). The page shows a code and the sandbox; check that the code is the one Claude Code printed and click **Approve** (or **Deny**). Only the sandbox's owner (or the admin) can approve. The code works once and expires in 10 minutes.

Then Claude Code unpacks the project's `.p7y` folder straight to disk: a new token for that sandbox only (in `.p7y/p7y.env`, 90 days) and the sandbox's Docker keys. The token never shows on the screen or in the chat. The folder keeps itself out of git, and the token is listed in Purgatory under **Access tokens** as `Claude Code init <date>`, where you can revoke it.

Run `/p7y:init` again whenever the token has expired or was revoked. A project can be tied to one sandbox at a time; another project in another folder can be tied to another sandbox, or to another Purgatory.

## The `.p7y` folder

The `.p7y` folder in the project's root folder says which Purgatory and which sandbox the project belongs to: `p7y.env` (the address, the sandbox's name and its token) and the sandbox's Docker keys. `/p7y:init` writes it, or you unpack it from an export zip. It holds secrets, and it keeps itself out of git: its own `.gitignore` is a single `*`. Add `.p7y` to `.dockerignore` too, so that a build never copies it into an image; the agent does when it writes one.

## Use

In your project's folder, ask in your own words, e.g. *deploy this app to my sandbox* or *give me a link to show this to someone*, or run `/p7y:deploy`. You need Docker installed on your machine (the build runs in the sandbox, but the `docker` command line talks to it). In a project without a `.p7y` folder, the agent tells you to run `/p7y:init` first.

The plugin has two skills:

- **`/p7y:init`**: ties the project to a sandbox, as above;
- **`/p7y:deploy`**: the steps of the [agent guide](https://p7y-dev.github.io/p7y/0.10/agent-guide/index.md) in short, for an agent that may be talking to someone who is not a developer. It works from `.p7y/p7y.env` with the REST API, and gets fresh Docker keys through a single-use link (unpacked to the disk, so a key never passes through the model: copied by a model a key gets garbled, and it would end up in the transcript).

The plugin does not bring the MCP server. Purgatory still has one, for other MCP clients: see [MCP](https://p7y-dev.github.io/p7y/0.10/mcp/index.md).

## Upgrading from the earlier plugin

The earlier plugin asked for an address and a token and kept them for the whole machine. Run `/plugin marketplace update p7y`, then `/p7y:init` once in each project. Those older settings are not used any more.

## Where it works

The plugin works fully in Claude Code: in the terminal, and in the Claude desktop app's **Code** tab; also in Claude Code inside a sandbox, deploying to another one (on a local `lvh.me` stack see [An agent inside a sandbox](https://p7y-dev.github.io/p7y/0.10/agents/#an-agent-inside-a-sandbox)). Claude chat and Cowork can install it too (**Customize → Plugins**, add the marketplace `p7y-dev/p7y`), but they cannot run commands on your computer, so there it does not do much. Without the plugin, any agent can deploy with an export (**Let your agent deploy…** on a sandbox) or a token: see [Let your agent deploy](https://p7y-dev.github.io/p7y/0.10/agents/index.md).
