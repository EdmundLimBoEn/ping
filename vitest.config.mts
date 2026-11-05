import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
	const migrationsPath = path.join(import.meta.dirname, "migrations");
	const migrations = await readD1Migrations(migrationsPath);

	return {
		plugins: [
			cloudflareTest({
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						OWNER_SECRET: "test-owner-secret",
						BOT_KEY_PEPPER: "pepper",
						APNS_KEY_ID: "TESTKEYID0",
						APNS_TEAM_ID: "TESTTEAMID",
						APNS_P8: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----",
						APNS_DRY_RUN: "1",
					},
				},
			}),
		],
		test: {
			setupFiles: ["./test/apply-migrations.ts"],
		},
	};
});
