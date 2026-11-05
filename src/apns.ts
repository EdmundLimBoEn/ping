export type ApnsEnvironment = "sandbox" | "production";

export type ApnsResult =
	| { ok: true; apnsId: string }
	| { ok: false; status: number; reason: string; unregistered: boolean };

type JwtCache = { token: string; iat: number };

const jwtCache = new Map<string, JwtCache>();
const JWT_TTL_SECONDS = 50 * 60;

export async function sendAlert(options: {
	p8: string;
	keyId: string;
	teamId: string;
	bundleId: string;
	environment: ApnsEnvironment;
	deviceToken: string;
	title: string;
	body: string;
	tag: string | null;
	dryRun: boolean;
}): Promise<ApnsResult> {
	if (options.dryRun) {
		return { ok: true, apnsId: "dry-run" };
	}

	const host =
		options.environment === "sandbox"
			? "https://api.sandbox.push.apple.com"
			: "https://api.push.apple.com";
	const jwt = await providerToken(options.p8, options.keyId, options.teamId);
	const payload = {
		aps: {
			alert: { title: options.title, body: options.body },
			sound: "default",
		},
		tag: options.tag ?? undefined,
	};

	const response = await fetch(`${host}/3/device/${options.deviceToken}`, {
		method: "POST",
		headers: {
			authorization: `bearer ${jwt}`,
			"apns-topic": options.bundleId,
			"apns-push-type": "alert",
			"apns-priority": "10",
			"content-type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	const apnsId = response.headers.get("apns-id") ?? "";
	if (response.ok) {
		return { ok: true, apnsId: apnsId || "ok" };
	}

	let reason = `http_${response.status}`;
	try {
		const body = (await response.json()) as { reason?: string };
		if (typeof body.reason === "string") reason = body.reason;
	} catch {
		reason = `http_${response.status}`;
	}

	return {
		ok: false,
		status: response.status,
		reason,
		unregistered: response.status === 410 || reason === "Unregistered" || reason === "BadDeviceToken",
	};
}

export async function providerToken(p8: string, keyId: string, teamId: string): Promise<string> {
	const cacheKey = `${keyId}:${teamId}`;
	const now = Math.floor(Date.now() / 1000);
	const cached = jwtCache.get(cacheKey);
	if (cached && now - cached.iat < JWT_TTL_SECONDS) {
		return cached.token;
	}

	const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyId }));
	const claims = base64Url(JSON.stringify({ iss: teamId, iat: now }));
	const signingInput = `${header}.${claims}`;
	const key = await importP8(p8);
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		key,
		new TextEncoder().encode(signingInput),
	);
	const token = `${signingInput}.${base64Url(signature)}`;
	jwtCache.set(cacheKey, { token, iat: now });
	return token;
}

async function importP8(pem: string): Promise<CryptoKey> {
	const normalized = pem.replace(/\\n/g, "\n").trim();
	const b64 = normalized.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
	const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	return crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

function base64Url(input: string | ArrayBuffer): string {
	const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
