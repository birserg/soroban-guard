# SEP-41 Guard

[![CI](https://github.com/birserg/soroban-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/birserg/soroban-guard/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Conformance testing for deployed [SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
Soroban token contracts on Stellar **testnet**.

> **Status: early.** Read checks (`decimals`, `balance`, `allowance`,
> `name`, `symbol`) run against testnet; writes and negative checks are
> next.

## Usage

```sh
cp .env.example .env  # fill in TESTNET_CONTRACT_ID, OWNER_ADDRESS, SPENDER_ADDRESS
pnpm install
pnpm typecheck && pnpm exec biome check . && pnpm test          # offline
set -a; source .env; set +a; pnpm test:live                     # testnet
set -a; source .env; set +a; node packages/soroban-guard/src/cli.ts "$TESTNET_CONTRACT_ID"
```

## Why

SEP-41 is the standard token interface for Soroban. Unlike Stellar Classic
assets — where the protocol itself enforces balance arithmetic — a Soroban
token is just a contract. Nothing stops a contract from implementing the
interface correctly while behaving incorrectly.

Existing tooling checks that a contract _exports_ the right functions. That
cannot distinguish a correct `transfer` from one that omits `from.require_auth()`
and lets anyone drain any balance. Those failures are behavioural, and
behaviour requires execution — which is the roadmap: today the guard runs
read checks, and the write path (transfers, approvals, negative checks that
confirm the contract _rejects_ what it must reject) comes next.

SEP-41 Guard takes a deployed contract address, exercises it against a live
network, and reports which SEP-41 clauses it satisfies.

## Scope

Conformance, not security. A passing report does **not** mean a token is safe:
it says nothing about admin mint capability, upgradeability, blacklists, or
fee-on-transfer behaviour — all of which are SEP-41-conformant and all of which
can still cause loss.

## Current limitations

* Testnet only. Never place mainnet keys in `.env`.
* Validated so far against a single SAC (Stellar Asset Contract) token.
  Custom WASM tokens exercise the same code paths but are not yet proven.
* SAC specifics the tool knows about: recipients need a trustline
  (transfers without one trap), the issuer balance reads `i64::MAX`
  (issuers mint on payout — not a usable subject for balance assertions),
  and SAC events carry an extra `sep0011_asset` topic.

## License

Apache-2.0
