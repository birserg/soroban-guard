# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[SemVer](https://semver.org/). Pre-1.0: anything may change.

Conventions: new entries go under `[Unreleased]` in the order Breaking,
Added, Changed, Fixed, Removed. A released section is immutable — correct a
released claim by adding an entry to `[Unreleased]`, never by rewriting
history someone may already have read. Reference issues as
`([#12](https://github.com/birserg/soroban-guard/issues/12))` and credit
outside contributors by handle. Entries describe what changed for a user of
the tool; internal refactors with no observable effect belong in the commit
log, not here.

## [Unreleased]

## [0.2.0] — 2026-09-19

The first check that changes state: `transfer` is verified by performing one.

### Added

- `transfer` check. Reads both balances, submits a signed transfer of one
  unit, reads them again, and asserts the exact deltas. Reports the
  before/after balances with the transaction hash and ledger as evidence.
- `OWNER_SECRET` / `SPENDER_SECRET`. A secret settles its own address; one
  that disagrees with a supplied `*_ADDRESS` exits rather than guessing
  which was meant.
- Write consent gate. A run holding a secret refuses unless the passphrase
  is a test network (or `--allow-non-testnet-write` is given), the RPC
  endpoint does not contradict it, and `SPENDER_ADDRESS` names an account
  the operator controls. Funding is check-first, so a funded mainnet
  account would otherwise reach a real transfer with nothing in the way.

### Changed

- Reads are one file per SEP-41 member, so an unassessed member is visible
  in the directory listing rather than only at runtime.
- Each account is defined once, carrying its address, signing authority and
  whether it was generated for the run.

### Fixed

- Several situations that reported a conformant contract as FAIL, each
  found against a real token on testnet: a holder or recipient that is the
  asset issuer (transfers there mint or burn rather than move), a transfer
  refused by the asset's own trustline or authorization policy, an address
  holding no trustline, and a self-transfer. All now report UNVERIFIABLE.
- A submission that never reached the ledger — RPC unreachable, an unfunded
  signer, a stale sequence — was reported as the contract refusing. It now
  propagates and the run records SKIPPED.
- `name` and `symbol` no longer FAIL an empty value. SEP-41 constrains them
  to `String` and no further, so the anomaly is reported rather than
  accused.

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

### Fixed

- The WASM-fetch fallback test supplied no code hash, so it returned
  `native` before reaching the 404 branch it covers. It now exercises that
  branch and asserts the fetch happened.
