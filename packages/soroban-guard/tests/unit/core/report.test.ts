import { describe, expect, it } from "vitest";
import { renderReport } from "../../../src/core/report.ts";
import type { CheckResult } from "../../../src/core/types.ts";

const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

const results: CheckResult[] = [
	{
		id: "sep41-decimals",
		clause: "SEP-41 §decimals",
		layer: "interface",
		requirement: "required",
		status: "PASS",
		expected: "u32 decimal precision",
		actual: "returned 7",
		evidence: { ledger: 100 },
		durationMs: 12,
	},
	{
		id: "sep41-balance",
		clause: "SEP-41 §balance",
		layer: "behavior",
		requirement: "required",
		status: "FAIL",
		expected: "non-negative balance for the holder",
		actual: "call trapped",
		evidence: { ledger: 100, error: "host invocation trapped" },
		durationMs: 34,
	},
	{
		id: "sep41-allowance",
		clause: "SEP-41 §allowance",
		layer: "behavior",
		requirement: "required",
		status: "SKIPPED",
		expected: "stub allowance",
		actual: "check did not complete",
		evidence: { error: "RPC down" },
		durationMs: 0,
	},
];

describe("renderReport", () => {
	it("renders one marked line per result plus a summary", () => {
		expect(
			renderReport({ standard: "SEP-41", contractId: CONTRACT, results }),
		).toBe(
			[
				`SEP-41 Conformance — ${CONTRACT}`,
				"",
				"  ✓ sep41-decimals  returned 7",
				"  ✗ sep41-balance  call trapped",
				"  ○ sep41-allowance  check did not complete",
				"",
				"1 of 3 passed",
			].join("\n"),
		);
	});

	it("renders an empty suite without crashing", () => {
		expect(
			renderReport({ standard: "SEP-41", contractId: CONTRACT, results: [] }),
		).toBe(`SEP-41 Conformance — ${CONTRACT}\n\n\n0 of 0 passed`);
	});
});
