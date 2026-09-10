#!/usr/bin/env node
import { parseArgs } from "node:util";
import { rpc } from "@stellar/stellar-sdk";
import { renderReport } from "./core/report.ts";
import { runSuite } from "./core/runner.ts";
import type { Sep41Context } from "./sep41/context.ts";
import { sep41Suite } from "./sep41/index.ts";

const { positionals, values } = parseArgs({
	allowPositionals: true,
	options: {
		"rpc-url": { type: "string" },
		passphrase: { type: "string" },
		help: { type: "boolean", short: "h" },
	},
});

const [contractId] = positionals;
if (values.help || !contractId) {
	console.log(
		"usage: sep41-guard <contract-id> [--rpc-url URL] [--passphrase P]",
	);
	process.exit(values.help ? 0 : 2);
}

const owner = process.env.OWNER_ADDRESS;
const spender = process.env.SPENDER_ADDRESS;
if (!owner || !spender) {
	console.error(
		"OWNER_ADDRESS and SPENDER_ADDRESS must be set (see .env.example)",
	);
	process.exit(2);
}

const rpcUrl =
	values["rpc-url"] ??
	process.env.SOROBAN_RPC_URL ??
	"https://soroban-testnet.stellar.org";
const networkPassphrase =
	values.passphrase ??
	process.env.NETWORK_PASSPHRASE ??
	"Test SDF Network ; September 2015";

const server = new rpc.Server(rpcUrl);
const source = await server.getAccount(owner);
const ctx: Sep41Context = {
	server,
	contractId,
	source,
	networkPassphrase,
	owner,
	spender,
};

const results = await runSuite(sep41Suite, ctx);
console.log(
	renderReport({ standard: sep41Suite.standard, contractId, results }),
);
if (results.some((result) => result.status !== "PASS")) {
	process.exit(1);
}
