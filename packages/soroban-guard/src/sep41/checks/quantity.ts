/**
 * Reading a quantity the way a write check needs it.
 *
 * Every state-changing check observes a number before and after, so each
 * needs the same three-way answer: the contract is wrong, we have no answer,
 * or here is the value. Collapsing the first two — the obvious shortcut —
 * is what makes a check report UNVERIFIABLE in the same run where the
 * matching read check FAILs, one contract with two answers.
 */
import { addressArg } from "../../core/invoke.ts";
import type { Sep41Context } from "../context.ts";
import { callRead, classifyStanding, describeValue } from "./shared.ts";

export type QuantityRead =
	| { readonly kind: "value"; readonly amount: bigint; readonly ledger: number }
	| { readonly kind: "defect"; readonly detail: string; readonly error: string }
	| { readonly kind: "no-answer"; readonly detail: string };

/**
 * `method` names the SEP-41 getter so diagnostics say which one misbehaved,
 * and `noun` names what it returns for the operator-facing message.
 */
async function readQuantity(
	ctx: Sep41Context,
	method: "balance" | "allowance",
	noun: string,
	addresses: readonly string[],
): Promise<QuantityRead> {
	const { outcome, ledger, fromArchive } = await callRead(
		ctx,
		method,
		addresses.map(addressArg),
	);
	// A restored answer is last-known state, and the write will bring the
	// entry current — so an archived baseline would be differenced against a
	// fresh after-read and the gap blamed on the contract.
	if (fromArchive) {
		return {
			kind: "no-answer",
			detail: `the ${noun} came from an archived entry, not current state`,
		};
	}
	if (outcome.kind === "ok") {
		if (typeof outcome.value !== "bigint") {
			return {
				kind: "defect",
				detail: `${method}() returned ${describeValue(outcome.value)}, expected an i128`,
				error: "",
			};
		}
		// SEP-41 quantities are non-negative, and the read checks FAIL a
		// negative one — both phases of a write must match that verdict.
		if (outcome.value < 0n) {
			return {
				kind: "defect",
				detail: `${method}() returned ${outcome.value}, which is negative`,
				error: "",
			};
		}
		return { kind: "value", amount: outcome.value, ledger };
	}
	if (outcome.kind === "trapped") {
		return classifyStanding(outcome.diagnostics) === null
			? {
					kind: "defect",
					detail: `${method}() trapped`,
					error: outcome.diagnostics,
				}
			: { kind: "no-answer", detail: `a ${noun} could not be read` };
	}
	return { kind: "no-answer", detail: `a ${noun} could not be read` };
}

export function readBalance(
	ctx: Sep41Context,
	address: string,
): Promise<QuantityRead> {
	return readQuantity(ctx, "balance", "balance", [address]);
}

export function readAllowance(
	ctx: Sep41Context,
	owner: string,
	spender: string,
): Promise<QuantityRead> {
	return readQuantity(ctx, "allowance", "allowance", [owner, spender]);
}
