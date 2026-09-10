import {
	addressArg,
	type InvokeResult,
	interpretSimulation,
	type ReadCall,
	simulateRead,
} from "../../core/invoke.ts";
import type { Check, CheckResult } from "../../core/types.ts";
import type { Sep41Context } from "../context.ts";

type CheckMeta = Pick<CheckResult, "id" | "clause" | "layer" | "requirement">;

/**
 * Shared outcome mapping for read-only checks. A trap is FAIL data (never
 * an exception); a restore is UNVERIFIABLE (the call never executed, so the
 * contract is not implicated); otherwise `accept` decides what a sane value
 * looks like and phrases it, or returns null to FAIL.
 *
 * TODO: distinguish missing-function → NOT_IMPLEMENTED via contract-spec
 * introspection (fetch the code entry, parse the spec for the function
 * name). Do NOT sniff the trap diagnostic string — that couples us to
 * RPC-version-specific error text.
 */
function mapReadOutcome(
	meta: CheckMeta,
	expected: string,
	ledger: number,
	outcome: InvokeResult,
	accept: (value: unknown) => string | null,
	durationMs: number,
): CheckResult {
	if (outcome.kind === "restore") {
		return {
			...meta,
			status: "UNVERIFIABLE",
			expected,
			actual: "call needs restoration; not executed",
			evidence: { ledger, error: outcome.diagnostics },
			durationMs,
		};
	}
	if (outcome.kind === "trapped") {
		return {
			...meta,
			status: "FAIL",
			expected,
			actual: "call trapped",
			evidence: { ledger, error: outcome.diagnostics },
			durationMs,
		};
	}
	const actual = accept(outcome.value);
	if (actual !== null) {
		return {
			...meta,
			status: "PASS",
			expected,
			actual,
			evidence: { ledger },
			durationMs,
		};
	}
	return {
		...meta,
		status: "FAIL",
		expected,
		actual: `returned unexpected value ${String(outcome.value)}`,
		evidence: { ledger },
		durationMs,
	};
}

async function execute(
	ctx: Sep41Context,
	call: ReadCall,
): Promise<{
	simLatestLedger: number;
	outcome: InvokeResult;
	durationMs: number;
}> {
	const started = Date.now();
	const sim = await simulateRead(
		ctx.server,
		ctx.source,
		call,
		ctx.networkPassphrase,
	);
	return {
		simLatestLedger: sim.latestLedger,
		outcome: interpretSimulation(sim),
		durationMs: Date.now() - started,
	};
}

// Sanity bound, not spec: SEP-41 puts no maximum on decimals. Anything
// above this almost certainly indicates a decode error rather than a real
// token (Stellar assets use 7 or fewer).
const MAX_PLAUSIBLE_DECIMALS = 38;
const decimalsMeta = {
	id: "sep41-decimals",
	clause: "SEP-41 §decimals",
	layer: "interface",
	requirement: "required",
} as const satisfies CheckMeta;

export const decimalsCheck: Check<Sep41Context> = {
	...decimalsMeta,
	description: "decimals() returns the token's decimal precision",
	async run(ctx) {
		const { simLatestLedger, outcome, durationMs } = await execute(ctx, {
			contractId: ctx.contractId,
			method: "decimals",
			args: [],
		});
		return mapReadOutcome(
			decimalsMeta,
			"u32 decimal precision",
			simLatestLedger,
			outcome,
			(value) =>
				typeof value === "number" &&
				Number.isInteger(value) &&
				value >= 0 &&
				value <= MAX_PLAUSIBLE_DECIMALS
					? `returned ${value}`
					: null,
			durationMs,
		);
	},
};

const balanceMeta = {
	id: "sep41-balance",
	clause: "SEP-41 §balance",
	layer: "behavior",
	requirement: "required",
} as const satisfies CheckMeta;

export const balanceCheck: Check<Sep41Context> = {
	...balanceMeta,
	description: "balance() returns a non-negative holding for an address",
	async run(ctx) {
		const { simLatestLedger, outcome, durationMs } = await execute(ctx, {
			contractId: ctx.contractId,
			method: "balance",
			args: [addressArg(ctx.owner)],
		});
		return mapReadOutcome(
			balanceMeta,
			"non-negative balance for the holder",
			simLatestLedger,
			outcome,
			(value) =>
				typeof value === "bigint" && value >= 0n ? `balance is ${value}` : null,
			durationMs,
		);
	},
};

const allowanceMeta = {
	id: "sep41-allowance",
	clause: "SEP-41 §allowance",
	layer: "behavior",
	requirement: "required",
} as const satisfies CheckMeta;

export const allowanceCheck: Check<Sep41Context> = {
	...allowanceMeta,
	description: "allowance() returns a non-negative spend approval",
	async run(ctx) {
		const { simLatestLedger, outcome, durationMs } = await execute(ctx, {
			contractId: ctx.contractId,
			method: "allowance",
			args: [addressArg(ctx.owner), addressArg(ctx.spender)],
		});
		return mapReadOutcome(
			allowanceMeta,
			"non-negative allowance from owner to spender",
			simLatestLedger,
			outcome,
			(value) =>
				typeof value === "bigint" && value >= 0n
					? `allowance is ${value}`
					: null,
			durationMs,
		);
	},
};
