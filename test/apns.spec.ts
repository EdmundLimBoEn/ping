import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { sendAlert } from "../src/apns";

let p8: string;
const encoder = new TextEncoder();

beforeAll(async () => {
	const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
	const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
	p8 = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----`;
});

afterEach(() => vi.unstubAllGlobals());

async function outgoingPayload(title: string, body: string, tag: string | null) {
	const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
	vi.stubGlobal("fetch", fetchMock);
	expect(await sendAlert({
		p8,
		keyId: "payload-test-key",
		teamId: "payload-test-team",
		bundleId: "test.ping",
		environment: "sandbox",
		deviceToken: "ab".repeat(32),
		title,
		body,
		tag,
		dryRun: false,
	})).toEqual({ ok: true, apnsId: "ok" });
	expect(fetchMock).toHaveBeenCalledTimes(1);
	return fetchMock.mock.calls[0][1]!.body as string;
}

describe("APNs payload byte limit", () => {
	it.each([
		{ name: "CJK", title: "probe", body: "界".repeat(2000), tag: null },
		{ name: "emoji", title: "界".repeat(200), body: "😀".repeat(1000), tag: "a".repeat(64) },
		{ name: "quotes and backslashes", title: "t".repeat(200), body: '"\\'.repeat(1000), tag: "ci" },
		{ name: "control characters", title: "\u0001".repeat(200), body: "\u0000".repeat(2000), tag: "ci" },
	])("bounds the complete serialized $name payload without splitting code points", async ({ title, body, tag }) => {
		const serialized = await outgoingPayload(title, body, tag);
		expect(encoder.encode(serialized).byteLength).toBeLessThanOrEqual(4096);
		const payload = JSON.parse(serialized);
		const shortened = payload.aps.alert.body as string;
		expect(payload).toEqual({ aps: { alert: { title, body: shortened }, sound: "default" }, ...(tag === null ? {} : { tag }) });
		expect(shortened.length).toBeGreaterThan(0);
		expect(shortened.length).toBeLessThan(body.length);
		expect(shortened.isWellFormed()).toBe(true);
		expect(body.startsWith(shortened)).toBe(true);
		// The next complete code point must exceed the budget, so text is not over-trimmed.
		payload.aps.alert.body += Array.from(body.slice(shortened.length))[0];
		expect(encoder.encode(JSON.stringify(payload)).byteLength).toBeGreaterThan(4096);
	});

	it.each([null, "ci"])("preserves small payloads with tag %s", async (tag) => {
		const title = "build 😀";
		const body = 'green 界\n"quoted"\\';
		expect(await outgoingPayload(title, body, tag)).toBe(JSON.stringify({
			aps: { alert: { title, body }, sound: "default" },
			tag: tag ?? undefined,
		}));
	});

	it.each([0, 1])("handles a payload %i bytes above the exact limit", async (excess) => {
		const title = "t".repeat(200);
		const tag = "a".repeat(64);
		const empty = JSON.stringify({ aps: { alert: { title, body: "" }, sound: "default" }, tag });
		const budget = 4096 - encoder.encode(empty).byteLength;
		const fittingBody = '"'.repeat(Math.floor(budget / 2)) + "a".repeat(budget % 2);
		const serialized = await outgoingPayload(title, fittingBody + "x".repeat(excess), tag);
		expect(encoder.encode(serialized).byteLength).toBe(4096);
		expect(JSON.parse(serialized).aps.alert).toEqual({ title, body: fittingBody });
	});
});
