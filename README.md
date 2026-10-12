# Prompt Studio CLI

Use your [Prompt Studio](https://promptstudio.app) library from the terminal. `ps` is an MCP client for the hosted server at `https://mcp.promptstudio.app/mcp`. It signs you in with the same browser account as the workspace and the iOS app. There is no API key.

The `promptstudio` command is the same program.

## Install

Node.js 20 or newer.

```bash
npm install -g @promptstudio/cli
ps login
```

Or run it once:

```bash
npx @promptstudio/cli login
```

From a checkout:

```bash
npm install
npm run build
node dist/index.js login
```

Publishing to npm still needs a person who can publish `@promptstudio/cli` (see [Before publishing](#before-publishing)).

## Sign in

```bash
ps login
ps whoami
ps logout
```

`login` opens a browser, listens on `127.0.0.1` (ports 53682–53691), and stores the OAuth client and refresh token in your config directory. The file mode is `0600` on macOS and Linux.

| Platform | Config directory |
| --- | --- |
| macOS | `~/Library/Application Support/prompt-studio-cli/` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/prompt-studio-cli/` |
| Windows | `%APPDATA%\prompt-studio-cli\` |

Override the directory with `PROMPTSTUDIO_CONFIG_DIR`. Override the server with `--server` or `PROMPTSTUDIO_MCP_URL`. The default server is `https://mcp.promptstudio.app/mcp`.

## Commands

```bash
ps list
ps list --folder Fun
ps search lighting
ps get "Ward Apple Watch: special feature ideas"
ps folders
ps credits
ps models
echo "a calm ceramic cup on a linen table" | ps save --title "Ceramic cup" --folder Fun
ps generate <prompt-id> --model flux-2-pro
```

`get` writes only the prompt text to stdout, so it can be piped:

```bash
ps get "my prompt" | pbcopy
```

`save` reads the prompt from the arguments, or from stdin when they are omitted. `--title` sets the name. `--folder` accepts a folder name or id.

`generate` queues an image through Prompt Studio, polls until it finishes, and prints the output URL. The default model is `flux-2-pro`. `ps models` lists the ids your account can use. Generation needs Pro and image credits. `--timeout` is seconds (default 180).

Add `--json` to read commands (`whoami`, `credits`, `folders`, `models`, `list`, `search`, `get`, and also `save` / `generate`) for JSON on stdout. It can sit before or after the command name: `ps --json list` or `ps list --json`.

`list` and `search` accept `--page` and `--page-size` (max 50).

## Errors

Sign-in failures (HTTP 401) say to run `ps login`. Plan and credit failures (HTTP 402) name the reason:

- Image generation needs Prompt Studio Pro.
- Image credits are used up.
- The action is over the free plan limit (for example the folder cap).

With `--json`, that object is written to stderr and the process exits 1.

## How it talks to Prompt Studio

The CLI is only an MCP client. Tool calls go to the hosted Streamable HTTP server. OAuth is authorization-code with PKCE (`S256`), dynamic client registration, and the `read` and `write` scopes. Discovery documents:

- `https://mcp.promptstudio.app/.well-known/oauth-protected-resource`
- `https://mcp.promptstudio.app/.well-known/oauth-authorization-server`

Registration is `https://mcp.promptstudio.app/register`. A loopback redirect such as `http://127.0.0.1:53682/callback` is accepted. No client secret is stored. Nothing in this repo is a credential.

Image generation is queued by Prompt Studio. This program does not run a model and does not hold a provider key.

## Develop

```bash
npm install
npm test
npm run build
```

Tests cover parsing, prompt and folder lookup, generation polling, credential file permissions, the command router, and a local OAuth login (PKCE, dynamic registration, loopback callback, and a later command that reuses the saved token).

## Before publishing

Do not publish from a pull request. A person with access to the npm org needs to confirm the package name `@promptstudio/cli` (`publishConfig.access` is `public`). If that org is unavailable, `prompt-studio-cli` is the unscoped alternative. `prepublishOnly` builds and tests.

Checked against the live authorization server on 12 Oct 2026: `POST /register` returned **201** for `http://127.0.0.1:<port>/callback` and for `http://localhost:<port>/callback`, including a client registered with several loopback ports at once. No redirect allowlist change is required for this CLI.

The same endpoint also returned 201 for non-loopback redirect URIs. The CLI only registers loopback URIs. Tightening registration to loopback is a server-side change, not a CLI change. Probe registrations created while checking that behavior can be revoked if the server has an admin view; they are public clients with no secret:

- `yU5NBKxDOZV0nUvi`
- `iKD7mykkM81DpwQV`
- `oPXZT5E_wweEnx1H`
- `X8cfKV5qXAUfEyVH`
- `trPiILDaA_eiVjMM`

## License

[MIT](LICENSE). Copyright promptalchemy.
