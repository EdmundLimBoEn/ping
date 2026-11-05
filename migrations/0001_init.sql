CREATE TABLE bots (
	slug TEXT PRIMARY KEY,
	secret_hash TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL
);

CREATE TABLE devices (
	token TEXT PRIMARY KEY,
	environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
	updated_at INTEGER NOT NULL
);

CREATE TABLE prefs (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	muted INTEGER NOT NULL DEFAULT 0,
	timezone TEXT NOT NULL DEFAULT 'UTC',
	quiet_start TEXT,
	quiet_end TEXT,
	muted_tags TEXT NOT NULL DEFAULT '[]',
	updated_at INTEGER NOT NULL
);

INSERT INTO prefs (id, muted, timezone, quiet_start, quiet_end, muted_tags, updated_at)
VALUES (1, 0, 'UTC', NULL, NULL, '[]', 0);

CREATE TABLE notifications (
	id TEXT PRIMARY KEY,
	bot TEXT NOT NULL,
	title TEXT NOT NULL,
	body TEXT NOT NULL,
	tag TEXT,
	created_at INTEGER NOT NULL,
	push TEXT NOT NULL,
	skip_reason TEXT
);

CREATE INDEX idx_notifications_created ON notifications (created_at DESC);
CREATE INDEX idx_notifications_bot ON notifications (bot, created_at DESC);
