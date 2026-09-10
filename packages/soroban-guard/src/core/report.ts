import type { CheckResult, CheckStatus } from "./types.ts";

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
 * prints nothing. The CHECKS.md emitter will share this shape later.
 */
export function renderReport(input: ReportInput): string {
	const lines = [`${input.standard} Conformance — ${input.contractId}`, ""];
	for (const result of input.results) {
		lines.push(`  ${MARK[result.status]} ${result.id}  ${result.actual}`);
	}
	const passed = input.results.filter(
		(result) => result.status === "PASS",
	).length;
	lines.push("", `${passed} of ${input.results.length} passed`);
	return lines.join("\n");
}
