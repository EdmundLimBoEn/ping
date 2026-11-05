import { describe, expect, it } from "vitest";
import { decideDelivery, isWithinQuietHours, parseClock, type Prefs } from "../src/delivery";

function prefs(overrides: Partial<Prefs> = {}): Prefs {
	return {
		muted: false,
		timezone: "UTC",
		quiet: null,
		mutedTags: new Set(),
		...overrides,
	};
}

describe("parseClock", () => {
	it("parses HH:MM into minutes", () => {
		expect(parseClock("00:00")).toBe(0);
		expect(parseClock("08:30")).toBe(8 * 60 + 30);
		expect(parseClock("23:59")).toBe(23 * 60 + 59);
	});

	it("rejects invalid clocks", () => {
		expect(parseClock("24:00")).toBeNull();
		expect(parseClock("8:30")).toBeNull();
		expect(parseClock("08:60")).toBeNull();
	});
});

describe("isWithinQuietHours", () => {
	it("treats equal start and end as no window", () => {
		expect(isWithinQuietHours(0, 0, 0)).toBe(false);
		expect(isWithinQuietHours(500, 120, 120)).toBe(false);
	});

	it("covers a same-day window", () => {
		expect(isWithinQuietHours(9 * 60, 8 * 60, 10 * 60)).toBe(true);
		expect(isWithinQuietHours(8 * 60, 8 * 60, 10 * 60)).toBe(true);
		expect(isWithinQuietHours(10 * 60, 8 * 60, 10 * 60)).toBe(false);
		expect(isWithinQuietHours(7 * 60, 8 * 60, 10 * 60)).toBe(false);
	});

	it("covers a window that wraps midnight", () => {
		expect(isWithinQuietHours(23 * 60, 22 * 60, 8 * 60)).toBe(true);
		expect(isWithinQuietHours(0, 22 * 60, 8 * 60)).toBe(true);
		expect(isWithinQuietHours(7 * 60 + 59, 22 * 60, 8 * 60)).toBe(true);
		expect(isWithinQuietHours(8 * 60, 22 * 60, 8 * 60)).toBe(false);
		expect(isWithinQuietHours(12 * 60, 22 * 60, 8 * 60)).toBe(false);
	});
});

describe("decideDelivery", () => {
	const noonUtc = new Date("2026-11-05T12:00:00Z");

	it("sends when nothing is muted", () => {
		expect(decideDelivery(prefs(), "ci", noonUtc)).toEqual({ kind: "send" });
	});

	it("skips when globally muted", () => {
		expect(decideDelivery(prefs({ muted: true }), "ci", noonUtc)).toEqual({
			kind: "skip",
			reason: "muted",
		});
	});

	it("skips a muted tag and still sends other tags", () => {
		const withMute = prefs({ mutedTags: new Set(["ci"]) });
		expect(decideDelivery(withMute, "ci", noonUtc)).toEqual({
			kind: "skip",
			reason: "muted_tag",
		});
		expect(decideDelivery(withMute, "chat", noonUtc)).toEqual({ kind: "send" });
		expect(decideDelivery(withMute, null, noonUtc)).toEqual({ kind: "send" });
	});

	it("skips during quiet hours in the prefs timezone", () => {
		const evening = prefs({
			timezone: "UTC",
			quiet: { startMinutes: 22 * 60, endMinutes: 8 * 60 },
		});
		expect(decideDelivery(evening, "ci", new Date("2026-11-05T23:15:00Z"))).toEqual({
			kind: "skip",
			reason: "quiet_hours",
		});
		expect(decideDelivery(evening, "ci", noonUtc)).toEqual({ kind: "send" });
	});

	it("applies mute before quiet hours", () => {
		expect(
			decideDelivery(
				prefs({
					muted: true,
					quiet: { startMinutes: 22 * 60, endMinutes: 8 * 60 },
				}),
				"ci",
				new Date("2026-11-05T23:15:00Z"),
			),
		).toEqual({ kind: "skip", reason: "muted" });
	});
});
