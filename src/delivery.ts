export type SkipReason = "muted" | "quiet_hours" | "muted_tag";

export type DeliveryDecision = { kind: "send" } | { kind: "skip"; reason: SkipReason };

export type QuietWindow = {
	startMinutes: number;
	endMinutes: number;
};

export type Prefs = {
	muted: boolean;
	timezone: string;
	quiet: QuietWindow | null;
	mutedTags: ReadonlySet<string>;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TAG_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function parseClock(value: string): number | null {
	const match = TIME_RE.exec(value);
	if (!match) return null;
	return Number(match[1]) * 60 + Number(match[2]);
}

export function formatClock(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function isValidTag(value: string): boolean {
	return TAG_RE.test(value);
}

export function isWithinQuietHours(nowMinutes: number, start: number, end: number): boolean {
	if (start === end) return false;
	if (start < end) return nowMinutes >= start && nowMinutes < end;
	return nowMinutes >= start || nowMinutes < end;
}

export function minutesInTimeZone(now: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "numeric",
		minute: "numeric",
		hourCycle: "h23",
	}).formatToParts(now);
	const hour = Number(parts.find((part) => part.type === "hour")?.value);
	const minute = Number(parts.find((part) => part.type === "minute")?.value);
	if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
		throw new RangeError(`invalid timezone: ${timeZone}`);
	}
	return hour * 60 + minute;
}

export function decideDelivery(prefs: Prefs, tag: string | null, now: Date): DeliveryDecision {
	if (prefs.muted) return { kind: "skip", reason: "muted" };
	if (tag !== null && prefs.mutedTags.has(tag)) return { kind: "skip", reason: "muted_tag" };
	if (prefs.quiet) {
		const nowMinutes = minutesInTimeZone(now, prefs.timezone);
		if (isWithinQuietHours(nowMinutes, prefs.quiet.startMinutes, prefs.quiet.endMinutes)) {
			return { kind: "skip", reason: "quiet_hours" };
		}
	}
	return { kind: "send" };
}
