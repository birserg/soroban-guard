# SEP-41 Guard

Conformance testing for deployed [SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
Soroban token contracts on Stellar.

> **Status: work in progress.** Nothing here works yet.

## Why

SEP-41 is the standard token interface for Soroban. Unlike Stellar Classic
assets — where the protocol itself enforces balance arithmetic — a Soroban
token is just a contract. Nothing stops a contract from implementing the
interface correctly while behaving incorrectly.

Existing tooling checks that a contract _exports_ the right functions. That
cannot distinguish a correct `transfer` from one that omits `from.require_auth()`
and lets anyone drain any balance. Those failures are behavioural, and
behaviour requires execution.

SEP-41 Guard takes a deployed contract address, exercises it against a live
network, and reports which SEP-41 clauses it satisfies — including negative
checks that confirm the contract _rejects_ what it must reject.

## Scope

Conformance, not security. A passing report does **not** mean a token is safe:
it says nothing about admin mint capability, upgradeability, blacklists, or
fee-on-transfer behaviour — all of which are SEP-41-conformant and all of which
can still cause loss.

## License

Apache-2.0
