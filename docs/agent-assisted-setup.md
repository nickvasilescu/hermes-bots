# Agent-assisted source setup

Korgo Bot can be used directly from this repository without a packaged or notarized macOS application.

> **Linux SSH-only is a different SKU.** Do not use this source/dev setup with
> a real identity, gateway credential, or Mini connection. Linux operators must
> follow the packaged, contained
> [`Korgo Linux SSH-only operations`](./korgo-linux-ssh-only.md) runbook. That
> path has no local setup/bootstrap fallback and does not ask for provider,
> Orgo, Composio, or Tailscale credentials.

## Give this prompt to your coding agent

Replace `<workspace>` with the directory where you want the repository:

```text
Set up Korgo Bot from source on this Mac.

1. Clone https://github.com/nickvasilescu/hermes-bots.git into <workspace>/hermes-bots.
2. Read README.md, AGENTS.md, and apps/desktop/AGENTS.md before changing or running anything.
3. Do not delete or reset ~/.hermes; it may contain existing profiles and conversations.
4. Install missing prerequisites only after telling me what is missing. The project requires Git, Node.js 22.22+, npm, uv, and Python 3.11.
5. From the repository root run ./scripts/setup-hermes-bots.sh --verify.
6. Start the app with npm --workspace apps/desktop run dev:bot.
7. Wait for the Korgo Bot window and report any setup error exactly. Do not run generic `hermes update`; this product pins its compatible runtime path.
```

## Manual equivalent

```bash
git clone https://github.com/nickvasilescu/hermes-bots.git
cd hermes-bots
./scripts/setup-hermes-bots.sh --verify --run
```

The setup script is idempotent: it installs dependencies from the committed lockfiles and can be run again after pulling changes.

## What the script changes

Inside the checkout it:

- creates or updates the project-managed Python environment through `uv sync --locked`;
- installs JavaScript dependencies through `npm ci`;
- optionally type-checks the Electron, renderer, and E2E projects;
- optionally launches the Bot SKU.

It does not:

- delete or reset `~/.hermes`;
- create an Orgo computer;
- save provider, Orgo, Composio, or Tailscale credentials;
- install a background service;
- change the generic Hermes installation.

Cloud resources and credentials are configured only after the app opens and the user explicitly follows the first-run guide.

That statement applies to the generic/source Bot flow documented here. It does
not authorize credential entry in the Linux SSH-only SKU; Mini owns Hermes
configuration, credentials, profiles, cron, messaging, MCPs, and WebCTX.

## Updating a source checkout

```bash
git pull --ff-only
./scripts/setup-hermes-bots.sh --verify
npm --workspace apps/desktop run dev:bot
```

Do not run the generic in-app Hermes updater for this product. Source users update by pulling a reviewed Korgo Bot commit and rerunning the setup script.

## Common setup failures

### `uv: command not found`

Install `uv` from its [official installation guide](https://docs.astral.sh/uv/getting-started/installation/), then rerun the script.

### Node.js is too old

Install a current Node.js 22 LTS or newer release. Confirm with:

```bash
node --version
npm --version
```

### Electron does not open

Run the launch command in a terminal and preserve its complete output:

```bash
npm --workspace apps/desktop run dev:bot
```

Include that output, macOS version, Node version, and the current Git commit when filing an issue.
