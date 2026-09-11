import { nativeToScVal, type rpc, type xdr } from "@stellar/stellar-sdk";

// Canned simulation responses. Only the fields interpretSimulation reads
// are real (retval/error/preamble); the rest are inert placeholders. A bare
// JS number encodes as 64-bit (decodes to bigint), so pass an explicit ScVal
// (e.g. xdr.ScVal.scvU32) for exact contract types — exactly what the chain
// returns.

const BASE = {
	id: "unit-test",
	latestLedger: 1,
	events: [],
	_parsed: true,
} as const;

function encode(retval: xdr.ScVal | unknown): xdr.ScVal {
	return typeof retval === "object" && retval !== null && "toXDR" in retval
		? (retval as xdr.ScVal)
		: nativeToScVal(retval);
}

export function okResponse(
	retval: xdr.ScVal | unknown,
): rpc.Api.SimulateTransactionResponse {
	return {
		...BASE,
		transactionData: {},
		minResourceFee: "0",
		result: { auth: [], retval: encode(retval) },
	} as unknown as rpc.Api.SimulateTransactionResponse;
}

export function errorResponse(
	error: string,
): rpc.Api.SimulateTransactionResponse {
	return {
		...BASE,
		error,
	} as unknown as rpc.Api.SimulateTransactionResponse;
}

/** Success-shaped but answerless: partial RPC data, never a contract trap. */
export function answerlessSuccess(): rpc.Api.SimulateTransactionResponse {
	return {
		...BASE,
		transactionData: {},
		minResourceFee: "0",
		result: { auth: [] },
	} as unknown as rpc.Api.SimulateTransactionResponse;
}

export function restoreResponse(
	retval?: xdr.ScVal | unknown,
): rpc.Api.SimulateTransactionResponse {
	const base = retval === undefined ? answerlessSuccess() : okResponse(retval);
	return {
		...base,
		restorePreamble: { minResourceFee: "0", transactionData: {} },
	} as unknown as rpc.Api.SimulateTransactionResponse;
}
