# AGENTS.md — repo conventions for any coding agent (human or AI)

Read this file before changing anything. It encodes failures that already
happened here once; do not relitigate them, follow them.

## Commands

```sh
pnpm typecheck                          # strict tsc, all packages
pnpm check:ci                           # Biome lint + format verification (read-only)
pnpm test                               # offline unit tests — always green, no network
set -a; source .env; set +a             # testnet credentials for live runs
pnpm test:live                          # testnet live tests (needs env above)
node packages/soroban-guard/src/cli.ts  # run the CLI directly
```

Node ≥24 is a floor, not fashion: the bin executes TS sources directly
via type stripping (details in CONTRIBUTING.md).

`pnpm check` (without `:ci`) rewrites files. Run it before committing,
then re-verify with `check:ci`. Never commit with red checks.

## Architecture laws

1. `core/` never imports `sep41/`. The runner takes a `Suite`, never a
   standard-specific import. A second standard must plug in untouched.
2. Checks return `FAIL`, never throw, for contract behavior. Only harness
   failures (RPC down, malformed address) throw — the runner records those
   as `SKIPPED`.
3. RPC-only. No Horizon in code; Horizon is a money-debug view for humans.
4. Sequencing is per-account nonce discipline. Reads simulate and spend
   nothing; funding probes existence via `getLedgerEntry`, not
   `getAccount`. Once writes land: re-fetch the source before every
   submitted transaction, because failures consume sequence too.
5. Trap is data (`InvokeResult`), never an exception. Never sniff
   diagnostic strings to classify contract behavior. Narrow exception:
   harness absence detection (funding/spec) matches the pinned SDK's own
   absence vocabulary, covered by unit tests — never trap text.
6. Funding is check-first, faucet-once; probe accounts default to
   generated throwaways (see `funding.ts`). Never "optimize" this into
   eager or repeated faucet hits.

## Verification hierarchy (ranked by what each can actually prove)

1. **Independent adversarial review** — the only thing that catches wrong
   *assumptions*. Must come from a different agent/pass than the
   implementer. Self-review does not count.
2. **Tests you wrote** — prove mechanics and prevent regressions. Green
   means "runs as designed", never "designed right": a test you authored
   can only re-assert your own assumptions.
3. **typecheck + lint** — prove form, not meaning.
4. **Live runs** — prove wiring against one token, not generality.

No behavior change commits without (1). Greens without (1) are necessary,
never sufficient.

## Editing discipline

* Read a file (or region) before editing it. After editing, re-read the
  region. Old strings must match exactly — never guess whitespace.
* Prefer small, unique `oldString` anchors. If an anchor could match twice,
  read wider first. Two eaten lines have happened here from sloppy anchors.
* Run `tsc` + unit tests after every batch of edits, before claiming done.

## Commit rules

* Product language only. Every message must make sense to someone reading
  `git log` cold in six months. Name the behavior, not the session: no
  opaque process refs ("round-4 residuals", "repartition"), no pasted
  test output. Established product terms (Tier-0, CHECKS.md) are fine.
  GOOD: `fix: fund only on true absence; reject malformed keys`.
  BAD: `fix: review round-4 residuals across funding and spec`.
* Whole files, one concern per commit. No `git add -p` hunk surgery to
  split a file across commits — if one file holds two concerns, sequence
  the work, not the hunks.
* Green per commit: typecheck + Biome + unit at stage time; clean-room
  frozen install for anything touching deps or history rewrites.
* No pushes, no amends or force-pushes of pushed history, without an
  explicit word for that exact action. Standing rule, no exceptions.

## Dependencies

* Exact pins only (`saveExact` is policy). No self-link overrides —
  workspace links resolve automatically (a stray
  `overrides: soroban-guard: link:...` was reverted once). Verify SDK
  behavior against the installed source in `node_modules`, never from
  memory or `.d.ts` alone — runtime unions have surprised us twice.
* Never add a dependency for a one-liner. Never wrap a one-line SDK call
  in a new abstraction without a caller that needs it.

## Secrets and tests

* Never commit secrets. `.env` is gitignored; `.env.example` is the
  template and must stay sourceable (verify after editing).
* Unit tests: no network, ever. Live tests: skip-guarded on env, each with
  a timeout — except `funding.live.test.ts`, which needs no env
  (throwaway faucet account) and always runs under `test:live`.
  Fixture builders live in `tests/unit/fixtures.ts`, not
  duplicated per file.

## Docs map

* Users ask → `SUPPORT.md`. Security reports → `SECURITY.md`.
  Contributors → `CONTRIBUTING.md`, conduct → `CODE_OF_CONDUCT.md`.
  This file is for implementers (human or AI), not users.
