import Foundation

struct DeviceRegistration: Codable {
	var ok: Bool
	var token: String
	var environment: String
}

struct NotifyAck: Codable {
	var id: String
	var bot: String
	var push: String
	var reason: String?
	var sent: Int
	var failed: Int
}

struct InboxResponse: Codable {
	var groups: [InboxGroup]
}

struct InboxGroup: Codable, Identifiable {
	var bot: String
	var items: [InboxItem]
	var id: String { bot }
}

struct InboxItem: Codable, Identifiable {
	var id: String
	var bot: String
	var title: String
	var body: String
	var tag: String?
	var created_at: Int
	var push: String
	var skip_reason: String?
}

struct Prefs: Codable, Equatable {
	var muted: Bool
	var timezone: String
	var quiet: QuietHours?
	var muted_tags: [String]
}

struct QuietHours: Codable, Equatable {
	var start: String
	var end: String
}

struct APIErrorBody: Codable {
	var error: String
}

enum PingError: LocalizedError {
	case notConfigured
	case http(Int, String)
	case decode

	var errorDescription: String? {
		switch self {
		case .notConfigured:
			return "[PLACEHOLDER: set the Worker URL and owner secret in Settings]"
		case let .http(status, code):
			return "Server \(status): \(code)"
		case .decode:
			return "The server sent a response Ping could not read."
		}
	}
}
