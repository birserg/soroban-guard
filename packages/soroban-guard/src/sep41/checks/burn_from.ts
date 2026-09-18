/**
 * SEP-41 §burn_from — a spender destroys the holder's tokens using the
 * allowance that authorised it.
 *
 * Two quantities move: the holder is debited and the allowance drawn down.
 * Nothing is credited, because a burn destroys rather than relocates — so
 * the spender's own balance must not change, and the allowance must fall by
 * the amount burned. A contract that burns without consuming the allowance
 * has left a standing permit to destroy more.
 *
 * Like transfer_from, the allowance is established here rather than assumed,
 * and the setup's failure reports UNVERIFIABLE rather than a verdict. Signed
 * by the spender, per `spender.require_auth()` in the clause.
 *
 * Irreversible: the tokens are gone. One unit, and every guard that protects
 * the operator applies.
 */
import { addressArg, amountArg, submitWrite } from "../../core/invoke.ts";
import type { CheckResult } from "../../core/types.ts";
import type { Sep41Context } from "../context.ts";
import { submitApproval } from "./approve.ts";
import { assertDeltas, writeEvidence } from "./delta.ts";
import { readAllowance, readBalance } from "./quantity.ts";
import {
	type CheckMeta,
	classifyStanding,
	isDeclared,
	notImplemented,
} from "./shared.ts";

const BURN_AMOUNT = 1n;

/** See transfer.ts — the issuer's balance is a sentinel, not a holding. */
const ISSUER_SENTINEL_BALANCE = 2n ** 63n - 1n;

const burnFromMeta = {
	id: "sep41-burn_from",
	clause: "SEP-41 §burn_from",
	layer: "behavior",
	requirement: "required",
} as const satisfies CheckMeta;

const EXPECTED =
	"burn_from removes the amount from the holder and consumes the allowance";

function unverifiable(
	actual: string,
	durationMs: number,
	error?: string,
): CheckResult {
	return {
		...burnFromMeta,
		status: "UNVERIFIABLE",
		expected: EXPECTED,
		actual,
		evidence: error === undefined ? {} : { error },
		durationMs,
	};
}

function failed(
	actual: string,
	durationMs: number,
	evidence: CheckResult["evidence"] = {},
): CheckResult {
	return {
		...burnFromMeta,
		status: "FAIL",
		expected: EXPECTED,
		actual,
		evidence,
		durationMs,
	};
}

