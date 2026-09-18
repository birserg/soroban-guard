/**
 * How a write check turns a before/after pair into a verdict.
 *
 * The write counterpart to read-outcome.ts. A read check judges one returned
 * value; a write check observes state, changes it, observes again, and judges
 * the difference. That pairing is also the evidence — a report saying
 * "holder -1, recipient +1, tx a6eecb…, ledger 4738627" is reviewable in a
 * way "PASS" is not.
 *
 * Nothing here touches the network. Give it the numbers and it decides.
 */
import type { SubmitResult } from "../../core/invoke.ts";
import type { CheckResult } from "../../core/types.ts";
import type { CheckMeta } from "./shared.ts";

/**
 * One observed quantity, named for the report ("holder", "recipient",
 * "allowance").
 */
export interface Observation {
	readonly label: string;
	readonly before: bigint;
	readonly after: bigint;
}

export interface Expectation {
	readonly label: string;
	readonly delta: bigint;
}

/**
 * Build the evidence bundle for a settled write.
 *
 * `after` is omitted rather than filled with placeholders when the
 * post-state could not be read: `Evidence.after` is optional, and its
 * absence says "no after-state was observed". Stringifying a failed read
 * would instead report a non-number as if it were a balance.
 */
export function writeEvidence(
	submitted: Extract<SubmitResult, { kind: "applied" }>,
	before: Readonly<Record<string, bigint>>,
	after?: Readonly<Record<string, bigint>>,
) {
	return {
		before: Object.fromEntries(
			Object.entries(before).map(([key, value]) => [key, value.toString()]),
		),
		...(after === undefined
			? {}
			: {
					after: Object.fromEntries(
						Object.entries(after).map(([key, value]) => [
							key,
							value.toString(),
						]),
					),
				}),
		txHash: submitted.txHash,
		ledger: submitted.ledger,
	};
}

/**
 * Judge observed movements against what the clause requires.
 *
 * PASS only when every expectation is met exactly. Exactness is deliberate:
 * SEP-41 gives transfer no fee semantics, so a token that credits less than
 * it debits is non-conformant, not merely unusual. The failure message names
 * every mismatch, because "holder -1, recipient 0" tells a reader where the
 * value went in a way "FAIL" does not.
 */
export function assertDeltas(
	meta: CheckMeta,
	expected: string,
	observations: readonly Observation[],
	expectations: readonly Expectation[],
	evidence: CheckResult["evidence"],
	durationMs: number,
): CheckResult {
	if (expectations.length === 0) {
		// A verdict with nothing required of it would PASS vacuously, which
		// is the one way this function could bless a contract it never
		// examined. Unreachable today; a caller that ever hits it has a bug
		// worth seeing immediately rather than a green check.
		throw new RangeError("assertDeltas needs at least one expectation");
	}
	const mismatches: string[] = [];
	const moved: string[] = [];
	for (const expectation of expectations) {
		const observation = observations.find(
			(candidate) => candidate.label === expectation.label,
		);
		if (observation === undefined) {
			mismatches.push(`${expectation.label} was not observed`);
			continue;
		}
		const delta = observation.after - observation.before;
		const rendered = `${observation.label} ${delta > 0n ? "+" : ""}${delta}`;
		if (delta === expectation.delta) {
			moved.push(rendered);
		} else {
			mismatches.push(
				`${rendered}, expected ${expectation.delta > 0n ? "+" : ""}${expectation.delta}`,
			);
		}
	}
	return {
		...meta,
		status: mismatches.length === 0 ? "PASS" : "FAIL",
		expected,
		actual: mismatches.length === 0 ? moved.join(", ") : mismatches.join("; "),
		evidence,
		durationMs,
	};
}
