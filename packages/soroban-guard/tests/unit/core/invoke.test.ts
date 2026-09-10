import { Keypair, nativeToScVal, type rpc, xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { addressArg, interpretSimulation } from "../../../src/core/invoke.ts";

// Note: a bare JS number encodes as 64-bit (decodes to bigint), so a genuine
// contract u32 must be built explicitly — exactly what the chain returns.
function successResponse(retval: xdr.ScVal | unknown) {
	const encoded =
		typeof retval === "object" && retval !== null && "toXDR" in retval
			? (retval as xdr.ScVal)
			: nativeToScVal(retval);
	return {
		id: "unit-test",
		latestLedger: 1,
		events: [],
		_parsed: true,
		transactionData: {},
		minResourceFee: "0",
		result: { auth: [], retval: encoded },
	} as unknown as rpc.Api.SimulateTransactionResponse;
}

function errorResponse(error: string): rpc.Api.SimulateTransactionResponse {
	return {
		id: "unit-test",
		latestLedger: 1,
		events: [],
		_parsed: true,
		error,
	} as unknown as rpc.Api.SimulateTransactionResponse;
}

describe("interpretSimulation", () => {
	it("decodes a contract u32 return to a number", () => {
		expect(interpretSimulation(successResponse(xdr.ScVal.scvU32(7)))).toEqual({
			kind: "ok",
			value: 7,
		});
	});

	it("keeps wide ints as bigint, never number", () => {
		const result = interpretSimulation(successResponse(900_000_000n));
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

	it("maps a restore preamble to restore, not trapped", () => {
		const restore = {
			...successResponse(7),
			restorePreamble: { minResourceFee: "0", transactionData: {} },
		} as unknown as rpc.Api.SimulateTransactionResponse;
		const result = interpretSimulation(restore);
		expect(result.kind).toBe("restore");
	});

	it("traps a success without a return value", () => {
		const noRetval = {
			id: "unit-test",
			latestLedger: 1,
			events: [],
			_parsed: true,
			transactionData: {},
			minResourceFee: "0",
			result: { auth: [] },
		} as unknown as rpc.Api.SimulateTransactionResponse;
		const result = interpretSimulation(noRetval);
		expect(result.kind).toBe("trapped");
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
