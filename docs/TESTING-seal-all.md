# Testing `seal/all`

`seal/all` is a testing-only integration branch: `main` plus merge commits of every Seal
feature branch (rebrand, home-overview, machines, home-chat, multi-account, live-sessions),
wired together. It is re-merged as the feature branches move; do not build on it.

## Before you start: quit Orca

Seal keeps its profile in its own folder (`~/Library/Application Support/Seal`,
`~/.config/Seal`), but it still shares `~/.orca` (runtime metadata, agent hook state, the
orcad secret store) and the agent CLIs' own homes with an installed Orca. Quit Orca
(Cmd-Q, not just closing the window) and stop any `orca serve` / `orca-serve.service` on the
same machine for the whole test session, or the two apps will fight over the same runtime
files and terminal daemon.

## 1. Build and install the Mac app (unsigned, Apple silicon)

Needs macOS 13.4+, Xcode command line tools, Node 24 and pnpm 12 (via corepack).

```bash
xcode-select --install                     # once; Swift helpers and native rebuilds need it
brew install node@24 && brew link --overwrite --force node@24
corepack enable

git clone https://github.com/brokespace/seal.git
cd seal
git checkout seal/all
pnpm install
pnpm -C mobile install --frozen-lockfile   # build:desktop also builds the mobile web bundle

# Typecheck, build all assets and native helpers, then package one arm64 Seal.app.
# identity=- ad-hoc signs the whole bundle (no Apple certificate needed); hardened runtime
# and notarization stay off for local builds.
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm build:mac --arm64 -c.mac.target=dir -c.mac.identity=-

ditto dist/mac-arm64/Seal.app /Applications/Seal.app
```

Opening it past Gatekeeper: a locally built app is not quarantined, so it usually opens
directly. If you copied it from another machine (AirDrop, a download, a zip), clear the
quarantine flag first:

```bash
xattr -dr com.apple.quarantine /Applications/Seal.app
codesign --verify --deep --strict /Applications/Seal.app && open /Applications/Seal.app
```

If macOS still says it "can't be opened", right-click Seal.app → **Open** → **Open**, or
System Settings → Privacy & Security → **Open Anyway**. Because the build is ad-hoc signed,
macOS asks for folder/automation permissions again after every rebuild.

To get a zip instead of a folder, use `-c.mac.target=zip` (written to `dist/`).

Install the CLI from the app: Settings → CLI → Install, which registers `/usr/local/bin/seal`
(Orca keeps `orca`).

## 2. Build, install and run the server runtime on Linux (x86_64)

Build the server-only tarball (orcad, its pinned Node 24 and the CLI launcher). Needs Node 24,
pnpm 12, `git`, and a C/C++ toolchain for the node-pty prebuild (`build-essential`, `python3`).

```bash
git clone https://github.com/brokespace/seal.git
cd seal
git checkout seal/all
corepack enable
pnpm install
pnpm -C mobile install --frozen-lockfile

pnpm build:mobile-web                      # orcad serves the mobile web bundle
pnpm build:orcad                           # sanity build of the orcad bundle (must stay ASCII)
pnpm build:orcad-template --targets linux-x64-glibc
pnpm build:packages
SOURCE_DATE_EPOCH="$(git log -1 --format=%ct)" node \
  config/scripts/orcad-distribution/server-artifact/pack-orcad-server-artifact.mjs \
  --template out/orcad-template --target linux-x64-glibc --out-dir out/orca-server
# -> out/orca-server/orca-server-linux-x64.tar.gz
```

Install it for your user and expose it as `seal` (the bundled launcher keeps upstream's
`orca-ide` file name):

```bash
mkdir -p ~/.local/opt/seal-server ~/.local/bin
tar -xzf out/orca-server/orca-server-linux-x64.tar.gz -C ~/.local/opt/seal-server --strip-components=1
ln -sf ~/.local/opt/seal-server/bin/orca-ide ~/.local/bin/seal
```

Install and log in to `claude`, `codex`, `git` and `tmux` (3.0+) on the server itself; the
server uses its own logins, not the Mac's.

### Run it in tmux (quickest)

