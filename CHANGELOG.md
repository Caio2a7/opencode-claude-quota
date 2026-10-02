# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0]

### Added

- OpenCode v2 CLI plugin rendering a "Claude Quota" block in the session sidebar.
- 5-hour session and weekly limits, optional per-model weekly limits (Opus, Sonnet).
- Weekly usage breakdown by surface and extra paid usage when enabled.
- Polling with a 60s default (30s minimum), exponential backoff, rate-limit awareness and stale-while-error display.
- Debounced refresh when a session finishes a turn and the `/claude-quota` slash command / palette entry.
- Options: `refreshInterval`, `showBreakdown`, `showModels`, `credentialsPath`.
- Strictly read-only credential lookup (`CLAUDE_CODE_OAUTH_TOKEN`, `~/.claude/.credentials.json`, macOS Keychain).
