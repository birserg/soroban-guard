/**
 * SEP-41 §transfer_from — a spender moves the holder's balance on their
 * behalf, consuming the allowance that authorised it.
 *
 * Three quantities move at once, and all three are asserted: the holder is
 * debited, the recipient credited, and the allowance drawn down by the same
 * amount. That last one is what distinguishes this from transfer — a
 * contract that moved the tokens but left the allowance untouched has
 * granted an unlimited permit, which is a drain waiting to happen.
 *
 * The allowance is established by this check rather than assumed. Depending
 * on approve having run first would make an approve failure surface as a
 * transfer_from verdict, and would stop either check from running alone.
 * So a setup approval is submitted first, and its failure reports
 * UNVERIFIABLE — a fact about the run, not about transfer_from.
 *
 * Signed by the spender, not the holder: `spender.require_auth()` is what
 * the clause specifies, so `SPENDER_SECRET` is what this needs.
 */
import { addressArg, amountArg, submitWrite } from "../../core/invoke.ts";
import type { CheckResult } from "../../core/types.ts";
import type { Sep41Context } from "../context.ts";
import { submitApproval } from "./approve.ts";
import { assertDeltas, writeEvidence } from "./delta.ts";
import { type QuantityRead, readAllowance, readBalance } from "./quantity.ts";
import {
	type CheckMeta,
	classifyStanding,
	isDeclared,
	notImplemented,
} from "./shared.ts";

const MOVE_AMOUNT = 1n;

/** See transfer.ts — the issuer is not a holder in either direction. */
const ISSUER_SENTINEL_BALANCE = 2n ** 63n - 1n;

const transferFromMeta = {
	id: "sep41-transfer_from",
	clause: "SEP-41 §transfer_from",
	layer: "behavior",
	requirement: "required",
} as const satisfies CheckMeta;

const EXPECTED =
	"transfer_from moves the amount and consumes the spender's allowance";

function unverifiable(
	actual: string,
	durationMs: number,
	error?: string,
): CheckResult {
	return {
		...transferFromMeta,
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
		...transferFromMeta,
		status: "FAIL",
		expected: EXPECTED,
		actual,
		evidence,
		durationMs,
	};
}

/** A defect is the contract's fault; anything else leaves us without a baseline. */
function baselineProblem(
	read: QuantityRead,
	elapsed: () => number,
): CheckResult | null {
	if (read.kind === "defect") {
		return failed(
			`${read.detail}; the before state cannot be trusted`,
			elapsed(),
			read.error === "" ? {} : { error: read.error },
		);
	}
	if (read.kind !== "value") {
		return unverifiable(
			`${read.detail}; cannot establish a before state to compare against`,
			elapsed(),
		);
	}
	return null;
}

