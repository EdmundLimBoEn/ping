export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
	) {
		super(code);
		this.name = "HttpError";
	}
}

export function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function errorJson(status: number, code: string): Response {
	return json({ error: code }, status);
}

const JSON_BODY_MAX_BYTES = 64 * 1024;

export async function readJson(request: Request): Promise<Record<string, unknown>> {
	let parsed: unknown;
	try {
		const reader = request.body?.getReader();
		if (!reader) throw new HttpError(400, "invalid_json");
		try {
			const decoder = new TextDecoder();
			let bytes = 0;
			let text = "";
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > JSON_BODY_MAX_BYTES) {
					await reader.cancel().catch(() => {});
					throw new HttpError(413, "invalid_json");
				}
				text += decoder.decode(value, { stream: true });
			}
			parsed = JSON.parse(text + decoder.decode());
		} finally {
			reader.releaseLock();
		}
	} catch (err) {
		if (err instanceof HttpError) throw err;
		throw new HttpError(400, "invalid_json");
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new HttpError(400, "invalid_json");
	}
	return parsed as Record<string, unknown>;
}

export function optionalString(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new HttpError(400, "invalid_json");
	return value;
}

export function requireString(value: unknown, code: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new HttpError(400, code);
	}
	return value;
}
