import { env } from "cloudflare:workers";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listDevices, listInbox } from "../src/db";
import { hmacHex } from "../src/hash";
import worker from "../src/index";

const SECRET = "transport-test-secret";
const TOKENS = ["ab", "cd", "ef"].map((value) => value.repeat(32));

describe("notify transport failures", () => {
	let p8: string;
	beforeAll(async () => {
		const keyPair = await crypto.subtle.generateKey(
			{ name: "ECDSA", namedCurve: "P-256" },
			true,
			["sign", "verify"],
		);
		const key = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
		p8 = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...key))}\n-----END PRIVATE KEY-----`;
	});

	beforeEach(async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		await env.DB.prepare("DELETE FROM notifications").run();
		await env.DB.prepare("DELETE FROM devices").run();
		await env.DB.prepare("DELETE FROM bots").run();
		await env.DB.prepare(
			"UPDATE prefs SET muted = 0, timezone = 'UTC', quiet_start = NULL, quiet_end = NULL, muted_tags = '[]'",
		).run();
		await env.DB.prepare("INSERT INTO bots (slug, secret_hash, created_at) VALUES (?, ?, ?)")
			.bind("transport-test", await hmacHex(env.BOT_KEY_PEPPER, SECRET), Date.now())
			.run();
		for (const token of TOKENS) {
			await env.DB.prepare("INSERT INTO devices (token, environment, updated_at) VALUES (?, ?, ?)")
				.bind(token, "sandbox", Date.now())
				.run();
		}
	});

	afterEach(() => vi.restoreAllMocks());

	it.each([
		{ scenario: "the middle device fails", allFail: false, sent: 2, failed: 1, push: "sent" },
		{ scenario: "every device fails", allFail: true, sent: 0, failed: 3, push: "failed" },
	])("preserves the inbox and attempts every device when $scenario", async ({ allFail, sent, failed, push }) => {
		const devices = await listDevices(env.DB);
		// Mock the transport so the worker exercises the real APNs delivery code.
		const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			if (allFail || String(input).endsWith(`/3/device/${devices[1].token}`)) {
				throw new TypeError("fetch failed");
			}
			return new Response(null, { status: 200, headers: { "apns-id": "test-apns-id" } });
		});

		const response = await worker.fetch(
			new Request("https://ping.test/notify", {
				method: "POST",
				headers: {
					authorization: `Bearer ${SECRET}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ title: "build", body: "green", tag: "ci" }),
			}),
			{ ...env, APNS_P8: p8, APNS_KEY_ID: "TRANSPORT", APNS_DRY_RUN: "0" },
		);

		expect(response.status).toBe(200);
		const result = (await response.json()) as { id: string };
		expect(result).toEqual({
			id: expect.any(String),
			bot: "transport-test",
			push,
			reason: null,
			sent,
			failed,
		});
		expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(
			devices.map((device) => `https://api.sandbox.push.apple.com/3/device/${device.token}`),
		);
		expect(await listInbox(env.DB, 50)).toEqual([
			{
				id: result.id,
				bot: "transport-test",
				title: "build",
				body: "green",
				tag: "ci",
				created_at: expect.any(Number),
				push,
				skip_reason: null,
			},
		]);
		expect(await listDevices(env.DB)).toEqual(devices);
	});
});
