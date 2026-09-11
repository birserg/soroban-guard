/**
 * Turning results into the two things a caller acts on: text for a human,
 * and an exit code for a machine. Both are pure functions over
 * `CheckResult[]` — nothing here prints, writes, or exits, so the CLI owns
 * every side effect and both are testable without a terminal.
 *
 * The exit code is the load-bearing half. It is tri-state on purpose: a run
 * that could not reach the network must not be indistinguishable from a
 * contract that violated the spec.
 */
import type { CheckLayer, CheckResult, CheckStatus } from "./types.ts";

export interface ReportInput {
	readonly standard: string;
	readonly contractId: string;
	readonly results: readonly CheckResult[];
}

const MARK: Record<CheckStatus, string> = {
	PASS: "✓",
	FAIL: "✗",
	SKIPPED: "○",
	UNVERIFIABLE: "?",
	NOT_IMPLEMENTED: "–",
};

/**
 * Render a terminal report. Pure function — takes results, returns text,
 * prints nothing. Non-passing checks print their expectation and diagnostic
 * on indented follow-ups; a bare mark without the reason is a report that
 * hides its own evidence. The CHECKS.md emitter will share this shape later.
 */
export function renderReport(input: ReportInput): string {
	const lines = [`${input.standard} Conformance — ${input.contractId}`, ""];
	for (const result of input.results) {
		lines.push(`  ${MARK[result.status]} ${result.id}  ${result.actual}`);
		if (result.status !== "PASS") {
			lines.push(`    expected: ${result.expected}`);
			if (result.evidence.error !== undefined) {
				lines.push(`    error: ${result.evidence.error}`);
			}
		}
	}
	const count = (status: CheckStatus): number =>
		input.results.filter((result) => result.status === status).length;
	lines.push(
		"",
		`${count("PASS")} pass, ${count("FAIL")} fail, ${count("SKIPPED")} skipped, ` +
			`${count("UNVERIFIABLE")} unverifiable, ${count("NOT_IMPLEMENTED")} not implemented ` +
			`(${input.results.length} checks)`,
	);
	const layers: readonly CheckLayer[] = ["interface", "behavior", "events"];
	const layerParts: string[] = [];
	for (const layer of layers) {
		const inLayer = input.results.filter((result) => result.layer === layer);
		if (inLayer.length > 0) {
			const layerPassed = inLayer.filter(
				(result) => result.status === "PASS",
			).length;
			layerParts.push(`${layer} ${layerPassed}/${inLayer.length} pass`);
		}
	}
	if (layerParts.length > 0) {
		lines.push(`by layer: ${layerParts.join(" · ")}`);
	}
	return lines.join("\n");
}

/**
 * Tri-state exit code. 0 means verified conformant, 1 means verified
 * violation, 2 means unknown — the run itself failed or nothing conclusive
 * was established. Collapsing these (e.g. exiting 1 for SKIPPED) makes the
 * exit code lie about which of the three happened.
 */
export function exitCodeFor(results: readonly CheckResult[]): number {
	if (results.length === 0) {
		return 2;
	}
	if (results.some((result) => result.status === "FAIL")) {
		return 1;
	}
	if (
		results.some(
			(result) =>
				result.status === "NOT_IMPLEMENTED" &&
				result.requirement === "required",
		)
	) {
		return 1;
	}
	if (
		results.some(
			(result) =>
				result.status === "SKIPPED" || result.status === "UNVERIFIABLE",
		)
	) {
		return 2;
	}
	return 0;
}
