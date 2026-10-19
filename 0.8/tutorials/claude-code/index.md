# Put your app online with Claude Code

You have an app on your computer (a website, a dashboard, a small tool) and you want a link to it that works for anyone. Claude Code builds and runs it in your Purgatory sandbox and gives you that link.

**What you need:** Claude Code (in a terminal, or the **Code** tab of the Claude desktop app), [Docker](https://docs.docker.com/get-docker/) installed on your computer, and a Purgatory account.

## 1. Make a sandbox

1. Open your Purgatory address in the browser and sign in.
1. Click **+ New sandbox**, give it a short name (for example `shop`), keep the template and click **Create**. It takes 10–30 seconds.

A sandbox is your own small server: your app runs there, not on your computer.

Simple or Advanced

The switch at the top right changes how much the screen shows. **Simple** is enough for everything here.

## 2. Install the p7y plugin in Claude Code (once)

1. In Purgatory, click your sandbox, then **Let your agent deploy…**.

1. Click **Create token**. It makes a token that works only for this sandbox, and shows it once.

1. Below it appears a command with your address and the new token in it. Click **Copy**, open a terminal (in VS Code: **Terminal → New Terminal**; on Windows also PowerShell, on a Mac the Terminal app), paste it and press Enter:

   ```
   claude plugin marketplace add p7y-dev/p7y
   claude plugin install p7y@p7y --scope user --config p7y_url=https://p7y.example.com --config p7y_token=p7y_…
   ```

   It installs the plugin for you (**user**: in all your projects) and gives it the address and the token; Claude Code keeps the token in your system's secure storage.

Good to know

- `claude` not found? Claude Code is not installed for the terminal: see [Claude Code's setup](https://code.claude.com/docs/en/setup). An *unknown option* means an older Claude Code: run `claude update`.
- The pasted line can stay in the terminal's history, token included. The token works only for this sandbox, expires in 90 days, and you can revoke it in Purgatory (Advanced → **Access tokens**).
- Rather not paste a token? **Other ways** in the same window: run `claude` in a terminal, then `/plugin marketplace add p7y-dev/p7y` and `/plugin install p7y@p7y` in it, and paste the address and the token when it asks. (The Claude Code panel in VS Code has no `/plugin`.)

You do this once. For another sandbox later, see [More projects](#more-projects) below.

## 3. Deploy

Open your app's folder in Claude Code and say, in your own words:

> Deploy this app.

Claude Code wakes the sandbox, builds your app there, starts it and checks that it answers. At the end it gives you a link like `https://shop-web.example.com` (your sandbox's name first). Open it: that is your app, and it works for anyone you send it to.

It also creates a `.p7y` folder in your project: it remembers which sandbox belongs to this project and holds its keys. It is a secret, and it keeps itself out of git on its own; leave it there.

## 4. Change and update

Changed something? Say:

> Update the app.

The same link shows the new version a few seconds later.

## Good to know

- **Sleep:** when nobody uses the app for a while (30 minutes by default), the sandbox sleeps to free the server. The next visit wakes it in a few seconds: the visitor sees *waking up* and then your app. Nothing is lost.
- **Sleep later:** *let it sleep only after 2 hours without visitors* works too, or set it in Purgatory: the sandbox → **Details** → **Sleep** → **Change…** (*never* is there as well).
- **It does not answer?** Ask Claude Code *why does my app not answer?*: it reads the app's logs in the sandbox. The usual cause is an app that listens only on `localhost`; Claude Code fixes that.
- **Docker is needed on your computer** only for its command line: the build runs in the sandbox.

## More projects

The token you created works for one sandbox. For a second project with its own sandbox:

- **Easiest:** in Purgatory, on the other sandbox, **Let your agent deploy…** → **Download**, then in that project say *set up the p7y zip from my Downloads in this project and deploy*. Claude Code puts it in that project's `.p7y` folder and uses it from then on.
- **Many sandboxes:** give the plugin a token for all your sandboxes instead (switch to **Advanced** → **Access tokens** → **+ New token**, then in Claude Code `/plugin` → p7y → configure). Then Claude Code picks the sandbox by the project's name, asks when it is not sure, and creates one when there is none.

More details: [Claude Code plugin](https://p7y-dev.github.io/p7y/0.8/claude-plugin/index.md).
