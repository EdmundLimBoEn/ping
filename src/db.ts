import { HttpError } from "./http";
import { decideDelivery, formatClock, isValidTag, parseClock, type Prefs } from "./delivery";

export type DeviceRow = { token: string; environment: "sandbox" | "production"; updated_at: number };

export type PrefsRow = {
	muted: number;
	timezone: string;
	quiet_start: string | null;
	quiet_end: string | null;
	muted_tags: string;
};

export type NotificationRow = {
	id: string;
	bot: string;
	title: string;
	body: string;
	tag: string | null;
	created_at: number;
	push: string;
	skip_reason: string | null;
};

export async function loadPrefs(db: D1Database): Promise<Prefs> {
	const row = await db
		.prepare("SELECT muted, timezone, quiet_start, quiet_end, muted_tags FROM prefs WHERE id = 1")
		.first<PrefsRow>();
	if (!row) throw new HttpError(500, "misconfigured");
	return rowToPrefs(row);
}

export function rowToPrefs(row: PrefsRow): Prefs {
	let tags: unknown;
	try {
		tags = JSON.parse(row.muted_tags);
	} catch {
		tags = [];
	}
	const mutedTags = new Set<string>();
	if (Array.isArray(tags)) {
		for (const tag of tags) {
			if (typeof tag === "string" && isValidTag(tag)) mutedTags.add(tag);
		}
	}
	let quiet: Prefs["quiet"] = null;
	if (row.quiet_start && row.quiet_end) {
		const start = parseClock(row.quiet_start);
		const end = parseClock(row.quiet_end);
		if (start !== null && end !== null) {
			quiet = { startMinutes: start, endMinutes: end };
		}
	}
	return {
		muted: row.muted === 1,
		timezone: row.timezone,
		quiet,
		mutedTags,
	};
}

export function serializePrefs(prefs: Prefs) {
	return {
		muted: prefs.muted,
		timezone: prefs.timezone,
		quiet: prefs.quiet
			? {
					start: formatClock(prefs.quiet.startMinutes),
					end: formatClock(prefs.quiet.endMinutes),
				}
			: null,
		muted_tags: [...prefs.mutedTags],
	};
}

export async function upsertDevice(
	db: D1Database,
	token: string,
	environment: "sandbox" | "production",
	now: number,
): Promise<void> {
	// Give every refresh a distinct timestamp, even within the same millisecond.
	await db
		.prepare(
			`INSERT INTO devices (token, environment, updated_at) VALUES (?, ?, ?)
			 ON CONFLICT(token) DO UPDATE SET environment = excluded.environment,
			 updated_at = MAX(excluded.updated_at, devices.updated_at + 1)`,
		)
		.bind(token, environment, now)
		.run();
}

export async function deleteDevice(db: D1Database, token: string): Promise<void> {
	await db.prepare("DELETE FROM devices WHERE token = ?").bind(token).run();
}

export async function deleteDeviceIfUnchanged(db: D1Database, device: DeviceRow): Promise<void> {
	await db
		.prepare("DELETE FROM devices WHERE token = ? AND environment = ? AND updated_at = ?")
		.bind(device.token, device.environment, device.updated_at)
		.run();
}

export async function listDevices(db: D1Database): Promise<DeviceRow[]> {
	const result = await db.prepare("SELECT token, environment, updated_at FROM devices").all<DeviceRow>();
	return result.results ?? [];
}

export async function insertNotification(
	db: D1Database,
	row: NotificationRow,
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO notifications (id, bot, title, body, tag, created_at, push, skip_reason)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(row.id, row.bot, row.title, row.body, row.tag, row.created_at, row.push, row.skip_reason)
		.run();
	await db
		.prepare(
			`DELETE FROM notifications WHERE id IN (
				SELECT id FROM notifications ORDER BY created_at DESC LIMIT -1 OFFSET 500
			)`,
		)
		.run();
}

export async function listInbox(db: D1Database, limit: number): Promise<NotificationRow[]> {
	const result = await db
		.prepare(
			`SELECT id, bot, title, body, tag, created_at, push, skip_reason
			 FROM notifications
			 ORDER BY created_at DESC
			 LIMIT ?`,
		)
		.bind(limit)
		.all<NotificationRow>();
	return result.results ?? [];
}

export function groupInbox(rows: NotificationRow[]) {
	const groups: { bot: string; items: NotificationRow[] }[] = [];
	const index = new Map<string, number>();
	for (const row of rows) {
		const existing = index.get(row.bot);
		if (existing === undefined) {
			index.set(row.bot, groups.length);
			groups.push({ bot: row.bot, items: [row] });
		} else {
			groups[existing].items.push(row);
		}
	}
	return groups;
}

export function deliveryForNotify(prefs: Prefs, tag: string | null, now: Date) {
	return decideDelivery(prefs, tag, now);
}

export type PushOutcome = "sent" | "skipped" | "none" | "failed";
