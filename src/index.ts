import { sendAlert, type ApnsResult } from "./apns";
import { notifySecret, requireOwner, resolveBot } from "./auth";
import {
	deleteDevice,
	deleteDeviceIfUnchanged,
	deliveryForNotify,
	groupInbox,
	insertNotification,
	listDevices,
	listInbox,
	loadPrefs,
	serializePrefs,
	upsertDevice,
	type PushOutcome,
} from "./db";
import { isValidTag, minutesInTimeZone, parseClock } from "./delivery";
import { errorJson, HttpError, json, optionalString, readJson, requireString } from "./http";

const TITLE_MAX = 200;
const BODY_MAX = 2000;
const TOKEN_RE = /^[0-9a-fA-F]{64,200}$/;

export default {
	async fetch(request, env): Promise<Response> {
		try {
			return await route(request, env);
		} catch (err) {
			if (err instanceof HttpError) {
				return errorJson(err.status, err.code);
			}
			console.error(JSON.stringify({ msg: "unhandled", err: String(err) }));
			return errorJson(500, "internal");
		}
	},
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const path = url.pathname.replace(/\/+$/, "") || "/";
	const method = request.method.toUpperCase();

	if (method === "GET" && path === "/") return home();
	if (method === "GET" && path === "/health") {
		return json({ ok: true, service: "ping" });
	}
	if (method === "POST" && path === "/notify") {
		return notify(request, env);
	}
	if (method === "POST" && path === "/devices") {
		await requireOwner(request, env.OWNER_SECRET);
		return registerDevice(request, env);
	}
	if (method === "DELETE" && path === "/devices") {
		await requireOwner(request, env.OWNER_SECRET);
		return unregisterDevice(request, env);
	}
	if (method === "GET" && path === "/inbox") {
		await requireOwner(request, env.OWNER_SECRET);
		return inbox(url, env);
	}
	if (method === "GET" && path === "/prefs") {
		await requireOwner(request, env.OWNER_SECRET);
		return getPrefs(env);
	}
	if (method === "PUT" && path === "/prefs") {
		await requireOwner(request, env.OWNER_SECRET);
		return putPrefs(request, env);
	}

	return errorJson(404, "not_found");
}

async function notify(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const secret = notifySecret(request, optionalString(body.secret));
	const bot = await resolveBot(env.DB, env.BOT_KEY_PEPPER, secret);
	const title = clip(requireString(body.title, "invalid_title"), TITLE_MAX);
	const bodyText = clip(requireString(body.body, "invalid_body"), BODY_MAX);
	const tag = parseTag(body.tag);
	const now = new Date();
	const createdAt = now.getTime();
	const id = crypto.randomUUID();

	const prefs = await loadPrefs(env.DB);
	const decision = deliveryForNotify(prefs, tag, now);
	const devices = decision.kind === "send" ? await listDevices(env.DB) : [];

	let push: PushOutcome = "skipped";
	let skipReason: string | null = null;
	let sent = 0;
	let failed = 0;

	if (decision.kind === "skip") {
		push = "skipped";
		skipReason = decision.reason;
	} else if (devices.length === 0) {
		push = "none";
		skipReason = "no_devices";
	} else {
		const dryRun = env.APNS_DRY_RUN === "1";
		for (const device of devices) {
			let result: ApnsResult;
			try {
				result = await sendAlert({
					p8: env.APNS_P8,
					keyId: env.APNS_KEY_ID,
					teamId: env.APNS_TEAM_ID,
					bundleId: env.APNS_BUNDLE_ID,
					environment: device.environment,
					deviceToken: device.token,
					title,
					body: bodyText,
					tag,
					dryRun,
				});
			} catch {
				failed += 1;
				console.error(JSON.stringify({ msg: "apns_transport_failed" }));
				continue;
			}
			if (result.ok) {
				sent += 1;
			} else {
				failed += 1;
				if (result.unregistered) {
					await deleteDeviceIfUnchanged(env.DB, device);
				}
				console.error(
					JSON.stringify({
						msg: "apns_failed",
						status: result.status,
						reason: result.reason,
					}),
				);
			}
		}
		push = sent > 0 ? "sent" : "failed";
	}

	await insertNotification(env.DB, {
		id,
		bot,
		title,
		body: bodyText,
		tag,
		created_at: createdAt,
		push,
		skip_reason: skipReason,
	});

	return json({
		id,
		bot,
		push,
		reason: skipReason,
		sent,
		failed,
	});
}

