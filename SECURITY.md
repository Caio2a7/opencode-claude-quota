# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |
| < 0.1   | No        |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Security Advisories: open the repository's **Security** tab and
choose **Report a vulnerability**. Do not open a public issue for security problems.

Include the affected version, steps to reproduce and the impact. You can expect an acknowledgement and a fix or
mitigation plan as soon as the report is triaged.

## Scope

What the plugin does, and what is therefore in scope:

- Reads Claude Code OAuth credentials **read-only** from `CLAUDE_CODE_OAUTH_TOKEN`, `~/.claude/.credentials.json` (or `credentialsPath`), or macOS Keychain (`security find-generic-password -s "Claude Code-credentials" -w` on macOS when the file is absent).
- Sends a single `GET https://api.anthropic.com/api/oauth/usage` request over HTTPS with the user's OAuth token. The token is never logged, written or cached to disk, and is never refreshed.
- Writes a local usage snapshot cache to `${XDG_CACHE_HOME:-~/.cache}/opencode-claude-quota/state.json` (directory `0700`, files `0600`, atomic temp-file rename) containing only usage percentages, reset timestamps and error backoff state — never credentials.
- Spawns child processes with fixed argument lists, `shell: false` and a short timeout: `claude --version` (3 s timeout, once per TUI process) and `security` (5 s timeout, macOS only).
- Sends no telemetry and has zero runtime dependencies.
- v0.1.0 was published manually; releases from v0.1.1 onward are published from GitHub Actions via npm trusted publishing (OIDC) with provenance.

Out of scope: vulnerabilities in OpenCode itself, in Claude Code (`claude`), in Anthropic's API endpoints, or in your operating system.
