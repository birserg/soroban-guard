#!/usr/bin/env node
import { parseArgs } from "node:util";
import { Keypair, rpc, StrKey } from "@stellar/stellar-sdk";
import { fundAccount } from "./core/funding.ts";
import { exitCodeFor, renderReport } from "./core/report.ts";
import { runSuite } from "./core/runner.ts";
import { inspectContract } from "./core/spec.ts";
import type { Sep41Context } from "./sep41/context.ts";
import { sep41Suite, withCoverageGaps } from "./sep41/index.ts";

const USAGE =
	"usage: sep41-guard <contract-id> [--rpc-url URL] [--passphrase P]";

let positionals: string[];
let values: {
	"rpc-url"?: string;
	passphrase?: string;
	help?: boolean;
};
try {
	({ positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			"rpc-url": { type: "string" },
			passphrase: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	}));
} catch (error) {
	console.error(
		`invalid arguments: ${error instanceof Error ? error.message : String(error)}`,
	);
	console.error(USAGE);
	process.exit(2);
}

if (values.help) {
	console.log(USAGE);
	process.exit(0);
}
const [rawContractId, ...extraPositionals] = positionals;
const contractId = nonEmpty(rawContractId);
if (!contractId || extraPositionals.length > 0) {
	console.error(USAGE);
	process.exit(2);
}
if (!StrKey.isValidContract(contractId)) {
	console.error(`invalid contract ID: ${contractId}`);
	process.exit(2);
}

/**
 * Probe addresses. Reads never spend and never need a balance — `balance()`
 * on an address holding nothing is still a conformance observation — so an
 * unconfigured run generates throwaway accounts rather than refusing to
 * start. Supplying the env vars points the probes at a specific holder,
 * which is what you want when asserting real balances on a token you own.
 */
const ownerEnv = nonEmpty(process.env.OWNER_ADDRESS);
const owner = ownerEnv ?? Keypair.random().publicKey();
// Remembered, not inferred: a generated probe asserting balance 0 proves
// nothing (it passes on every token, including always-zero bugs), so the
// balance check reports it UNVERIFIABLE instead of PASS.
const ownerIsThrowaway = ownerEnv === undefined;
const spender =
	nonEmpty(process.env.SPENDER_ADDRESS) ?? Keypair.random().publicKey();
for (const [role, address] of [
	["owner", owner],
	["spender", spender],
] as const) {
	if (!StrKey.isValidEd25519PublicKey(address)) {
		console.error(`invalid ${role} address: ${address}`);
		process.exit(2);
	}
}

/** Empty/blank flags behave as unset: `--rpc-url ""` must fall back to env
 * and defaults exactly like an omitted flag, not reach the SDK as "". */
function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

const rpcUrl =
	nonEmpty(values["rpc-url"]) ??
	nonEmpty(process.env.SOROBAN_RPC_URL) ??
	"https://soroban-testnet.stellar.org";
try {
	new URL(rpcUrl);
} catch {
	console.error(`invalid RPC URL: ${rpcUrl}`);
	process.exit(2);
}
const networkPassphrase =
	nonEmpty(values.passphrase) ??
	nonEmpty(process.env.NETWORK_PASSPHRASE) ??
	"Test SDF Network ; September 2015";

let server: rpc.Server;
let source: Awaited<ReturnType<rpc.Server["getAccount"]>>;
let specFunctions: readonly string[] | null;
try {
	// The SDK validates the transport scheme eagerly and throws outside any
	// RPC call, so construction lives inside the guarded block too.
	// Order inside is deliberate: inspect first, so a missing ID exits
	// before spending faucet quota or waiting out polls; fund next
	// (check-first: funded accounts are untouched, and funding verifies
	// both owner and spender exist); load last, so a post-funding load
	// failure genuinely means unreachable.
	server = new rpc.Server(rpcUrl);
	const inspected = await inspectContract(server, contractId);
	if (inspected.kind === "missing") {
		console.error(`no contract found at ${contractId}`);
		console.log(
			renderReport({ standard: sep41Suite.standard, contractId, results: [] }),
		);
		process.exit(2);
	}
	specFunctions = inspected.kind === "wasm" ? inspected.functions : null;
	await fundAccount(server, owner);
	await fundAccount(server, spender);
	source = await server.getAccount(owner);
} catch (error) {
	console.error(
		`cannot prepare run: ${error instanceof Error ? error.message : String(error)}`,
	);
	console.log(
		renderReport({ standard: sep41Suite.standard, contractId, results: [] }),
	);
	process.exit(2);
}
const ctx: Sep41Context = {
	server,
	contractId,
	source,
	networkPassphrase,
	owner,
	spender,
	ownerIsThrowaway,
	specFunctions,
};

const assessed = await runSuite(sep41Suite, ctx);
// Unassessed members become UNVERIFIABLE rows: without this, five passing
// checks would exit 0 while half the standard went unexamined.
const results = withCoverageGaps(assessed);
console.log(
	renderReport({ standard: sep41Suite.standard, contractId, results }),
);
// 0 = verified conformant, 1 = verified violation, 2 = unknown (see
// exitCodeFor). SKIPPED/UNVERIFIABLE are not contract verdicts and must
// never exit 1.
process.exit(exitCodeFor(results));