export const burnFromCheck = {
	...burnFromMeta,
	description: "burn_from() burns the amount and draws down the allowance",
	async run(ctx: Sep41Context): Promise<CheckResult> {
		const started = Date.now();
		const elapsed = () => Date.now() - started;
		if (!isDeclared(ctx, "burn_from")) {
			return notImplemented(burnFromMeta, "burn_from", elapsed());
		}

		const { owner, spender } = ctx.parties;
		if (owner.signer === undefined || spender.signer === undefined) {
			return unverifiable(
				"burn_from needs both keys: OWNER_SECRET to grant the allowance and SPENDER_SECRET to spend it",
				elapsed(),
			);
		}
		if (
			owner.signer.address !== owner.address ||
			spender.signer.address !== spender.address
		) {
			return unverifiable(
				"a signer does not match the party it signs for; supply keys for the addresses under test",
				elapsed(),
			);
		}
		if (owner.address === spender.address) {
			return unverifiable(
				"holder and spender are the same address; burning your own tokens is the burn clause, not this one — set SPENDER_ADDRESS to a different account",
				elapsed(),
			);
		}

		const beforeOwner = await readBalance(ctx, owner.address);
		if (beforeOwner.kind === "defect") {
			return failed(
				`${beforeOwner.detail}; the before state cannot be trusted`,
				elapsed(),
				beforeOwner.error === "" ? {} : { error: beforeOwner.error },
			);
		}
		if (beforeOwner.kind !== "value") {
			return unverifiable(
				"balance unreadable; cannot establish a before state to compare against",
				elapsed(),
			);
		}
		if (beforeOwner.amount < BURN_AMOUNT) {
			return unverifiable(
				`holder has ${beforeOwner.amount}, nothing to burn`,
				elapsed(),
			);
		}
		if (beforeOwner.amount === ISSUER_SENTINEL_BALANCE) {
			return unverifiable(
				"holder is the asset issuer (balance reads i64::MAX); burning from an issuer does not decrease it, so the delta proves nothing — point OWNER_SECRET at a holding account",
				elapsed(),
			);
		}

		// Setup: something must be allowed before it can be consumed.
		const seeded = await readAllowance(ctx, owner.address, spender.address);
		if (seeded.kind !== "value") {
			return unverifiable(
				"could not read the allowance to set up the test",
				elapsed(),
			);
		}
		const approval = await submitApproval(ctx, BURN_AMOUNT, seeded.ledger);
		if (approval.kind !== "applied") {
			return unverifiable(
				"could not establish an allowance to spend; approve must work before burn_from can be assessed",
				elapsed(),
				approval.kind === "timeout" ? approval.txHash : approval.diagnostics,
			);
		}
		const beforeAllowance = await readAllowance(
			ctx,
			owner.address,
			spender.address,
		);
		if (beforeAllowance.kind !== "value") {
			return unverifiable(
				"allowance unreadable after the setup approval",
				elapsed(),
			);
		}
		if (beforeAllowance.amount < BURN_AMOUNT) {
			return unverifiable(
				`the setup approval left an allowance of ${beforeAllowance.amount}; approve is not honouring the amount it was given`,
				elapsed(),
			);
		}

		const submitted = await submitWrite(
			ctx.server,
			{
				contractId: ctx.contractId,
				method: "burn_from",
				args: [
					addressArg(spender.address),
					addressArg(owner.address),
					amountArg(BURN_AMOUNT),
				],
				signer: spender.signer,
			},
			ctx.networkPassphrase,
		);

		const before = {
			holder: beforeOwner.amount,
			allowance: beforeAllowance.amount,
		};
		if (submitted.kind === "timeout") {
			return {
				...burnFromMeta,
				status: "UNVERIFIABLE",
				expected: EXPECTED,
				actual:
					submitted.txHash === ""
						? "stopped waiting, and no transaction hash was observed; the burn may still apply"
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
			if (classifyStanding(submitted.diagnostics) !== null) {
				return unverifiable(
					"the burn was refused by the asset's own trustline policy, not by a defect in the contract",
					elapsed(),
					submitted.diagnostics,
				);
			}
			return failed(
				"a burn_from within an allowance the contract itself granted was refused",
				elapsed(),
				{ error: submitted.diagnostics },
			);
		}

		const afterOwner = await readBalance(ctx, owner.address);
		const afterAllowance = await readAllowance(
			ctx,
			owner.address,
			spender.address,
		);
		const settled = writeEvidence(submitted, before);
		for (const read of [afterOwner, afterAllowance]) {
			if (read.kind === "defect") {
				return failed(`burn applied, then ${read.detail}`, elapsed(), {
					...settled,
					...(read.error === "" ? {} : { error: read.error }),
				});
			}
		}
		if (afterOwner.kind !== "value" || afterAllowance.kind !== "value") {
			return {
				...burnFromMeta,
				status: "UNVERIFIABLE",
				expected: EXPECTED,
				actual: "burn applied but the state was unreadable afterwards",
				evidence: settled,
				durationMs: elapsed(),
			};
		}

		return assertDeltas(
			burnFromMeta,
			EXPECTED,
			[
				{
					label: "holder",
					before: beforeOwner.amount,
					after: afterOwner.amount,
				},
				{
					label: "allowance",
					before: beforeAllowance.amount,
					after: afterAllowance.amount,
				},
			],
			[
				{ label: "holder", delta: -BURN_AMOUNT },
				{ label: "allowance", delta: -BURN_AMOUNT },
			],
			writeEvidence(submitted, before, {
				holder: afterOwner.amount,
				allowance: afterAllowance.amount,
			}),
			elapsed(),
		);
	},
};
