import type { Account, rpc } from "@stellar/stellar-sdk";

/**
 * Everything a SEP-41 check needs to run. This is the concrete `Ctx` that
 * `Check<Ctx>` is generic over — it lives in sep41/, never in core/.
 *
 * `source` supplies the sequence number for simulation only; simulation
 * spends nothing. `owner` is funded on demand but never given a trustline:
 * a supplied owner needs a pre-existing TEST trustline for balance reads,
 * while a generated probe without one reports UNVERIFIABLE, never FAIL.
 * `spender` is never funded — simulation argument only. Roles, not
 * identities — which account plays each role is decided by the caller.
 *
 * `specFunctions` is the contract's declared function list when determinable
 * (WASM tokens), fetched once per run. `null` means undeterminable (SAC has
 * no spec to read) — checks proceed to simulation as if everything exists,
 * and a trap is judged on its own terms.
 */
export interface Sep41Context {
	readonly server: rpc.Server;
	readonly contractId: string;
	readonly source: Account;
	readonly networkPassphrase: string;
	readonly owner: string;
	readonly spender: string;
	/**
	 * True when the owner address was generated for this run rather than
	 * supplied. A generated probe asserting balance 0 proves nothing, so
	 * checks use this to report UNVERIFIABLE instead of a vacuous PASS.
	 */
	readonly ownerIsThrowaway: boolean;
	readonly specFunctions: readonly string[] | null;
}