async function registerDevice(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const token = requireString(body.token, "invalid_token");
	if (!TOKEN_RE.test(token)) throw new HttpError(400, "invalid_token");
	const environment = body.environment === "production" ? "production" : "sandbox";
	await upsertDevice(env.DB, token.toLowerCase(), environment, Date.now());
	return json({ ok: true, token: token.toLowerCase(), environment });
}

async function unregisterDevice(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const token = requireString(body.token, "invalid_token");
	await deleteDevice(env.DB, token.toLowerCase());
	return json({ ok: true });
}

async function inbox(url: URL, env: Env): Promise<Response> {
	const limitRaw = Number(url.searchParams.get("limit") ?? "50");
	const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;
	const rows = await listInbox(env.DB, limit);
	return json({ groups: groupInbox(rows) });
}

async function getPrefs(env: Env): Promise<Response> {
	const prefs = await loadPrefs(env.DB);
	return json(serializePrefs(prefs));
}

async function putPrefs(request: Request, env: Env): Promise<Response> {
	const body = await readJson(request);
	const muted = Boolean(body.muted);
	const timezone = optionalString(body.timezone) ?? "UTC";
	assertTimeZone(timezone);
	const mutedTags = parseMutedTags(body.muted_tags);
	const quiet = parseQuiet(body.quiet);
	if (quiet) {
		minutesInTimeZone(new Date(), timezone);
	}
	await env.DB.prepare(
		`UPDATE prefs
		 SET muted = ?, timezone = ?, quiet_start = ?, quiet_end = ?, muted_tags = ?, updated_at = ?
		 WHERE id = 1`,
	)
		.bind(
			muted ? 1 : 0,
			timezone,
			quiet?.start ?? null,
			quiet?.end ?? null,
			JSON.stringify(mutedTags),
			Date.now(),
		)
		.run();
	const prefs = await loadPrefs(env.DB);
	return json(serializePrefs(prefs));
}

function parseTag(value: unknown): string | null {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string" || !isValidTag(value)) {
		throw new HttpError(400, "invalid_tag");
	}
	return value;
}

function parseMutedTags(value: unknown): string[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value)) throw new HttpError(400, "invalid_muted_tags");
	if (value.length > 32) throw new HttpError(400, "invalid_muted_tags");
	const tags: string[] = [];
	for (const item of value) {
		if (typeof item !== "string" || !isValidTag(item)) {
			throw new HttpError(400, "invalid_muted_tags");
		}
		if (!tags.includes(item)) tags.push(item);
	}
	return tags;
}

function parseQuiet(value: unknown): { start: string; end: string } | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new HttpError(400, "invalid_quiet");
	}
	const record = value as Record<string, unknown>;
	const start = requireString(record.start, "invalid_quiet");
	const end = requireString(record.end, "invalid_quiet");
	if (parseClock(start) === null || parseClock(end) === null) {
		throw new HttpError(400, "invalid_quiet");
	}
	return { start, end };
}

function assertTimeZone(timeZone: string): void {
	try {
		minutesInTimeZone(new Date(), timeZone);
	} catch {
		throw new HttpError(400, "invalid_timezone");
	}
}

function clip(value: string, max: number): string {
	const trimmed = value.trim();
	if (trimmed.length === 0) throw new HttpError(400, "invalid_json");
	return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function home(): Response {
	const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ping</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem auto; max-width: 40rem; padding: 0 1rem; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  pre { background: #111; color: #eee; padding: 1rem; overflow: auto; border-radius: 8px; }
  @media (prefers-color-scheme: light) { pre { background: #f4f4f5; color: #111; } }
  h1 { font-size: 1.5rem; }
</style>
<h1>Ping</h1>
<p>[PLACEHOLDER: one-line description of this personal push inbox]</p>
<p>Health: <a href="/health"><code>GET /health</code></a></p>
<p>Bots post to <code>POST /notify</code>. The iPhone app registers a device token at <code>POST /devices</code>.</p>
<pre>curl -sS http://127.0.0.1:43123/notify \\
  -H 'content-type: application/json' \\
  -H 'authorization: Bearer STEVE_BOT_SECRET' \\
  -d '{"title":"steve","body":"deploy finished","tag":"ci"}'</pre>
</html>`;
	return new Response(html, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}
