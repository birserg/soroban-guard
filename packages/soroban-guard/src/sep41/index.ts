/**
 * The SEP-41 standard's entry point: which members the spec requires, which
 * of them this suite currently assesses, and the bridge between the two.
 *
 * Coverage is a first-class concern here, not an afterthought. A suite that
 * passes every check it happens to own would otherwise report "conformant"
 * for a token whose transfer was never examined — so unassessed members
 * become explicit UNVERIFIABLE rows, and the exit code follows.
 */
import type { CheckResult, Suite } from "../core/types.ts";
import { allowanceCheck } from "./checks/allowance.ts";
import { approveCheck } from "./checks/approve.ts";
import { balanceCheck } from "./checks/balance.ts";
import { burnCheck } from "./checks/burn.ts";
import { burnFromCheck } from "./checks/burn_from.ts";
import { decimalsCheck } from "./checks/decimals.ts";
import { nameCheck } from "./checks/name.ts";
import { unauthorizedTransferFromCheck } from "./checks/negative.ts";
import { symbolCheck } from "./checks/symbol.ts";
import { transferCheck } from "./checks/transfer.ts";
import { transferFromCheck } from "./checks/transfer_from.ts";
import type { Sep41Context } from "./context.ts";

export type { Sep41Context } from "./context.ts";

/**
 * The ten required SEP-41 token-interface members. The suite may cover a
 * subset; anything uncovered is a gap in our knowledge, not a contract
 * verdict — see withCoverageGaps.
 */
export const SEP41_MEMBERS: readonly string[] = [
	"allowance",
	"approve",
	"balance",
	"burn",
	"burn_from",
	"decimals",
	"name",
	"symbol",
	"transfer",
	"transfer_from",
];

/**
 * The suite's check for a member, if any. Convention: check ids are
 * `sep41-<member>`; pinned by unit test so a renamed id fails loudly
 * instead of silently opening a phantom gap row.
 */
function memberOf(resultId: string): string | null {
	if (!resultId.startsWith("sep41-")) {
		return null;
	}
	const rest = resultId.slice("sep41-".length);
	// Longest match wins, and it has to: `burn` is a prefix of `burn_from`,
	// so a shortest-first match would credit a burn_from check to burn and
	// open a phantom gap row next to a check that ran. A member may carry a
	// `-suffix` naming a variant — a negative check, say — and still count
	// as covering its clause.
	let best: string | null = null;
	for (const member of SEP41_MEMBERS) {
		if (rest !== member && !rest.startsWith(`${member}-`)) {
			continue;
		}
		if (best === null || member.length > best.length) {
			best = member;
		}
	}
	return best;
}

/**
 * Append UNVERIFIABLE rows for required members no check assessed, so the
 * report shows the gap and the exit code reflects it. Without this, a suite
 * would exit 0 — "verified conformant" — on the strength of the members it
 * happens to cover, while approve, burn and friends went unexamined.
 */
export function withCoverageGaps(
	results: readonly CheckResult[],
): CheckResult[] {
	const covered = new Set(
		results
			.map((result) => memberOf(result.id))
			.filter((member): member is string => member !== null),
	);
	const gaps = SEP41_MEMBERS.filter((member) => !covered.has(member)).map(
		(member): CheckResult => ({
			id: `sep41-${member}`,
			clause: `SEP-41 §${member}`,
			// Shallowest claim: nothing was observed, not even the interface.
			layer: "interface",
			requirement: "required",
			status: "UNVERIFIABLE",
			expected: `${member}() is assessed by the suite`,
			actual: "not assessed by this suite",
			evidence: {},
			durationMs: 0,
		}),
	);
	return [...results, ...gaps];
}

/**
 * The SEP-41 suite. This object is the only thing core ever sees — the
 * runner takes a Suite, never a SEP-41 import.
 */
export const sep41Suite: Suite<Sep41Context> = {
	standard: "SEP-41",
	checks: [
		decimalsCheck,
		balanceCheck,
		allowanceCheck,
		nameCheck,
		symbolCheck,
		// Writes after reads: a read failure is cheap to learn and does not
		// spend a ledger close.
		//
		// The negative check goes first among them, for two reasons. Its
		// premise is an absence — no allowance — and approve would grant the
		// very thing it needs missing. And it needs the holder to have
		// something worth taking, which transfer and burn each spend: on a
		// holder with exactly one unit, running them first starves the check
		// that matters most into UNVERIFIABLE. It costs nothing to move,
		// since a correct contract refuses at simulation and touches no
		// state at all.
		unauthorizedTransferFromCheck,
		transferCheck,
		approveCheck,
		transferFromCheck,
		burnCheck,
		burnFromCheck,
	],
};
