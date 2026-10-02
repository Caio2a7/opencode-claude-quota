# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Persistent HTTP 429 caused by the non-Claude-Code user agent: requests now identify as `claude-code/<installed
  version>` (fallback `2.1.287`), which the usage endpoint does not throttle. Cache files from earlier versions
  (state schema v1) are discarded, so an old persisted 429 block does not outlive the upgrade.
- Running several OpenCode instances at once no longer triggers HTTP 429: instances share one cached snapshot, one
  cross-process fetch lock and one persisted backoff, so N windows make about one request per interval.
- Rate limiting no longer looks like an error: the sidebar keeps showing the data and adds a muted
  "rate limited · retry in Xm" line.

### Changed

- Default `refreshInterval` is now 120s (was 60s) and the minimum is 60s (was 30s).
- A refresh after a finished turn only fetches when the shared snapshot is older than 60s.
- 429 responses honour `Retry-After`; without it the block grows 2m, 4m, 8m… up to 30m and resets on success. Network
  and HTTP errors share the same persisted backoff.
- The sidebar renders immediately from the shared cache on startup.

## [0.1.0]

### Added

- OpenCode v2 CLI plugin rendering a "Claude Quota" block in the session sidebar.
- 5-hour session and weekly limits, optional per-model weekly limits (Opus, Sonnet).
- Weekly usage breakdown by surface and extra paid usage when enabled.
- Polling with a 60s default (30s minimum), exponential backoff, rate-limit awareness and stale-while-error display.
- Debounced refresh when a session finishes a turn and the `/claude-quota` slash command / palette entry.
- Options: `refreshInterval`, `showBreakdown`, `showModels`, `credentialsPath`.
- Strictly read-only credential lookup (`CLAUDE_CODE_OAUTH_TOKEN`, `~/.claude/.credentials.json`, macOS Keychain).
