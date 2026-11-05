import { SELF } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { hmacHex } from "../src/hash";

const OWNER = "test-owner-secret";
const STEVE = "steve-secret";
const DEVICE = "ab".repeat(32);

async function seed() {
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

function ownerHeaders(): HeadersInit {
	return {
		authorization: `Bearer ${OWNER}`,
		"content-type": "application/json",
	};
}

async function notify(extra: Record<string, unknown> = {}) {
	return SELF.fetch("https://ping.test/notify", {
		method: "POST",
		headers: {
			authorization: `Bearer ${STEVE}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ title: "build", body: "green", tag: "ci", ...extra }),
	});
}

describe("notify delivery", () => {
	beforeEach(seed);

	it("stores an inbox row when no devices are registered", async () => {
		const response = await notify();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			bot: "steve",
			push: "none",
			reason: "no_devices",
			sent: 0,
		});
		const inbox = await SELF.fetch("https://ping.test/inbox", {
			headers: { authorization: `Bearer ${OWNER}` },
		});
		const payload = (await inbox.json()) as {
			groups: { bot: string; items: { title: string; push: string }[] }[];
		};
		expect(payload.groups).toHaveLength(1);
		expect(payload.groups[0].bot).toBe("steve");
		expect(payload.groups[0].items[0].title).toBe("build");
		expect(payload.groups[0].items[0].push).toBe("none");
	});

	it("skips push when muted and still writes the inbox", async () => {
		await SELF.fetch("https://ping.test/prefs", {
			method: "PUT",
			headers: ownerHeaders(),
			body: JSON.stringify({ muted: true, timezone: "UTC" }),
		});
		const response = await notify();
		expect(await response.json()).toMatchObject({
			push: "skipped",
			reason: "muted",
		});
	});

	it("skips push for a muted tag", async () => {
		await SELF.fetch("https://ping.test/prefs", {
			method: "PUT",
			headers: ownerHeaders(),
			body: JSON.stringify({ muted: false, timezone: "UTC", muted_tags: ["ci"] }),
		});
		const muted = await notify();
		expect(await muted.json()).toMatchObject({ push: "skipped", reason: "muted_tag" });
		const other = await notify({ tag: "chat" });
		expect(await other.json()).toMatchObject({ push: "none", reason: "no_devices" });
	});

	it("skips push during quiet hours", async () => {
		const now = new Date();
		const later = new Date(now.getTime() + 120_000);
		const start = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
		const end = `${String(later.getUTCHours()).padStart(2, "0")}:${String(later.getUTCMinutes()).padStart(2, "0")}`;
		await SELF.fetch("https://ping.test/prefs", {
			method: "PUT",
			headers: ownerHeaders(),
			body: JSON.stringify({
				muted: false,
				timezone: "UTC",
				quiet: { start, end },
			}),
		});
		const response = await notify();
		expect(await response.json()).toMatchObject({
			push: "skipped",
			reason: "quiet_hours",
		});
	});

	it("sends in dry-run after a device is registered", async () => {
		await SELF.fetch("https://ping.test/devices", {
			method: "POST",
			headers: ownerHeaders(),
			body: JSON.stringify({ token: DEVICE, environment: "sandbox" }),
		});
		const response = await notify();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			bot: "steve",
			push: "sent",
			reason: null,
			sent: 1,
			failed: 0,
		});
	});
});
