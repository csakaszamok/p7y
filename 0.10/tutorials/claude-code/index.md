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

1. In the window's step **1**, click **Copy** next to each of the two lines, open a terminal (in VS Code: **Terminal → New Terminal**; on Windows also PowerShell, on a Mac the Terminal app), paste them one after the other and press Enter after each:

   ```
   claude plugin marketplace add p7y-dev/p7y
   claude plugin install p7y@p7y
   ```

   It installs the plugin for you, in all your projects. It asks for no address and no token.

Good to know

- `claude` not found? Claude Code is not installed for the terminal: see [Claude Code's setup](https://code.claude.com/docs/en/setup). An *unknown option* means an older Claude Code: run `claude update`.
- Already in Claude Code? **In Claude Code instead** in the same window shows the same two lines as `/plugin marketplace add p7y-dev/p7y` and `/plugin install p7y@p7y`. (The Claude Code panel in VS Code has no `/plugin`: use the terminal.)

You install the plugin once. Each project then gets its sandbox in the next step.

## 3. Connect the project and deploy

1. Open your app's folder in Claude Code. In Purgatory, in the window's step **2**, click **Copy** and paste the line into Claude Code. It looks like this:

   ```
   /p7y:init https://p7y.example.com shop
   ```

1. Claude Code prints a link. Open it in your browser (sign in if it asks). The page shows a code and your sandbox: check that the code is the one Claude Code printed, then click **Approve**. The code works once and expires in 10 minutes.

   Behind the scenes, Claude Code gets a token for this sandbox only, and writes it in a `.p7y` folder in your project, next to the sandbox's keys. You never see or copy the token. It is a secret, and the folder keeps itself out of git on its own; leave it there. The token expires in 90 days (run `/p7y:init` again then), and you can revoke it in Purgatory (Advanced → **Access tokens**, named `Claude Code init <date>`).

1. Now say, in your own words:

   > Deploy this app.

Claude Code wakes the sandbox, builds your app there, starts it and checks that it answers. At the end it gives you a link like `https://shop-web.example.com` (your sandbox's name first). Open it: that is your app, and it works for anyone you send it to.

## 4. Change and update

Changed something? Say:

> Update the app.

The same link shows the new version a few seconds later.

## Good to know

- **Sleep:** when nobody uses the app for a while (30 minutes by default), the sandbox sleeps to free the server. The next visit wakes it in a few seconds: the visitor sees *waking up* and then your app. Nothing is lost.
- **Sleep later:** *let it sleep only after 2 hours without visitors* works too, or set it in Purgatory: the sandbox → **Details** → **Sleep** → **Change…** (*never* is there as well).
- **It does not answer?** Ask Claude Code *why does my app not answer?*: it reads the app's logs in the sandbox. The usual cause is an app that listens only on `localhost`; Claude Code fixes that.
- **Only for you or your colleagues?** Say *make it visible only to me* (or *only to my colleagues*): Claude Code sets `p7y.access` ([App access](https://p7y-dev.github.io/p7y/0.10/app-access/index.md)), and opening the link then asks the visitor to sign in to Purgatory.
- **Docker is needed on your computer** only for its command line: the build runs in the sandbox.

## More projects

Each project is tied to one sandbox by its own `.p7y` folder. For a second project with its own sandbox (or on another Purgatory), do step 3 there: in Purgatory, on that sandbox, **Let your agent deploy…**, copy the `/p7y:init` line and paste it into Claude Code in that project. The plugin needs no new setup.

Used the earlier plugin, which asked for an address and a token? Run `/plugin marketplace update p7y` once, then `/p7y:init` in each project.

More details: [Claude Code plugin](https://p7y-dev.github.io/p7y/0.10/claude-plugin/index.md).
