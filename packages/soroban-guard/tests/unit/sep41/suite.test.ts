import { describe, expect, it } from "vitest";
import type { CheckResult } from "../../../src/core/types.ts";
import {
	SEP41_MEMBERS,
	sep41Suite,
	withCoverageGaps,
} from "../../../src/sep41/index.ts";

function assessed(id: string): CheckResult {
	return {
		id,
		clause: `SEP-41 §${id}`,
		layer: "behavior",
		requirement: "required",
		status: "PASS",
		expected: "stub",
		actual: "stub",
		evidence: {},
		durationMs: 0,
	};
}

describe("SEP41_MEMBERS", () => {
	it("lists the ten required token-interface members", () => {
		expect([...SEP41_MEMBERS].sort()).toEqual(
			[
				"allowance",
				"approve",
				"balance",
				"burn",
				"burn_from",
				"decimals",
				"name",
				"symbol",
				"transfer",
				"transfer_from",
			].sort(),
		);
	});
});

describe("suite coverage convention", () => {
	it("every check id names a member of SEP41_MEMBERS", () => {
		expect(sep41Suite.checks.length).toBeGreaterThan(0);
		for (const check of sep41Suite.checks) {
			expect(check.id.startsWith("sep41-")).toBe(true);
			expect(SEP41_MEMBERS).toContain(check.id.slice("sep41-".length));
		}
	});
});

describe("withCoverageGaps", () => {
	it("emits UNVERIFIABLE rows for unassessed members", () => {
		const results = withCoverageGaps([]);
		expect(results).toHaveLength(10);
		for (const result of results) {
			expect(result.status).toBe("UNVERIFIABLE");
			expect(result.actual).toBe("not assessed by this suite");
			expect(result.requirement).toBe("required");
		}
		expect(results.map((result) => result.id).sort()).toEqual(
			[...SEP41_MEMBERS].map((member) => `sep41-${member}`).sort(),
		);
	});

	it("leaves fully covered results untouched", () => {
		const full = SEP41_MEMBERS.map((member) => assessed(`sep41-${member}`));
		const results = withCoverageGaps(full);
		expect(results).toHaveLength(10);
		expect(results.every((result) => result.status === "PASS")).toBe(true);
	});

	it("gaps only what is missing, preserving order", () => {
		const partial = [assessed("sep41-decimals"), assessed("sep41-balance")];
		const results = withCoverageGaps(partial);
		expect(results).toHaveLength(10);
		expect(results.slice(0, 2).map((result) => result.id)).toEqual([
			"sep41-decimals",
			"sep41-balance",
		]);
		expect(
			results.slice(2).every((result) => result.status === "UNVERIFIABLE"),
		).toBe(true);
	});

	it("ignores ids outside the convention without inventing rows", () => {
		const results = withCoverageGaps([assessed("something-else")]);
		expect(results).toHaveLength(11);
		expect(results[0]?.id).toBe("something-else");
	});
});
