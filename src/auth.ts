import { HttpError } from "./http";
import { hmacHex, secretsEqual } from "./hash";

export function bearerToken(request: Request): string | null {
	const header = request.headers.get("authorization");
	if (!header) return null;
	const match = /^Bearer\s+(\S+)/i.exec(header);
	return match ? match[1] : null;
}

export function notifySecret(request: Request, bodySecret: string | undefined): string {
	const fromHeader = bearerToken(request);
	const secret = fromHeader ?? bodySecret;
	if (!secret) throw new HttpError(401, "unauthorized");
	return secret;
}

export async function requireOwner(request: Request, ownerSecret: string): Promise<void> {
	if (!ownerSecret) throw new HttpError(500, "misconfigured");
	const token = bearerToken(request);
	if (!token || !(await secretsEqual(token, ownerSecret))) {
		throw new HttpError(401, "unauthorized");
	}
}

export async function resolveBot(
	db: D1Database,
	pepper: string,
	secret: string,
): Promise<string> {
	if (!pepper) throw new HttpError(500, "misconfigured");
	const secretHash = await hmacHex(pepper, secret);
	const row = await db
		.prepare("SELECT slug FROM bots WHERE secret_hash = ?")
		.bind(secretHash)
		.first<{ slug: string }>();
	if (!row) throw new HttpError(401, "unauthorized");
	return row.slug;
}
