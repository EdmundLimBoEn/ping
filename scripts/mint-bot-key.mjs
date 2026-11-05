#!/usr/bin/env node
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const SLUG_RE = /^[a-z][a-z0-9-]{0,31}$/;

function usage() {
	console.error("Usage: node scripts/mint-bot-key.mjs <slug> [--apply-local] [--apply-remote]");
	console.error("Example: node scripts/mint-bot-key.mjs steve --apply-local");
	process.exit(2);
}

function readDevVars(filePath) {
	if (!existsSync(filePath)) return {};
	const text = readFileSync(filePath, "utf8");
	const vars = {};
	const lines = text.split(/\n/);
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (!line || line.trim().startsWith("#")) {
			i += 1;
			continue;
		}
		const eq = line.indexOf("=");
		if (eq === -1) {
			i += 1;
			continue;
		}
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1);
		if (value.startsWith('"')) {
			let collected = value.slice(1);
			while (!collected.endsWith('"') && i + 1 < lines.length) {
				i += 1;
				collected += `\n${lines[i]}`;
			}
			if (collected.endsWith('"')) collected = collected.slice(0, -1);
			vars[key] = collected;
		} else {
			vars[key] = value;
		}
		i += 1;
	}
	return vars;
}

function pepper() {
	if (process.env.BOT_KEY_PEPPER) return process.env.BOT_KEY_PEPPER;
	const fromFile = readDevVars(resolve(".dev.vars")).BOT_KEY_PEPPER;
	if (fromFile) return fromFile;
	throw new Error("BOT_KEY_PEPPER is missing. Copy .dev.vars.example to .dev.vars and set it.");
}

function hmacHex(pepperValue, secret) {
	return createHmac("sha256", pepperValue).update(secret, "utf8").digest("hex");
}

const args = process.argv.slice(2);
const slug = args.find((arg) => !arg.startsWith("--"));
const applyLocal = args.includes("--apply-local");
const applyRemote = args.includes("--apply-remote");
if (!slug) usage();
if (!SLUG_RE.test(slug)) {
	console.error("Slug must match [a-z][a-z0-9-]{0,31}. Example: steve");
	process.exit(2);
}

const secret = `png_${randomBytes(24).toString("base64url")}`;
const secretHash = hmacHex(pepper(), secret);
const createdAt = Date.now();
const sql = `INSERT INTO bots (slug, secret_hash, created_at) VALUES ('${slug}', '${secretHash}', ${createdAt})
ON CONFLICT(slug) DO UPDATE SET secret_hash = excluded.secret_hash, created_at = excluded.created_at;`;

console.log(`Bot: ${slug}`);
console.log(`Secret (shown once): ${secret}`);
console.log("Store the secret in the bot. Ping stores only the HMAC.");
console.log("");
console.log("SQL:");
console.log(sql);

function apply(flag) {
	const result = spawnSync(
		"npx",
		["wrangler", "d1", "execute", "ping", flag, "--command", sql],
		{ stdio: "inherit" },
	);
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (applyLocal) apply("--local");
if (applyRemote) apply("--remote");
