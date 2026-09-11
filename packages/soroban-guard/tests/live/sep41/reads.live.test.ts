import { rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { runSuite } from "../../../src/core/runner.ts";
import { inspectContract } from "../../../src/core/spec.ts";
import type { Sep41Context } from "../../../src/sep41/context.ts";
import { sep41Suite, withCoverageGaps } from "../../../src/sep41/index.ts";

const CONTRACT = process.env.TESTNET_CONTRACT_ID;
const RPC_URL =
	process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const PASSPHRASE =
	process.env.NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const OWNER = process.env.OWNER_ADDRESS;
const SPENDER = process.env.SPENDER_ADDRESS;

describe.skipIf(!(CONTRACT && OWNER && SPENDER))(
	"SEP-41 reads on testnet",
	() => {
		it("all five reads PASS", async () => {
			if (!CONTRACT || !OWNER || !SPENDER) {
				throw new Error("unreachable: env guard skipped this suite");
			}
			const server = new rpc.Server(RPC_URL);
			const source = await server.getAccount(OWNER);
			const inspected = await inspectContract(server, CONTRACT);
			const ctx: Sep41Context = {
				server,
				contractId: CONTRACT,
				source,
				networkPassphrase: PASSPHRASE,
				owner: OWNER,
				spender: SPENDER,
				ownerIsThrowaway: false,
				specFunctions: inspected.kind === "wasm" ? inspected.functions : null,
			};
			const assessed = await runSuite(sep41Suite, ctx);
			const results = withCoverageGaps(assessed);
			expect(results).toHaveLength(10);
			for (const result of results.slice(0, 5)) {
				expect(
					result?.status,
					`${result?.id} → ${result?.actual} ${result?.evidence.error ?? ""}`,
				).toBe("PASS");
			}
			for (const result of results.slice(5)) {
				expect(result?.status).toBe("UNVERIFIABLE");
				expect(result?.actual).toBe("not assessed by this suite");
			}
		}, 60_000);
	},
);
