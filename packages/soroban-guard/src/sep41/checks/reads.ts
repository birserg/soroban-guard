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
 * What a value assertion can conclude. `pass`/`null` are PASS/FAIL;
 * `unverifiable` is for spec-legal but insane values (e.g. decimals far
 * outside any plausible bound) — accusing the contract would be false, and
 * passing would bless a likely decode problem.
 */
type AcceptResult =
	| { readonly verdict: "pass"; readonly actual: string }
	| { readonly verdict: "unverifiable"; readonly actual: string }
	| null;

/**
 * Shared outcome mapping for read-only checks. A trap is FAIL data (never
 * an exception). Restore and inconclusive both mean the call never produced
 * an answer, so both are UNVERIFIABLE with different explanations — never
 * FAIL. Otherwise `accept` decides what a sane value looks like.
 *
 * Missing functions never reach here: isDeclared() short-circuits them to
 * NOT_IMPLEMENTED from ctx.specFunctions before any simulation. Do NOT
 * sniff trap diagnostics for absence — that couples us to
 * RPC-version-specific error text.
 */
function mapReadOutcome(
	meta: CheckMeta,
	expected: string,
	ledger: number,
	outcome: InvokeResult,
	accept: (value: unknown) => AcceptResult,
	durationMs: number,
): CheckResult {
	if (outcome.kind === "restore" || outcome.kind === "inconclusive") {
		return {
			...meta,
			status: "UNVERIFIABLE",
			expected,
			actual:
				outcome.kind === "restore"
					? "call needs restoration; not executed"
					: "no return value observed; not executed",
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
	const accepted = accept(outcome.value);
	if (accepted !== null && accepted.verdict === "unverifiable") {
		return {
			...meta,
			status: "UNVERIFIABLE",
			expected,
			actual: accepted.actual,
			evidence: { ledger },
			durationMs,
		};
	}
	if (accepted !== null) {
		return {
			...meta,
			status: "PASS",
			expected,
			actual: accepted.actual,
			evidence: { ledger },
			durationMs,
		};
	}
	return {
		...meta,
		status: "FAIL",
		expected,
		actual:
			outcome.value === null
				? `returned void, expected ${expected}`
				: `returned unexpected value ${String(outcome.value)}`,
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

/**
 * Interface-layer short-circuit: when the spec is determinable (WASM) and
 * does not declare `method`, the function is absent — NOT_IMPLEMENTED,
 * reported under the interface layer (absence is an interface verdict, not
 * a behavior one) without spending a simulation. `null` spec means
 * undeterminable (SAC): proceed to simulation as today.
 */
function notImplemented(
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

function isDeclared(ctx: Sep41Context, method: string): boolean {
	return ctx.specFunctions === null || ctx.specFunctions.includes(method);
}
// Sanity bound, not spec: SEP-41 puts no maximum on decimals. Anything
// above this almost certainly indicates a decode error rather than a real
// token (Stellar assets use 7 or fewer) — so out-of-range routes to
// UNVERIFIABLE, never FAIL: accusing a spec-legal value would be false.
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
		const started = Date.now();
		if (!isDeclared(ctx, "decimals")) {
			return notImplemented(decimalsMeta, "decimals", Date.now() - started);
		}
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
			(value) => {
				if (
					typeof value !== "number" ||
					!Number.isInteger(value) ||
					value < 0
				) {
					return null;
				}
				if (value <= MAX_PLAUSIBLE_DECIMALS) {
					return { verdict: "pass", actual: `returned ${value}` } as const;
				}
				return {
					verdict: "unverifiable",
					actual: `returned ${value}, outside plausible bounds`,
				} as const;
			},
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
		const started = Date.now();
		if (!isDeclared(ctx, "balance")) {
			return notImplemented(balanceMeta, "balance", Date.now() - started);
		}
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
				typeof value === "bigint" && value >= 0n
					? { verdict: "pass", actual: `balance is ${value}` }
					: null,
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
		const started = Date.now();
		if (!isDeclared(ctx, "allowance")) {
			return notImplemented(allowanceMeta, "allowance", Date.now() - started);
		}
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
					? { verdict: "pass", actual: `allowance is ${value}` }
					: null,
			durationMs,
		);
	},
};

const nameMeta = {
	id: "sep41-name",
	clause: "SEP-41 §name",
	layer: "interface",
	requirement: "required",
} as const satisfies CheckMeta;

export const nameCheck: Check<Sep41Context> = {
	...nameMeta,
	description: "name() returns the token's human-readable name",
	async run(ctx) {
		const started = Date.now();
		if (!isDeclared(ctx, "name")) {
			return notImplemented(nameMeta, "name", Date.now() - started);
		}
		const { simLatestLedger, outcome, durationMs } = await execute(ctx, {
			contractId: ctx.contractId,
			method: "name",
			args: [],
		});
		return mapReadOutcome(
			nameMeta,
			"string token name",
			simLatestLedger,
			outcome,
			(value) =>
				typeof value === "string" && value.trim() !== ""
					? { verdict: "pass", actual: `name is "${value}"` }
					: null,
			durationMs,
		);
	},
};

const symbolMeta = {
	id: "sep41-symbol",
	clause: "SEP-41 §symbol",
	layer: "interface",
	requirement: "required",
} as const satisfies CheckMeta;

export const symbolCheck: Check<Sep41Context> = {
	...symbolMeta,
	description: "symbol() returns the token's ticker symbol",
	async run(ctx) {
		const started = Date.now();
		if (!isDeclared(ctx, "symbol")) {
			return notImplemented(symbolMeta, "symbol", Date.now() - started);
		}
		const { simLatestLedger, outcome, durationMs } = await execute(ctx, {
			contractId: ctx.contractId,
			method: "symbol",
			args: [],
		});
		return mapReadOutcome(
			symbolMeta,
			"string token symbol",
			simLatestLedger,
			outcome,
			(value) =>
				typeof value === "string" && value.trim() !== ""
					? { verdict: "pass", actual: `symbol is "${value}"` }
					: null,
			durationMs,
		);
	},
};
