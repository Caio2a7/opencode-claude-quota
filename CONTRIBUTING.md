# Contributing

Thanks for helping out! Bug reports and pull requests are welcome.

## Setup

```sh
bun install
bun test
bun run typecheck
```

## Guidelines

- Keep the plugin **read-only** with respect to Claude credentials: never write, refresh or log tokens.
- No new runtime dependencies without a strong reason.
- Keep files under 300 lines and functions under 40 lines; no stubs or `any`.
- Add or update tests in `tests/` for any behaviour change (`bun:test`).
- Use [Conventional Commits](https://www.conventionalcommits.org/) and update `CHANGELOG.md`.
- The usage endpoint is unofficial; parse defensively and degrade gracefully when fields disappear.

## Local testing in OpenCode

Add the checkout to `~/.config/opencode/cli.json` (see the README) and restart OpenCode.
