import { describe, expect, it } from "vitest";
import {
	classifyStanding,
	describeValue,
} from "../../../src/sep41/checks/shared.ts";

/**
 * describeValue renders the one thing a FAIL has to justify: what the
 * contract actually returned. `String()` alone collapses a Soroban map to
 * "[object Object]", which is no evidence at all, so the shapes that
 * scValToNative can produce are pinned here.
 */
describe("describeValue", () => {
	it("keeps the n on a bigint, so 1 and 1n are distinguishable", () => {
		expect(describeValue(1n)).toBe("1n");
		expect(describeValue(1)).toBe("1");
	});

	it("renders void as the word, not as null", () => {
		expect(describeValue(null)).toBe("void");
	});

	it("quotes strings, so trailing space and emptiness are visible", () => {
		expect(describeValue("")).toBe('""');
		expect(describeValue("USDC ")).toBe('"USDC "');
	});

	// scValToNative decodes a Soroban map to a plain object and a vec to an
	// array. Both used to stringify uselessly.
	it("shows a map by shape rather than [object Object]", () => {
		expect(describeValue({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
	});

	it("shows a vec by shape, with bigint members intact", () => {
		expect(describeValue([1n, 2n])).toBe('["1n","2n"]');
	});

	it("renders booleans and undefined without throwing", () => {
		expect(describeValue(true)).toBe("true");
		expect(describeValue(undefined)).toBe("undefined");
	});

	// A report has to be produced even for a value that resists rendering;
	// throwing here would turn a FAIL into a SKIPPED and lose the finding.
	it("never throws on a value that cannot be stringified", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(() => describeValue(circular)).not.toThrow();
		expect(describeValue(circular)).toContain("Object");

		expect(() => describeValue(Symbol("x"))).not.toThrow();
	});
});

describe("classifyStanding", () => {
	it.each([
		["trustline entry is missing for account G...", "no-trustline"],
		["balance is deauthorized", "not-authorized"],
		["trustline is deauthorized", "not-authorized"],
	])("classifies SAC host wording: %s", (diagnostics, expected) => {
		expect(classifyStanding(diagnostics)).toBe(expected);
	});

	// Narrow on purpose: these phrases appear in custom-token panics where
	// the refusal IS the verdict, and downgrading them would hide findings.
	it.each([
		"Error(Contract, #7)",
		"caller is not authorized",
		"not authorized to mint",
		"HostError: Error(Contract, #11)",
	])("leaves a contract's own refusal alone: %s", (diagnostics) => {
		expect(classifyStanding(diagnostics)).toBeNull();
	});

	// Why matching on host wording is safe rather than merely convenient:
	// Soroban strips panic! strings from release WASM, so a custom token's
	// trap reaches us as a bare error code. Captured from Comet on testnet
	// (a real WASM SEP-41 token) — no prose for these patterns to match.
	it("does not match a custom WASM token's bare error code", () => {
		expect(classifyStanding("HostError: Error(Contract, #29)")).toBeNull();
	});

	// The descriptive strings come from the host's asset logic, which only
	// runs for SAC calls. Captured from BLND on testnet.
	it("matches the host's own asset wording", () => {
		const sacTrap =
			'HostError: Error(Contract, #13)\n\nEvent log (newest first):\n   0: [Diagnostic Event] topics:[error, Error(Contract, #13)], data:["trustline entry is missing for account", GCGX...]';
		expect(classifyStanding(sacTrap)).toBe("no-trustline");
	});
});
