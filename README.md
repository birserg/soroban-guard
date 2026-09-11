# SEP-41 Guard

[![CI](https://github.com/birserg/soroban-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/birserg/soroban-guard/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Conformance testing for deployed [SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
Soroban token contracts on Stellar **testnet**.

> **Status: early.** Read checks (`decimals`, `balance`, `allowance`,
> `name`, `symbol`) run against testnet; writes and negative checks are
> next.

## Usage

Requires **Node 24** — the CLI runs its TypeScript sources directly via
type stripping, so there is no build step. Nothing else to configure:

```sh
pnpm install
node packages/soroban-guard/src/cli.ts <contract-id>
```

Against a real testnet token that looks like this:

```
SEP-41 Conformance — CA5UTUUPHYL5K22UBRUVC37EARZUGYOSGK3IKIXG2JLCC5ZZLI4BDWDM

  ✓ sep41-decimals  returned 7
  ? sep41-balance  balance is 0 on a generated probe address; set OWNER_ADDRESS for a real assertion
    expected: non-negative balance for the holder
  ✓ sep41-name  name is "Comet Pool Token"
  ✓ sep41-symbol  symbol is "CPAL"
```

Probe accounts are generated and funded from Friendbot per run. A generated
probe holds none of the token under test, so balance and allowance report
`UNVERIFIABLE` rather than a vacuous pass. Point them at an address that
actually holds the token for a real assertion:

```sh
OWNER_ADDRESS=G... SPENDER_ADDRESS=G... \
  node packages/soroban-guard/src/cli.ts <contract-id>
```

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | every required member assessed and conformant |
| `1`  | a verified violation |
| `2`  | unknown — the run failed, or members went unassessed |

`2` is the honest answer while the suite covers 5 of SEP-41's 10 members:
passing what it does check cannot establish conformance for `transfer` and
friends, which it does not check yet.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

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
* SAC specifics the checks actually observe: `balance` and `allowance`
  against an address with no trustline trap with "trustline entry is
  missing", which is reported UNVERIFIABLE — no standing to ask — rather
  than FAIL. The issuer's own balance reads `i64::MAX` (issuers mint on
  payout), so it cannot anchor a balance assertion; that one is a fixture
  note in `.env.example`, not a branch in the code.
* Events are not observed at all yet. No check reads topics, nothing
  populates `evidence.events`, and the `events` layer exists only as a
  label awaiting the write path.

## License

Apache-2.0
