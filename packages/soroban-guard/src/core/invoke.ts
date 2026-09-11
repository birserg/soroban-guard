import {
	type Account,
	Address,
	BASE_FEE,
	Networks,
	Operation,
	rpc,
	scValToNative,
	TransactionBuilder,
	type xdr,
} from "@stellar/stellar-sdk";

/**
 * Read path: simulate a contract call, decode the outcome.
 *
 * A trap is a result, not an exception — `interpretSimulation` maps it to
 * `{ kind: "trapped" }` so negative checks can assert on it. Only harness
 * failures (RPC down, malformed address) throw, and those propagate.
 */

// Transaction validity window. Irrelevant for pure simulation; kept so the
// write path builds identical transactions when it submits for real.
const TX_TIMEOUT_S = 30;

/** A single read-only contract invocation. Args arrive pre-encoded as ScVals. */
export interface ReadCall {
	readonly contractId: string;
	readonly method: string;
	readonly args: readonly xdr.ScVal[];
}

export type InvokeResult =
	| { readonly kind: "ok"; readonly value: unknown }
	| { readonly kind: "trapped"; readonly diagnostics: string }
	| { readonly kind: "restore"; readonly diagnostics: string }
	| { readonly kind: "inconclusive"; readonly diagnostics: string };

/**
 * Encode a `C...`/`G...` address argument. Contract functions take ScVals,
 * never raw strings — a raw string encodes as an ScString and the call traps
 * on type mismatch.
 */
export function addressArg(address: string): xdr.ScVal {
	return Address.fromString(address).toScVal();
}

/**
 * I/O half: build the invocation against `source` and simulate it. Returns
 * the raw simulation response — decoding is `interpretSimulation`'s job.
 *
 * `source` supplies the sequence number only; simulation spends nothing.
 * Re-fetch it before each real transaction — sequence is consumed even by
 * transactions that fail on-chain.
 */
export async function simulateRead(
	server: rpc.Server,
	source: Account,
	call: ReadCall,
	networkPassphrase: string = Networks.TESTNET,
): Promise<rpc.Api.SimulateTransactionResponse> {
	const tx = new TransactionBuilder(source, {
		fee: BASE_FEE,
		networkPassphrase,
	})
		.addOperation(
			Operation.invokeContractFunction({
				contract: call.contractId,
				function: call.method,
				args: [...call.args],
			}),
		)
		.setTimeout(TX_TIMEOUT_S)
		.build();
	return server.simulateTransaction(tx);
}

/**
 * Pure half: map a simulation response to an `InvokeResult`. No I/O, fully
 * unit-testable against captured fixtures.
 *
 * Decoding notes: integers wider than 32 bits arrive as `bigint` (i128
 * balances included) — never coerce to `number`. A `void` return decodes to
 * `null` (there is no other null source). Restore responses are
 * success-shaped at runtime and carry the answer — reads decode it as `ok`
 * because reads never submit; only a restore *without* an answer reports
 * `restore`. Answerless success is partial RPC data, never a contract trap,
 * so it reports `inconclusive` and callers must not FAIL on it.
 */
export function interpretSimulation(
	sim: rpc.Api.SimulateTransactionResponse,
): InvokeResult {
	if (rpc.Api.isSimulationError(sim)) {
		return { kind: "trapped", diagnostics: sim.error };
	}
	if (rpc.Api.isSimulationSuccess(sim) && sim.result?.retval !== undefined) {
		return { kind: "ok", value: scValToNative(sim.result.retval) };
	}
	if (rpc.Api.isSimulationRestore(sim)) {
		return {
			kind: "restore",
			diagnostics:
				"no answer and archived entries need restoration before this call can execute",
		};
	}
	return {
		kind: "inconclusive",
		diagnostics: "simulation succeeded without a return value",
	};
}
