import { describe, expect, it } from "vitest";
import { exitCodeFor, renderReport } from "../../../src/core/report.ts";
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
				"    expected: non-negative balance for the holder",
				"    error: host invocation trapped",
				"  ○ sep41-allowance  check did not complete",
				"    expected: stub allowance",
				"    error: RPC down",
				"",
				"1 pass, 1 fail, 1 skipped, 0 unverifiable, 0 not implemented (3 checks)",
				"by layer: interface 1/1 pass · behavior 0/2 pass",
			].join("\n"),
		);
	});

	it("renders an empty suite without crashing", () => {
		expect(
			renderReport({ standard: "SEP-41", contractId: CONTRACT, results: [] }),
		).toBe(
			`SEP-41 Conformance — ${CONTRACT}\n\n\n0 pass, 0 fail, 0 skipped, 0 unverifiable, 0 not implemented (0 checks)`,
		);
	});
});

function resultWith(
	status: CheckResult["status"],
	requirement: CheckResult["requirement"] = "required",
): CheckResult {
	return {
		id: "stub",
		clause: "TEST §example",
		layer: "behavior",
		requirement,
		status,
		expected: "stub",
		actual: "stub",
		evidence: {},
		durationMs: 0,
	};
}

describe("exitCodeFor", () => {
	it("exits 0 when everything passes", () => {
		expect(exitCodeFor([resultWith("PASS"), resultWith("PASS")])).toBe(0);
	});

	it("exits 0 for optional NOT_IMPLEMENTED", () => {
		expect(exitCodeFor([resultWith("NOT_IMPLEMENTED", "optional")])).toBe(0);
	});

	it("exits 1 on any FAIL", () => {
		expect(exitCodeFor([resultWith("PASS"), resultWith("FAIL")])).toBe(1);
	});

	it("exits 1 when a required check is NOT_IMPLEMENTED", () => {
		expect(exitCodeFor([resultWith("NOT_IMPLEMENTED")])).toBe(1);
	});

	it("exits 2 when nothing ran", () => {
		expect(exitCodeFor([])).toBe(2);
	});

	it("exits 2 on SKIPPED or UNVERIFIABLE, never 1", () => {
		expect(exitCodeFor([resultWith("PASS"), resultWith("SKIPPED")])).toBe(2);
		expect(exitCodeFor([resultWith("UNVERIFIABLE")])).toBe(2);
	});

	it("prefers 1 when both FAIL and SKIPPED are present", () => {
		expect(exitCodeFor([resultWith("SKIPPED"), resultWith("FAIL")])).toBe(1);
	});
});
