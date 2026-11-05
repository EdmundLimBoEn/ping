const encoder = new TextEncoder();

export async function hmacHex(pepper: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(pepper),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(secret));
	return bufferToHex(mac);
}

export async function secretsEqual(provided: string, expected: string): Promise<boolean> {
	const [providedHash, expectedHash] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(provided)),
		crypto.subtle.digest("SHA-256", encoder.encode(expected)),
	]);
	return crypto.subtle.timingSafeEqual(providedHash, expectedHash);
}

function bufferToHex(buffer: ArrayBuffer): string {
	return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
