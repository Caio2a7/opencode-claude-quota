# opencode-claude-quota

**Claude Code usage, quota and rate limits in the OpenCode sidebar.** An [OpenCode](https://opencode.ai) v2 TUI plugin
that shows your Claude subscription's 5-hour session and weekly limits, per-model weekly caps, weekly usage by surface
and extra paid usage, right next to your session.

```
Claude Quota
5h     ━━━━━━━━━──────  51%
       resets in 1h 10m
Week   ━───────────────   6%
       resets in 1d 22h
This week
Claude Code            86%
Chats                   7%
Cowork                  7%
updated 12s ago
```

## Features

- 5-hour session and weekly usage bars, coloured by severity (green → yellow → red).
- Per-model weekly limits (Opus, Sonnet) when your plan reports them.
- Weekly usage breakdown by surface (Claude Code, Chats, Cowork, …) and extra usage when enabled.
- Relative reset times that tick without refetching; stale data stays visible with a `(stale)` marker on errors.
- Polite polling: 60s default (30s minimum), exponential backoff, `Retry-After` support, debounced refresh after each
  finished turn.
- `/claude-quota` slash command (and command-palette entry) to force a refresh.
- Native OpenCode **v2** plugin, strictly read-only credential handling.

## Requirements

- OpenCode **v2** (`@opencode/plugin` 2.x).
- A Claude Pro/Max subscription, signed in through [Claude Code](https://claude.com/claude-code) (`claude` login) or
  `CLAUDE_CODE_OAUTH_TOKEN` set.

## Install

Add the package to `~/.config/opencode/cli.json`:

```json
{
  "plugins": ["opencode-claude-quota"]
}
```

Install methods verified against OpenCode 2.x:

- **npm-style package** (verified with a tarball from `npm pack`, entry `"file:/abs/path/opencode-claude-quota-0.1.0.tgz"`):
  OpenCode installs the package into its cache and loads the prebuilt `dist/tui.js` through `exports["./tui"]`. The
  published package ships compiled JavaScript only, because the host does not compile `.tsx` under `node_modules`.
- **Local checkout** (verified with the absolute path entry below): OpenCode loads the root `tui.tsx` shim, which
  re-exports `src/tui.tsx`. Run `bun install` in the checkout first. The shim is not part of the published package.

`opencode plugin add` only accepts npm registry or Git specifiers and was not tested.

With options:

```json
{
  "plugins": [
    {
      "package": "opencode-claude-quota",
      "options": { "refreshInterval": 90, "showBreakdown": false }
    }
  ]
}
```

From a local checkout, use its absolute path:

```json
{
  "plugins": ["/path/to/opencode-claude-quota"]
}
```

Restart OpenCode and open a session; the sidebar must be visible (`session.sidebar` is `auto` by default and needs a
wide terminal).

## Configuration

| Option            | Type    | Default | Description                                                         |
| ----------------- | ------- | ------- | ------------------------------------------------------------------- |
| `refreshInterval` | number  | `60`    | Polling interval in seconds. Values below `30` are raised to `30`.  |
| `showBreakdown`   | boolean | `true`  | Show the "This week" usage-by-surface rows (0% rows are skipped).   |
| `showModels`      | boolean | `true`  | Show per-model weekly windows (Opus, Sonnet) when present.          |
| `credentialsPath` | string  | –       | Credentials file location, used as-is (`~` is not expanded).        |

Invalid values fall back to the defaults.

## How it works

The plugin calls `GET https://api.anthropic.com/api/oauth/usage` with your Claude Code OAuth token, the same data
behind Claude Code's `/usage` screen. A single poller is shared per TUI instance, not per render.

Credentials are looked up **read-only**, in this order:

1. `CLAUDE_CODE_OAUTH_TOKEN` environment variable
2. `~/.claude/.credentials.json` (or `credentialsPath`)
3. macOS Keychain (`Claude Code-credentials`), on macOS only and only when the credentials file is missing; macOS
   may show a keychain access prompt the first time.

### Backoff

Network errors, HTTP errors and repeated "token rejected" (401/403) responses are retried with capped exponential
backoff (interval × 2^failures, at most 10 minutes). After network/HTTP errors and 429s, `/claude-quota` is blocked
until the backoff elapses; 429 honours `Retry-After` (capped at 1 hour). Missing credentials and unexpected internal
errors keep the normal interval, so a fresh `claude` login is picked up quickly.

## Privacy & security

- The token is sent only to `api.anthropic.com` over HTTPS and never leaves your machine otherwise.
- The token is never written, logged or cached to disk, and **never refreshed**: if it expired, run `claude` once.
- No cookie scraping, no browser sessions, no telemetry.
- The usage endpoint is **undocumented and unofficial**; it may change or disappear without notice. The plugin parses
  it defensively and shows a muted message instead of failing.

## Troubleshooting

| Symptom                                   | Fix                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| "Claude Code credentials not found"       | Run `claude` and log in, or set `CLAUDE_CODE_OAUTH_TOKEN`.                  |
| "token expired"                           | Run `claude` once so Claude Code refreshes its own token.                   |
| Nothing in the sidebar                    | Open a session, widen the terminal and check `session.sidebar` in `cli.json`. |
| Numbers look stale                        | Run `/claude-quota`; refreshes are debounced to one request per 30s.        |
| Rate limited                              | The plugin backs off automatically; raise `refreshInterval`.                |

Plugin load errors are logged to `~/.local/share/opencode/log/opencode.log`.

## Why not the v1 plugins?

OpenCode v1 usage plugins target the old TUI plugin API and do not load on v2. This plugin is built on
`@opencode/plugin/tui` and the v2 slot system, and keeps credential access read-only.

## Development

```sh
bun install
bun test
bun run typecheck
bun run build   # compiles dist/tui.js (also runs on npm pack)
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