```bash
TS_IP=$(tailscale ip -4)                   # or the LAN IP the Mac can reach
tmux new-session -d -s seal-server \
  "~/.local/bin/seal serve --bind $TS_IP --pairing-address $TS_IP --port 6768 2>&1 | tee ~/seal-serve.log"
grep 'Pairing URL' ~/seal-serve.log        # the access link for the Mac
```

### Or run it as a systemd user service

```bash
~/.local/bin/seal serve service install --command ~/.local/bin/seal \
  --port 6768 --bind "$TS_IP" --pairing-address "$TS_IP"
loginctl enable-linger "$USER"             # keep it running after logout
~/.local/bin/seal serve service status
journalctl --user -u seal-serve.service -f
~/.local/bin/seal pair --address "$TS_IP"  # the service never logs a link; mint one here
```

The unit is named `seal-serve.service`, so it can run next to an Orca server's
`orca-serve.service` on the same account. Remove it with `seal serve service uninstall`.

If the server is bound to `127.0.0.1` (for SSH tunnelling), `seal pair` cannot expose it for
pairing; use the `Pairing URL` printed at startup and connect through
`ssh -L 6768:127.0.0.1:6768 <server>`.

### Connect the Mac

In Seal on the Mac: Settings → **Machines** → **Add machine** → **Connect via Seal server
(pairing link)**, name it, paste the pairing URL and add it. Keep both machines on the same
tailnet or LAN; never expose the port to the internet.

Or choose **Connect over SSH** and enter its SSH details: every feature works over SSH alone,
and Seal installs nothing on the box. A machine can hold both; the **SSH / Seal server**
switch on its row picks the one Seal uses. See [machines.md](machines.md).

## 3. Feature checklist

### Rebrand

