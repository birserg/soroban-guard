import { afterEach, describe, expect, it, vi } from "vitest";
import * as invoke from "../../../src/core/invoke.ts";
import { approveCheck } from "../../../src/sep41/checks/approve.ts";
import {
	APPLIED,
	OWNER,
	okResponse,
	rejected,
	sequencedServer,
	settledFailure,
	signerFor,
	stubSubmit,
	writeCtx,
} from "../fixtures.ts";

/**
 * Offline coverage for the approve check.
 *
 * Unlike transfer, the assertion is absolute rather than relative: SEP-41
 * says approve overrides, so the suite asserts the exact amount instead of
 * a delta. What matters here is that no configuration problem, and no
 * missing permission, ever reaches a FAIL.
 */

afterEach(() => {
	vi.restoreAllMocks();
});

describe("approveCheck", () => {
	// SEP-41: approve "overrides any existing allowance". An absolute
	// assertion is the only one that catches a contract that accumulates.
	it("PASSes when the allowance ends at exactly the approved amount", async () => {
		const submit = stubSubmit(APPLIED);
		// From zero the first approval proves nothing on its own (overwrite
		// and accumulate agree), so the check confirms with a second amount
		// and the stub must answer that third read.
		const result = await approveCheck.run(
			writeCtx(
				sequencedServer([okResponse(0n), okResponse(1n), okResponse(2n)]),
			),
		);
		expect(result.status).toBe("PASS");
		expect(result.actual).toContain("allowance is 2 after approving 2 over 1");
		expect(submit).toHaveBeenCalledTimes(2);
		// Four args, and the expiration must not be encoded as an amount.
		expect(submit.mock.calls[0]?.[1]?.args).toHaveLength(4);
	});

	// Both of approve's submissions can die on the ledger, and each has its
	// own branch. A ledger failure is not the contract refusing, so neither
	// may reach a verdict — but only the second is reachable once the first
	// has applied, so they are exercised separately.
	it("is UNVERIFIABLE when the first approval failed on-chain", async () => {
		stubSubmit(settledFailure("transaction abc123 failed on-chain"));
		const result = await approveCheck.run(
			writeCtx(sequencedServer([okResponse(0n)])),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("reached the ledger and failed there");
		expect(result.evidence.error).toBe("transaction abc123 failed on-chain");
	});

	it("is UNVERIFIABLE when the confirming approval failed on-chain", async () => {
		// Chained, not blanket: the first approval must apply so the check
		// reaches the confirming submission at all.
		vi.spyOn(invoke, "submitWrite")
			.mockResolvedValueOnce(APPLIED)
			.mockResolvedValueOnce(
				settledFailure("transaction def456 failed on-chain"),
			);
		const result = await approveCheck.run(
			writeCtx(sequencedServer([okResponse(0n), okResponse(1n)])),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("reached the ledger and failed there");
		expect(result.evidence.error).toBe("transaction def456 failed on-chain");
	});

	it("FAILs an accumulator on the confirming approval", async () => {
		stubSubmit(APPLIED);
		// 0 -> 1 -> 3: the first approval looks right, the second exposes
		// the accumulation.
		const result = await approveCheck.run(
			writeCtx(
				sequencedServer([okResponse(0n), okResponse(1n), okResponse(3n)]),
			),
		);
		expect(result.status).toBe("FAIL");
		expect(result.actual).toContain("added to the previous allowance");
	});

	it("names an ignored second approval instead of calling it accumulation", async () => {
		stubSubmit(APPLIED);
		// 0 -> 1 -> 1: neither overwrite (would land on 2) nor accumulate
		// (would land on 3) — the second approval did nothing at all.
		const result = await approveCheck.run(
			writeCtx(
				sequencedServer([okResponse(0n), okResponse(1n), okResponse(1n)]),
			),
		);
		expect(result.status).toBe("FAIL");
		expect(result.actual).toContain("did not change the allowance");
		expect(result.actual).not.toContain("accumulated");
	});

	it("FAILs a contract that adds to the allowance instead of replacing it", async () => {
		stubSubmit(APPLIED);
		const result = await approveCheck.run(
			writeCtx(sequencedServer([okResponse(5n), okResponse(6n)])),
		);
		expect(result.status).toBe("FAIL");
		expect(result.actual).toContain("added to the previous allowance");
	});

	it("is UNVERIFIABLE without the holder's key", async () => {
		const submit = stubSubmit(APPLIED);
		const result = await approveCheck.run(
			writeCtx(sequencedServer([okResponse(0n)]), { ownerSigns: false }),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("OWNER_SECRET");
		expect(submit).not.toHaveBeenCalled();
	});

	it("is UNVERIFIABLE when holder and spender are the same address", async () => {
		const submit = stubSubmit(APPLIED);
		const ctx = writeCtx(sequencedServer([okResponse(0n)]));
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

	it("is UNVERIFIABLE on submission timeout, carrying the hash", async () => {
		stubSubmit({ kind: "timeout", txHash: "deadbeef" });
		const result = await approveCheck.run(
			writeCtx(sequencedServer([okResponse(0n)])),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("deadbeef");
	});

	it("is UNVERIFIABLE when archived state must be restored", async () => {
		stubSubmit({ kind: "restore", diagnostics: "restore me" });
		const result = await approveCheck.run(
			writeCtx(sequencedServer([okResponse(0n)])),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("archived state");
	});

	it("is UNVERIFIABLE when the approval is refused by trustline policy", async () => {
		stubSubmit(rejected("trustline entry is missing for account G..."));
		const result = await approveCheck.run(
			writeCtx(sequencedServer([okResponse(0n)])),
		);
		expect(result.status).toBe("UNVERIFIABLE");
		expect(result.actual).toContain("trustline policy");
	});

	it("reports NOT_IMPLEMENTED when the spec declares no approve", async () => {
		const ctx = writeCtx(sequencedServer([okResponse(0n)]));
		const result = await approveCheck.run({
			...ctx,
			specFunctions: ["balance"],
		});
		expect(result.status).toBe("NOT_IMPLEMENTED");
		expect(result.layer).toBe("interface");
	});
});
