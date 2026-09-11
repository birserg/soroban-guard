/**
 * Core result model. Deliberately SEP-agnostic: nothing here knows what
 * SEP-41 is. A suite supplies the checks; the runner returns these.
 */

/**
 * PASS/FAIL are the only verdicts about the contract itself.
 *
 * SKIPPED         — not run (a prerequisite check failed, or excluded).
 * UNVERIFIABLE    — could not be tested under the current conditions, e.g.
 *                   a mutation check against a token we hold no balance of.
 *                   Distinct from FAIL: the contract is not implicated.
 * NOT_IMPLEMENTED — the contract does not expose the function at all.
 */
export type CheckStatus =
	| "PASS"
	| "FAIL"
	| "SKIPPED"
	| "UNVERIFIABLE"
	| "NOT_IMPLEMENTED";

/**
 * Which layer of conformance a check belongs to. Reported separately so a
 * token that behaves correctly but emits malformed events is not simply
 * "non-compliant" — the failure is located.
 *
 * interface — the function exists and takes the arguments the spec names.
 * behavior  — calling it does what the spec says, and refuses what it must.
 * events    — the right event is emitted, in a shape indexers can read. A
 *             token can move balances correctly and still be invisible to
 *             every wallet and explorer.
 */
export type CheckLayer = "interface" | "behavior" | "events";

/**
 * Whether the clause is mandatory. SEP-41 itself has no optionality
 * language — every member of its TokenInterface trait (including decimals,
 * name, symbol, burn, burn_from) is required, so today every SEP-41 check
 * is "required" (the suite currently covers 5 of the 10 members; the flag
 * describes the clause, not suite coverage). The flag exists for future
 * standards and capability disclosure; mint/clawback are not SEP-41 at all
 * (SAC extensions), so they never appear here.
 *
 * Absent-vs-broken are different verdicts: an `optional` check that is
 * absent (NOT_IMPLEMENTED) is conformant, but an `optional` check that is
 * present and misbehaves still FAILs — optionality excuses absence, never
 * defects. Exit codes follow the same rule.
 */
export type CheckRequirement = "required" | "optional";

/** A contract event observed on-chain, decoded to native values. */
export interface ObservedEvent {
	readonly topics: readonly unknown[];
	readonly data: unknown;
}

/**
 * What makes a result reviewable rather than merely asserted. Every field is
 * optional because a read-only check has no transaction and no state delta.
 */
export interface Evidence {
	/** Balances/allowances read before the call, keyed by a human label. */
	readonly before?: Readonly<Record<string, string>>;
	/** The same keys, read after. */
	readonly after?: Readonly<Record<string, string>>;
	readonly events?: readonly ObservedEvent[];
	readonly txHash?: string;
	/**
	 * Latest ledger known to the node at observation time for reads (no
	 * transaction is applied), ledger of inclusion for writes. Per-check
	 * values from a sequential run are separate observations, not one
	 * coherent snapshot — events age out of RPC, this number does not.
	 */
	readonly ledger?: number;
	/** Raw error text when a call trapped, for FAIL and for negative checks. */
	readonly error?: string;
}

export interface CheckResult {
	readonly id: string;
	/** Human-readable clause reference, e.g. "TOKEN §transfer_from". */
	readonly clause: string;
	readonly layer: CheckLayer;
	readonly requirement: CheckRequirement;
	readonly status: CheckStatus;
	/** What the specification requires. */
	readonly expected: string;
	/** What the contract actually did. */
	readonly actual: string;
	readonly evidence: Evidence;
	readonly durationMs: number;
}

/**
 * A single conformance check. `run` must not throw for a non-conformant
 * contract — that is a FAIL result, not an exception. Exceptions are for
 * harness failures (RPC down, malformed address).
 */
export interface Check<Ctx> {
	readonly id: string;
	readonly clause: string;
	readonly layer: CheckLayer;
	readonly requirement: CheckRequirement;
	readonly description: string;
	run(ctx: Ctx): Promise<CheckResult>;
}

/** A named group of checks for one standard. */
export interface Suite<Ctx> {
	readonly standard: string;
	readonly checks: readonly Check<Ctx>[];
}
