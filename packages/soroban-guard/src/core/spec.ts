import { contract, type rpc } from "@stellar/stellar-sdk";

/**
 * What the ledger says about a contract ID. `wasm` carries the declared
 * function names; `native` (SAC and friends — no usable spec) and `missing`
 * (no instance entry at all) both mean the spec is undeterminable and
 * callers must proceed as today. `missing` additionally tells the CLI the
 * address names nothing, which is a usage error rather than a verdict.
 */
export type ContractCode =
	| { readonly kind: "missing" }
	| { readonly kind: "native" }
	| { readonly kind: "wasm"; readonly functions: readonly string[] };

/**
 * Pure: function names declared by a parsed spec. Tested with hand-built
 * entries through the real SDK parser. `f.name` is read via String()
 * because parsed entries may carry it as an XDR String object rather than
 * a JS string — normalization is verified against a real WASM token when
 * OZ validation lands, not before.
 */
export function specFunctionNames(spec: contract.Spec): readonly string[] {
	return spec.funcs().map((fn) => String(fn.name));
}

/**
 * The SDK reports absent ledger entries as `{code: 404}` objects, with
 * "Could not obtain contract …" messages as backstop for code-less shapes.
 * Both halves are scoped to the SDK's own absence vocabulary from the
 * exactly-pinned version (all three instance-fetch rejects carry code
 * 404) — a generic /not found/i would also match unrelated ledger misses.
 * Anything else (TypeError, 429/500 carriers) is a transport problem and
 * propagates untouched.
 */
function isNotFound(error: unknown): boolean {
	if (typeof error !== "object" || error === null) {
		return false;
	}
	const record = error as Record<string, unknown>;
	if (record.code === 404) {
		return true;
	}
	return (
		typeof record.message === "string" &&
		/could not obtain contract (instance|wasm)/i.test(record.message)
	);
}

/**
 * Inspect a contract ID: existence, then spec availability. Never throws
 * for ledger states — missing instances, SAC/native executables, archived
 * code, and unparseable specs all resolve to a kind; only transport
 * failures propagate, and those are harness errors for the caller to
 * report. Callers proceed as today on anything but `missing`.
 */
export async function inspectContract(
	server: rpc.Server,
	contractId: string,
): Promise<ContractCode> {
	let instance: Awaited<ReturnType<typeof server.getContractInstance>>;
	try {
		instance = await server.getContractInstance(contractId);
	} catch (error) {
		if (isNotFound(error)) {
			return { kind: "missing" };
		}
		throw error;
	}
	const executable = instance.executable;
	if (executable?.type === "contractExecutableExternalRef") {
		// CAP-85: resolve the named hash through the SDK, mirroring
		// getContractWasmByContractId. A wrong turn here only loses the
		// NOT_IMPLEMENTED optimization (one extra simulation), never a
		// verdict — so unknown setup states fall back to native while
		// unambiguous transport (TypeError) propagates. Shape reads stay
		// outside the guarded region: only SDK calls may throw into it.
		const ref = (executable as unknown as { externalRef?: unknown })
			.externalRef;
		if (ref === undefined || ref === null) {
			return { kind: "native" };
		}
		try {
			const wasm = await server.getContractWasmByHash(
				await server.getExternalRefWasmHash(
					ref as Parameters<typeof server.getExternalRefWasmHash>[0],
				),
			);
			return {
				kind: "wasm",
				functions: specFunctionNames(contract.Spec.fromWasm(wasm)),
			};
		} catch (error) {
			if (error instanceof TypeError) {
				throw error;
			}
			return { kind: "native" };
		}
	}
	if (executable?.type !== "contractExecutableWasm") {
		// SAC and anything else without fetchable WASM.
		// The pinned SDK's own discriminant strings are the ground truth
		// here (see server.getContractWasmByContractId); a future SDK that
		// reshapes these arms fails typecheck at upgrade time, which is the
		// guard — no runtime string can protect against unknown shapes.
		return { kind: "native" };
	}
	let wasm: Uint8Array;
	try {
		// Same access the SDK itself uses (server.getContractWasmByContractId).
		const hash = (executable as unknown as { value?: { value?: Uint8Array } })
			.value?.value;
		if (!(hash instanceof Uint8Array)) {
			return { kind: "native" };
		}
		wasm = await server.getContractWasmByHash(hash);
	} catch (error) {
		if (isNotFound(error)) {
			// Archived/expired code: undeterminable, proceed as today.
			return { kind: "native" };
		}
		throw error;
	}
	try {
		return {
			kind: "wasm",
			functions: specFunctionNames(contract.Spec.fromWasm(wasm)),
		};
	} catch {
		return { kind: "native" };
	}
}
