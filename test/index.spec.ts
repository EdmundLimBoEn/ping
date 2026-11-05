import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("health", () => {
	it("returns ok", async () => {
		const response = await SELF.fetch("https://ping.test/health");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, service: "ping" });
	});

	it("serves the home page", async () => {
		const response = await SELF.fetch("https://ping.test/");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toMatch(/text\/html/);
		expect(await response.text()).toContain("POST /notify");
	});
});
