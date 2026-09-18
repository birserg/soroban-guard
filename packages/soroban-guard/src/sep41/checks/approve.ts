/**
 * SEP-41 §approve — grant a spender permission to move the holder's balance.
 *
 * Reads the allowance, submits an approval, reads it again. Unlike transfer,
 * the assertion is an absolute value rather than a delta: SEP-41 says
 * approve "overrides any existing allowance", so a conformant contract ends
 * at exactly the approved amount regardless of what was there before. A
 * contract that added to the prior allowance instead of replacing it is
 * non-conformant, and only an absolute assertion catches that.
 *
 * The expiration is a `u32` ledger sequence, not an amount — and it must be
 * in the future, or the contract rejects an approval that is already expired.
 * Both are reasons this cannot reuse transfer's argument encoding wholesale.
 */
import {
	addressArg,
	amountArg,
	ledgerArg,
	submitWrite,
} from "../../core/invoke.ts";
import type { CheckResult } from "../../core/types.ts";
import type { Sep41Context } from "../context.ts";
import { writeEvidence } from "./delta.ts";
import { readAllowance } from "./quantity.ts";
import {
	type CheckMeta,
	classifyStanding,
	isDeclared,
	notImplemented,
} from "./shared.ts";

/** One unit: enough to prove the allowance moved, small enough to be safe. */
const APPROVE_AMOUNT = 1n;

/**
 * How far ahead to set the expiration. Far enough that the approval is
 * unambiguously live when the contract evaluates it, short enough that a
 * forgotten allowance lapses on its own — roughly a day at 5s ledgers.
 */
const EXPIRATION_LEDGERS = 17_280;

const approveMeta = {
	id: "sep41-approve",
	clause: "SEP-41 §approve",
	layer: "behavior",
	requirement: "required",
} as const satisfies CheckMeta;

const EXPECTED = "approve sets the spender's allowance to the given amount";

function unverifiable(
	actual: string,
	durationMs: number,
	error?: string,
): CheckResult {
	return {
		...approveMeta,
		status: "UNVERIFIABLE",
		expected: EXPECTED,
		actual,
		evidence: error === undefined ? {} : { error },
		durationMs,
	};
}

/**
 * Submit one approval. Exported because transfer_from and burn_from need an
 * allowance to exist before they can test anything, and duplicating the
 * argument encoding in three places is how the amount and the expiration
 * end up with different widths in two of them.
 */
export async function submitApproval(
	ctx: Sep41Context,
	amount: bigint,
	currentLedger: number,
): Promise<ReturnType<typeof submitWrite>> {
	const { owner, spender } = ctx.parties;
	if (owner.signer === undefined) {
		throw new Error("submitApproval requires a signer for the holder");
	}
	return submitWrite(
		ctx.server,
		{
			contractId: ctx.contractId,
			method: "approve",
			args: [
				addressArg(owner.address),
				addressArg(spender.address),
				amountArg(amount),
				ledgerArg(currentLedger + EXPIRATION_LEDGERS),
			],
			signer: owner.signer,
		},
		ctx.networkPassphrase,
	);
}

export const approveCheck = {
	...approveMeta,
	description: "approve() sets the spender's allowance to the given amount",
	async run(ctx: Sep41Context): Promise<CheckResult> {
		const started = Date.now();
		const elapsed = () => Date.now() - started;
		if (!isDeclared(ctx, "approve")) {
			return notImplemented(approveMeta, "approve", elapsed());
		}

		const { owner, spender } = ctx.parties;
		if (owner.signer === undefined) {
			return unverifiable(
				"no signing authority for the holder; set OWNER_SECRET to the account granting the allowance",
				elapsed(),
			);
		}
		if (owner.signer.address !== owner.address) {
			return unverifiable(
				`the holder is ${owner.address} but the signer signs as ${owner.signer.address}; supply a signer for the holder`,
				elapsed(),
			);
		}
		// Approving yourself is not a meaningful grant, and a contract may
		// reasonably refuse it — which would read as a defect.
		if (owner.address === spender.address) {
			return unverifiable(
				"holder and spender are the same address; an allowance to yourself proves nothing — set SPENDER_ADDRESS to a different account",
				elapsed(),
			);
		}

		const before = await readAllowance(ctx, owner.address, spender.address);
		if (before.kind === "defect") {
			return {
				...approveMeta,
				status: "FAIL",
				expected: EXPECTED,
				actual: `${before.detail}; the before state cannot be trusted`,
				evidence: before.error === "" ? {} : { error: before.error },
				durationMs: elapsed(),
			};
		}
		if (before.kind !== "value") {
			return unverifiable(
				"allowance unreadable; cannot establish a before state to compare against",
				elapsed(),
			);
		}

		const submitted = await submitApproval(ctx, APPROVE_AMOUNT, before.ledger);
		if (submitted.kind === "timeout") {
			return {
				...approveMeta,
				status: "UNVERIFIABLE",
				expected: EXPECTED,
				actual:
					submitted.txHash === ""
						? "stopped waiting, and no transaction hash was observed; the approval may still apply"
						: `stopped waiting on ${submitted.txHash}; it may still apply`,
				evidence: submitted.txHash === "" ? {} : { txHash: submitted.txHash },
				durationMs: elapsed(),
			};
		}
		if (submitted.kind === "restore") {
			return unverifiable(
				"archived state must be restored before this call can execute",
				elapsed(),
				submitted.diagnostics,
			);
		}
		if (submitted.kind === "rejected") {
			const standing = classifyStanding(submitted.diagnostics);
			if (standing !== null) {
				return unverifiable(
					"the approval was refused by the asset's own trustline policy, not by a defect in the contract",
					elapsed(),
					submitted.diagnostics,
				);
			}
			return {
				...approveMeta,
				status: "FAIL",
				expected: EXPECTED,
				actual: "an approval signed by the holder was refused",
				evidence: { error: submitted.diagnostics },
				durationMs: elapsed(),
			};
		}

		const after = await readAllowance(ctx, owner.address, spender.address);
		const evidence = writeEvidence(submitted, { allowance: before.amount });
		if (after.kind === "defect") {
			return {
				...approveMeta,
				status: "FAIL",
				expected: EXPECTED,
				actual: `approval applied, then ${after.detail}`,
				evidence:
					after.error === "" ? evidence : { ...evidence, error: after.error },
				durationMs: elapsed(),
			};
		}
		if (after.kind !== "value") {
			return {
				...approveMeta,
				status: "UNVERIFIABLE",
				expected: EXPECTED,
				actual: "approval applied but the allowance was unreadable afterwards",
				evidence,
				durationMs: elapsed(),
			};
		}

		// Absolute, not relative: approve overrides rather than accumulates.
		const settled = writeEvidence(
			submitted,
			{ allowance: before.amount },
			{ allowance: after.amount },
		);
		const exact = after.amount === APPROVE_AMOUNT;
		return {
			...approveMeta,
			status: exact ? "PASS" : "FAIL",
			expected: EXPECTED,
			actual: exact
				? `allowance is ${after.amount} after approving ${APPROVE_AMOUNT}`
				: `allowance is ${after.amount} after approving ${APPROVE_AMOUNT}${
						after.amount === before.amount + APPROVE_AMOUNT
							? "; the approval was added to the previous allowance rather than replacing it"
							: ""
					}`,
			evidence: settled,
			durationMs: elapsed(),
		};
	},
};
