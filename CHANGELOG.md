# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[SemVer](https://semver.org/). Pre-1.0: anything may change.

## [Unreleased]

## [0.1.0] — 2026-09-11

First runnable slice: five SEP-41 read checks against testnet.

### Added

- `decimals`, `balance`, `allowance`, `name`, `symbol` checks with
  PASS/FAIL/SKIPPED/UNVERIFIABLE/NOT_IMPLEMENTED verdicts and evidence.
- Contract-spec introspection: real NOT_IMPLEMENTED for WASM tokens,
  graceful fallback for SACs.
- `sep41-guard` CLI with tri-state exit codes (0 conformant / 1 violation /
  2 unknown) and a terminal report with per-status and per-layer summary.
- Tier-0 Friendbot funding with retry verification.
- Offline unit suite (fixtures, stub-server checks) + env-gated live tests.
- CI: typecheck + Biome + unit on every push, pinned actions.
- Project docs: SECURITY.md, CONTRIBUTING.md, Code of Conduct, issue
  templates, Dependabot.
