import { Keypair, rpc } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { fundAccount } from "../../../src/core/funding.ts";

const RPC_URL =
	process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

// No skip guard: this suite IS the network suite. Funding needs no
// addresses from env — the throwaway is generated per run.
describe("funding on testnet", () => {
	it("funds a fresh throwaway account", async () => {
		const server = new rpc.Server(RPC_URL);
		const keypair = Keypair.random();
		await fundAccount(server, keypair.publicKey());
		// Resolving means funded: getAccount throws for unfunded accounts.
		await expect(server.getAccount(keypair.publicKey())).resolves.toBeDefined();
	}, 90_000);
});
