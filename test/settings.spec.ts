/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import settingsView from "../ios/Ping/Ping/SettingsView.swift?raw";

// Check the actual SwiftUI observation boundary without requiring an iOS runtime.
// onChange reloads the draft only when its observed Equatable value changes.
const reloadObservers = [...settingsView.matchAll(
	/\.onChange\(of:\s*(store\.[\w.]+)\)\s*\{[^{}]*\bloadQuietFromPrefs\(\)/g,
)].map((match) => match[1].split(".").slice(1));

const savedPrefs = {
	muted: false,
	timezone: "Asia/Singapore",
	quiet: { start: "22:00", end: "08:00" } as { start: string; end: string } | null,
	muted_tags: ["ci"],
};

function observedValues(prefs: typeof savedPrefs) {
	// Fail closed if the view's observer syntax changes or the reload is removed.
	expect(reloadObservers.length).toBeGreaterThan(0);
	return reloadObservers.map((path) => path.reduce<unknown>((value, key) => {
		expect(value).toHaveProperty(key);
		return (value as Record<string, unknown>)[key];
	}, { prefs }));
}

describe("Settings quiet-hour draft invalidation", () => {
	it.each<[string, Partial<typeof savedPrefs>]>([
		["global mute", { muted: true }],
		["adding a muted tag", { muted_tags: ["ci", "chat"] }],
		["removing a muted tag", { muted_tags: [] }],
		["time zone", { timezone: "UTC" }],
	])("does not reload pending quiet-hour edits after changing %s", (_, change) => {
		// Cover both an enabled saved schedule (pending time edits/disable) and
		// no saved schedule (pending enable). Neither may be reloaded here.
		for (const quiet of [savedPrefs.quiet, null]) {
			const before = { ...savedPrefs, quiet };
			const after = { ...before, ...change };
			expect(observedValues(after)).toEqual(observedValues(before));
		}
	});

	it.each([
		["enable", null, { start: "22:00", end: "08:00" }],
		["start time", savedPrefs.quiet, { start: "23:00", end: "08:00" }],
		["end time", savedPrefs.quiet, { start: "22:00", end: "09:00" }],
		["disable", savedPrefs.quiet, null],
	])("still reloads when saved quiet hours change: %s", (_, before, after) => {
		expect(observedValues({ ...savedPrefs, quiet: after })).not.toEqual(
			observedValues({ ...savedPrefs, quiet: before }),
		);
	});

	it("does not reload when a preferences response contains the same quiet hours", () => {
		expect(observedValues(structuredClone(savedPrefs))).toEqual(observedValues(savedPrefs));
	});
});
