import type { Suite } from "../core/types.ts";
import { allowanceCheck, balanceCheck, decimalsCheck } from "./checks/reads.ts";
import type { Sep41Context } from "./context.ts";

export type { Sep41Context } from "./context.ts";

/**
 * The SEP-41 suite. This object is the only thing core ever sees — the
 * runner takes a Suite, never a SEP-41 import.
 */
export const sep41Suite: Suite<Sep41Context> = {
	standard: "SEP-41",
	checks: [decimalsCheck, balanceCheck, allowanceCheck],
};
