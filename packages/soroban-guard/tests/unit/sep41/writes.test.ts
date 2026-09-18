import {
	Account,
	Address,
	Keypair,
	Networks,
	type rpc,
} from "@stellar/stellar-sdk";
import type { Signer } from "@stellar/stellar-sdk/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as invoke from "../../../src/core/invoke.ts";
import { approveCheck } from "../../../src/sep41/checks/approve.ts";
import { burnCheck } from "../../../src/sep41/checks/burn.ts";
import { burnFromCheck } from "../../../src/sep41/checks/burn_from.ts";
import { transferFromCheck } from "../../../src/sep41/checks/transfer_from.ts";
import type { Sep41Context } from "../../../src/sep41/context.ts";
import { errorResponse, okResponse } from "../fixtures.ts";

/**
 * Offline coverage for the four remaining write checks.
 *
 * Each pins the same two questions the transfer check answers: which
 * situations are the contract's fault, and which are ours. The arithmetic
 * itself lives in delta.test.ts; what matters here is that no configuration
 * problem, and no missing permission, ever reaches a FAIL.
 */

function sequencedServer(
	responses: readonly rpc.Api.SimulateTransactionResponse[],
): rpc.Server {
	let index = 0;
	return {
		simulateTransaction: async () => {
			const response = responses[index];
			index += 1;
			if (response === undefined) {
				throw new Error(
					`stub exhausted: call ${index} of ${responses.length} planned`,
				);
			}
			return response;
		},
	} as unknown as rpc.Server;
}

const OWNER = Keypair.random().publicKey();
const SPENDER = Keypair.random().publicKey();

function signerFor(address: string): Signer {
	return { address } as unknown as Signer;
}

function ctxWith(
	server: rpc.Server,
	{ ownerSigns = true, spenderSigns = true } = {},
): Sep41Context {
	return {
		server,
		contractId: Address.contract(new Uint8Array(32)).toString(),
		source: new Account(OWNER, "1"),
		networkPassphrase: Networks.TESTNET,
		specFunctions: null,
		parties: {
			owner: {
				address: OWNER,
				isThrowaway: false,
				signer: ownerSigns ? signerFor(OWNER) : undefined,
			},
			spender: {
				address: SPENDER,
				isThrowaway: false,
				signer: spenderSigns ? signerFor(SPENDER) : undefined,
			},
		},
	};
}

function stubSubmit(result: invoke.SubmitResult) {
	return vi.spyOn(invoke, "submitWrite").mockResolvedValue(result);
}

