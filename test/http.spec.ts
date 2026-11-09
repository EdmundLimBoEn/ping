import { afterEach, describe, expect, it, vi } from "vitest";
import { readJson } from "../src/http";
import worker from "../src/index";

const LIMIT = 64 * 1024;

function request(body: BodyInit, headers?: HeadersInit): Request {
	return new Request("https://ping.test/notify", { method: "POST", body, headers, ...{ duplex: "half" } });
}

describe("JSON body limit", () => {
	afterEach(() => vi.restoreAllMocks());

	it.each([undefined, "1", String(8 * 1024 * 1024)])(
		"cancels an oversized unauthenticated stream with Content-Length %s",
		async (contentLength) => {
			const chunk = new TextEncoder().encode(" ".repeat(4096));
			let chunksRead = 0;
			const cancel = vi.fn();
			const stream = new ReadableStream<Uint8Array>({
				pull(controller) {
					chunksRead += 1;
					controller.enqueue(chunk);
					if (chunksRead === 2048) {
						controller.enqueue(new TextEncoder().encode("{}"));
						controller.close();
					}
				},
				cancel,
			});
			const accessEnv = vi.fn(() => {
				throw new Error("Oversized requests must not access bindings");
			});
			const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected APNs call"));
			const response = await worker.fetch(
				request(stream, contentLength === undefined ? {} : { "content-length": contentLength }),
				new Proxy({} as Env, { get: accessEnv }),
			);

			expect(response.status).toBe(413);
			expect(cancel).toHaveBeenCalledOnce();
			expect(chunksRead).toBeLessThanOrEqual(LIMIT / chunk.byteLength + 2);
			expect(accessEnv).not.toHaveBeenCalled();
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it("accepts exactly the byte limit, including split UTF-8 characters", async () => {
		const value = { body: "é".repeat((LIMIT - 12) / 2) + "a" };
		const bytes = new TextEncoder().encode(JSON.stringify(value));
		expect(bytes.byteLength).toBe(LIMIT);
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(bytes.slice(0, 10));
				controller.enqueue(bytes.slice(10));
				controller.close();
			},
		});
		await expect(readJson(request(stream))).resolves.toEqual(value);
	});

	it("rejects one byte over the limit even when the character count is smaller", async () => {
		const body = JSON.stringify({ body: "é".repeat((LIMIT - 12) / 2) + "aa" });
		expect(new TextEncoder().encode(body).byteLength).toBe(LIMIT + 1);
		await expect(readJson(request(body))).rejects.toMatchObject({ status: 413 });
	});

	it.each(["", "{", "null", "[]", '"text"'])("preserves invalid JSON handling for %s", async (body) => {
		await expect(readJson(request(body))).rejects.toMatchObject({ status: 400, code: "invalid_json" });
	});
});
