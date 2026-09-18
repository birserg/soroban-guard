import type { CheckResult, Suite } from "./types.ts";

/**
 * Run every check in the suite, in order, collecting results. Sequential by
 * design, not `Promise.all`: checks share the source account and testnet
 * rate limits, so parallel runs would cause tx_bad_seq and throttling.
 *
 * A check that throws has suffered a harness failure (RPC down, malformed address) —
 * that is not a verdict about the contract, so it is recorded as SKIPPED
 * with the error preserved, and the run continues. One bad check never
 * aborts the suite.
 *
 * Continuing is right for reads, which are cheap and independent. Once
 * several write checks exist it will be worth noticing that a harness
 * failure repeats — an unreachable RPC makes every remaining write throw in
 * turn, each after its own submission attempt — and short-circuiting the
 * rest rather than re-learning it. Not worth the machinery for one write.
 */
export async function runSuite<Ctx>(
	suite: Suite<Ctx>,
	ctx: Ctx,
): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	for (const check of suite.checks) {
		const started = Date.now();
		try {
			results.push(await check.run(ctx));
		} catch (error) {
			results.push({
				id: check.id,
				clause: check.clause,
				layer: check.layer,
				requirement: check.requirement,
				status: "SKIPPED",
				expected: check.description,
				actual: "check did not complete",
				evidence: {
					error: error instanceof Error ? error.message : String(error),
				},
				durationMs: Date.now() - started,
			});
		}
	}
	return results;
}
