/**
 * Whether this run is allowed to sign anything, and why not when it is not.
 *
 * Every other guard in this codebase protects the contract from a false
 * accusation. These protect the operator from their own key, and from a
 * misconfiguration that would produce one: funding is check-first, so an
 * already-funded account never touches the faucet, and nothing downstream
 * distinguishes a testnet probe from a mainnet holding.
 *
 * Pure so the consent model is pinned by tests rather than by a manual
 * table that evaporates. The CLI calls it and exits on a non-null answer.
 */

/** Passphrase for the network the CLI targets when none is supplied. */
export const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

/** The public network, named so the host table can refer to it. */
const PUBLIC_PASSPHRASE = "Public Global Stellar Network ; September 2015";

/**
 * Networks where signing needs no override: the public test networks, plus
 * the standalone passphrase Quickstart uses for a local node.
 */
const WRITE_SAFE_PASSPHRASES: readonly string[] = [
	TESTNET_PASSPHRASE,
	"Test SDF Future Network ; October 2022",
	"Standalone Network ; February 2017",
];

/**
 * Soroban RPC hosts whose network is known, for catching a passphrase that
 * disagrees with the endpoint it is aimed at.
 *
 * Deliberately short: it recognises the endpoints people typo between, and
 * anything unrecognised is left alone rather than guessed at — self-hosted
 * RPC is the normal case, not a suspicious one. Horizon hosts are absent
 * because Horizon is a different API and never serves as an RPC URL.
 */
const KNOWN_RPC_HOSTS: ReadonlyMap<string, string> = new Map([
	["soroban-testnet.stellar.org", TESTNET_PASSPHRASE],
	["rpc-futurenet.stellar.org", "Test SDF Future Network ; October 2022"],
	["mainnet.sorobanrpc.com", PUBLIC_PASSPHRASE],
	["soroban-rpc.mainnet.stellar.gateway.fm", PUBLIC_PASSPHRASE],
]);

export function isWriteSafePassphrase(passphrase: string): boolean {
	return WRITE_SAFE_PASSPHRASES.includes(passphrase);
}

/**
 * A fully-qualified name ends in a dot — `stellar.org.` is legal DNS and
 * resolves identically, so it must not slip past a host comparison. `URL`
 * already lowercases and strips the port.
 */
function canonicalHost(hostname: string): string {
	return hostname.toLowerCase().replace(/\.$/, "");
}

export interface ConsentInput {
	/** True when any party carries a signer, i.e. the run can submit. */
	readonly willSign: boolean;
	readonly passphrase: string;
	/** `URL.hostname` of the RPC endpoint. */
	readonly rpcHostname: string;
	/** `--allow-non-testnet-write` was passed. */
	readonly override: boolean;
}

/**
 * Why this run must not sign, or null when it may.
 *
 * Reads are never refused: they sign nothing and spend nothing, so a run
 * without a signer always passes. A non-test passphrase is refusable by
 * override, because a private or future network is a legitimate target that
 * should be asked for rather than arrived at. A passphrase that contradicts
 * its endpoint is refused outright — the envelope would be signed for one
 * network and sent to another, and the rejection would report as the
 * contract refusing. No override, because no operator means that.
 */
export function writeRefusalReason(input: ConsentInput): string | null {
	if (!input.willSign) {
		return null;
	}
	const passphraseIsWriteSafe = isWriteSafePassphrase(input.passphrase);
	if (!passphraseIsWriteSafe && !input.override) {
		return `refusing to sign on "${input.passphrase}": write checks are testnet-only. Unset the *_SECRET variables to run reads, or pass --allow-non-testnet-write if you meant it.`;
	}
	// Exact, not by category: a passphrase names one specific network, and
	// two test networks are as incompatible with each other as either is
	// with the public one. Comparing write-safety would let a futurenet
	// signature reach a testnet endpoint — the very mismatch this catches.
	const host = canonicalHost(input.rpcHostname);
	const expected = KNOWN_RPC_HOSTS.get(host);
	if (expected !== undefined && expected !== input.passphrase) {
		return `network mismatch: ${host} serves "${expected}", but this run signs for "${input.passphrase}". A transaction signed for one network is rejected by the other, which would report as the contract refusing. Fix whichever half is wrong.`;
	}
	return null;
}
