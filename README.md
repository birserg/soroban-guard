# SEP-41 Guard

[![CI](https://github.com/birserg/soroban-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/birserg/soroban-guard/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Conformance testing for deployed [SEP-41](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
Soroban token contracts on Stellar **testnet**.

> **Status: early.** Six of SEP-41's ten members are checked against
> testnet: the five reads (`decimals`, `balance`, `allowance`, `name`,
> `symbol`) plus `transfer`, which signs and submits a real transaction and
> asserts the balance deltas it produced. `approve`, `transfer_from`,
> `burn`, `burn_from` and negative checks are next.

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
  ? sep41-allowance  allowance is 0 between addresses that never interacted; set OWNER_ADDRESS and SPENDER_ADDRESS to a real approving pair
    expected: non-negative allowance from owner to spender
  ✓ sep41-name  name is "Comet Pool Token"
  ✓ sep41-symbol  symbol is "CPAL"
  ? sep41-transfer  no signing authority for the holder; set OWNER_SECRET to an account that both signs and holds this token
    expected: transfer moves the amount from holder to recipient
```

Unassessed members appear too, one row each, so the report never implies
coverage it does not have.

An unconfigured run generates probe addresses and funds the owner from
Friendbot. A generated probe holds none of the token under test, so balance
and allowance report `UNVERIFIABLE` rather than a vacuous pass. Point them at an address that
actually holds the token for a real assertion:

```sh
OWNER_ADDRESS=G... SPENDER_ADDRESS=G... \
  node packages/soroban-guard/src/cli.ts <contract-id>
```

### Checking writes

`transfer` changes state, so it has to be signed. Without a key it reports
`UNVERIFIABLE` — never `FAIL`, because a missing key says nothing about the
contract. Supply the holder's secret to run it for real:

```sh
OWNER_SECRET=$(stellar keys show owner) SPENDER_ADDRESS=G... \
  node packages/soroban-guard/src/cli.ts <contract-id>
```

The secret settles its own address, so `OWNER_ADDRESS` is redundant
alongside it — supply both only if you want the mismatch checked. The run
transfers **1 unit** of the token, the smallest amount that proves movement,
and reports the before/after balances with the transaction hash and ledger.

> **Testnet only, by default.** This signs and submits real transactions, so
> a run that holds a secret refuses unless everything agrees: the passphrase
> must be a test network (or `--allow-non-testnet-write` given), the RPC
> endpoint must not contradict it, and `SPENDER_ADDRESS` must name an account
> you control — a generated recipient's key is discarded at exit, so sending
> to one burns the unit. Funding is check-first, so none of this can be
> caught by the faucet: an already-funded mainnet account would otherwise
> sail straight through. Reads run anywhere and sign nothing.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | every required member assessed and conformant |
| `1`  | a verified violation |
| `2`  | unknown — the run failed, or members went unassessed |

`2` is the honest answer while the suite covers 6 of SEP-41's 10 members:
passing what it does check cannot establish conformance for `approve`,
`transfer_from`, `burn` and `burn_from`, which it does not check yet.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## Why

SEP-41 is the standard token interface for Soroban. Unlike Stellar Classic
assets — where the protocol itself enforces balance arithmetic — a Soroban
token is just a contract. Nothing stops a contract from implementing the
interface correctly while behaving incorrectly.

Existing tooling checks that a contract _exports_ the right functions. That
cannot distinguish a correct `transfer` from one that omits `from.require_auth()`
and lets anyone drain any balance. Those failures are behavioural, and
behaviour requires execution. That is why `transfer` is checked by actually
performing one: the guard reads both balances, submits a signed transfer,
reads them again, and reports the deltas with the transaction hash and
ledger as evidence. The remaining writes (`approve`, `transfer_from`,
`burn`, `burn_from`) and the negative checks that confirm a contract
_rejects_ what it must reject come next.

SEP-41 Guard takes a deployed contract address, exercises it against a live
network, and reports which SEP-41 clauses it satisfies.

## Scope

Conformance, not security. A passing report does **not** mean a token is safe:
it says nothing about admin mint capability, upgradeability, or blacklists —
all of which are SEP-41-conformant and all of which can still cause loss.

Nor does a passing `transfer` mean the contract checks authorization. The
check proves the transfer *works* — an authorized move of one unit lands and
the balances move by exactly that much. It does not prove the contract would
have *refused* an unauthorized one, which is what catches a missing
`require_auth`. Negative checks are what close that gap, and they are not
written yet.

One judgement worth stating: a fee-on-transfer token, which credits the
recipient less than it debits the sender, **FAILs** here. SEP-41 gives
`transfer` no fee semantics, so crediting a different amount than was debited
is a violation of the clause as written, not a variation the tool tolerates.

## Current limitations

* Testnet only. Never place mainnet keys in `.env`.
* Validated so far against a single SAC (Stellar Asset Contract) token.
  Custom WASM tokens exercise the same code paths but are not yet proven.
* SAC specifics the checks actually observe: `balance` and `allowance`
  against an address with no trustline trap with "trustline entry is
  missing", which is reported UNVERIFIABLE — no standing to ask — rather
  than FAIL. The issuer's own balance reads `i64::MAX` (issuers mint on
  payout), so it cannot anchor a balance assertion. `transfer` refuses to
  judge any run the issuer takes part in — sending from one mints and
  sending to one burns, so neither side's delta means what it appears to —
  and reports UNVERIFIABLE before spending a ledger close.
* Events are not observed at all yet. No check reads topics, nothing
  populates `evidence.events`, and the `events` layer exists only as a
  label awaiting the write path.

## License

Apache-2.0
