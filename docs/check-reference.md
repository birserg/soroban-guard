# Checks reference

What each of the eleven checks proves, needs, and reports. The suite runs
them in the order below: reads first (cheap, no keys), then the negative
check (needs no allowance to exist yet), then the writes.

A premise is what must be true *before* the check can say anything at all.
When a premise is missing the check reports UNVERIFIABLE — never FAIL,
because a missing key, an empty holder, or an unreadable balance is a fact
about the run, not about the contract.

## Reads

### `sep41-decimals` — interface

`decimals()` returns the token's decimal precision: a non-negative integer.
Any `u32` passes; an implausible one passes with the anomaly visible in the
message rather than failing a spec-legal value.

### `sep41-balance` — behavior

`balance()` returns a non-negative holding for the holder address. A
generated probe reporting `0` is UNVERIFIABLE instead of a vacuous pass —
`0` distinguishes nothing, while any other value rules out an always-zero
bug and PASSes.

### `sep41-allowance` — behavior

`allowance()` returns a non-negative approval from holder to spender. Same
probe rule as balance: `0` on a generated pair is UNVERIFIABLE.

### `sep41-name` — interface

`name()` returns a string. Empty is spec-legal, so it passes with the
anomaly visible rather than failing a contract the spec allows.

### `sep41-symbol` — interface

As `name`: any string passes, empty included, anomaly visible.

## Writes

Most writes move **1 unit**, sign, submit, and assert the before/after
state with the transaction hash and ledger as evidence — but the family
varies: `transfer_from-unauthorized` passes on a refusal and records the
refusal's error text instead of a transaction, and `approve` sets an
absolute allowance (including a confirming second approval of 2) rather
than a delta. A holder needs roughly four units plus XLM for fees for the
full suite to assess everything; with less, later checks honestly report
UNVERIFIABLE.

### `sep41-transfer_from-unauthorized` — behavior

Attempts a spend with no allowance and **passes only when the contract
refuses** — the inverted mapping that catches a missing `require_auth()`,
which no positive check can distinguish. Premise: the spender holds no
allowance, the holder holds something worth taking, neither party is the
asset issuer, the holder and spender differ, the spender is not a generated
address, and the spender's signer signs as the spender. Needs the spender's
key. Runs before `approve`, which would otherwise grant the allowance whose
absence is the premise.

### `sep41-transfer` — behavior

Moves one unit from holder to recipient and asserts holder `-1`,
recipient `+1` exactly — a fee-on-transfer token FAILs here, correctly
against SEP-41, which gives transfer no fee semantics. Needs the holder's
key; the signing key must sign as the holder, the recipient must be a
distinct, non-generated, non-issuer address, and a non-issuer holder needs
a balance. Proves liveness only: it does not show the contract would refuse
an unauthorized move.

### `sep41-approve` — behavior

Sets the allowance to exactly 1 (overwriting, per the spec) and asserts
the exact value — including a second approval of 2 when starting from
zero, where overwrite and accumulate agree. Needs the holder's key.
Assertion is absolute, not a delta. Does not check the stored expiration:
`allowance()` returns the amount alone.

### `sep41-transfer_from` — behavior

Moves one unit holder → spender as the spender and asserts holder `-1`,
recipient `+1`, allowance `-1` — the draw-down is the distinguishing
requirement. Needs both keys. Establishes its own allowance when none
suffices; consumes a standing one when it does (never overwrites it).

### `sep41-burn` — behavior

Destroys one unit of the holder's balance and asserts `-1`. Irreversible.
Needs the holder's key. Cannot show supply actually fell — SEP-41 declares
no `total_supply`, so a mint elsewhere during the burn is invisible.

### `sep41-burn_from` — behavior

Burns one unit as the spender, asserting holder `-1`, allowance `-1`, and
spender `0` — a debited spender alongside would be double-spending. Needs
both keys. Irreversible.

## Verdicts

- `PASS` — the clause was exercised and held.
- `FAIL` — the clause was exercised and was violated.
- `UNVERIFIABLE` — the clause could not be exercised; no verdict either way.
- `SKIPPED` — the check could not run (harness or network failure). A
  submitted transaction that timed out is not this: it reports
  UNVERIFIABLE, since it may still apply.
- `NOT_IMPLEMENTED` — the contract does not declare this member (WASM
  spec introspection; SACs have no spec, so every member is attempted).

Exit codes follow: `0` conformant, `1` violation, `2` unknown. Anything
unassessed appears as an explicit `UNVERIFIABLE` row rather than a silent
omission.
