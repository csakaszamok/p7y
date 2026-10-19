# Claude Code plugin

New to this?

[Put your app online with Claude Code](https://p7y-dev.github.io/p7y/0.8/tutorials/claude-code/index.md) walks through it step by step.

The `p7y` plugin connects Claude Code to your Purgatory and teaches it to deploy: you say *put my app online*, it picks or creates a sandbox, wakes it, deploys the project to the sandbox's own Docker, checks that the app answers and gives you its address.

## Install

In Claude Code:

```
/plugin marketplace add p7y-dev/p7y
/plugin install p7y@p7y
```

Or from a terminal, without starting Claude (a sandbox's **Let your agent deploy…** gives this, filled in, after **Create token**). Claude Code in an editor (the VS Code extension) has no `/plugin`, so there it is the way:

```
claude plugin marketplace add p7y-dev/p7y
claude plugin install p7y@p7y --scope user --config p7y_url=https://p7y.example.com --config p7y_token=p7y_…
```

(that leaves the token in the shell's history).

Claude Code asks where to install it: **user** (every folder of yours; usually what you want), **project** (this repository, for everyone who uses it, through its `.claude/settings.json`) or **local** (this folder, only you). Then it asks for two things, which a sandbox's **Let your agent deploy…** shows, ready to copy:

- **Purgatory address**: as in your browser, e.g. `https://p7y.example.com`;
- **Purgatory access token**: **Create token** there makes one for that sandbox only (it starts with `p7y_` and is shown once). Claude Code keeps it in your system's secure storage, not in a file.

Change them later with `/plugin` → p7y. Updates come with Purgatory's releases (`/plugin marketplace update p7y`).

### Which token

- **For one sandbox** (the default): the safest; the agent can use that sandbox and nothing else, and cannot create sandboxes. For another project with another sandbox, download that sandbox's zip into it (below): the agent uses the `.p7y` folder's own token for it.
- **For all your sandboxes** (Advanced view → **Access tokens** → **+ New token**): handy with many sandboxes; the agent picks the sandbox by the project's name, asks when it is not clear, and creates one when there is none.

## The `.p7y` folder

The plugin ties each project to its sandbox with a `.p7y` folder in the project's root folder: the sandbox's name, its Docker keys (and, from an export, a token). The agent writes it the first time it deploys a project, or unpacks it from an export zip. It holds secrets, and it keeps itself out of git: its own `.gitignore` is a single `*`. Add `.p7y` to `.dockerignore` too, so that a build never copies it into an image; the agent does when it writes one.

## Use

In your project's folder, ask in your own words, e.g. *deploy this app to my sandbox* or *give me a link to show this to someone*, or run `/p7y:deploy`. You need Docker installed on your machine (the build runs in the sandbox, but the `docker` command line talks to it).

The plugin has:

- the **p7y MCP server**: your Purgatory's [MCP](https://p7y-dev.github.io/p7y/0.8/mcp/index.md) at `<address>/mcp`, with your token: list, create, wake and put sandboxes to sleep, their apps and files;
- the **deploy skill** (`/p7y:deploy`): the steps of the [agent guide](https://p7y-dev.github.io/p7y/0.8/agent-guide/index.md) in short, for an agent that may be talking to someone who is not a developer.

## Where it works

The plugin works fully in Claude Code: in the terminal, and in the Claude desktop app's **Code** tab. Claude chat and Cowork can install it too (**Customize → Plugins**, add the marketplace `p7y-dev/p7y`), but there only the skill works: they do not ask for the address and the token, so the MCP server is not connected. Without the plugin, any agent can deploy with an export (**Let your agent deploy…** on a sandbox) or a token: see [Let your agent deploy](https://p7y-dev.github.io/p7y/0.8/agents/index.md).
