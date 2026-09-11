import type { rpc } from "@stellar/stellar-sdk";
import { describe, expect, it, vi } from "vitest";
import { fundAccount } from "../../../src/core/funding.ts";

const KEY = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const ABSENT = new Error("failed to find an entry for key ABCD");

function stubServer(impl: {
	getLedgerEntry?: () => Promise<unknown>;
	requestAirdrop?: () => Promise<unknown>;
}): rpc.Server & {
	getLedgerEntry: ReturnType<typeof vi.fn>;
	requestAirdrop: ReturnType<typeof vi.fn>;
} {
	return {
		getLedgerEntry: vi.fn(async () => ({})),
		requestAirdrop: vi.fn(async () => {}),
		...impl,
	} as unknown as rpc.Server & {
		getLedgerEntry: ReturnType<typeof vi.fn>;
		requestAirdrop: ReturnType<typeof vi.fn>;
	};
}

describe("fundAccount", () => {
	it("returns immediately for funded accounts without touching the faucet", async () => {
		const server = stubServer({});
		await fundAccount(server, KEY, { delayMs: 0 });
		expect(server.getLedgerEntry).toHaveBeenCalledTimes(1);
		expect(server.requestAirdrop).not.toHaveBeenCalled();
	});

	it("requests once, then verifies", async () => {
		let calls = 0;
		const server = stubServer({
			getLedgerEntry: vi.fn(async () => {
				calls++;
				if (calls < 2) {
					throw ABSENT;
				}
				return {};
			}),
		});
		await fundAccount(server, KEY, { delayMs: 0 });
		expect(server.requestAirdrop).toHaveBeenCalledTimes(1);
		expect(server.requestAirdrop).toHaveBeenCalledWith(KEY);
	});

	it("throws after exhausting verification attempts", async () => {
		const server = stubServer({
			getLedgerEntry: vi.fn(async () => {
				throw ABSENT;
			}),
		});
		await expect(
			fundAccount(server, KEY, { attempts: 3, delayMs: 0 }),
		).rejects.toThrow(KEY);
		// Initial check + one verification per attempt.
		expect(server.getLedgerEntry).toHaveBeenCalledTimes(4);
		expect(server.requestAirdrop).toHaveBeenCalledTimes(1);
	});

	it("never sleeps after the final poll", async () => {
		const sleeps: number[] = [];
		const server = stubServer({
			getLedgerEntry: vi.fn(async () => {
				throw ABSENT;
			}),
		});
		await expect(
			fundAccount(server, KEY, {
				attempts: 3,
				delayMs: 30_000,
				sleep: async (ms) => {
					sleeps.push(ms);
				},
			}),
		).rejects.toThrow();
		expect(sleeps).toEqual([30_000, 30_000]);
	});

	it("propagates faucet rejections immediately", async () => {
		const server = stubServer({
			getLedgerEntry: vi.fn(async () => {
				throw ABSENT;
			}),
			requestAirdrop: vi.fn(async () => {
				throw new Error("rate limited");
			}),
		});
		await expect(fundAccount(server, KEY, { delayMs: 0 })).rejects.toThrow(
			"rate limited",
		);
		expect(server.getLedgerEntry).toHaveBeenCalledTimes(1);
	});

	it("propagates transport errors without firing the faucet", async () => {
		const server = stubServer({
			getLedgerEntry: vi.fn(async () => {
				throw new TypeError("fetch failed");
			}),
		});
		await expect(fundAccount(server, KEY, { delayMs: 0 })).rejects.toThrow(
			"fetch failed",
		);
		expect(server.requestAirdrop).not.toHaveBeenCalled();
	});

	it("propagates mid-poll transport errors without further sleeps", async () => {
		const sleeps: number[] = [];
		let calls = 0;
		const server = stubServer({
			getLedgerEntry: vi.fn(async () => {
				calls++;
				if (calls === 1) {
					throw ABSENT;
				}
				throw new TypeError("fetch failed");
			}),
		});
		await expect(
			fundAccount(server, KEY, {
				delayMs: 0,
				sleep: async (ms) => {
					sleeps.push(ms);
				},
			}),
		).rejects.toThrow("fetch failed");
		expect(sleeps).toEqual([]);
	});

	it("rejects non-positive attempts before any network call", async () => {
		const server = stubServer({});
		await expect(
			fundAccount(server, KEY, { attempts: 0, delayMs: 0 }),
		).rejects.toThrow(RangeError);
		expect(server.getLedgerEntry).not.toHaveBeenCalled();
		expect(server.requestAirdrop).not.toHaveBeenCalled();
	});

	it("rejects bad delays before any network call", async () => {
		const server = stubServer({});
		for (const delayMs of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
			await expect(fundAccount(server, KEY, { delayMs })).rejects.toThrow(
				RangeError,
			);
		}
		expect(server.getLedgerEntry).not.toHaveBeenCalled();
		expect(server.requestAirdrop).not.toHaveBeenCalled();
	});

	it("rejects malformed keys before any network call", async () => {
		const server = stubServer({});
		await expect(
			fundAccount(server, "NOT_A_KEY", { delayMs: 0 }),
		).rejects.toThrow(RangeError);
		expect(server.getLedgerEntry).not.toHaveBeenCalled();
		expect(server.requestAirdrop).not.toHaveBeenCalled();
	});
});