export const transferFromCheck = {
	...transferFromMeta,
	description: "transfer_from() moves the amount and draws down the allowance",
	async run(ctx: Sep41Context): Promise<CheckResult> {
		const started = Date.now();
		const elapsed = () => Date.now() - started;
		if (!isDeclared(ctx, "transfer_from")) {
			return notImplemented(transferFromMeta, "transfer_from", elapsed());
		}

		const { owner, spender } = ctx.parties;
		// Two signers, two reasons. The holder's key creates the allowance;
		// the spender's key exercises it. Stated together so an operator
		// learns both requirements in one run rather than two.
		if (owner.signer === undefined || spender.signer === undefined) {
			return unverifiable(
				"transfer_from needs both keys: OWNER_SECRET to grant the allowance and SPENDER_SECRET to spend it",
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
				"holder and spender are the same address; a self-transfer nets zero and consumes no allowance — set SPENDER_ADDRESS to a different account",
				elapsed(),
			);
		}

		const beforeOwner = await readBalance(ctx, owner.address);
		const ownerProblem = baselineProblem(beforeOwner, elapsed);
		if (ownerProblem !== null) {
			return ownerProblem;
		}
		const beforeSpender = await readBalance(ctx, spender.address);
		const spenderProblem = baselineProblem(beforeSpender, elapsed);
		if (spenderProblem !== null) {
			return spenderProblem;
		}
		if (beforeOwner.kind !== "value" || beforeSpender.kind !== "value") {
			return unverifiable("balances unreadable", elapsed());
		}
		if (beforeOwner.amount < MOVE_AMOUNT) {
			return unverifiable(
				`holder has ${beforeOwner.amount}, nothing to transfer`,
				elapsed(),
			);
		}
		if (
			beforeOwner.amount === ISSUER_SENTINEL_BALANCE ||
			beforeSpender.amount === ISSUER_SENTINEL_BALANCE
		) {
			return unverifiable(
				"one party is the asset issuer (balance reads i64::MAX); issuer transfers mint or burn rather than move, so the delta proves nothing",
				elapsed(),
			);
		}

		// Setup, not assertion: the allowance has to exist before there is
		// anything to consume. A failure here says nothing about
		// transfer_from, so it never reaches a verdict.
		const seeded = await readAllowance(ctx, owner.address, spender.address);
		if (seeded.kind !== "value") {
			return unverifiable(
				"could not read the allowance to set up the test",
				elapsed(),
			);
		}
		const approval = await submitApproval(ctx, MOVE_AMOUNT, seeded.ledger);
		if (approval.kind !== "applied") {
			return unverifiable(
				"could not establish an allowance to spend; approve must work before transfer_from can be assessed",
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
		if (beforeAllowance.amount < MOVE_AMOUNT) {
			return unverifiable(
				`the setup approval left an allowance of ${beforeAllowance.amount}; approve is not honouring the amount it was given`,
				elapsed(),
			);
		}

		const submitted = await submitWrite(
			ctx.server,
			{
				contractId: ctx.contractId,
				method: "transfer_from",
				args: [
					addressArg(spender.address),
					addressArg(owner.address),
					addressArg(spender.address),
					amountArg(MOVE_AMOUNT),
				],
				// The spender authorises this, not the holder.
				signer: spender.signer,
			},
			ctx.networkPassphrase,
		);

		const before = {
			holder: beforeOwner.amount,
			recipient: beforeSpender.amount,
			allowance: beforeAllowance.amount,
		};
		if (submitted.kind === "timeout") {
			return {
				...transferFromMeta,
				status: "UNVERIFIABLE",
				expected: EXPECTED,
				actual:
					submitted.txHash === ""
						? "stopped waiting, and no transaction hash was observed; the transfer may still apply"
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
					"the transfer was refused by the asset's own trustline policy, not by a defect in the contract",
					elapsed(),
					submitted.diagnostics,
				);
			}
			return failed(
				"a transfer_from within an allowance the contract itself granted was refused",
				elapsed(),
				{ error: submitted.diagnostics },
			);
		}

		const afterOwner = await readBalance(ctx, owner.address);
		const afterSpender = await readBalance(ctx, spender.address);
		const afterAllowance = await readAllowance(
			ctx,
			owner.address,
			spender.address,
		);
		const settled = writeEvidence(submitted, before);
		for (const read of [afterOwner, afterSpender, afterAllowance]) {
			if (read.kind === "defect") {
				return failed(`transfer applied, then ${read.detail}`, elapsed(), {
					...settled,
					...(read.error === "" ? {} : { error: read.error }),
				});
			}
		}
		if (
			afterOwner.kind !== "value" ||
			afterSpender.kind !== "value" ||
			afterAllowance.kind !== "value"
		) {
			return {
				...transferFromMeta,
				status: "UNVERIFIABLE",
				expected: EXPECTED,
				actual: "transfer applied but the state was unreadable afterwards",
				evidence: settled,
				durationMs: elapsed(),
			};
		}

		// The allowance draw-down is the clause's distinguishing requirement:
		// moving the tokens without consuming it leaves a standing permit.
		return assertDeltas(
			transferFromMeta,
			EXPECTED,
			[
				{
					label: "holder",
					before: beforeOwner.amount,
					after: afterOwner.amount,
				},
				{
					label: "recipient",
					before: beforeSpender.amount,
					after: afterSpender.amount,
				},
				{
					label: "allowance",
					before: beforeAllowance.amount,
					after: afterAllowance.amount,
				},
			],
			[
				{ label: "holder", delta: -MOVE_AMOUNT },
				{ label: "recipient", delta: MOVE_AMOUNT },
				{ label: "allowance", delta: -MOVE_AMOUNT },
			],
			writeEvidence(submitted, before, {
				holder: afterOwner.amount,
				recipient: afterSpender.amount,
				allowance: afterAllowance.amount,
			}),
			elapsed(),
		);
	},
};
