import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { hmacHex } from "../src/hash";

const OWNER = "test-owner-secret";
const STEVE = "steve-secret";
const DEVICE = "a".repeat(64);

async function seedSteve() {
	const secretHash = await hmacHex("pepper", STEVE);
	await env.DB.prepare("DELETE FROM bots").run();
	await env.DB.prepare("DELETE FROM devices").run();
	await env.DB.prepare("DELETE FROM notifications").run();
	await env.DB.prepare(
		"UPDATE prefs SET muted = 0, timezone = 'UTC', quiet_start = NULL, quiet_end = NULL, muted_tags = '[]'",
	).run();
	await env.DB.prepare("INSERT INTO bots (slug, secret_hash, created_at) VALUES (?, ?, ?)")
		.bind("steve", secretHash, Date.now())
		.run();
}

function notify(secret: string | null, body: Record<string, unknown> = {}) {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (secret) headers.authorization = `Bearer ${secret}`;
	return SELF.fetch("https://ping.test/notify", {
		method: "POST",
		headers,
		body: JSON.stringify({ title: "hello", body: "from steve", ...body }),
	});
}

function owner(path: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	headers.set("authorization", `Bearer ${OWNER}`);
	if (!headers.has("content-type") && init.body) {
		headers.set("content-type", "application/json");
	}
	return SELF.fetch(`https://ping.test${path}`, { ...init, headers });
}

describe("auth", () => {
	beforeEach(seedSteve);

	it("matches the HMAC-SHA256 vector used by scripts/mint-bot-key.mjs", async () => {
		expect(await hmacHex("pepper", "secret")).toBe(
			"804e6d854739162fdea0d455b3aafe67f40d2919406186a27be601596ac6d306",
		);
	});

	it("rejects notify without a secret", async () => {
		const response = await notify(null);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "unauthorized" });
	});

	it("rejects notify with the wrong secret", async () => {
		const response = await notify("nope");
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "unauthorized" });
	});

	it("accepts notify with Authorization Bearer", async () => {
		const response = await notify(STEVE);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as { bot: string; push: string };
		expect(payload.bot).toBe("steve");
		expect(payload.push).toBe("none");
	});

	it("accepts notify with body.secret when the header is missing", async () => {
		const response = await SELF.fetch("https://ping.test/notify", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				title: "hello",
				body: "from steve",
				secret: STEVE,
			}),
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as { bot: string };
		expect(payload.bot).toBe("steve");
	});

	it("rejects owner routes without the owner secret", async () => {
		const inbox = await SELF.fetch("https://ping.test/inbox");
		expect(inbox.status).toBe(401);
		const devices = await SELF.fetch("https://ping.test/devices", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: DEVICE, environment: "sandbox" }),
		});
		expect(devices.status).toBe(401);
	});

	it("rejects owner routes with a bot secret", async () => {
		const response = await SELF.fetch("https://ping.test/prefs", {
			headers: { authorization: `Bearer ${STEVE}` },
		});
		expect(response.status).toBe(401);
	});

	it("lets the owner register a device", async () => {
		const response = await owner("/devices", {
			method: "POST",
			body: JSON.stringify({ token: DEVICE, environment: "sandbox" }),
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			ok: true,
			token: DEVICE,
			environment: "sandbox",
		});
	});
});
