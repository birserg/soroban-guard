/**
 * SEP-41 §name — the token's human-readable name.
 */
import type { Check } from "../../core/types.ts";
import type { Sep41Context } from "../context.ts";
import { mapReadOutcome } from "./read-outcome.ts";
import {
	type CheckMeta,
	callRead,
	isDeclared,
	notImplemented,
} from "./shared.ts";

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
		const elapsed = () => Date.now() - started;
		if (!isDeclared(ctx, "name")) {
			return notImplemented(nameMeta, "name", elapsed());
		}
		const { outcome, ledger } = await callRead(ctx, "name", []);
		return mapReadOutcome(
			nameMeta,
			"string token name",
			ledger,
			outcome,
			(value) =>
				typeof value === "string" && value.trim() !== ""
					? { verdict: "pass", actual: `name is ${JSON.stringify(value)}` }
					: null,
			elapsed(),
		);
	},
};
