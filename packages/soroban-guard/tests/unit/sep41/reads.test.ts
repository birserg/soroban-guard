import {
	Account,
	Address,
	Keypair,
	Networks,
	type rpc,
	xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import {
	allowanceCheck,
	balanceCheck,
	decimalsCheck,
	nameCheck,
	symbolCheck,
} from "../../../src/sep41/checks/reads.ts";
import type { Sep41Context } from "../../../src/sep41/context.ts";
import {
	answerlessSuccess,
	errorResponse,
	okResponse,
	restoreResponse,
} from "../fixtures.ts";

/**
 * Offline coverage for the SEP-41 read checks. The server is a stub returning
 * canned simulation responses, so the REAL check objects run end to end —
 * metadata, mapping branches, and value assertions — with zero network.
 * Live tests then only need to prove the wiring, not the logic.
 */
function stubServer(response: rpc.Api.SimulateTransactionResponse): rpc.Server {
	return {
		simulateTransaction: async () => response,
	} as unknown as rpc.Server;
}

function ctxWith(
	server: rpc.Server,
	specFunctions: readonly string[] | null = null,
	ownerIsThrowaway = false,
): Sep41Context {
	const owner = Keypair.random().publicKey();
	const spender = Keypair.random().publicKey();
	return {
		server,
		contractId: Address.contract(new Uint8Array(32)).toString(),
		source: new Account(owner, "1"),
		networkPassphrase: Networks.TESTNET,
		owner,
		spender,
		ownerIsThrowaway,
		specFunctions,
	};
}

describe("decimalsCheck", () => {
	it("reports NOT_IMPLEMENTED under the interface layer when undeclared", async () => {
		const result = await decimalsCheck.run(
			ctxWith(stubServer(okResponse(xdr.ScVal.scvU32(7))), ["balance"]),
		);
		expect(result.status).toBe("NOT_IMPLEMENTED");
		expect(result.layer).toBe("interface");
		expect(result.actual).toContain("decimals");
	});

	it("passes on a sane u32 with metadata attached", async () => {
		const result = await decimalsCheck.run(
			ctxWith(stubServer(okResponse(xdr.ScVal.scvU32(7)))),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toBe("returned 7");
		expect(result.layer).toBe("interface");
		expect(result.requirement).toBe("required");
	});

	it("fails a trap with the diagnostic preserved", async () => {
		const result = await decimalsCheck.run(
			ctxWith(stubServer(errorResponse("host invocation trapped"))),
		);
		expect(result.status).toBe("FAIL");
		expect(result.evidence.error).toBe("host invocation trapped");
	});

	it("still fails a trap on a generated probe", async () => {
		// Narrowness lock: no-standing UNVERIFIABLE applies to balance and
		// allowance only. A decimals trap is genuine contract behavior even
		// when the probe is throwaway, so it stays FAIL.
		const result = await decimalsCheck.run(
			ctxWith(stubServer(errorResponse("host invocation trapped")), null, true),
		);
		expect(result.status).toBe("FAIL");
		expect(result.evidence.error).toBe("host invocation trapped");
	});

	it("reports UNVERIFIABLE when restoration is needed", async () => {
		const result = await decimalsCheck.run(
			ctxWith(stubServer(restoreResponse())),
		);
		expect(result.status).toBe("UNVERIFIABLE");
	});

	it("reports UNVERIFIABLE on answerless success, never FAIL", async () => {
		const result = await decimalsCheck.run(
			ctxWith(stubServer(answerlessSuccess())),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("no return value");
	});

	it("passes spec-legal values with the anomaly visible, not verdict-changing", async () => {
		// u32-ness is established by successful decode, so any u32 passes;
		// the bound survives only as warning text, since neither FAIL (false
		// accusation on spec-legal values) nor UNVERIFIABLE (the answer was
		// observed) is honest.
		const result = await decimalsCheck.run(
			ctxWith(stubServer(okResponse(xdr.ScVal.scvU32(100)))),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toContain("outside plausible bounds");
	});

	it("fails a void return without calling it unexpected", async () => {
		const result = await decimalsCheck.run(
			ctxWith(stubServer(okResponse(xdr.ScVal.scvVoid()))),
		);
		expect(result.status).toBe("FAIL");
		expect(result.actual).toContain("void");
	});
});

describe("balanceCheck", () => {
	it("passes on a non-negative bigint", async () => {
		const result = await balanceCheck.run(
			ctxWith(stubServer(okResponse(900_000_000n))),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toBe("balance is 900000000");
		expect(result.layer).toBe("behavior");
	});

	it("fails a wrong-typed value", async () => {
		const result = await balanceCheck.run(
			ctxWith(stubServer(okResponse(xdr.ScVal.scvU32(7)))),
		);
		expect(result.status).toBe("FAIL");
	});

	it("reports UNVERIFIABLE for zero on a generated probe", async () => {
		const server = stubServer(okResponse(0n));
		const result = await balanceCheck.run(ctxWith(server, null, true));
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("OWNER_ADDRESS");
	});

	it("passes zero for a configured owner", async () => {
		const result = await balanceCheck.run(
			ctxWith(stubServer(okResponse(0n)), null, false),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toBe("balance is 0");
	});

	it("reports UNVERIFIABLE for a trap on a generated probe", async () => {
		const server = stubServer(errorResponse("trustline entry is missing"));
		const result = await balanceCheck.run(ctxWith(server, null, true));
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("without standing");
		expect(result.evidence.error).toBe("trustline entry is missing");
	});

	it("fails a trap on a configured owner", async () => {
		const result = await balanceCheck.run(
			ctxWith(stubServer(errorResponse("trustline entry is missing"))),
		);
		expect(result.status).toBe("FAIL");
		expect(result.evidence.error).toBe("trustline entry is missing");
	});

	it("fails a trap on a generated probe against a WASM-declared contract", async () => {
		// The no-standing fallback is SAC-scoped: with a declared spec
		// there is no trustline concept, so the trap is genuine behavior.
		const server = stubServer(errorResponse("trustline entry is missing"));
		const result = await balanceCheck.run(ctxWith(server, ["balance"], true));
		expect(result.status).toBe("FAIL");
		expect(result.evidence.error).toBe("trustline entry is missing");
	});
});

describe("allowanceCheck", () => {
	it("passes on a non-negative bigint", async () => {
		const result = await allowanceCheck.run(
			ctxWith(stubServer(okResponse(0n))),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toBe("allowance is 0");
	});

	it("fails a trap with the diagnostic preserved", async () => {
		const result = await allowanceCheck.run(
			ctxWith(stubServer(errorResponse("no allowance entry"))),
		);
		expect(result.status).toBe("FAIL");
		expect(result.evidence.error).toBe("no allowance entry");
	});

	it("reports UNVERIFIABLE for zero on a generated probe", async () => {
		const server = stubServer(okResponse(0n));
		const result = await allowanceCheck.run(ctxWith(server, null, true));
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("OWNER_ADDRESS");
	});

	it("reports UNVERIFIABLE for a trap on a generated probe", async () => {
		const server = stubServer(errorResponse("trustline entry is missing"));
		const result = await allowanceCheck.run(ctxWith(server, null, true));
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("without standing");
		expect(result.evidence.error).toBe("trustline entry is missing");
	});

	it("fails a trap on a generated probe against a WASM-declared contract", async () => {
		const server = stubServer(errorResponse("trustline entry is missing"));
		const result = await allowanceCheck.run(
			ctxWith(server, ["allowance"], true),
		);
		expect(result.status).toBe("FAIL");
		expect(result.evidence.error).toBe("trustline entry is missing");
	});
});

describe("nameCheck", () => {
	it("passes on a string with metadata attached", async () => {
		const result = await nameCheck.run(
			ctxWith(stubServer(okResponse("Test Token"))),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toBe('name is "Test Token"');
		expect(result.layer).toBe("interface");
		expect(result.requirement).toBe("required");
	});

	it("fails a non-string value", async () => {
		const result = await nameCheck.run(
			ctxWith(stubServer(okResponse(xdr.ScVal.scvU32(7)))),
		);
		expect(result.status).toBe("FAIL");
	});

	it("fails empty and blank names", async () => {
		for (const name of ["", "   "]) {
			const result = await nameCheck.run(ctxWith(stubServer(okResponse(name))));
			expect(result.status).toBe("FAIL");
		}
	});

	it("escapes control characters from contract metadata", async () => {
		const result = await nameCheck.run(
			ctxWith(stubServer(okResponse("A\n\x1b[31mB"))),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).not.toContain("\n");
		expect(result.actual).not.toContain("\x1b");
		expect(result.actual).toContain("\\n");
	});
});

describe("symbolCheck", () => {
	it("passes on a string", async () => {
		const result = await symbolCheck.run(
			ctxWith(stubServer(okResponse("TEST"))),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toBe('symbol is "TEST"');
	});

	it("reports NOT_IMPLEMENTED when undeclared", async () => {
		const result = await symbolCheck.run(
			ctxWith(stubServer(okResponse("TEST")), ["decimals"]),
		);
		expect(result.status).toBe("NOT_IMPLEMENTED");
	});

	it("fails an empty symbol", async () => {
		const result = await symbolCheck.run(ctxWith(stubServer(okResponse(""))));
		expect(result.status).toBe("FAIL");
	});
});
