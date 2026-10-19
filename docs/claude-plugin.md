# Claude Code plugin

The `p7y` plugin connects Claude Code to your Purgatory and teaches it to deploy: you say *put my app online*, it picks or creates a sandbox, wakes it, deploys the project to the sandbox's own Docker, checks that the app answers and gives you its address.

## Install

In Claude Code:

```
/plugin marketplace add p7y-dev/p7y
/plugin install p7y@p7y
```

Claude Code asks for two things:

- **Purgatory address**: as in your browser, e.g. `https://p7y.example.com`;
- **Purgatory access token**: in Purgatory, **Access tokens → + New token** (it starts with `p7y_`). Claude Code keeps it in your system's secure storage, not in a file. A token limited to one sandbox keeps the agent away from your others.

Change them later with `/plugin` → p7y. Updates come with Purgatory's releases (`/plugin marketplace update p7y`).

## Use

In your project's folder, ask in your own words, e.g. *deploy this app to my sandbox* or *give me a link to show this to someone*, or run `/p7y:deploy`. You need Docker installed on your machine (the build runs in the sandbox, but the `docker` command line talks to it).

The plugin has:

- the **p7y MCP server**: your Purgatory's [MCP](mcp.md) at `<address>/mcp`, with your token: list, create, wake and put sandboxes to sleep, their apps and files;
- the **deploy skill** (`/p7y:deploy`): the steps of the [agent guide](agent-guide.md) in short, for an agent that may be talking to someone who is not a developer.

## Where it works

The plugin works fully in Claude Code: in the terminal, and in the Claude desktop app's **Code** tab. Claude chat and Cowork can install it too (**Customize → Plugins**, add the marketplace `p7y-dev/p7y`), but there only the skill works: they do not ask for the address and the token, so the MCP server is not connected. Without the plugin, any agent can deploy with an export (**Let your agent deploy…** on a sandbox) or a token: see [Let your agent deploy](agents.md).
