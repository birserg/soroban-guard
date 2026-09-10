import type { Account, rpc } from "@stellar/stellar-sdk";

/**
 * Everything a SEP-41 check needs to run. This is the concrete `Ctx` that
 * `Check<Ctx>` is generic over — it lives in sep41/, never in core/.
 *
 * `source` supplies the sequence number for simulation only; simulation
 * spends nothing. `owner`/`spender` are the funded probe addresses (both
 * carry a trustline on SAC tokens): the owner holds the balance and grants
 * allowances, the spender receives them. Roles, not identities — which
 * account plays each role is decided by the caller.
 */
export interface Sep41Context {
	readonly server: rpc.Server;
	readonly contractId: string;
	readonly source: Account;
	readonly networkPassphrase: string;
	readonly owner: string;
	readonly spender: string;
}
