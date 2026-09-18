import { Address, rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { runSuite } from "../../../src/core/runner.ts";
import { inspectContract } from "../../../src/core/spec.ts";
import type { Sep41Context } from "../../../src/sep41/context.ts";
import { sep41Suite, withCoverageGaps } from "../../../src/sep41/index.ts";

const RPC_URL =
	process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE =
	process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const OWNER = process.env.OWNER_ADDRESS;
const SPENDER = process.env.SPENDER_ADDRESS;

// The all-zero contract address is assumed undeployed on testnet: grinding
// a deployment to it is infeasible, but if this test ever flips to PASS,
// reinvestigate rather than deleting it.
//
// Note the CLI itself would refuse this address first (missing → exit 2).
// This test bypasses the CLI to prove the suite *reports* failure — FAIL
// with diagnostics — which is what SOW evidence for negatives will show.
const EMPTY_CONTRACT = Address.contract(new Uint8Array(32)).toString();

describe.skipIf(!(OWNER && SPENDER))("SEP-41 reads against nothing", () => {
	it("every check FAILs with its diagnostic preserved", async () => {
		if (!OWNER || !SPENDER) {
			throw new Error("unreachable: env guard skipped this suite");
		}
		const server = new rpc.Server(RPC_URL);
		const source = await server.getAccount(OWNER);
		const inspected = await inspectContract(server, EMPTY_CONTRACT);
		expect(inspected.kind).toBe("missing");
		const ctx: Sep41Context = {
			server,
			contractId: EMPTY_CONTRACT,
			source,
			networkPassphrase: PASSPHRASE,
			parties: {
				owner: { address: OWNER, isThrowaway: false },
				spender: { address: SPENDER, isThrowaway: false },
			},
			specFunctions: null,
		};
		const assessed = await runSuite(sep41Suite, ctx);
		const results = withCoverageGaps(assessed);
		expect(results).toHaveLength(10);
		for (const result of results.slice(0, 5)) {
			expect(result?.status).toBe("FAIL");
			expect(result?.evidence.error).toBeDefined();
		}
		// transfer is in the suite but never reaches the contract: no signer
		// is configured here, so it reports about us, not about the address.
		// Everything past it is an unassessed-member gap row.
		for (const result of results.slice(5)) {
			expect(result?.status).toBe("UNVERIFIABLE");
		}
		expect(results[5]?.id).toBe("sep41-transfer");
	}, 60_000);
});
