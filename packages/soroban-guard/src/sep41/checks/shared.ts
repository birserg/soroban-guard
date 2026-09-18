/**
 * Machinery every SEP-41 check needs, whether it reads or writes: check
 * identity, the spec short-circuit, the chain call, and standing
 * classification.
 */
import type { xdr } from "@stellar/stellar-sdk";
import {
	type InvokeResult,
	interpretSimulation,
	simulateRead,
} from "../../core/invoke.ts";
import type { CheckResult } from "../../core/types.ts";
import type { Sep41Context } from "../context.ts";

/** The identity fields a check declares once and stamps onto every result. */
export type CheckMeta = Pick<
	CheckResult,
	"id" | "clause" | "layer" | "requirement"
>;

/**
 * Whether the contract declares this member. A WASM contract's spec is
 * authoritative, so a missing member is answered without spending a
 * simulation. `null` means the spec is undeterminable (a SAC has none) —
 * proceed and judge the call on its own terms.
 */
export function isDeclared(ctx: Sep41Context, method: string): boolean {
	return ctx.specFunctions === null || ctx.specFunctions.includes(method);
}

/**
 * Absence is an interface verdict, not a behavior one — so this reports
 * under the interface layer whatever layer the check itself belongs to.
 */
export function notImplemented(
	meta: CheckMeta,
	method: string,
	durationMs: number,
): CheckResult {
	return {
		...meta,
		layer: "interface",
		status: "NOT_IMPLEMENTED",
		expected: `${method}() is implemented`,
		actual: `contract spec declares no '${method}'`,
		evidence: {},
		durationMs,
	};
}

/**
 * Simulate one read and decode the outcome. Every check reaches the chain
 * through here; `ledger` is the node's latest at observation time, which is
 * evidence for reads since they apply nothing.
 */
export async function callRead(
	ctx: Sep41Context,
	method: string,
	args: readonly xdr.ScVal[],
): Promise<{ readonly outcome: InvokeResult; readonly ledger: number }> {
	const sim = await simulateRead(
		ctx.server,
		ctx.source,
		{ contractId: ctx.contractId, method, args },
		ctx.networkPassphrase,
	);
	return { outcome: interpretSimulation(sim), ledger: sim.latestLedger };
}

/**
 * Why a call may have had no standing to succeed — or null when the outcome
 * is the contract's own behavior.
 *
 * A Stellar Asset Contract enforces the asset's rules alongside the token
 * interface: account balances live in trustlines, and an `AUTH_REQUIRED`
 * asset needs the issuer's authorization. A call tripping either never had
 * standing, so treating it as a defect accuses a conformant token.
 *
 * Reads diagnostic text, which this codebase otherwise avoids — error
 * strings are RPC- and version-specific. It is the only place the reason
 * exists: no balance read predicts it, and for a submission the attempt has
 * already happened. It fails safe either way, since an unmatched string
 * falls through to the verdict we would have reported anyway, and a match
 * only ever downgrades an accusation to "unknown".
 *
 * Patterns are the SAC host's own wording, narrower than a bare "not
 * authorized" — that phrase appears in custom-token panics where the refusal
 * IS the verdict, and downgrading those would hide real findings.
 *
 * Returns a code rather than a sentence: reads and writes phrase the same
 * finding differently, and keeping two copies of the patterns in sync is
 * exactly the drift this exists to prevent.
 */
export type StandingProblem = "no-trustline" | "not-authorized";

export function classifyStanding(diagnostics: string): StandingProblem | null {
	if (/trustline entry is missing/i.test(diagnostics)) {
		return "no-trustline";
	}
	if (/balance is deauthorized|trustline is deauthorized/i.test(diagnostics)) {
		return "not-authorized";
	}
	return null;
}