const APPLIED = {
	kind: "applied",
	txHash: "abc123",
	ledger: 4738627,
} as const;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("approveCheck", () => {
	// SEP-41: approve "overrides any existing allowance". An absolute
	// assertion is the only one that catches a contract that accumulates.
	it("PASSes when the allowance ends at exactly the approved amount", async () => {
		const submit = stubSubmit(APPLIED);
		const result = await approveCheck.run(
			ctxWith(sequencedServer([okResponse(0n), okResponse(1n)])),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toContain("allowance is 1");
		// Four args, and the expiration must not be encoded as an amount.
		expect(submit.mock.calls[0]?.[1]?.args).toHaveLength(4);
	});

	it("FAILs a contract that adds to the allowance instead of replacing it", async () => {
		stubSubmit(APPLIED);
		const result = await approveCheck.run(
			ctxWith(sequencedServer([okResponse(5n), okResponse(6n)])),
		);
		expect(result.status).toBe("FAIL");
		expect(result.actual).toContain("added to the previous allowance");
	});

	it("is UNVERIFIABLE without the holder's key", async () => {
		const submit = stubSubmit(APPLIED);
		const result = await approveCheck.run(
			ctxWith(sequencedServer([okResponse(0n)]), { ownerSigns: false }),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("OWNER_SECRET");
		expect(submit).not.toHaveBeenCalled();
	});

	it("is UNVERIFIABLE when holder and spender are the same address", async () => {
		const submit = stubSubmit(APPLIED);
		const ctx = ctxWith(sequencedServer([okResponse(0n)]));
		const result = await approveCheck.run({
			...ctx,
			parties: {
				owner: ctx.parties.owner,
				spender: {
					address: OWNER,
					isThrowaway: false,
					signer: signerFor(OWNER),
				},
			},
		});
		expect(result.status).toBe("UNVERIFIABLE");
		expect(submit).not.toHaveBeenCalled();
	});
});

describe("burnCheck", () => {
	it("PASSes on a clean debit with nothing credited", async () => {
		stubSubmit(APPLIED);
		const result = await burnCheck.run(
			ctxWith(sequencedServer([okResponse(100n), okResponse(99n)])),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toContain("holder -1");
	});

	it("FAILs when the balance did not fall", async () => {
		stubSubmit(APPLIED);
		const result = await burnCheck.run(
			ctxWith(sequencedServer([okResponse(100n), okResponse(100n)])),
		);
		expect(result.status).toBe("FAIL");
		expect(result.actual).toContain("holder 0");
	});

	it("is UNVERIFIABLE with nothing to burn", async () => {
		const submit = stubSubmit(APPLIED);
		const result = await burnCheck.run(
			ctxWith(sequencedServer([okResponse(0n)])),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("nothing to burn");
		expect(submit).not.toHaveBeenCalled();
	});

	// Burning from an issuer does not decrease its sentinel balance, so the
	// delta would read as the burn having done nothing.
	it("is UNVERIFIABLE when the holder is the asset issuer", async () => {
		const submit = stubSubmit(APPLIED);
		const result = await burnCheck.run(
			ctxWith(sequencedServer([okResponse(2n ** 63n - 1n)])),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("issuer");
		expect(submit).not.toHaveBeenCalled();
	});
});

describe("transferFromCheck", () => {
	// Reads: owner, spender, seed-allowance, post-approval allowance, then
	// after the write: owner, spender, allowance.
	it("PASSes when both balances and the allowance all move", async () => {
		stubSubmit(APPLIED);
		const result = await transferFromCheck.run(
			ctxWith(
				sequencedServer([
					okResponse(100n),
					okResponse(5n),
					okResponse(0n),
					okResponse(1n),
					okResponse(99n),
					okResponse(6n),
					okResponse(0n),
				]),
			),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toContain("allowance -1");
	});

	// The distinguishing requirement: moving tokens without consuming the
	// allowance leaves a standing permit to move more.
	it("FAILs when the allowance was not consumed", async () => {
		stubSubmit(APPLIED);
		const result = await transferFromCheck.run(
			ctxWith(
				sequencedServer([
					okResponse(100n),
					okResponse(5n),
					okResponse(0n),
					okResponse(1n),
					okResponse(99n),
					okResponse(6n),
					okResponse(1n),
				]),
			),
		);
		expect(result.status).toBe("FAIL");
		expect(result.actual).toContain("allowance 0, expected -1");
	});

	it("is UNVERIFIABLE without the spender's key", async () => {
		const submit = stubSubmit(APPLIED);
		const result = await transferFromCheck.run(
			ctxWith(sequencedServer([okResponse(100n)]), { spenderSigns: false }),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("SPENDER_SECRET");
		expect(submit).not.toHaveBeenCalled();
	});

	// A setup failure says nothing about transfer_from itself.
	it("is UNVERIFIABLE when the setup approval is refused", async () => {
		stubSubmit({ kind: "rejected", diagnostics: "approve failed" });
		const result = await transferFromCheck.run(
			ctxWith(
				sequencedServer([okResponse(100n), okResponse(5n), okResponse(0n)]),
			),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("could not establish an allowance");
	});

	it("FAILs a defective balance rather than calling it unreadable", async () => {
		const result = await transferFromCheck.run(
			ctxWith(sequencedServer([errorResponse("Error(Contract, #7)")])),
		);
		expect(result.status).toBe("FAIL");
		expect(result.actual).toContain("balance() trapped");
	});
});

describe("burnFromCheck", () => {
	it("PASSes when the holder is debited and the allowance consumed", async () => {
		stubSubmit(APPLIED);
		const result = await burnFromCheck.run(
			ctxWith(
				sequencedServer([
					okResponse(100n),
					okResponse(0n),
					okResponse(1n),
					okResponse(99n),
					okResponse(0n),
				]),
			),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toContain("holder -1");
		expect(result.actual).toContain("allowance -1");
	});

	it("FAILs when the allowance survived the burn", async () => {
		stubSubmit(APPLIED);
		const result = await burnFromCheck.run(
			ctxWith(
				sequencedServer([
					okResponse(100n),
					okResponse(0n),
					okResponse(1n),
					okResponse(99n),
					okResponse(1n),
				]),
			),
		);
		expect(result.status).toBe("FAIL");
		expect(result.actual).toContain("allowance 0, expected -1");
	});

	it("is UNVERIFIABLE without both keys", async () => {
		const submit = stubSubmit(APPLIED);
		const result = await burnFromCheck.run(
			ctxWith(sequencedServer([okResponse(100n)]), { spenderSigns: false }),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("SPENDER_SECRET");
		expect(submit).not.toHaveBeenCalled();
	});
});