- [ ] Window title, menus, About, tray, Dock and onboarding say **Seal**; the icon is the Seal placeholder.
- [ ] Settings → Updates shows no upstream update feed; Help → feedback/crash report points at Seal's issue tracker.
- [ ] Settings → CLI installs `seal` (an installed Orca's `orca` is untouched); `seal --help` works.
- [ ] Seal and Orca can be installed side by side (`com.brokespace.seal` vs `com.stablyai.orca`).

### Home overview

- [ ] With at least one project, **Home** in the sidebar opens the overview; first launch without projects still shows the Landing onboarding (no chat there).
- [ ] Sessions panel groups by machine and project and includes (a) agents in Seal panes and (b) Claude Code/Codex sessions started outside Seal (plain terminal, tmux, SSH host). Finished external transcripts do not appear here.
- [ ] Clicking a Seal-pane session reveals its pane; clicking an external session opens **Agent sessions** with that session selected.
- [ ] Needs-attention strip shows waiting/permission sessions, failed machines and accounts at 80%+.
- [ ] Machines panel lists this computer, SSH hosts and paired runtimes with live status and CPU/memory from the machines service; **Manage** opens the Machines page.
- [ ] Accounts panel lists every enabled Claude/Codex vault account (active one first) with 5h/7d usage, plus other providers' rate limits; local Seal-pane sessions show the account they launched on.
- [ ] Worktrees & PRs and Automations panels show real data; links open the right pages.

### Home chat (assistant)

- [ ] The assistant panel sits in Home's chat slot above the overview (not beside Landing).
- [ ] Settings popover: pick Claude Code (headless, uses a saved Claude account) or an OpenAI-compatible endpoint; send a message and see streaming.
- [ ] `list_machines`, run a command locally and on an SSH host, read/write/transfer a file.
- [ ] A `seal_cli` tool card shows `seal …`; `worktree rm` and `terminal send --interrupt` ask for approval first.
- [ ] Spawn a subagent (agent mode creates a worktree with a coding agent; assistant mode runs in the background) and get its completion notice.
- [ ] Memory dialog (rules/facts/journal), routines, web search, attachments, chat switch/delete all persist across a restart.

### Machines

- [ ] A host saved earlier as both an SSH host and a remote server shows up once, connected via Seal server, with its SSH details kept (Settings → Machines shows both).
- [ ] Switching that machine to SSH and back changes only the badge: stats, files, terminal, agents, worktrees, live sessions and home-chat tools keep working.
- [ ] Settings has one **Machines** section (no separate SSH Hosts / Remote Seal Servers); old links to either land there.
- [ ] Sidebar **Machines** lists this computer and every machine with status, OS, CPU/RAM/disk and running agents.
- [ ] Worktrees on a machine: enter a repo path, create a worktree, open a terminal or agent in it, remove it.
- [ ] Quick actions: terminal, open in editor, connect/reconnect, edit, remove.
- [ ] File explorer on local, SSH and paired-runtime machines: browse, upload (drag in), download/drag out, URL download, rename, delete, new folder, previews (image, PDF, markdown, code); transfers panel shows progress.
- [ ] A Windows SSH host reports stats and supports URL download.
- [ ] A terminal opens on every machine, over SSH or the Seal server.

### Multi-account

- [ ] Settings → Accounts is one page: Claude, Codex and API keys groups, then Auto-swap, Rules, Running sessions, Swap history and Other providers. No account appears twice, and there is no machine dropdown in the header.
- [ ] Each card shows alias, email and organisation, plan, health (Working, Expires <date>, Login rejected), 5h and 7d bars with reset times, the next-swap estimate, running sessions and a chip per machine holding the login.
- [ ] Add account → Claude: browser sign-in with the pasted code, "Use Claude login <email>" for this computer's login, and a pasted `claude setup-token`. Cancelling or closing the dialog leaves no `claude` process (`pgrep -fl claude`).
- [ ] Add account → Codex: browser or device code, and "Use Codex login <email>". No `codex` process is left afterwards.
- [ ] This computer's own `~/.claude` and `~/.codex` logins are tagged "System login" and can be removed: "Remove from Seal" keeps the CLI signed in, "Remove and log out" signs it out. Either way the account stays gone after Refresh usage and after a restart, until it is imported again.
- [ ] Drag a card (or focus its handle and use the arrow keys) to change priority; Rename, Sign in again, Push to machine and Remove work from the card menu.
- [ ] With a second machine paired, the summary reads "N accounts across 2 machines", Push to machine adds that machine's chip, and Sync to machines copies logins and rules.
- [ ] Turn on auto-swap for Claude, push one account near its threshold, and watch a new session launch on another account; running sessions swap on polled 5h/7d usage and the move is listed under Swap history.
- [ ] A Seal-launched agent tab shows its account badge; the badge menu moves the session (Claude live, Codex by resume) and the toast says which.
- [ ] Push to machine lists every Seal server and every connected SSH machine. Pushing to an SSH machine installs the login there (Claude via the login Keychain on a Mac), adds its chip, and says swap rules only run where a Seal server runs.
- [ ] Home → Accounts card lists the same accounts with compact usage, and Manage opens Settings → Accounts.
- [ ] `seal account usage` prints one aligned table per provider; `seal account import|remove|order|token add|key add|key rm` change the same roster the page shows. `seal account current|swap|pick|alias|autoswap|policy|pin|sync|sessions --help` all print `seal account …` usage; `--environment <id>` targets the Linux server.
- [ ] On the Linux server: `seal account usage --json` answers from its own vault.

### Live sessions

- [ ] Sidebar **Agent sessions** lists Claude Code and Codex sessions on this Mac and every connected SSH host, by machine, with live status.
- [ ] Selecting one streams its transcript; sending a message shows queued → sent → delivered only once the transcript confirms it (Codex via `codex queue`).
- [ ] Permission prompts can be answered from the page.
- [ ] Settings → Agents → shell integration (and an SSH host's menu) installs the `tmux -L seal` wrapper; new `claude`/`codex` runs become deliverable via tmux. `seal shell-integration status --json` agrees.
- [ ] **Take over** stops an external session and resumes it in a Seal pane.
- [ ] Works the same against the paired Linux server (its sessions show under that machine).

### Cross-cutting

- [ ] Everything above also works with the Mac connected to the Linux server (remote host), and in a folder (non-git) workspace where relevant.
- [ ] Quit and relaunch: Home, Machines and Agent sessions restore without errors in the console.
