#!/usr/bin/env node
import { parseArgs } from "node:util";
import { type Account, Keypair, rpc, StrKey } from "@stellar/stellar-sdk";
import { KeypairSigner } from "@stellar/stellar-sdk/contract";
import { fundAccount, loadSourceAccount } from "./core/funding.ts";
import { exitCodeFor, renderReport } from "./core/report.ts";
import { runSuite } from "./core/runner.ts";
import { inspectContract } from "./core/spec.ts";
import type { Party, Sep41Context } from "./sep41/context.ts";
import { sep41Suite, withCoverageGaps } from "./sep41/index.ts";

const USAGE =
	"usage: sep41-guard <contract-id> [--rpc-url URL] [--passphrase P] [--allow-http]";

const DEFAULT_PASSPHRASE = "Test SDF Network ; September 2015";

let positionals: string[];
let values: {
	"rpc-url"?: string;
	passphrase?: string;
	"allow-http"?: boolean;
	help?: boolean;
};
try {
	({ positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			"rpc-url": { type: "string" },
			passphrase: { type: "string" },
			"allow-http": { type: "boolean" },
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

const [rawContractId, ...extraPositionals] = positionals;
// Any positional alongside --help is a usage error, not a help request:
// `--help extra-garbage` used to slip through because only 2+
// positionals were rejected before the help branch.
if (extraPositionals.length > 0 || (values.help && positionals.length > 0)) {
	console.error(USAGE);
	process.exit(2);
}
if (values.help) {
	console.log(USAGE);
	process.exit(0);
}
const contractId = nonEmpty(rawContractId);
if (!contractId) {
	console.error(USAGE);
	process.exit(2);
}
if (!StrKey.isValidContract(contractId)) {
	console.error(`invalid contract ID: ${contractId}`);
	process.exit(2);
}

/**
 * Resolve one role's address and, when this run holds the key, its signer.
 *
 * `<ROLE>_SECRET` is the stronger source: a secret key contains its own
 * public key, so it settles the address by itself. `<ROLE>_ADDRESS` alone
 * gives reads a real holder to observe while leaving writes UNVERIFIABLE.
 * Neither generates a throwaway — reads still observe something, writes
 * still report honestly.
 *
 * A secret that disagrees with a supplied address is a misconfiguration,
 * not a preference to resolve: reading one account's balance while signing
 * as another produces a FAIL that says nothing about the contract. So it
 * exits rather than picking a winner, the same way a blank passphrase does.
 */
function resolveRole(
	role: "OWNER" | "SPENDER",
	// A signer binds the network it signs for, so the passphrase is a
	// parameter rather than a closed-over const: the ordering constraint is
	// then visible in the signature instead of being a TDZ throw waiting for
	// whoever reorders CLI setup next.
	networkPassphrase: string,
): Party {
	const declared = nonEmpty(process.env[`${role}_ADDRESS`]);
	const secret = nonEmpty(process.env[`${role}_SECRET`]);
	if (declared !== undefined && !StrKey.isValidEd25519PublicKey(declared)) {
		console.error(`invalid ${role}_ADDRESS: ${declared}`);
		process.exit(2);
	}
	if (secret === undefined) {
		return {
			address: declared ?? Keypair.random().publicKey(),
			isThrowaway: declared === undefined,
		};
	}
	let keypair: Keypair;
	try {
		keypair = Keypair.fromSecret(secret);
	} catch {
		// Never echo the value — it is a private key.
		console.error(`invalid ${role}_SECRET: not a valid S... secret key`);
		process.exit(2);
	}
	const address = keypair.publicKey();
	if (declared !== undefined && declared !== address) {
		console.error(
			`${role}_SECRET is the key for ${address}, but ${role}_ADDRESS is ${declared}`,
		);
		process.exit(2);
	}
	return {
		address,
		// KeypairSigner is a Signer already — it carries the address it signs
		// as, so there is no pair of fields to keep in sync. The SDK's own
		// basicNodeSigner docs point here for exactly that reason.
		signer: new KeypairSigner(keypair, networkPassphrase),
		isThrowaway: false,
	};
}

/** Empty/blank flags behave as unset: `--rpc-url ""` must fall back to env
 * and defaults exactly like an omitted flag, not reach the SDK as "". */
function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * The passphrase is network identity, not a free string: never trim it
 * (trimming " X " into "X" would silently switch networks), and refuse a
 * blank one instead of falling back — silent defaults hide misconfig.
 */
function resolvePassphrase(value: string | undefined): string {
	if (value === undefined) {
		return DEFAULT_PASSPHRASE;
	}
	if (value.trim() === "") {
		console.error("passphrase must not be blank");
		process.exit(2);
	}
	if (value !== value.trim()) {
		console.error("warning: passphrase has surrounding whitespace");
	}
	return value;
}

const rpcUrl = (
	nonEmpty(values["rpc-url"]) ??
	nonEmpty(process.env.SOROBAN_RPC_URL) ??
	"https://soroban-testnet.stellar.org"
).replace(/\/+$/, "");
try {
	new URL(rpcUrl);
} catch {
	console.error(`invalid RPC URL: ${rpcUrl}`);
	process.exit(2);
}
const networkPassphrase = resolvePassphrase(
	values.passphrase ?? process.env.NETWORK_PASSPHRASE,
);

const parties = {
	owner: resolveRole("OWNER", networkPassphrase),
	spender: resolveRole("SPENDER", networkPassphrase),
};

let server: rpc.Server;
let source: Account;
let specFunctions: readonly string[] | null;
try {
	// The SDK validates the transport scheme eagerly and throws outside any
	// RPC call, so construction lives inside the guarded block too.
	// Order inside is deliberate: inspect first, so a missing ID exits
	// before spending faucet quota or waiting out polls; fund next
	// (check-first, owner only: it sources and signs every call, and an
	// untouched funded account costs nothing); load last, so a
	// post-funding load failure genuinely means unreachable.
	server = new rpc.Server(rpcUrl, {
		allowHttp: values["allow-http"] === true,
	});
	const inspected = await inspectContract(server, contractId);
	if (inspected.kind === "missing") {
		console.error(`no contract found at ${contractId}`);
		console.log(
			renderReport({ standard: sep41Suite.standard, contractId, results: [] }),
		);
		process.exit(2);
	}
	specFunctions = inspected.kind === "wasm" ? inspected.functions : null;
	// Only the owner. It sources and signs every call the suite makes; the
	// spender is an argument, never a source, so funding it spends faucet
	// quota for nothing and adds a failure that would abort a run whose
	// reads would otherwise have passed. Fund it when a spender-signed
	// check lands, not before.
	await fundAccount(server, parties.owner.address);
	source = await loadSourceAccount(server, parties.owner.address);
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
	specFunctions,
	parties,
};

const assessed = await runSuite(sep41Suite, ctx);
// Unassessed members become UNVERIFIABLE rows: without this, a suite that
// passes every check it happens to own would exit 0 — "verified conformant"
// — while the members it never examined went unreported.
const results = withCoverageGaps(assessed);
console.log(
	renderReport({ standard: sep41Suite.standard, contractId, results }),
);
// 0 = verified conformant, 1 = verified violation, 2 = unknown (see
// exitCodeFor). SKIPPED/UNVERIFIABLE are not contract verdicts and must
// never exit 1.
process.exit(exitCodeFor(results));
