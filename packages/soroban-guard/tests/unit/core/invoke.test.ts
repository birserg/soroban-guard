import { Keypair, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { addressArg, interpretSimulation } from "../../../src/core/invoke.ts";
import {
	answerlessSuccess,
	errorResponse,
	okResponse,
	restoreResponse,
} from "../fixtures.ts";

describe("interpretSimulation", () => {
	it("decodes a contract u32 return to a number", () => {
		expect(interpretSimulation(okResponse(xdr.ScVal.scvU32(7)))).toEqual({
			kind: "ok",
			value: 7,
		});
	});

	it("keeps wide ints as bigint, never number", () => {
		const result = interpretSimulation(okResponse(900_000_000n));
		expect(result.kind).toBe("ok");
		if (result.kind === "ok") {
			expect(typeof result.value).toBe("bigint");
			expect(result.value).toBe(900_000_000n);
		}
	});

	it("maps a simulation error to trapped with diagnostics", () => {
		expect(
			interpretSimulation(errorResponse("host invocation trapped")),
		).toEqual({ kind: "trapped", diagnostics: "host invocation trapped" });
	});

	it("decodes a restore that carries an answer as ok", () => {
		// Restore responses are success-shaped at runtime: the preamble only
		// matters for submission, and reads never submit.
		expect(interpretSimulation(restoreResponse(xdr.ScVal.scvU32(7)))).toEqual({
			kind: "ok",
			value: 7,
		});
	});

	it("maps a restore without an answer to restore", () => {
		const result = interpretSimulation(restoreResponse());
		expect(result.kind).toBe("restore");
	});

	it("maps answerless success to inconclusive, never trapped", () => {
		// Partial RPC data is a harness anomaly, not a contract trap.
		// Mapping it to FAIL would accuse the contract of non-conformance.
		const result = interpretSimulation(answerlessSuccess());
		expect(result.kind).toBe("inconclusive");
	});

	it("decodes a void return to null", () => {
		expect(interpretSimulation(okResponse(xdr.ScVal.scvVoid()))).toEqual({
			kind: "ok",
			value: null,
		});
	});
});

describe("addressArg", () => {
	it("encodes a valid address", () => {
		const address = Keypair.random().publicKey();
		expect(addressArg(address)).toBeDefined();
	});

	it("rejects garbage", () => {
		expect(() => addressArg("NOT_AN_ADDRESS")).toThrow();
	});
});
