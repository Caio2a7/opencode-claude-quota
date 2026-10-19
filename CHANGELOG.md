# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-19

### Added

- OpenCode V2 CLI/TUI plugin rendering a "Claude Quota" block in the session sidebar (`sidebar.content` slot).
- 5-hour session and weekly limits, plus optional per-model weekly limits (Opus, Sonnet).
- Weekly usage breakdown by surface (Claude Code, Chats, Cowork, …) and extra paid usage when enabled.
- Cross-instance coordination through `${XDG_CACHE_HOME:-~/.cache}/opencode-claude-quota/state.json` (`0700`/`0600`, atomic rename) and `fetch.lock`: shared snapshot cache, single-flight requests, `Retry-After` support and persisted exponential backoff (2m → 30m).
- `User-Agent: claude-code/<installed version>` header (fallback `claude-code/2.1.287`) to avoid endpoint throttling on `GET https://api.anthropic.com/api/oauth/usage`.
- Polite polling with a 120s default (60s minimum), stale-while-error / rate-limit display, debounced post-turn refresh (only when the shared snapshot is older than 60s) and `/claude-quota` slash command / command-palette entry.
- Options: `refreshInterval`, `showBreakdown`, `showModels`, `credentialsPath`.
- Strictly read-only credential lookup (`CLAUDE_CODE_OAUTH_TOKEN`, `~/.claude/.credentials.json`, macOS Keychain).

[Unreleased]: https://github.com/Caio2a7/opencode-claude-quota/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Caio2a7/opencode-claude-quota/releases/tag/v0.1.0
