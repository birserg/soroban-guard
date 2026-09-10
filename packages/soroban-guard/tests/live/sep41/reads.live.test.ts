import { rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { runSuite } from "../../../src/core/runner.ts";
import type { Sep41Context } from "../../../src/sep41/context.ts";
import { sep41Suite } from "../../../src/sep41/index.ts";

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
		it("decimals, balance and allowance all PASS", async () => {
			if (!CONTRACT || !OWNER || !SPENDER) {
				throw new Error("unreachable: env guard skipped this suite");
			}
			const server = new rpc.Server(RPC_URL);
			const source = await server.getAccount(OWNER);
			const ctx: Sep41Context = {
				server,
				contractId: CONTRACT,
				source,
				networkPassphrase: PASSPHRASE,
				owner: OWNER,
				spender: SPENDER,
			};
			const results = await runSuite(sep41Suite, ctx);
			expect(results).toHaveLength(3);
			for (const result of results) {
				expect(
					result.status,
					`${result.id} → ${result.actual} ${result.evidence.error ?? ""}`,
				).toBe("PASS");
			}
		}, 60_000);
	},
);
