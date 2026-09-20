# Verification log

Evidence that the write checks reach the ledger, kept because a report in a
terminal is not evidence anyone else can check. Every hash below is on
Stellar testnet and can be looked up on any explorer.

## Reproducing it yourself

The fixture is a Stellar Asset Contract the operator issues, so anyone can
build the same setup without needing a token they do not control. A SAC
because it takes four steps to issue one — the guard itself is
contract-agnostic and calls SEP-41 members by name, so a custom WASM token
is tested the same way, and better informed: its spec says which members
are declared, so undeclared ones report NOT_IMPLEMENTED without spending a
call. A SAC has no spec, so every member is attempted blind.

Steps:

1. Generate three keypairs and fund them from Friendbot (issuer, owner,
   spender).
2. Have the owner and spender each establish a trustline to an asset the
   issuer controls, and pay the owner some of it.
3. Deploy the asset's SAC (`createStellarAssetContract`).
4. Run the guard with both secrets set.

```sh
OWNER_SECRET=$(stellar keys secret owner) \
SPENDER_SECRET=$(stellar keys secret spender) \
  node packages/soroban-guard/src/cli.ts <contract-id>
```

One caveat worth knowing before you try: `transfer_from-unauthorized`
requires the spender to hold **no** allowance, since that absence is the
premise it tests. Re-running against a pair that has already been through
`approve` reports UNVERIFIABLE rather than a verdict — use a fresh spender
(funded, trustlined to the asset, key in `SPENDER_SECRET`),
or read the guard's message, which says exactly this.

## Run of 2026-09-19

Against `CAJLPKZHDCHRMELESHIYGTRR2SXKEQMYWNNGLOLIZ4U2HLGHTXZXSLLY`, a SAC
for a test asset, with both keys configured:

```
SEP-41 Conformance — CAJLPKZHDCHRMELESHIYGTRR2SXKEQMYWNNGLOLIZ4U2HLGHTXZXSLLY

  ✓ sep41-decimals  returned 7
  ✓ sep41-balance  balance is 4999999967
  ✓ sep41-allowance  allowance is 0
  ✓ sep41-name  name is "GSVQU:GB77UX7L5ZULBK5ZWZ5AEBUJG5CBDLHO4GRYGC2KAOXKA5MDV5DYGNBI"
  ✓ sep41-symbol  symbol is "GSVQU"
  ✓ sep41-transfer  holder -1, recipient +1
  ✓ sep41-transfer_from-unauthorized  an unauthorized spend was refused
  ✓ sep41-approve  allowance is 1 after approving 1
  ✓ sep41-transfer_from  holder -1, recipient +1, allowance -1
  ✓ sep41-burn  holder -1
  ✓ sep41-burn_from  holder -1, spender 0, allowance -1

11 pass, 0 fail, 0 skipped, 0 unverifiable, 0 not implemented (11 checks)
by layer: interface 3/3 pass · behavior 8/8 pass

exit 0
```

### Transactions that run produced

| Function | Transaction |
| -------- | ----------- |
| `transfer` | `3b2b43647caaa87e125e5c53179ba19770a676bbe14d37d48967ce024b25a303` |
| `approve` | `2542d5d93aa48dea2d683cde4223e93179828edcddb67363f43da912ab0be07e` |
| `transfer_from` | `07983908014b5b45b23bb187d9b032f32fd1e3187ed181833b4843687d75a284` |
| `burn` | `c2053e5e29d7941fe4c843542469ecad373b7c754d2bca72deddd94282699cdd` |
| `burn_from` | `0fc55442ca2fe51a40ad36596194011d8d431d94a23657f243af4f3e6a840f4a` |

`transfer_from-unauthorized` produced no transaction, which is the point:
the contract refused it at simulation, so nothing reached the ledger.

## What this does and does not establish

It establishes that the write path signs, submits, settles and measures
against a real contract — and that a refusal-shaped requirement is asserted
correctly at least once.

It does not establish behaviour against a **custom WASM token**. Every run
here is against a Stellar Asset Contract, whose implementation is native to
the protocol and shared by every classic asset. A SAC cannot be
non-conformant in an interesting way; the tokens that can are the ones
someone wrote in Rust, and none has been tested yet. That gap is the reason
`transfer_from-unauthorized` matters most against a deployed vulnerable
fixture, which remains unbuilt.
